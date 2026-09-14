// One-off migration: notes' `createdBy` from the raw identity string (schema 1)
// to the actor's `handle` (schema 2). Run while the target server is up:
//   bun scripts/migrate-notes-createdby.ts
// Idempotent: a value equal to some `actors` key becomes that entry's handle;
// a value already equal to some handle is left alone; anything else is
// reported and left alone. Then the straggler check: every `clients` entry
// that has not synced notes at the target schema since this run started is
// listed, since it could still hold an old bundle that writes the old shape.
// The migration closes when a rerun prints migrated=0 and stragglers: 0.

import { actorsMap, clientsMap, type Actor, type Client } from "@garage/sync/directory";
import { SCHEMA, notesMap } from "../apps/notes/src/model";
import { open } from "./target";

const startedAt = Date.now();

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

const actors = await connect("actors");
const handleOf = new Map<string, string>();
for (const [key, entry] of actorsMap(actors.doc).entries()) {
  handleOf.set(key, (entry.toJSON() as Actor).handle);
}
const handles = new Set(handleOf.values());

const notes = await connect("notes");
const migrated = new Map<string, string>(); // note id -> new createdBy
let already = 0;
const unknown: string[] = [];
notes.doc.transact(() => {
  for (const [id, note] of notesMap(notes.doc).entries()) {
    const value = note.get("createdBy") as string;
    if (handles.has(value)) {
      already++;
    } else if (handleOf.has(value)) {
      const handle = handleOf.get(value)!;
      note.set("createdBy", handle);
      migrated.set(id, handle);
    } else {
      unknown.push(value);
    }
  }
});
console.log(`migrated=${migrated.size} already=${already} unknown=${unknown.length}`);
for (const value of unknown) console.log(`  unknown createdBy: ${JSON.stringify(value)}`);

const clients = await connect("clients");
let stragglers = 0;
for (const [id, entry] of clientsMap(clients.doc).entries()) {
  const client = entry.toJSON() as Client;
  const app = client.apps.notes;
  if (app && app.schema >= SCHEMA && app.syncedAt >= startedAt) continue;
  stragglers++;
  console.log(`  straggler: ${client.label ?? id} (${client.actor})`);
}
console.log(`stragglers: ${stragglers}`);

// The sync protocol acks nothing: a second client must observe the writes.
const check = await connect("notes");
await until(
  () => [...migrated].every(([id, handle]) => notesMap(check.doc).get(id)?.get("createdBy") === handle),
  "a second client to observe the migrated values",
);
for (const x of [actors, notes, clients, check]) x.provider.destroy();
process.exit(0);
