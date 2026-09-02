// Integration check for the sync path. Run while `bun run dev:test` is up:
//   bun scripts/converge.ts [room]
// Two clients connect, each adds an item, then we assert both see both —
// including across a simulated hibernation eviction (/debug/amnesia).

import { openDoc } from "@garage/sync";
import { HTTP, SERVER } from "./target";
const room = process.argv[2] ?? `converge-${Date.now()}`;

function items(doc: import("yjs").Doc) {
  return doc.getArray<{ text: string }>("items");
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

const has = (doc: import("yjs").Doc, text: string) =>
  items(doc).toArray().some((i) => i.text === text);

items(a.doc).push([{ text: "from-A" }]);
items(b.doc).push([{ text: "from-B" }]);
await until(() => has(a.doc, "from-B") && has(b.doc, "from-A"), "initial convergence");

const amnesia = await fetch(`${HTTP}/debug/amnesia`);
if (!amnesia.ok) throw new Error("amnesia route failed");

items(b.doc).push([{ text: "post-amnesia" }]);
await until(() => has(a.doc, "post-amnesia"), "convergence across simulated eviction");

// A third, fresh client must receive everything from storage alone.
const c = openDoc(room, SERVER);
await until(
  () => has(c.doc, "from-A") && has(c.doc, "from-B") && has(c.doc, "post-amnesia"),
  "fresh client hydrates from SQLite",
);

for (const x of [a, b, c]) x.provider.destroy();
console.log("SUCCESS");
process.exit(0);
