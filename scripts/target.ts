// Which server the integration scripts hit.
// Defaults to the disposable test instance (`bun run dev:test`, port 8788,
// its own state dir) — never the long-lived LAN server on 8787, because
// backup-cycle.ts wipes whatever it points at. Override deliberately:
//   GARAGE_URL=http://localhost:8787 bun scripts/converge.ts
export const HTTP = process.env.GARAGE_URL ?? "http://localhost:8788";
export const SERVER = `${HTTP.replace(/^http/, "ws")}/doc`;
