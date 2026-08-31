// Compaction check. Run while `bun run dev` is up:
//   bun scripts/compaction.ts
// Pushes enough updates to cross the threshold, forces a cold start, and
// asserts the log collapses to one row with no data loss.

import { openDoc } from "@garage/sync";

const SERVER = "ws://localhost:8787/doc";
const N = 250; // > COMPACT_THRESHOLD (200)
const room = `compact-${Date.now()}`;

async function rowsFor(doc: string): Promise<number> {
  const stats = (await (await fetch("http://localhost:8787/debug/stats")).json()) as {
    doc: string;
    n: number;
  }[];
  return stats.find((s) => s.doc === doc)?.n ?? 0;
}

async function until(cond: () => boolean, what: string, ms = 20000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`ok: ${what}`);
}

const writer = openDoc(room, SERVER);
const items = writer.doc.getArray<number>("items");
for (let i = 0; i < N; i++) {
  items.push([i]);
  await new Promise((r) => setTimeout(r, 2)); // separate transactions/updates
}

// Early pushes coalesce into the initial sync message, so the row count is
// approximate; it just has to cross the compaction threshold.
const MIN_ROWS = 201;
let n = 0;
const start = Date.now();
while ((n = await rowsFor(room)) < MIN_ROWS && Date.now() - start < 20000) {
  await new Promise((r) => setTimeout(r, 100));
}
if (n < MIN_ROWS) throw new Error(`expected >${MIN_ROWS - 1} rows persisted, saw ${n}`);
console.log(`ok: ${n} rows persisted`);

writer.provider.destroy();
await fetch("http://localhost:8787/debug/amnesia");

// A fresh client triggers hydration, which triggers compaction.
const reader = openDoc(room, SERVER);
await until(
  () => reader.doc.getArray<number>("items").length === N,
  `fresh client sees all ${N} items`,
);
const after = await rowsFor(room);
if (after !== 1) throw new Error(`expected 1 row after compaction, saw ${after}`);
console.log("ok: log compacted to 1 row");

reader.provider.destroy();
console.log("SUCCESS");
process.exit(0);
