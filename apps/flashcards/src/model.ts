// The flashcards data model as plain functions over Y.Docs, shared by the app
// and by scripts so the shape is stated once. Three doc kinds:
//   `flashcards`                     the index: `decks` map, deck id -> Y.Map { name, createdBy, createdAt }
//   `flashcards-deck-<deckId>`       one deck: `cards` map, card id -> Y.Map { front, back, createdAt }
//   `flashcards-progress-<handle>`   one person: `cards` map, `<deckId>/<cardId>` -> review state,
//                                    plus `log`, a Y.Array of one entry per answer
// Deck and card ids come from uuid() and handles are lowercase by directory
// convention, so every name matches the Worker's `[A-Za-z0-9_-]+` doc route
// (bay/src/index.ts) without anything here having to check.

import * as Y from "yjs";
import { uuid } from "@garage/sync";

export const SCHEMA = 1;

// `suffix` exists so scripts can burn doc names per run; the app passes nothing
// and gets the real names.
export function indexDoc(suffix = ""): string {
  return `flashcards${suffix}`;
}

export function deckDoc(deckId: string, suffix = ""): string {
  return `flashcards${suffix}-deck-${deckId}`;
}

export function progressDoc(handle: string, suffix = ""): string {
  return `flashcards${suffix}-progress-${handle}`;
}

// --- the index doc ---

export type Deck = {
  name: string;
  createdBy: string; // the creator's actor handle
  createdAt: number;
};

// A deck entry is a nested Y.Map: renaming touches only `name`, so it can never
// discard another client's concurrent edit to the same entry.
export function decksMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>("decks");
}

export function createDeck(doc: Y.Doc, name: string, createdBy: string): string {
  const id = uuid();
  const entry = new Y.Map<unknown>();
  entry.set("name", name);
  entry.set("createdBy", createdBy);
  entry.set("createdAt", Date.now());
  decksMap(doc).set(id, entry);
  return id;
}

export function renameDeck(doc: Y.Doc, deckId: string, name: string): void {
  decksMap(doc).get(deckId)?.set("name", name);
}

// Drops the index entry only; the deck's own doc is left where it is.
export function deleteDeck(doc: Y.Doc, deckId: string): void {
  decksMap(doc).delete(deckId);
}

// Oldest first.
export function listDecks(doc: Y.Doc): [string, Deck][] {
  return [...decksMap(doc).entries()]
    .map(([id, entry]) => [id, entry.toJSON() as Deck] as [string, Deck])
    .sort((a, b) => a[1].createdAt - b[1].createdAt);
}

// --- a deck doc ---

export type SideKind = "plain" | "abc";

// A side is a plain object replaced whole rather than a nested Y.Map: kind and
// text are always chosen together in the editor, and front and back are already
// separate keys of the card's Y.Map, so two people editing the two sides of one
// card still merge.
export type Side = { kind: SideKind; text: string };

export type Card = {
  front: Side;
  back: Side;
  createdAt: number;
};

export function cardsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>("cards");
}

export function addCard(doc: Y.Doc, front: Side, back: Side, id = uuid()): string {
  const card = new Y.Map<unknown>();
  card.set("front", front);
  card.set("back", back);
  card.set("createdAt", Date.now());
  cardsMap(doc).set(id, card);
  return id;
}

export function setSide(doc: Y.Doc, cardId: string, which: "front" | "back", side: Side): void {
  cardsMap(doc).get(cardId)?.set(which, side);
}

export function deleteCard(doc: Y.Doc, cardId: string): void {
  cardsMap(doc).delete(cardId);
}

// Oldest first; there is no ordering array.
export function listCards(doc: Y.Doc): [string, Card][] {
  return [...cardsMap(doc).entries()]
    .map(([id, card]) => [id, card.toJSON() as Card] as [string, Card])
    .sort((a, b) => a[1].createdAt - b[1].createdAt);
}

// Copies every card into a fresh deck doc under the same card ids, so progress
// keyed on those ids still resolves in the copy. The index entry for the copy is
// the caller's to write.
export function copyCards(from: Y.Doc, to: Y.Doc): void {
  to.transact(() => {
    for (const [id, card] of listCards(from)) addCard(to, card.front, card.back, id);
  });
}

// --- a progress doc ---

// SM-2 state for one card. The arithmetic lives elsewhere; this module only
// stores what it produces.
export type Review = {
  ease: number;
  interval: number; // days
  reps: number;
  due: number; // epoch ms
};

export type LogEntry = {
  deckId: string;
  cardId: string;
  at: number;
  grade: number;
};

export function reviewsMap(doc: Y.Doc): Y.Map<Review> {
  return doc.getMap<Review>("cards");
}

export function reviewLog(doc: Y.Doc): Y.Array<LogEntry> {
  return doc.getArray<LogEntry>("log");
}

function key(deckId: string, cardId: string): string {
  return `${deckId}/${cardId}`;
}

export function getReview(doc: Y.Doc, deckId: string, cardId: string): Review | undefined {
  return reviewsMap(doc).get(key(deckId, cardId));
}

// One answer: the new state and its log line land together.
export function recordReview(
  doc: Y.Doc,
  deckId: string,
  cardId: string,
  grade: number,
  next: Review,
  at = Date.now(),
): void {
  doc.transact(() => {
    reviewsMap(doc).set(key(deckId, cardId), next);
    reviewLog(doc).push([{ deckId, cardId, at, grade }]);
  });
}

// Card ids of `deck` that this person owes at `now`: never reviewed, or due.
export function dueCards(progress: Y.Doc, deckId: string, deck: Y.Doc, now: number): string[] {
  return listCards(deck)
    .filter(([cardId]) => {
      const review = getReview(progress, deckId, cardId);
      return review === undefined || review.due <= now;
    })
    .map(([cardId]) => cardId);
}
