// Shared by the deck seeding scripts: writes one named deck of plain cards in
// shuffled order with distinct createdAt values, because the planner
// introduces fresh cards oldest first and a sorted deck would drill them in
// order. Refuses a name the index already holds. Targets scripts/target.ts:
// the test server by default, the family server only with
// GARAGE_URL=http://localhost:8787.

import { addCard, cardsMap, createDeck, deckDoc, decksMap, indexDoc, type Side } from "../apps/flashcards/src/model";
import { open } from "./target";

const CREATED_BY = "dev"; // the local stub identity, like the hand-seeded decks

async function until(cond: () => boolean, what: string, ms = 20000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`ok: ${what}`);
}

export async function seedDeck(name: string, cards: [Side, Side][]): Promise<void> {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const index = open(indexDoc());
  await until(() => index.provider.synced, "index synced");
  if ([...decksMap(index.doc).values()].some((d) => d.get("name") === name)) {
    throw new Error(`a deck named "${name}" already exists`);
  }
  const deckId = createDeck(index.doc, name, CREATED_BY);

  const deck = open(deckDoc(deckId));
  const base = Date.now();
  deck.doc.transact(() => {
    shuffled.forEach(([front, back], i) => {
      const id = addCard(deck.doc, front, back);
      cardsMap(deck.doc).get(id)!.set("createdAt", base + i);
    });
  });

  // The protocol acks nothing: fresh clients prove the server has both docs.
  const indexCheck = open(indexDoc());
  const deckCheck = open(deckDoc(deckId));
  await until(
    () => decksMap(indexCheck.doc).get(deckId)?.get("name") === name && cardsMap(deckCheck.doc).size === cards.length,
    `"${name}" (${deckId}) holds ${cards.length} cards`,
  );
  process.exit(0);
}
