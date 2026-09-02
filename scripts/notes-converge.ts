// Integration check for the notes data model. Run while `bun run dev:test` is up:
//   bun scripts/notes-converge.ts [room]
// Two headless clients edit the same note's Y.Text concurrently (interleaved
// inserts), converge to identical strings, survive /debug/amnesia, and a
// fresh third client hydrates the full note set from SQLite.

import * as Y from "yjs";
import { openDoc } from "@garage/sync";
import { HTTP, SERVER } from "./target";
const room = process.argv[2] ?? `notes-converge-${Date.now()}`;

function notes(doc: Y.Doc) {
  return doc.getMap<Y.Map<unknown>>("notes");
}

function body(doc: Y.Doc, id: string): Y.Text | undefined {
  return notes(doc).get(id)?.get("text") as Y.Text | undefined;
}

async function until(cond: () => boolean, what: string, ms = 10000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`ok: ${what}`);
}

const a = openDoc(room, SERVER);
const b = openDoc(room, SERVER);

// A creates a note the way the app does.
const noteId = crypto.randomUUID();
{
  const note = new Y.Map<unknown>();
  note.set("text", new Y.Text());
  note.set("createdBy", "script-a");
  note.set("createdAt", Date.now());
  note.set("updatedAt", Date.now());
  notes(a.doc).set(noteId, note);
}
await until(() => body(b.doc, noteId) !== undefined, "B sees A's note");

// Interleaved concurrent inserts into the same Y.Text.
let expectedLen = 0;
for (let i = 0; i < 20; i++) expectedLen += `A${i} `.length + `B${i} `.length;
for (let i = 0; i < 20; i++) {
  const ta = body(a.doc, noteId)!;
  const tb = body(b.doc, noteId)!;
  ta.insert(Math.min(3 * i, ta.length), `A${i} `);
  tb.insert(Math.min(2 * i, tb.length), `B${i} `);
}
const converged = () => {
  const sa = body(a.doc, noteId)!.toString();
  const sb = body(b.doc, noteId)!.toString();
  return sa.length === expectedLen && sa === sb;
};
await until(converged, "interleaved inserts converge to identical strings");

const amnesia = await fetch(`${HTTP}/debug/amnesia`);
if (!amnesia.ok) throw new Error("amnesia route failed");

// A second note plus more text edits after the simulated eviction.
const noteId2 = crypto.randomUUID();
{
  const note = new Y.Map<unknown>();
  note.set("text", new Y.Text("second note"));
  note.set("createdBy", "script-b");
  note.set("createdAt", Date.now());
  note.set("updatedAt", Date.now());
  notes(b.doc).set(noteId2, note);
}
body(a.doc, noteId)!.insert(0, "post-amnesia ");
await until(
  () =>
    body(a.doc, noteId2)?.toString() === "second note" &&
    body(b.doc, noteId)!.toString().startsWith("post-amnesia ") &&
    body(a.doc, noteId)!.toString() === body(b.doc, noteId)!.toString(),
  "convergence across simulated eviction",
);

// A fresh client must hydrate the full note set from storage alone.
const expected = body(a.doc, noteId)!.toString();
const c = openDoc(room, SERVER);
await until(
  () =>
    body(c.doc, noteId)?.toString() === expected &&
    body(c.doc, noteId2)?.toString() === "second note" &&
    notes(c.doc).get(noteId)?.get("createdBy") === "script-a",
  "fresh client hydrates the full note set from SQLite",
);

for (const x of [a, b, c]) x.provider.destroy();
console.log("SUCCESS");
process.exit(0);
