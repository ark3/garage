// Seeds the "Subtraction to 10" deck: every `a - b` with a and b in 1..10 and a
// positive answer, 45 cards, the counterpart of the hand-seeded "Addition to
// 20" deck (all `a + b` for a and b in 1..10).
//   bun scripts/flashcards-subtraction-deck.ts

import { type Side } from "../apps/flashcards/src/model";
import { seedDeck } from "./flashcards-seed";

const cards: [Side, Side][] = [];
for (let a = 2; a <= 10; a++) {
  for (let b = 1; b < a; b++) {
    cards.push([{ kind: "plain", text: `${a} - ${b}` }, { kind: "plain", text: `${a - b}` }]);
  }
}
await seedDeck("Subtraction to 10", cards);
