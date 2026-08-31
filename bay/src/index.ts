import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { getUser } from "@garage/sync/identity";

interface Env {
  GARAGE: DurableObjectNamespace;
}

// y-websocket message types. Awareness is relayed, never persisted.
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const COMPACT_THRESHOLD = 200;
const COMPACTION_ACTOR = "<compaction>";

type Attachment = { doc: string; user: string };

export class Garage {
  ctx: DurableObjectState;
  // Working copies only. The DO may be evicted between any two messages
  // (hibernation), so every handler must reach docs through getDoc().
  docs = new Map<string, Y.Doc>();

  constructor(ctx: DurableObjectState, _env: Env) {
    this.ctx = ctx;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS updates (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        doc TEXT NOT NULL,
        actor TEXT NOT NULL,
        ts INTEGER NOT NULL,
        data BLOB NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS updates_by_doc ON updates (doc, seq)",
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      this.ctx.storage.sql.exec("SELECT 1");
      return new Response("ok\n");
    }
    if (url.pathname === "/debug/stats") {
      const rows = this.ctx.storage.sql
        .exec("SELECT doc, COUNT(*) AS n FROM updates GROUP BY doc")
        .toArray();
      return Response.json(rows);
    }
    if (url.pathname === "/debug/amnesia") {
      // Simulates hibernation eviction: sockets survive, heap state does not.
      this.docs.clear();
      return new Response("forgot\n");
    }
    const m = url.pathname.match(/^\/doc\/([A-Za-z0-9_-]+)$/);
    if (m && request.headers.get("Upgrade") === "websocket") {
      const name = m[1];
      const user = await getUser(request);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [name]);
      pair[1].serializeAttachment({ doc: name, user } satisfies Attachment);
      const doc = this.getDoc(name);
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(enc, doc);
      pair[1].send(encoding.toUint8Array(enc));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response("not found\n", { status: 404 });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    if (typeof message === "string") return;
    const { doc: name, user } = ws.deserializeAttachment() as Attachment;
    const doc = this.getDoc(name);
    const decoder = decoding.createDecoder(new Uint8Array(message));
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) {
      const syncType = decoding.readVarUint(decoder);
      if (syncType === syncProtocol.messageYjsSyncStep1) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.writeSyncStep2(enc, doc, decoding.readVarUint8Array(decoder));
        ws.send(encoding.toUint8Array(enc));
      } else {
        // SyncStep2 and Update both carry an update payload.
        const update = decoding.readVarUint8Array(decoder);
        this.persistAndApply(name, doc, update, user, ws);
      }
    } else if (type === MESSAGE_AWARENESS) {
      this.broadcast(name, new Uint8Array(message), ws);
    }
  }

  webSocketClose(_ws: WebSocket) {}
  webSocketError(_ws: WebSocket) {}

  // The single chokepoint: always safe to call on a cold heap.
  private getDoc(name: string): Y.Doc {
    let doc = this.docs.get(name);
    if (doc) return doc;
    doc = new Y.Doc();
    const rows = this.ctx.storage.sql
      .exec("SELECT seq, data FROM updates WHERE doc = ? ORDER BY seq", name)
      .toArray();
    for (const row of rows) {
      Y.applyUpdate(doc, new Uint8Array(row.data as ArrayBuffer));
    }
    if (rows.length > COMPACT_THRESHOLD) {
      this.compact(name, doc, rows[rows.length - 1].seq as number);
    }
    this.docs.set(name, doc);
    return doc;
  }

  private compact(name: string, doc: Y.Doc, upToSeq: number) {
    this.ctx.storage.sql.exec(
      "INSERT INTO updates (doc, actor, ts, data) VALUES (?, ?, ?, ?)",
      name,
      COMPACTION_ACTOR,
      Date.now(),
      Y.encodeStateAsUpdate(doc),
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM updates WHERE doc = ? AND seq <= ?",
      name,
      upToSeq,
    );
  }

  // Persist before acknowledging: the insert commits before any outgoing
  // message is released (the DO output gate guarantees ordering).
  private persistAndApply(
    name: string,
    doc: Y.Doc,
    update: Uint8Array,
    actor: string,
    from: WebSocket,
  ) {
    if (update.byteLength <= 2) return; // empty diff from SyncStep2
    this.ctx.storage.sql.exec(
      "INSERT INTO updates (doc, actor, ts, data) VALUES (?, ?, ?, ?)",
      name,
      actor,
      Date.now(),
      update,
    );
    Y.applyUpdate(doc, update);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    this.broadcast(name, encoding.toUint8Array(enc), from);
  }

  private broadcast(name: string, payload: Uint8Array, exclude?: WebSocket) {
    for (const sock of this.ctx.getWebSockets(name)) {
      if (sock === exclude) continue;
      try {
        sock.send(payload);
      } catch {}
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/whoami") {
      return new Response((await getUser(request)) + "\n");
    }
    if (
      url.pathname === "/health" ||
      url.pathname.startsWith("/doc/") ||
      url.pathname.startsWith("/debug/")
    ) {
      const stub = env.GARAGE.get(env.GARAGE.idFromName("garage"));
      return stub.fetch(request);
    }
    return new Response("not found\n", { status: 404 });
  },
};
