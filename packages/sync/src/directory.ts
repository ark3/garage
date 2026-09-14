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
