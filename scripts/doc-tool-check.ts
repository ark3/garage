// Integration check for scripts/doc.ts. Run while `bun run dev:test` is up:
//   bun scripts/doc-tool-check.ts
// Drives the tool as a subprocess so the real CLI, exit codes included, is
// what gets exercised. A run-unique actors key is set, dumped, and deleted;
// a run-unique notes-shaped doc holds a Y.Text that the tool must refuse to
// replace or traverse, leaving the doc byte-for-byte as dumped before.

import * as Y from "yjs";
import { open } from "./target";

const run = Date.now();
const KEY = `doc-tool-check-${run}`;
const ROOM = `doc-tool-check-${run}`;

async function until(cond: () => boolean, what: string, ms = 10000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`ok: ${what}`);
}

async function tool(...args: string[]) {
  const proc = Bun.spawn(["bun", `${import.meta.dir}/doc.ts`, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

function expect(ok: boolean, what: string) {
  if (!ok) throw new Error(`FAIL: ${what}`);
  console.log(`ok: ${what}`);
}

async function dump(doc: string) {
  const r = await tool("dump", doc);
  expect(r.code === 0, `dump ${doc} exits 0`);
  return JSON.parse(r.stdout) as Record<string, Record<string, Record<string, unknown>>>;
}

// set / dump / delete on the actors directory.
let r = await tool("set", "actors", `actors.${KEY}.name`, '"Placeholder"');
expect(r.code === 0, "set actors.<key>.name exits 0");
let actors = (await dump("actors")).actors;
expect(
  JSON.stringify(actors[KEY]) === '{"name":"Placeholder"}',
  "dump actors shows the new entry",
);
r = await tool("delete", "actors", `actors.${KEY}`);
expect(r.code === 0, "delete actors.<key> exits 0");
actors = (await dump("actors")).actors;
expect(!(KEY in actors), "dump actors no longer shows the entry");

// A notes-shaped doc with a Y.Text the tool must leave alone.
// Cut the same-process BroadcastChannel so "b sees it" means the server has it.
const noteId = crypto.randomUUID();
const a = open(ROOM);
a.provider.disableBc = true;
a.provider.disconnectBc();
{
  const note = new Y.Map<unknown>();
  note.set("text", new Y.Text("hello"));
  note.set("createdBy", "doc-tool-check");
  a.doc.getMap<Y.Map<unknown>>("notes").set(noteId, note);
}
const b = open(ROOM);
b.provider.disableBc = true;
b.provider.disconnectBc();
await until(
  () => (b.doc.getMap<Y.Map<unknown>>("notes").get(noteId)?.get("text") as Y.Text | undefined)?.toString() === "hello",
  "a second client sees the note",
);
a.provider.destroy();
b.provider.destroy();

const dumped = await dump(ROOM);
expect(dumped.notes[noteId].text === "hello", "dump shows the text as a string");
const before = JSON.stringify(dumped);

r = await tool("set", ROOM, `notes.${noteId}.text`, '"clobbered"');
expect(r.code !== 0, `set onto a Y.Text exits non-zero (${r.stderr.trim()})`);
r = await tool("set", ROOM, `notes.${noteId}.text.0`, '"x"');
expect(r.code !== 0, `set through a Y.Text exits non-zero (${r.stderr.trim()})`);
r = await tool("delete", ROOM, `notes.${noteId}.text`);
expect(r.code !== 0, `delete of a Y.Text exits non-zero (${r.stderr.trim()})`);

const after = JSON.stringify(await dump(ROOM));
expect(before === after, "doc unchanged after the refusals");

console.log("SUCCESS");
process.exit(0);
