// Which server the integration scripts hit, and how to authenticate to it.
// Defaults to the disposable test instance (`bun run dev:test`, port 8788,
// its own state dir) — never the long-lived LAN server on 8787, because
// backup-cycle.ts wipes whatever it points at. Override deliberately:
//   GARAGE_URL=http://localhost:8787 bun scripts/converge.ts
//
// A non-local target sits behind Cloudflare Access, so every request —
// plain fetch and WebSocket upgrade alike — must carry the service-token
// headers. The token lives outside the repo: default
// ~/.config/garage/tokens/scripts, override GARAGE_ACCESS_TOKEN_FILE, format
// CF_ACCESS_CLIENT_ID=... / CF_ACCESS_CLIENT_SECRET=... lines.
// Local runs send nothing. Scripts should use sfetch/open below rather than
// bare fetch/openDoc so the headers can never be forgotten.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { openDoc } from "@garage/sync";

export const HTTP = process.env.GARAGE_URL ?? "http://localhost:8788";
export const SERVER = `${HTTP.replace(/^http/, "ws")}/doc`;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const HEADERS: Record<string, string> = LOCAL_HOSTS.has(new URL(HTTP).hostname)
  ? {}
  : accessHeaders();

function accessHeaders(): Record<string, string> {
  const path =
    process.env.GARAGE_ACCESS_TOKEN_FILE ??
    `${homedir()}/.config/garage/tokens/scripts`;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `${HTTP} is non-local but there is no service token at ${path} ` +
        `(override the path with GARAGE_ACCESS_TOKEN_FILE)`,
    );
  }
  const vars = new Map(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1)] as const;
      }),
  );
  const id = vars.get("CF_ACCESS_CLIENT_ID");
  const secret = vars.get("CF_ACCESS_CLIENT_SECRET");
  if (!id || !secret) {
    throw new Error(
      `${path} must define CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET`,
    );
  }
  return { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret };
}

// fetch that carries the Access headers when the target requires them.
export function sfetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, headers: { ...HEADERS, ...init.headers } });
}

// Bun's WebSocket accepts custom headers on the upgrade request; y-websocket
// constructs the polyfill with the URL alone, so the headers ride along here.
const wsOpts = Object.keys(HEADERS).length
  ? {
      WebSocketPolyfill: class extends WebSocket {
        constructor(url: string | URL) {
          super(url, { headers: HEADERS } as unknown as string[]);
        }
      } as unknown as typeof WebSocket,
    }
  : undefined;

// openDoc against SERVER, attaching the Access headers on the WS upgrade.
export function open(room: string) {
  return openDoc(room, SERVER, wsOpts);
}
