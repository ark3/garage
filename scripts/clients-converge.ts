// Integration check for the clients directory shape and its after-sync stamp.
// Run while `bun run dev:test` is up:
//   bun scripts/clients-converge.ts
// The doc name is fixed at `clients`, so client ids are run-unique UUIDs and
// only this run's entries are asserted on. Client A stamps itself (the
// marker); client B opens later, and in its `sync` handler asserts A's
// marker is already present before stamping — the ordering the plan doc
// relies on. Then: restamp leaves label/firstSeen alone, two apps coexist,
// `sync` fires again on reconnect, /debug/amnesia survival, and a fresh
// client hydrates everything.

import { getClient, setClient, stampClient } from "@garage/sync/directory";
import { HTTP, open, sfetch } from "./target";

const ACTOR = "person-a@example.com";
const CLIENT_A = crypto.randomUUID();
const CLIENT_B = crypto.randomUUID();
const notes = { actor: ACTOR, app: "notes", build: "abc1234", schema: 1 };

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

const a = open("clients");
let aSyncs = 0;
a.provider.on("sync", (state: boolean) => {
  if (state) aSyncs++;
});
await until(() => a.provider.synced, "client A synced");
stampClient(a.doc, { ...notes, clientId: CLIENT_A });

// B opens after A's marker exists on the server. Its stamp is written inside
// its own `sync` handler, where A's marker must already be present.
const b = open("clients");
let markerSeenByB: boolean | undefined;
b.provider.once("sync", (state: boolean) => {
  if (!state) return;
  markerSeenByB = getClient(b.doc, CLIENT_A) !== undefined;
  stampClient(b.doc, { ...notes, clientId: CLIENT_B });
});
await until(() => getClient(a.doc, CLIENT_B) !== undefined, "A observes B's stamp");
assert(markerSeenByB === true, "B held A's marker when it stamped (stamp is after sync)");
assert(b.provider.synced, "B's provider reports synced");

// Hand-edited label survives a restamp; firstSeen is stable; two apps coexist.
setClient(a.doc, CLIENT_A, { label: "Someone's laptop" });
const first = getClient(a.doc, CLIENT_A)!;
await new Promise((r) => setTimeout(r, 5));
stampClient(a.doc, { ...notes, clientId: CLIENT_A, build: "def5678", schema: 2 });
stampClient(a.doc, { ...notes, clientId: CLIENT_A, app: "flashcards", schema: 3 });
const restamped = getClient(a.doc, CLIENT_A)!;
assert(restamped.label === "Someone's laptop", "restamp leaves label alone");
assert(restamped.firstSeen === first.firstSeen, "restamp leaves firstSeen alone");
assert(restamped.apps.notes.syncedAt > first.apps.notes.syncedAt, "restamp advances syncedAt");
assert(restamped.apps.notes.build === "def5678", "restamp updates build");
assert(restamped.apps.notes.schema === 2, "restamp updates schema");
assert(restamped.apps.flashcards.schema === 3, "stamps for two apps coexist");
await until(
  () => JSON.stringify(getClient(b.doc, CLIENT_A)) === JSON.stringify(restamped),
  "B converges on A's restamped entry",
);

// `sync` fires again on every reconnect, so an app can restamp there.
assert(aSyncs === 1, "A has synced exactly once so far");
a.provider.disconnect();
a.provider.connect();
await until(() => aSyncs === 2, "sync(true) fires again after reconnect");

const amnesia = await sfetch(`${HTTP}/debug/amnesia`);
if (!amnesia.ok) throw new Error("amnesia route failed");

stampClient(b.doc, { ...notes, clientId: CLIENT_B, build: "0123abc" });
await until(
  () => getClient(a.doc, CLIENT_B)?.apps.notes.build === "0123abc",
  "convergence across simulated eviction",
);

// A fresh client must hydrate the full map from storage alone.
const c = open("clients");
await until(
  () =>
    JSON.stringify(getClient(c.doc, CLIENT_A)) === JSON.stringify(restamped) &&
    getClient(c.doc, CLIENT_B)?.apps.notes.build === "0123abc",
  "fresh client hydrates both entries from SQLite",
);

for (const x of [a, b, c]) x.provider.destroy();
console.log("SUCCESS");
process.exit(0);
