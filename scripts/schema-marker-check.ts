// Integration check for the schema marker guard. Run while `bun run dev:test` is up:
//   bun scripts/schema-marker-check.ts
// Client A (schema 1) writes a value and syncs, which sets meta.schema = 1.
// Client B (schema 2) syncs, sees the doc behind, and moves the marker to 2.
// A observes the marker going ahead: its guard disconnects the provider and
// reports stale. A write A attempts afterwards never reaches a fresh client
// C, and the marker C hydrates is still 2 (A never wrote its own back).
//
// Headless, this drives guardSchema over the real provider; what runs only
// in a browser — openApp's onStale (IndexedDB teardown, the sessionStorage
// reload guard, location.reload) — is unit-tested where it is pure and not
// exercised here.

import { guardSchema, schemaOf } from "@garage/sync";
import { open } from "./target";

const room = `schema-marker-${Date.now()}`;

function items(doc: import("yjs").Doc) {
  return doc.getArray<{ text: string }>("items");
}

const has = (doc: import("yjs").Doc, text: string) =>
  items(doc).toArray().some((i) => i.text === text);

async function until(cond: () => boolean, what: string, ms = 10000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`ok: ${what}`);
}

function assert(cond: boolean, what: string) {
  if (!cond) throw new Error(`assertion failed: ${what}`);
  console.log(`ok: ${what}`);
}

const a = open(room);
let aStale = 0;
guardSchema(a.doc, a.provider, 1, () => aStale++);
items(a.doc).push([{ text: "from-A" }]);
await until(() => schemaOf(a.doc) === 1, "A synced and set the marker to 1");
assert(aStale === 0, "A is not stale at its own schema");

const b = open(room);
guardSchema(b.doc, b.provider, 2, () => {
  throw new Error("B must never be stale");
});
await until(() => has(b.doc, "from-A") && schemaOf(b.doc) === 2, "B synced and moved the marker to 2");

await until(() => aStale === 1, "A observed the marker going ahead and reported stale");
assert(schemaOf(a.doc) === 2, "A's doc holds the newer marker, not its own");
assert(a.provider.shouldConnect === false, "A's provider was disconnected");
await until(() => !a.provider.wsconnected, "A's socket is closed");

// A write from the stale bundle stays local.
items(a.doc).push([{ text: "after-stale" }]);
await new Promise((r) => setTimeout(r, 500));

const c = open(room);
await until(() => has(c.doc, "from-A") && schemaOf(c.doc) === 2, "fresh client C hydrates from-A and marker 2");
await new Promise((r) => setTimeout(r, 500));
assert(!has(c.doc, "after-stale"), "A's post-stale write never reached C");
assert(!has(b.doc, "after-stale"), "A's post-stale write never reached B");

for (const x of [a, b, c]) x.provider.destroy();
console.log("SUCCESS");
process.exit(0);
