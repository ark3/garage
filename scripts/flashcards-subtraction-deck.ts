// Seeds the "Subtraction to 10" deck: every `a - b` with a and b in 1..10 and a
// positive answer, 45 cards, the counterpart of the hand-seeded "Addition to
// 20" deck (all `a + b` for a and b in 1..10). Cards land in shuffled order
// with distinct createdAt values, because the planner introduces fresh cards
// oldest first and a sorted deck would drill 2 - 1, 3 - 1, 3 - 2, ... in turn.
// Targets scripts/target.ts: the test server by default, the family server
// only with GARAGE_URL=http://localhost:8787.
//   bun scripts/flashcards-subtraction-deck.ts

import { addCard, cardsMap, createDeck, deckDoc, decksMap, indexDoc } from "../apps/flashcards/src/model";
import { open } from "./target";

const NAME = "Subtraction to 10";
const CREATED_BY = "dev"; // the local stub identity, like the addition deck

async function until(cond: () => boolean, what: string, ms = 20000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`ok: ${what}`);
}

const facts: [number, number][] = [];
for (let a = 2; a <= 10; a++) for (let b = 1; b < a; b++) facts.push([a, b]);
for (let i = facts.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [facts[i], facts[j]] = [facts[j], facts[i]];
}

const index = open(indexDoc());
await until(() => index.provider.synced, "index synced");
if ([...decksMap(index.doc).values()].some((d) => d.get("name") === NAME)) {
  throw new Error(`a deck named "${NAME}" already exists`);
}
const deckId = createDeck(index.doc, NAME, CREATED_BY);

const deck = open(deckDoc(deckId));
const base = Date.now();
deck.doc.transact(() => {
  facts.forEach(([a, b], i) => {
    const id = addCard(deck.doc, { kind: "plain", text: `${a} - ${b}` }, { kind: "plain", text: `${a - b}` });
    cardsMap(deck.doc).get(id)!.set("createdAt", base + i);
  });
});

// The protocol acks nothing: fresh clients prove the server has both docs.
const indexCheck = open(indexDoc());
const deckCheck = open(deckDoc(deckId));
await until(
  () => decksMap(indexCheck.doc).get(deckId)?.get("name") === NAME && cardsMap(deckCheck.doc).size === facts.length,
  `"${NAME}" (${deckId}) holds ${facts.length} cards`,
);
process.exit(0);
