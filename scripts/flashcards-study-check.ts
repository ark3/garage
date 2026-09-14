// What the study screen does to a progress doc, without the screen. Run while
// `bun run dev:test` is up:
//   bun scripts/flashcards-study-check.ts
// The converge script proves the storage; this proves the composition the screen
// grades with — `gradeCard`, which the screen calls and this imports — leaves one
// handle's deck cleared for the rest of the day, due again tomorrow, and leaves
// another handle's untouched. Doc names carry a run-unique suffix so runs never
// share state.

import { uuid } from "@garage/sync";
import {
  addCard,
  deckDoc,
  dueCards,
  getReview,
  gradeCard,
  listCards,
  progressDoc,
  reviewLog,
} from "../apps/flashcards/src/model";
import { QUALITY } from "../apps/flashcards/src/sm2";
import { open } from "./target";

const suffix = `-${Date.now()}`;
const ALPHA = "alpha";
const BRAVO = "bravo";
const DAY_MS = 86_400_000;

async function until(cond: () => boolean, what: string, ms = 20000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`ok: ${what}`);
}

// --- a small deck, and two people who have never seen it ---

const deckId = uuid();
const deck = open(deckDoc(deckId, suffix));
deck.doc.transact(() => {
  for (let i = 2; i <= 5; i++) {
    addCard(deck.doc, { kind: "plain", text: `${i} x 7` }, { kind: "plain", text: `${i * 7}` });
  }
});
const cardIds = listCards(deck.doc).map(([id]) => id);

const alpha = open(progressDoc(ALPHA, suffix));
const bravo = open(progressDoc(BRAVO, suffix));

const now = Date.now();
await until(
  () => dueCards(alpha.doc, deckId, deck.doc, now).join() === cardIds.join(),
  "a new deck is entirely due, in card order",
);

// --- alpha answers every card Good, exactly as the study screen does ---

for (const cardId of dueCards(alpha.doc, deckId, deck.doc, now)) {
  gradeCard(alpha.doc, deckId, cardId, "good", now);
}

const deckFresh = open(deckDoc(deckId, suffix));
const alphaFresh = open(progressDoc(ALPHA, suffix));
await until(
  () =>
    reviewLog(alphaFresh.doc).length === cardIds.length &&
    reviewLog(alphaFresh.doc).toArray().every((entry) => entry.grade === QUALITY.good) &&
    listCards(deckFresh.doc).length === cardIds.length,
  "every answer reaches the server as a log line at Good's quality",
);

await until(
  () =>
    dueCards(alphaFresh.doc, deckId, deckFresh.doc, now).length === 0 &&
    dueCards(alphaFresh.doc, deckId, deckFresh.doc, now + DAY_MS - 1000).length === 0,
  "alpha owes nothing more today",
);

await until(
  () => dueCards(alphaFresh.doc, deckId, deckFresh.doc, now + DAY_MS).join() === cardIds.join(),
  "the whole deck is due again tomorrow",
);

// --- bravo has studied nothing, and alpha's session did not touch that ---

const bravoFresh = open(progressDoc(BRAVO, suffix));
await until(
  () =>
    dueCards(bravo.doc, deckId, deck.doc, now).join() === cardIds.join() &&
    dueCards(bravoFresh.doc, deckId, deckFresh.doc, now).join() === cardIds.join() &&
    reviewLog(bravoFresh.doc).length === 0 &&
    getReview(bravoFresh.doc, deckId, cardIds[0]) === undefined,
  "bravo still owes the whole deck",
);

for (const x of [deck, deckFresh, alpha, alphaFresh, bravo, bravoFresh]) x.provider.destroy();
console.log("SUCCESS");
process.exit(0);
