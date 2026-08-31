import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

export { getUser } from "./identity";

// Connect a new Y.Doc to the bay DO. Default server URL assumes the app is
// served by the same Worker (one origin, no CORS).
export function openDoc(name: string, serverUrl?: string) {
  const base =
    serverUrl ??
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/doc`;
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(base, name, doc);
  return { doc, provider };
}
