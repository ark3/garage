// Proves `open()` from scripts/target.ts does not leak updates between
// same-process clients over BroadcastChannel. Bun has BroadcastChannel and
// y-websocket syncs providers in one process over it, so without cutting it
// a second client can see a write the server never received — and the
// converge scripts' "fresh client hydrates" checks would prove nothing.
// Run while `bun run dev:test` is up:
//   bun scripts/bc-check.ts
// Client b connects normally. Client a writes before its WebSocket has
// connected and is destroyed at once, so the server never hears from it.
// Asserts b does not see the value within a short window, and that a fresh
// third client, hydrated from the server alone, does not have it either.

import { open } from "./target";

const room = `bc-check-${Date.now()}`;
const KEY = "leak";

async function until(cond: () => boolean, what: string, ms = 10000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`ok: ${what}`);
}

function expect(ok: boolean, what: string) {
  if (!ok) throw new Error(`FAIL: ${what}`);
  console.log(`ok: ${what}`);
}

const seen = (doc: import("yjs").Doc) => doc.getMap<string>("m").get(KEY);

const b = open(room);
await until(() => b.provider.synced, "b synced with the server");

const a = open(room);
expect(!a.provider.wsconnected, "a writes before its WebSocket is connected");
a.doc.getMap<string>("m").set(KEY, "value");
a.provider.destroy();

await new Promise((r) => setTimeout(r, 500));
expect(seen(b.doc) === undefined, `b never sees a's write (saw: ${JSON.stringify(seen(b.doc))})`);

const c = open(room);
await until(() => c.provider.synced, "c synced with the server");
expect(seen(c.doc) === undefined, `server does not have a's write (c saw: ${JSON.stringify(seen(c.doc))})`);

for (const x of [b, c]) x.provider.destroy();
console.log("SUCCESS");
process.exit(0);
