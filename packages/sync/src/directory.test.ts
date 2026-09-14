import { expect, test } from "bun:test";
import * as Y from "yjs";
import { getActor, setActor } from "./directory";

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
