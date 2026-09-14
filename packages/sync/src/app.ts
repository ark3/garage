// The pieces openApp (index.ts) composes, kept free of y-websocket and
// IndexedDB so they can be unit-tested: the per-browser client id, the actor
// string, the `me` view over the actors doc, the after-sync stamp, and the
// schema marker guard.

import * as Y from "yjs";
import { actorsMap, getActor, stampClient, type Actor } from "./directory";

// The subset of localStorage the helper touches; tests pass a plain object.
export type Store = Pick<Storage, "getItem" | "setItem">;

export const CLIENT_ID_KEY = "garage.clientId";
export const WHOAMI_KEY = "whoami"; // same key notes already caches under

// crypto.randomUUID needs a secure context; plain-http LAN dev is not one.
export function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// One id per browser profile, generated on first use and never rotated.
export function clientId(store: Store): string {
  let id = store.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = uuid();
    store.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

// The identity string the server sees: /whoami when reachable (and cached
// for next time), the cache when offline, "unknown" on a cold offline start.
export async function resolveActor(
  store: Store,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  try {
    const actor = (await (await fetchFn("/whoami")).text()).trim();
    store.setItem(WHOAMI_KEY, actor);
    return actor;
  } catch {
    return store.getItem(WHOAMI_KEY) ?? "unknown";
  }
}

// A live view of this actor's directory entry. It is not a promise because
// the actors doc arrives in stages (IndexedDB, then the server, then hand
// edits), and each stage can change the answer; `undefined` means unmapped.
export type Me = {
  readonly current: Actor | undefined;
  observe(fn: (me: Actor | undefined) => void): () => void;
};

export function meOf(actors: Y.Doc, actor: string): Me {
  const map = actorsMap(actors);
  return {
    get current() {
      return getActor(actors, actor);
    },
    observe(fn) {
      const handler = () => fn(getActor(actors, actor));
      map.observeDeep(handler);
      return () => map.unobserveDeep(handler);
    },
  };
}

// Stamps `clients` now if the app doc is already synced, and again on every
// later sync(true) (y-websocket emits one per reconnect). Only the provider
// surface used here is named, so a test can drive it with a plain emitter.
export type SyncSource = {
  readonly synced: boolean;
  on(event: "sync", fn: (state: boolean) => void): void;
};

export function stampOnSync(
  source: SyncSource,
  clients: Y.Doc,
  stamp: Parameters<typeof stampClient>[1],
): void {
  const write = () => stampClient(clients, stamp);
  source.on("sync", (state) => {
    if (state) write();
  });
  if (source.synced) write();
}

// Every app doc carries a top-level `meta` map whose `schema` is the shape
// the store currently holds. A bundle compares it with its own schema
// constant: behind or absent means this bundle moves the store to its shape
// (the idempotent migration script maps leftover old values whenever it
// runs); ahead means this bundle is stale and must stop writing.
export function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap("meta");
}

export function schemaOf(doc: Y.Doc): number | undefined {
  return metaMap(doc).get("schema") as number | undefined;
}

export function setSchema(doc: Y.Doc, schema: number): void {
  metaMap(doc).set("schema", schema);
}

export type SchemaState = "absent" | "behind" | "same" | "ahead";

export function schemaState(doc: Y.Doc, schema: number): SchemaState {
  const marker = schemaOf(doc);
  if (marker === undefined) return "absent";
  return marker < schema ? "behind" : marker > schema ? "ahead" : "same";
}

export type SchemaSource = SyncSource & { disconnect(): void };

// Runs the comparison now, on every sync(true), and on every change to
// `meta` (IndexedDB load, another client's bump). The stale check always
// comes first, and the marker is written only while synced, so a bundle
// that has not yet seen the server's marker never overwrites a newer one
// with its own. Ahead: disconnect before anything else, call onStale once,
// and never write again — not even after a later sync.
export function guardSchema(
  doc: Y.Doc,
  source: SchemaSource,
  schema: number,
  onStale: () => void,
): void {
  let stale = false;
  const check = () => {
    if (stale) return;
    const state = schemaState(doc, schema);
    if (state === "ahead") {
      stale = true;
      source.disconnect();
      onStale();
    } else if (state !== "same" && source.synced) {
      setSchema(doc, schema);
    }
  };
  metaMap(doc).observe(check);
  source.on("sync", (state) => {
    if (state) check();
  });
  check();
}

// Reload once per key and value for the session, so a server still serving
// the old bundle cannot loop. Records the value as a side effect when it
// says yes.
function reloadOnce(store: Store, key: string, value: string): boolean {
  if (store.getItem(key) === value) return false;
  store.setItem(key, value);
  return true;
}

// Whether a stale bundle should reload: once per app and marker.
export function shouldReload(store: Store, app: string, marker: number): boolean {
  return reloadOnce(store, `garage.stale.${app}`, String(marker));
}

// Whether a bundle should reload because the server serves a different
// build: once per app and served value, and never for its own.
export function shouldReloadBuild(
  store: Store,
  app: string,
  own: string,
  served: string,
): boolean {
  return served !== own && reloadOnce(store, `garage.build.${app}`, served);
}
