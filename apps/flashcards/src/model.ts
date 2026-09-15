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
// The progress doc stores exactly what the scheduler produces, so the SM-2
// state type comes from there rather than being restated here.
import { QUALITY, schedule, type Button, type Review } from "./sm2";

export type { Button, Review };

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

// One answer, whole: the scheduler decides the next state from the state the
// card carries now, and the log line records that button's quality. The study
// screen and the headless check both answer cards through here, so neither can
// compose the two halves differently from the other.
export function gradeCard(
  progress: Y.Doc,
  deckId: string,
  cardId: string,
  button: Button,
  now = Date.now(),
): void {
  const next = schedule(getReview(progress, deckId, cardId), button, now);
  recordReview(progress, deckId, cardId, QUALITY[button], next, now);
}

// The sessions total the completion screen shows: distinct local calendar days
// with a log entry, across every deck. It only ever goes up; there is no streak.
export function sessionsTotal(progress: Y.Doc): number {
  return new Set(reviewLog(progress).map((entry) => new Date(entry.at).toDateString())).size;
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

// The two session caps, the same for every deck: they keep the morning drill
// short whatever the deck holds, and they win over the scheduler.
export const FRESH_PER_DAY = 5;
export const REVIEW_PER_SESSION = 20;

export type Plan = {
  warmup: string[]; // not due, longest interval first: two well-known cards; empty when the other two are
  review: string[]; // due, most overdue first, cut at REVIEW_PER_SESSION
  fresh: string[]; // never studied, oldest first, cut at what is left of today's quota
};

function sameLocalDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

// Cards of `deck` first logged on the calendar day of `now`. Fresh is decided
// by the progress entry, not the log, so a card logged without an entry (which
// nothing writes today) both spends quota here and stays fresh.
function introducedToday(progress: Y.Doc, deckId: string, now: number): number {
  const first = new Map<string, number>();
  for (const entry of reviewLog(progress).toArray()) {
    if (entry.deckId !== deckId) continue;
    const seen = first.get(entry.cardId);
    if (seen === undefined || entry.at < seen) first.set(entry.cardId, entry.at);
  }
  let n = 0;
  for (const at of first.values()) if (sameLocalDay(at, now)) n++;
  return n;
}

// One session of `deck` for this person at `now`. Order within each list is
// deterministic; shuffling is the session's job, not the planner's. With
// nothing due and nothing new the warm-up is skipped too, so the plan is empty
// and Study cannot be pressed again and again for a two-card session.
export function planSession(progress: Y.Doc, deckId: string, deck: Y.Doc, now: number): Plan {
  const known: [string, Review][] = [];
  const fresh: string[] = [];
  for (const [cardId] of listCards(deck)) {
    const review = getReview(progress, deckId, cardId);
    if (review) known.push([cardId, review]);
    else fresh.push(cardId);
  }
  const due = known.filter(([, r]) => r.due <= now).sort((a, b) => a[1].due - b[1].due);
  const notDue = known.filter(([, r]) => r.due > now).sort((a, b) => b[1].interval - a[1].interval);
  const review = due.slice(0, REVIEW_PER_SESSION).map(([id]) => id);
  const freshToday = fresh.slice(0, Math.max(0, FRESH_PER_DAY - introducedToday(progress, deckId, now)));
  const warmup = review.length || freshToday.length ? notDue.slice(0, 2).map(([id]) => id) : [];
  return { warmup, review, fresh: freshToday };
}
