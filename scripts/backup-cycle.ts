// Backup/restore cycle check. Run while `bun run dev:test` is up:
//   bun scripts/backup-cycle.ts
// Seeds two docs (one pushed past the compaction threshold so a snapshot row
// is covered), takes a backup, wipes the server, proves restore recovers
// everything, then proves restoring an older backup cannot destroy a newer
// edit (merge, not replace).

import * as Y from "yjs";
import { openDoc } from "@garage/sync";
import { fromBase64, type BackupEnvelope } from "@garage/sync/backup";
import { HTTP, SERVER } from "./target";

const stamp = Date.now();
const roomA = `backup-a-${stamp}`;
const roomB = `backup-b-${stamp}`; // gets compacted
const N = 250; // > COMPACT_THRESHOLD (200)

async function until(cond: () => boolean | Promise<boolean>, what: string, ms = 20000) {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`ok: ${what}`);
}

async function rowsFor(doc: string): Promise<number> {
  const stats = (await (await fetch(`${HTTP}/debug/stats`)).json()) as {
    doc: string;
    n: number;
  }[];
  return stats.find((s) => s.doc === doc)?.n ?? 0;
}

async function takeBackup(): Promise<BackupEnvelope> {
  const res = await fetch(`${HTTP}/api/backup`);
  if (!res.ok) throw new Error(`backup failed: ${res.status}`);
  return (await res.json()) as BackupEnvelope;
}

async function restore(envelope: BackupEnvelope) {
  const res = await fetch(`${HTTP}/api/restore`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
  if (!res.ok) throw new Error(`restore failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { restored: Record<string, number> };
}

const texts = (doc: Y.Doc) =>
  doc.getArray<{ text: string }>("items").toArray().map((i) => i.text);

// 1. Seed roomA with known content and roomB past the compaction threshold.
{
  const a = openDoc(roomA, SERVER);
  a.doc.getArray("items").push([{ text: "alpha" }, { text: "beta" }]);
  await until(async () => (await rowsFor(roomA)) >= 1, "roomA persisted");
  a.provider.destroy();

  const b = openDoc(roomB, SERVER);
  const items = b.doc.getArray<number>("items");
  for (let i = 0; i < N; i++) {
    items.push([i]);
    await new Promise((r) => setTimeout(r, 2)); // separate transactions/updates
  }
  await until(async () => (await rowsFor(roomB)) > 200, "roomB pushed past threshold");
  b.provider.destroy();
  await fetch(`${HTTP}/debug/amnesia`);
  const reader = openDoc(roomB, SERVER); // hydration triggers compaction
  await until(() => reader.doc.getArray<number>("items").length === N, "roomB hydrates");
  reader.provider.destroy();
  if ((await rowsFor(roomB)) !== 1) throw new Error("roomB did not compact to 1 row");
  console.log("ok: roomB compacted to a single snapshot row");
}

// 2. Backup: every doc present and non-empty; snapshot decodes to real content.
const backup1 = await takeBackup();
for (const room of [roomA, roomB]) {
  const b64 = backup1.docs[room];
  if (!b64 || fromBase64(b64).byteLength <= 2) throw new Error(`${room} missing/empty in backup`);
}
{
  const offline = new Y.Doc();
  Y.applyUpdate(offline, fromBase64(backup1.docs[roomB]));
  if (offline.getArray<number>("items").length !== N)
    throw new Error("backup of compacted doc does not decode to full content");
}
console.log("ok: backup contains both docs, compacted doc decodes offline");

// 3. Destroy server state, restore, prove fresh clients see the originals.
await fetch(`${HTTP}/debug/wipe`);
if ((await rowsFor(roomA)) !== 0 || (await rowsFor(roomB)) !== 0)
  throw new Error("wipe left rows behind");
{
  const empty = openDoc(roomA, SERVER); // prove the wipe was real, not cosmetic
  await new Promise((r) => setTimeout(r, 500));
  if (empty.doc.getArray("items").length !== 0) throw new Error("wipe did not empty roomA");
  empty.provider.destroy();
}
console.log("ok: server wiped");

const { restored } = await restore(backup1);
if (!(roomA in restored) || !(roomB in restored)) throw new Error("restore skipped a doc");
{
  const a = openDoc(roomA, SERVER);
  const b = openDoc(roomB, SERVER);
  await until(
    () =>
      texts(a.doc).join(",") === "alpha,beta" &&
      b.doc.getArray<number>("items").length === N,
    "fresh clients see restored content after wipe",
  );
  a.provider.destroy();
  b.provider.destroy();
}

// 4. Merge safety: a newer edit survives restoring an older backup.
const backup2 = await takeBackup();
{
  const rows = await rowsFor(roomA);
  const w = openDoc(roomA, SERVER);
  await until(() => texts(w.doc).includes("alpha"), "writer synced before new edit");
  w.doc.getArray("items").push([{ text: "post-backup" }]);
  await until(async () => (await rowsFor(roomA)) > rows, "post-backup edit persisted");
  w.provider.destroy();
}
await restore(backup2); // older backup, lacks "post-backup"
{
  const c = openDoc(roomA, SERVER);
  await until(
    () => {
      const t = texts(c.doc);
      return t.includes("alpha") && t.includes("beta") && t.includes("post-backup");
    },
    "newer edit survives restore of older backup",
  );
  c.provider.destroy();
}

console.log("SUCCESS");
process.exit(0);
