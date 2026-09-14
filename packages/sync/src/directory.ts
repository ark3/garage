// Directory docs: plain functions over a Y.Doc, shared by apps and scripts so
// the shape is stated once. `actors` is keyed by the identity string getUser
// returns (an email, or a service token's common_name); robots are ordinary
// entries. Each entry is a nested Y.Map so concurrent edits to different
// fields of one entry merge instead of clobbering each other.

import * as Y from "yjs";

export type Actor = {
  handle: string; // short, hand-chosen, lowercase; used in doc names
  name: string; // display
  fg: string;
  bg: string;
};

export function actorsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>("actors");
}

export function getActor(doc: Y.Doc, id: string): Actor | undefined {
  const entry = actorsMap(doc).get(id);
  return entry ? (entry.toJSON() as Actor) : undefined;
}

// Creates the entry if absent; otherwise writes only the given fields in
// place, so a partial update never discards another client's edits.
export function setActor(doc: Y.Doc, id: string, fields: Partial<Actor>): void {
  doc.transact(() => {
    const map = actorsMap(doc);
    let entry = map.get(id);
    if (!entry) {
      entry = new Y.Map<unknown>();
      map.set(id, entry);
    }
    for (const [k, v] of Object.entries(fields)) entry.set(k, v);
  });
}

// `clients` is keyed by a per-browser client id (a UUID kept in localStorage).
// Each app the client runs stamps its own sub-entry after its doc has synced,
// so a stamp on the server means that client holds both the bundle and the
// current state. `label` is hand-edited only; the stamp never touches it.

export type ClientApp = {
  build: string; // git short sha baked into the bundle
  schema: number; // per-app doc-shape version
  syncedAt: number;
};

export type Client = {
  actor: string;
  label?: string; // e.g. "Someone's phone, Safari"
  firstSeen: number;
  apps: Record<string, ClientApp>;
};

export function clientsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>("clients");
}

export function getClient(doc: Y.Doc, id: string): Client | undefined {
  const entry = clientsMap(doc).get(id);
  return entry ? (entry.toJSON() as Client) : undefined;
}

// Hand edits (label, or reassigning the actor). Creates the entry if absent.
export function setClient(
  doc: Y.Doc,
  id: string,
  fields: Partial<Pick<Client, "actor" | "label">>,
): void {
  doc.transact(() => {
    const entry = ensureClient(clientsMap(doc), id);
    for (const [k, v] of Object.entries(fields)) entry.set(k, v);
  });
}

// Records that this client has synced `app` at `build`/`schema` right now.
// First sight of a client creates its entry with `actor` and `firstSeen`;
// after that only the app's own sub-entry changes.
export function stampClient(
  doc: Y.Doc,
  stamp: { clientId: string; actor: string; app: string; build: string; schema: number },
): void {
  doc.transact(() => {
    const entry = ensureClient(clientsMap(doc), stamp.clientId);
    if (!entry.has("actor")) entry.set("actor", stamp.actor);
    if (!entry.has("firstSeen")) entry.set("firstSeen", Date.now());
    const apps = entry.get("apps") as Y.Map<Y.Map<unknown>>;
    let app = apps.get(stamp.app);
    if (!app) {
      app = new Y.Map<unknown>();
      apps.set(stamp.app, app);
    }
    app.set("build", stamp.build);
    app.set("schema", stamp.schema);
    app.set("syncedAt", Date.now());
  });
}

function ensureClient(map: Y.Map<Y.Map<unknown>>, id: string): Y.Map<unknown> {
  let entry = map.get(id);
  if (!entry) {
    entry = new Y.Map<unknown>();
    entry.set("apps", new Y.Map<unknown>());
    map.set(id, entry);
  }
  return entry;
}
