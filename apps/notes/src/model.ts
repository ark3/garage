// The notes data model as plain functions over a Y.Doc, shared by the app and
// by scripts so the shape is stated once.
// Top-level map: note id -> Y.Map { text: Y.Text, createdBy, createdAt, updatedAt }.

import * as Y from "yjs";
import { uuid } from "@garage/sync";

export type Note = Y.Map<unknown>;

export function notesMap(doc: Y.Doc): Y.Map<Note> {
  return doc.getMap<Note>("notes");
}

export function createNote(doc: Y.Doc, createdBy: string, text = ""): string {
  const id = uuid();
  const note = new Y.Map<unknown>();
  note.set("text", new Y.Text(text));
  note.set("createdBy", createdBy);
  note.set("createdAt", Date.now());
  note.set("updatedAt", Date.now());
  notesMap(doc).set(id, note);
  return id;
}

export function deleteNote(doc: Y.Doc, id: string): void {
  notesMap(doc).delete(id);
}

export function body(note: Note): Y.Text {
  return note.get("text") as Y.Text;
}

export function title(note: Note): string {
  return body(note).toString().split("\n")[0].trim();
}

// Most recently updated first.
export function listNotes(doc: Y.Doc): [string, Note][] {
  return [...notesMap(doc).entries()].sort(
    (a, b) => ((b[1].get("updatedAt") as number) ?? 0) - ((a[1].get("updatedAt") as number) ?? 0),
  );
}
