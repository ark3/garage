// Generic doc tool: inspect and hand-edit any doc without a per-app script.
//   bun scripts/doc.ts dump <doc>                # every top-level type, as JSON
//   bun scripts/doc.ts set <doc> <path> <json>   # e.g. actors.someone.name '"Someone"'
//   bun scripts/doc.ts delete <doc> <path>
// Targets whatever scripts/target.ts says: the disposable test server by
// default, the family server only with an explicit GARAGE_URL, production
// with URL plus service token.
//
// A path is dot-separated. The first segment names a top-level type (created
// as a Y.Map if absent); later segments are Y.Map keys, or indices when the
// parent is a Y.Array. `set` creates missing intermediate Y.Maps; a JSON
// object becomes a nested Y.Map, an array a Y.Array, scalars are stored as
// is. Setting an array index equal to its length appends.
//
// Y.Text is never created, replaced, deleted, or traversed: text has edit
// semantics, and a path-set would destroy its collaborative history. There
// is no way for a generic tool to know which strings are text, so it refuses
// rather than guesses — exit code non-zero, doc untouched.
//
// The sync protocol acks nothing, so after a write a second client is opened
// and the tool waits until it observes the new value (or its absence) before
// printing done. A timeout exits non-zero.

import * as Y from "yjs";
import { open } from "./target";

const [cmd, name, path, json] = process.argv.slice(2);

async function until(cond: () => boolean, what: string, ms = 10000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function connect(room: string) {
  const client = open(room);
  await until(() => client.provider.synced, `sync of ${room}`);
  return client;
}

// After sync a top-level type is a bare AbstractType until a getX() call
// names its kind; pick the kind from what it holds. Undefined if absent.
function root(doc: Y.Doc, key: string): Y.AbstractType<unknown> | undefined {
  const t = doc.share.get(key);
  if (!t) return undefined;
  if (t.constructor !== Y.AbstractType) return t;
  const first = t._start?.content;
  if (first instanceof Y.ContentString || first instanceof Y.ContentFormat) {
    return doc.getText(key);
  }
  if (t._map.size === 0 && t._start) return doc.getArray(key);
  return doc.getMap(key);
}

function isText(v: unknown): v is Y.Text {
  return v instanceof Y.Text;
}

function child(parent: Y.Map<unknown> | Y.Array<unknown>, seg: string): unknown {
  return parent instanceof Y.Array ? parent.get(index(parent, seg)) : parent.get(seg);
}

function index(arr: Y.Array<unknown>, seg: string): number {
  const i = Number(seg);
  if (!Number.isInteger(i) || i < 0) throw new Error(`"${seg}" is not an array index`);
  return i;
}

// Walk to the container that holds the last segment. With `create`, missing
// map keys along the way become Y.Maps (inside the caller's transaction);
// without it the walk stops at the first gap and returns undefined.
function locate(
  doc: Y.Doc,
  segs: string[],
  create: boolean,
): Y.Map<unknown> | Y.Array<unknown> | undefined {
  if (segs.length < 2) throw new Error("path needs at least two segments");
  let node: unknown = root(doc, segs[0]) ?? (create ? doc.getMap(segs[0]) : undefined);
  for (let i = 1; i < segs.length - 1; i++) {
    if (node === undefined) return undefined;
    if (isText(node)) throw new Error(`refusing to traverse Y.Text at ${segs.slice(0, i).join(".")}`);
    if (!(node instanceof Y.Map || node instanceof Y.Array)) {
      throw new Error(`cannot traverse scalar at ${segs.slice(0, i).join(".")}`);
    }
    let next = child(node, segs[i]);
    if (next === undefined && create && node instanceof Y.Map) {
      next = new Y.Map<unknown>();
      node.set(segs[i], next);
    }
    node = next;
  }
  if (node === undefined) return undefined;
  if (isText(node)) throw new Error(`refusing to traverse Y.Text at ${segs.slice(0, -1).join(".")}`);
  if (!(node instanceof Y.Map || node instanceof Y.Array)) {
    throw new Error(`cannot traverse scalar at ${segs.slice(0, -1).join(".")}`);
  }
  return node;
}

function toY(value: unknown): unknown {
  if (Array.isArray(value)) {
    const arr = new Y.Array<unknown>();
    arr.push(value.map(toY));
    return arr;
  }
  if (value !== null && typeof value === "object") {
    const map = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(value)) map.set(k, toY(v));
    return map;
  }
  return value;
}

// Plain-JSON view of whatever sits at the path; undefined if absent.
function read(doc: Y.Doc, segs: string[]): unknown {
  const parent = locate(doc, segs, false);
  if (!parent) return undefined;
  const last = segs[segs.length - 1];
  if (parent instanceof Y.Array && index(parent, last) >= parent.length) return undefined;
  const v = child(parent, last);
  return v instanceof Y.AbstractType ? v.toJSON() : v;
}

function dump(doc: Y.Doc): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of doc.share.keys()) out[key] = root(doc, key)!.toJSON();
  return out;
}

function set(doc: Y.Doc, segs: string[], value: unknown) {
  doc.transact(() => {
    const parent = locate(doc, segs, true)!;
    const last = segs[segs.length - 1];
    if (parent instanceof Y.Map) {
      if (isText(parent.get(last))) throw new Error(`refusing to replace Y.Text at ${segs.join(".")}`);
      parent.set(last, toY(value));
      return;
    }
    const i = index(parent, last);
    if (i > parent.length) throw new Error(`index ${i} is past the end of ${segs.slice(0, -1).join(".")}`);
    if (i < parent.length) {
      if (isText(parent.get(i))) throw new Error(`refusing to replace Y.Text at ${segs.join(".")}`);
      parent.delete(i, 1);
    }
    parent.insert(i, [toY(value)]);
  });
}

function del(doc: Y.Doc, segs: string[]) {
  const parent = locate(doc, segs, false);
  if (!parent) return;
  const last = segs[segs.length - 1];
  if (parent instanceof Y.Map) {
    if (isText(parent.get(last))) throw new Error(`refusing to delete Y.Text at ${segs.join(".")}`);
    parent.delete(last);
    return;
  }
  const i = index(parent, last);
  if (i >= parent.length) return;
  if (isText(parent.get(i))) throw new Error(`refusing to delete Y.Text at ${segs.join(".")}`);
  parent.delete(i, 1);
}

async function main() {
  if (!name) throw new Error("usage: doc.ts dump <doc> | set <doc> <path> <json> | delete <doc> <path>");
  const a = await connect(name);
  if (cmd === "dump") {
    console.log(JSON.stringify(dump(a.doc), null, 2));
    return;
  }
  if (!path) throw new Error(`${cmd} needs a path`);
  const segs = path.split(".");
  let expected: string | undefined;
  if (cmd === "set") {
    if (json === undefined) throw new Error("set needs a JSON value");
    const value = JSON.parse(json);
    set(a.doc, segs, value);
    expected = JSON.stringify(value);
  } else if (cmd === "delete") {
    del(a.doc, segs);
  } else {
    throw new Error(`unknown command "${cmd}"`);
  }
  const b = await connect(name);
  await until(
    () => JSON.stringify(read(b.doc, segs)) === expected,
    `a second client to observe ${cmd} ${path}`,
  );
  console.log(`done: ${cmd} ${name} ${path}`);
}

try {
  await main();
  process.exit(0);
} catch (e) {
  console.error(`error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
