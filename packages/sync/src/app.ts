// The pieces openApp (index.ts) composes, kept free of y-websocket and
// IndexedDB so they can be unit-tested: the per-browser client id, the actor
// string, the `me` view over the actors doc, and the after-sync stamp.

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
