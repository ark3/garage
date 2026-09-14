import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import { clientId, meOf, resolveActor, stampOnSync, type Me } from "./app";

export { getUser } from "./identity";
export { uuid, type Me } from "./app";

// Connect a new Y.Doc to the bay DO. Default server URL assumes the app is
// served by the same Worker (one origin, no CORS). Headless clients pass a
// WebSocketPolyfill that attaches their Access service-token headers, and
// disableBc so same-process providers only ever meet through the server.
export function openDoc(
  name: string,
  serverUrl?: string,
  opts?: { WebSocketPolyfill?: typeof WebSocket; disableBc?: boolean },
) {
  const base =
    serverUrl ??
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/doc`;
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(base, name, doc, opts);
  return { doc, provider };
}

// How every browser app opens its doc. Local persistence is unconditional
// (offline-first), the two directory docs are opened and persisted the same
// way so an offline start still knows who you are, and `clients` is stamped
// after each sync of the app doc. `schema` is the app's hand-bumped
// doc-shape integer; `build` comes from the GARAGE_BUILD global the build
// script bakes in. Resolves once /whoami has answered or failed.
export async function openApp(name: string, schema: number) {
  const { doc, provider } = openDoc(name);
  new IndexeddbPersistence(name, doc);
  const actors = openDoc("actors");
  new IndexeddbPersistence("actors", actors.doc);
  const clients = openDoc("clients");
  new IndexeddbPersistence("clients", clients.doc);

  const actor = await resolveActor(localStorage);
  const me: Me = meOf(actors.doc, actor);
  stampOnSync(provider, clients.doc, {
    clientId: clientId(localStorage),
    actor,
    app: name,
    build: GARAGE_BUILD,
    schema,
  });
  return { doc, provider, actor, me };
}
