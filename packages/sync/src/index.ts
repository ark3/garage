import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import {
  clientId,
  guardSchema,
  meOf,
  resolveActor,
  schemaOf,
  shouldReload,
  shouldReloadBuild,
  stampOnSync,
  type Me,
} from "./app";

export { getUser } from "./identity";
export { guardSchema, schemaOf, uuid, type Me } from "./app";

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
//
// The doc's schema marker is guarded from the start, before /whoami, so a
// stale bundle (doc ahead of `schema`) disconnects as soon as the doc says
// so. Going stale is terminal for the bundle, so it is surfaced as a promise:
// `stale` resolves if this bundle must stop, after one reload per marker
// has already been tried and the doc is still ahead. Local persistence is
// dropped too, so nothing the stale bundle writes can ride IndexedDB into
// the next load.
//
// The served build is checked the same way a promotion would otherwise wait
// on a hand reload: on every sync(true) and whenever the tab becomes
// visible, fetch build.txt beside the bundle and reload once per served
// value when it differs from GARAGE_BUILD. Fetch failures are ignored —
// offline is normal.
export async function openApp(name: string, schema: number) {
  const { doc, provider } = openDoc(name);
  const local = new IndexeddbPersistence(name, doc);
  const stale = new Promise<void>((resolve) =>
    guardSchema(doc, provider, schema, () => {
      local.destroy();
      if (shouldReload(sessionStorage, name, schemaOf(doc)!)) location.reload();
      else resolve();
    }),
  );
  const checkBuild = async () => {
    let served: string;
    try {
      const res = await fetch("./build.txt", { cache: "no-store" });
      if (!res.ok) return;
      served = (await res.text()).trim();
    } catch {
      return;
    }
    if (shouldReloadBuild(sessionStorage, name, GARAGE_BUILD, served)) location.reload();
  };
  provider.on("sync", (state: boolean) => {
    if (state) checkBuild();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkBuild();
  });
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
  return { doc, provider, actor, me, stale };
}

// How a browser app opens a doc other than its app doc — flashcards holds a
// deck and a progress doc beside its index. Same transport and same local
// persistence as openApp's doc (offline-first is unconditional, keyed by doc
// name), and nothing else: the schema marker, the client stamp and the build
// check belong to the app doc, which one bundle's openApp already carries for
// every shape that bundle writes. These docs come and go as the person moves
// between decks, so closing is the caller's job, and it has to take the
// socket, the persistence and the doc with it — a leaked provider is a leaked
// socket.
export function openPersistedDoc(name: string) {
  const { doc, provider } = openDoc(name);
  const local = new IndexeddbPersistence(name, doc);
  return {
    doc,
    provider,
    close() {
      provider.destroy();
      local.destroy();
      doc.destroy();
    },
  };
}
