// Integration check for the actors directory shape. Run while `bun run dev:test` is up:
//   bun scripts/actors-converge.ts
// The doc name is fixed at `actors`, so keys carry a run-unique suffix rather
// than wiping. Two headless clients write disjoint entries, edit one entry
// concurrently (different fields), survive /debug/amnesia, and a fresh third
// client hydrates everything from SQLite.

import { getActor, setActor } from "@garage/sync/directory";
import { HTTP, open, sfetch } from "./target";

const run = Date.now();
const PERSON_A = `person-a-${run}@example.com`;
const PERSON_B = `person-b-${run}@example.com`;
const ROBOT = `backup-job-${run}`; // a service token's common_name

async function until(cond: () => boolean, what: string, ms = 10000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`ok: ${what}`);
}

const a = open("actors");
const b = open("actors");

// Disjoint entries from each client; the robot is just another entry.
setActor(a.doc, PERSON_A, { handle: "pa", name: "Person A", fg: "#000", bg: "#fc0" });
setActor(b.doc, PERSON_B, { handle: "pb", name: "Person B", fg: "#fff", bg: "#06c" });
setActor(b.doc, ROBOT, { handle: "backup", name: "Backup job", fg: "#fff", bg: "#444" });
await until(
  () =>
    getActor(b.doc, PERSON_A)?.handle === "pa" &&
    getActor(a.doc, PERSON_B)?.handle === "pb" &&
    getActor(a.doc, ROBOT)?.handle === "backup",
  "disjoint entries converge",
);

// Both edit the same entry at once, different fields: both edits survive.
setActor(a.doc, PERSON_A, { name: "Person A (renamed)" });
setActor(b.doc, PERSON_A, { bg: "#0c6" });
const merged = { handle: "pa", name: "Person A (renamed)", fg: "#000", bg: "#0c6" };
const sameAs = (x: object | undefined) => JSON.stringify(x) === JSON.stringify(merged);
await until(
  () => sameAs(getActor(a.doc, PERSON_A)) && sameAs(getActor(b.doc, PERSON_A)),
  "concurrent edits to one entry merge field-wise",
);

const amnesia = await sfetch(`${HTTP}/debug/amnesia`);
if (!amnesia.ok) throw new Error("amnesia route failed");

setActor(a.doc, ROBOT, { name: "Backup job (nightly)" });
await until(
  () => getActor(b.doc, ROBOT)?.name === "Backup job (nightly)",
  "convergence across simulated eviction",
);

// A fresh client must hydrate the full map from storage alone.
const c = open("actors");
await until(
  () =>
    sameAs(getActor(c.doc, PERSON_A)) &&
    getActor(c.doc, PERSON_B)?.name === "Person B" &&
    getActor(c.doc, ROBOT)?.name === "Backup job (nightly)",
  "fresh client hydrates the full actors map from SQLite",
);

for (const x of [a, b, c]) x.provider.destroy();
console.log("SUCCESS");
process.exit(0);
