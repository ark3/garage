// Integration check for the flashcards data model. Run while `bun run dev:test` is up:
//   bun scripts/flashcards-converge.ts
// Doc names carry a run-unique suffix (the index doc too, whose real name is the
// fixed `flashcards`) so runs never share state. Two clients build a deck and
// converge, two handles study it with separate progress, a copied deck keeps its
// card ids so progress still resolves, a thousand-card deck round-trips into a
// fresh client, and everything survives /debug/amnesia.

import * as Y from "yjs";
import {
  addCard,
  cardsMap,
  copyCards,
  createDeck,
  deckDoc,
  decksMap,
  dueCards,
  getReview,
  indexDoc,
  listCards,
  listDecks,
  progressDoc,
  recordReview,
  renameDeck,
  reviewLog,
  setSide,
  type Review,
} from "../apps/flashcards/src/model";
import { HTTP, open, sfetch } from "./target";

const suffix = `-${Date.now()}`;
const ALPHA = "alpha";
const BRAVO = "bravo";

async function until(cond: () => boolean, what: string, ms = 20000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`ok: ${what}`);
}

// Stand-in for the scheduler: this script only proves storage, not arithmetic.
function scheduled(due: number): Review {
  return { ease: 2.5, interval: 1, reps: 1, due };
}

// --- two clients on the index and on one deck ---

const indexA = open(indexDoc(suffix));
const indexB = open(indexDoc(suffix));

const deckId = createDeck(indexA.doc, "Times tables", ALPHA);
await until(
  () => decksMap(indexB.doc).get(deckId)?.get("name") === "Times tables",
  "B sees the deck A created",
);

renameDeck(indexB.doc, deckId, "Times tables (2-5)");
await until(
  () => decksMap(indexA.doc).get(deckId)?.get("createdBy") === ALPHA &&
    decksMap(indexA.doc).get(deckId)?.get("name") === "Times tables (2-5)",
  "a rename from B keeps A's createdBy",
);

const deckA = open(deckDoc(deckId, suffix));
const deckB = open(deckDoc(deckId, suffix));

const cardA = addCard(deckA.doc, { kind: "plain", text: "3 x 4" }, { kind: "plain", text: "12" });
const cardB = addCard(deckB.doc, { kind: "abc", text: "B" }, { kind: "plain", text: "treble B" });
await until(
  () => cardsMap(deckA.doc).size === 2 && cardsMap(deckB.doc).size === 2,
  "cards from both clients converge",
);

// Both sides of one card edited at once, one per client: neither is lost.
setSide(deckA.doc, cardA, "front", { kind: "plain", text: "3 x 4 = ?" });
setSide(deckB.doc, cardA, "back", { kind: "plain", text: "twelve" });
const bothSides = (doc: Y.Doc) => {
  const card = listCards(doc).find(([id]) => id === cardA)![1];
  return card.front.text === "3 x 4 = ?" && card.back.text === "twelve";
};
await until(
  () => bothSides(deckA.doc) && bothSides(deckB.doc),
  "concurrent edits to the two sides of one card both survive",
);

// --- two handles study the same deck ---

const alpha = open(progressDoc(ALPHA, suffix));
const bravo = open(progressDoc(BRAVO, suffix));

const now = Date.now();
await until(() => dueCards(alpha.doc, deckId, deckA.doc, now).length === 2, "alpha owes both cards");

const tomorrow = now + 86_400_000;
recordReview(alpha.doc, deckId, cardA, 4, scheduled(tomorrow), now);
await until(
  () =>
    getReview(alpha.doc, deckId, cardA)?.due === tomorrow &&
    reviewLog(alpha.doc).length === 1 &&
    dueCards(alpha.doc, deckId, deckA.doc, now).join() === cardB,
  "alpha's answer removes that card from what alpha owes",
);

// Bravo's doc is untouched by alpha's studying.
const bravoFresh = open(progressDoc(BRAVO, suffix));
await until(
  () =>
    dueCards(bravo.doc, deckId, deckB.doc, now).length === 2 &&
    getReview(bravoFresh.doc, deckId, cardA) === undefined &&
    reviewLog(bravoFresh.doc).length === 0,
  "bravo's progress is separate from alpha's",
);

// --- a copy keeps card ids, so progress still resolves ---

const copyId = createDeck(indexA.doc, "Times tables (copy)", BRAVO);
const copy = open(deckDoc(copyId, suffix));
copyCards(deckA.doc, copy.doc);
const copyFresh = open(deckDoc(copyId, suffix));
await until(
  () => listCards(copyFresh.doc).map(([id]) => id).join() === listCards(deckA.doc).map(([id]) => id).join(),
  "the copied deck carries the same card ids",
);
await until(
  () => getReview(alpha.doc, copyId, cardA) === undefined &&
    dueCards(alpha.doc, copyId, copyFresh.doc, now).length === 2,
  "progress is per deck id, so the copy starts unstudied",
);

// --- a thousand cards ---

const bigId = createDeck(indexA.doc, "Thousand", ALPHA);
const big = open(deckDoc(bigId, suffix));
big.doc.transact(() => {
  for (let i = 0; i < 1000; i++) {
    addCard(big.doc, { kind: "plain", text: `${i} x 7` }, { kind: "plain", text: `${i * 7}` });
  }
});
const bytes = Y.encodeStateAsUpdate(big.doc).byteLength;
const started = Date.now();
const bigFresh = open(deckDoc(bigId, suffix));
await until(() => cardsMap(bigFresh.doc).size === 1000, "a fresh client hydrates a thousand cards");
const hydrateMs = Date.now() - started;
console.log(`thousand-card deck: ${bytes} bytes of update, hydrated in ${hydrateMs} ms`);
if (listCards(bigFresh.doc)[999][1].back.text !== `${999 * 7}`) {
  throw new Error("the thousand-card deck did not round-trip");
}

// --- simulated eviction, then fresh clients on all three doc kinds ---

const amnesia = await sfetch(`${HTTP}/debug/amnesia`);
if (!amnesia.ok) throw new Error("amnesia route failed");

const laterId = addCard(deckB.doc, { kind: "plain", text: "9 x 9" }, { kind: "plain", text: "81" });
recordReview(bravo.doc, deckId, cardB, 1, scheduled(now), now);
await until(
  () => cardsMap(deckA.doc).get(laterId) !== undefined && reviewLog(bravo.doc).length === 1,
  "convergence across simulated eviction",
);

const index2 = open(indexDoc(suffix));
const deck2 = open(deckDoc(deckId, suffix));
const alpha2 = open(progressDoc(ALPHA, suffix));
await until(
  () =>
    listDecks(index2.doc).map(([, d]) => d.name).join() ===
      "Times tables (2-5),Times tables (copy),Thousand" &&
    cardsMap(deck2.doc).size === 3 &&
    bothSides(deck2.doc) &&
    getReview(alpha2.doc, deckId, cardA)?.due === tomorrow &&
    reviewLog(alpha2.doc).length === 1,
  "fresh clients hydrate index, deck, and progress from SQLite",
);

for (const x of [indexA, indexB, deckA, deckB, alpha, bravo, bravoFresh, copy, copyFresh, big, bigFresh, index2, deck2, alpha2]) {
  x.provider.destroy();
}
console.log("SUCCESS");
process.exit(0);
