import { expect, test } from "bun:test";
import * as Y from "yjs";
import { getActor, getClient, setActor, setClient, stampClient } from "./directory";

const ID = "person-a@example.com";
const full = { handle: "pa", name: "Person A", fg: "#000", bg: "#fc0" };

test("setActor creates, then merges partial updates in place", () => {
  const doc = new Y.Doc();
  expect(getActor(doc, ID)).toBeUndefined();
  setActor(doc, ID, full);
  setActor(doc, ID, { name: "Renamed" });
  expect(getActor(doc, ID)).toEqual({ ...full, name: "Renamed" });
});

test("concurrent partial updates to one entry keep both fields", () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  setActor(a, ID, full);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  setActor(a, ID, { name: "Renamed" });
  setActor(b, ID, { bg: "#0c6" });
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  const merged = { ...full, name: "Renamed", bg: "#0c6" };
  expect(getActor(a, ID)).toEqual(merged);
  expect(getActor(b, ID)).toEqual(merged);
});

const CLIENT = "00000000-0000-4000-8000-000000000001";
const notes = { clientId: CLIENT, actor: ID, app: "notes", build: "abc1234", schema: 1 };

test("stampClient creates the entry with actor, firstSeen, and the app stamp", () => {
  const doc = new Y.Doc();
  const before = Date.now();
  stampClient(doc, notes);
  const c = getClient(doc, CLIENT)!;
  expect(c.actor).toBe(ID);
  expect(c.label).toBeUndefined();
  expect(c.firstSeen).toBeGreaterThanOrEqual(before);
  expect(c.apps.notes.build).toBe("abc1234");
  expect(c.apps.notes.schema).toBe(1);
  expect(c.apps.notes.syncedAt).toBeGreaterThanOrEqual(before);
});

test("restamp updates only the app stamp, preserving label and firstSeen", () => {
  const doc = new Y.Doc();
  stampClient(doc, notes);
  setClient(doc, CLIENT, { label: "Someone's phone" });
  const first = getClient(doc, CLIENT)!;
  stampClient(doc, { ...notes, build: "def5678", schema: 2 });
  const second = getClient(doc, CLIENT)!;
  expect(second.label).toBe("Someone's phone");
  expect(second.firstSeen).toBe(first.firstSeen);
  expect(second.actor).toBe(first.actor);
  expect(second.apps.notes.build).toBe("def5678");
  expect(second.apps.notes.schema).toBe(2);
  expect(second.apps.notes.syncedAt).toBeGreaterThanOrEqual(first.apps.notes.syncedAt);
});

test("stamps for two apps on one client coexist", () => {
  const doc = new Y.Doc();
  stampClient(doc, notes);
  stampClient(doc, { ...notes, app: "flashcards", schema: 3 });
  const c = getClient(doc, CLIENT)!;
  expect(Object.keys(c.apps).sort()).toEqual(["flashcards", "notes"]);
  expect(c.apps.notes.schema).toBe(1);
  expect(c.apps.flashcards.schema).toBe(3);
});
