// Backup page: download every doc as a dated JSON file, restore from one.
// The doc names and byte counts shown after each operation are the human
// check that a backup isn't empty.

import { fromBase64, type BackupEnvelope } from "@garage/sync/backup";

const status = document.getElementById("status") as HTMLParagraphElement;
const report = document.getElementById("report") as HTMLDivElement;

function say(text: string, isError = false) {
  status.textContent = text;
  status.className = isError ? "error" : "";
}

function showDocs(title: string, sizes: Record<string, number>) {
  const rows = Object.entries(sizes)
    .map(([name, bytes]) => `<tr><td>${name}</td><td class="bytes">${bytes}</td></tr>`)
    .join("");
  report.innerHTML = `<table><caption>${title}</caption>
    <tr><th>doc</th><th>bytes</th></tr>${rows}</table>`;
}

document.getElementById("download")!.addEventListener("click", async () => {
  say("fetching backup…");
  const res = await fetch("/api/backup");
  if (!res.ok) return say(`backup failed: ${res.status}`, true);
  const envelope = (await res.json()) as BackupEnvelope;
  const sizes: Record<string, number> = {};
  for (const [name, b64] of Object.entries(envelope.docs)) {
    sizes[name] = fromBase64(b64).byteLength;
  }
  const date = envelope.createdAt.slice(0, 10);
  const blob = new Blob([JSON.stringify(envelope)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `garage-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  const n = Object.keys(sizes).length;
  say(`backed up ${n} doc${n === 1 ? "" : "s"} (${envelope.createdAt})`);
  showDocs("backed up", sizes);
});

document.getElementById("restore")!.addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  say(`restoring from ${file.name}…`);
  const res = await fetch("/api/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await file.text(),
  });
  if (!res.ok) return say(`restore failed: ${res.status} ${await res.text()}`, true);
  const { restored } = (await res.json()) as { restored: Record<string, number> };
  const n = Object.keys(restored).length;
  say(`restored ${n} doc${n === 1 ? "" : "s"} from ${file.name}`);
  showDocs("restored", restored);
});
