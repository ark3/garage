import { expect, test } from "bun:test";
import * as Y from "yjs";
import { CLIENT_ID_KEY, WHOAMI_KEY, clientId, meOf, resolveActor, stampOnSync } from "./app";
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

// A stand-in for the provider's sync surface: `synced` plus the sync event.
function fakeSource(synced = false) {
  const fns: ((s: boolean) => void)[] = [];
  return {
    synced,
    on: (_: "sync", fn: (s: boolean) => void) => void fns.push(fn),
    emit: (s: boolean) => fns.forEach((f) => f(s)),
  };
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
