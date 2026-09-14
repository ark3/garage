import { expect, test } from "bun:test";
import * as Y from "yjs";
import {
  CLIENT_ID_KEY,
  WHOAMI_KEY,
  clientId,
  guardSchema,
  meOf,
  resolveActor,
  schemaOf,
  schemaState,
  setSchema,
  shouldReload,
  stampOnSync,
} from "./app";
import { getClient, setActor } from "./directory";

function fakeStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    dump: () => Object.fromEntries(m),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("clientId generates a UUID once and reuses it", () => {
  const store = fakeStore();
  const id = clientId(store);
  expect(id).toMatch(UUID);
  expect(clientId(store)).toBe(id);
  expect(store.dump()).toEqual({ [CLIENT_ID_KEY]: id });
});

test("clientId keeps an existing id", () => {
  const store = fakeStore({ [CLIENT_ID_KEY]: "existing" });
  expect(clientId(store)).toBe("existing");
});

const ok = (body: string) => (async () => new Response(body)) as typeof fetch;
const offline = (async () => {
  throw new TypeError("Failed to fetch");
}) as typeof fetch;

test("resolveActor takes /whoami and caches it", async () => {
  const store = fakeStore();
  expect(await resolveActor(store, ok("person-a@example.com\n"))).toBe("person-a@example.com");
  expect(store.dump()).toEqual({ [WHOAMI_KEY]: "person-a@example.com" });
});

test("resolveActor falls back to the cache offline, else unknown", async () => {
  expect(await resolveActor(fakeStore({ [WHOAMI_KEY]: "cached@example.com" }), offline)).toBe(
    "cached@example.com",
  );
  expect(await resolveActor(fakeStore(), offline)).toBe("unknown");
});

test("me reflects the actors doc as it changes; unmapped is undefined", () => {
  const actors = new Y.Doc();
  const me = meOf(actors, "person-a@example.com");
  const seen: unknown[] = [];
  const stop = me.observe((a) => seen.push(a));
  expect(me.current).toBeUndefined();
  const entry = { handle: "pa", name: "Person A", fg: "#000", bg: "#fc0" };
  setActor(actors, "person-a@example.com", entry);
  setActor(actors, "person-b@example.com", { ...entry, handle: "pb" });
  setActor(actors, "person-a@example.com", { name: "Renamed" });
  expect(me.current).toEqual({ ...entry, name: "Renamed" });
  // Every actors change re-reads my entry, even someone else's edit.
  expect(seen).toEqual([entry, entry, { ...entry, name: "Renamed" }]);
  stop();
  setActor(actors, "person-a@example.com", { name: "Again" });
  expect(seen.length).toBe(3);
});

// A stand-in for the provider's sync surface: `synced`, the sync event, and
// disconnect (which drops `synced`, as y-websocket does).
function fakeSource(synced = false) {
  const fns: ((s: boolean) => void)[] = [];
  const source = {
    synced,
    disconnects: 0,
    on: (_: "sync", fn: (s: boolean) => void) => void fns.push(fn),
    emit: (s: boolean) => {
      source.synced = s;
      fns.forEach((f) => f(s));
    },
    disconnect: () => {
      source.disconnects++;
      source.synced = false;
    },
  };
  return source;
}

const stamp = {
  clientId: "00000000-0000-4000-8000-000000000001",
  actor: "person-a@example.com",
  app: "scratch",
  build: "abc1234",
  schema: 1,
};

test("stampOnSync writes the payload on each sync(true) only", () => {
  const clients = new Y.Doc();
  const source = fakeSource();
  stampOnSync(source, clients, stamp);
  expect(getClient(clients, stamp.clientId)).toBeUndefined();
  source.emit(false);
  expect(getClient(clients, stamp.clientId)).toBeUndefined();
  source.emit(true);
  const c = getClient(clients, stamp.clientId)!;
  expect(c.actor).toBe(stamp.actor);
  expect(c.apps.scratch).toEqual({ build: "abc1234", schema: 1, syncedAt: c.apps.scratch.syncedAt });
  source.emit(true);
  expect(getClient(clients, stamp.clientId)!.apps.scratch.syncedAt).toBeGreaterThanOrEqual(
    c.apps.scratch.syncedAt,
  );
});

test("stampOnSync stamps immediately when already synced", () => {
  const clients = new Y.Doc();
  stampOnSync(fakeSource(true), clients, stamp);
  expect(getClient(clients, stamp.clientId)!.apps.scratch.build).toBe("abc1234");
});

test("schemaState: absent, behind, same, ahead", () => {
  const doc = new Y.Doc();
  expect(schemaState(doc, 2)).toBe("absent");
  setSchema(doc, 1);
  expect(schemaState(doc, 2)).toBe("behind");
  setSchema(doc, 2);
  expect(schemaState(doc, 2)).toBe("same");
  setSchema(doc, 3);
  expect(schemaState(doc, 2)).toBe("ahead");
  expect(schemaOf(doc)).toBe(3);
});

test("guardSchema writes the marker when absent or behind, only once synced", () => {
  const doc = new Y.Doc();
  const source = fakeSource();
  let stale = 0;
  guardSchema(doc, source, 2, () => stale++);
  expect(schemaOf(doc)).toBeUndefined();
  setSchema(doc, 1); // e.g. the IndexedDB copy arriving before the server
  expect(schemaOf(doc)).toBe(1);
  source.emit(true);
  expect(schemaOf(doc)).toBe(2);
  expect(stale).toBe(0);
  expect(source.disconnects).toBe(0);
});

test("guardSchema writes immediately when already synced and the marker is absent", () => {
  const doc = new Y.Doc();
  guardSchema(doc, fakeSource(true), 1, () => {});
  expect(schemaOf(doc)).toBe(1);
});

test("guardSchema on a doc ahead disconnects, reports stale once, and never writes", () => {
  const doc = new Y.Doc();
  setSchema(doc, 2);
  const source = fakeSource(true);
  let stale = 0;
  guardSchema(doc, source, 1, () => stale++);
  expect(source.disconnects).toBe(1);
  expect(stale).toBe(1);
  expect(schemaOf(doc)).toBe(2);
  // A later sync or meta change does not resurrect the bundle's own marker.
  source.emit(true);
  setSchema(doc, 3);
  expect(schemaOf(doc)).toBe(3);
  expect(source.disconnects).toBe(1);
  expect(stale).toBe(1);
});

test("guardSchema goes stale when the marker moves ahead after sync", () => {
  const doc = new Y.Doc();
  const source = fakeSource(true);
  let stale = 0;
  guardSchema(doc, source, 1, () => stale++);
  expect(schemaOf(doc)).toBe(1);
  setSchema(doc, 2); // another client's bump arriving as a meta change
  expect(source.disconnects).toBe(1);
  expect(stale).toBe(1);
  expect(schemaOf(doc)).toBe(2);
});

test("shouldReload says yes once per app and marker", () => {
  const store = fakeStore();
  expect(shouldReload(store, "notes", 2)).toBe(true);
  expect(shouldReload(store, "notes", 2)).toBe(false);
  expect(shouldReload(store, "notes", 3)).toBe(true);
  expect(shouldReload(store, "scratch", 3)).toBe(true);
  expect(store.dump()).toEqual({ "garage.stale.notes": "3", "garage.stale.scratch": "3" });
});
