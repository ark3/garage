// Seeds the "Grand staff" deck: one whole note on a brace-joined treble and
// bass staff per card, the answer its letter name and where it sits. The
// lines and spaces of both staves, the three notes between them (middle C on
// a ledger line, its neighbours in the spaces on either side of it), and the
// space just above the treble and just below the bass: 23 cards.
//
// The staves are drawn two line-spacings apart (%%sysstaffsep 12, measured
// against the rendered SVG), the beginner's "eleven lines" grand staff where
// middle C's ledger line is equidistant from both. abcjs pushes a staff away
// from a note above it, so the three between notes are all written on the
// treble voice to keep that gap the same on every card.
//   bun scripts/flashcards-grand-staff-deck.ts

import { type Side } from "../apps/flashcards/src/model";
import { seedDeck } from "./flashcards-seed";

// [abc pitch on the treble voice, on the bass voice, answer]; `x` is an
// invisible rest so the other staff stays empty.
const notes: [string, string, string][] = [
  ["g", "x", "G (above treble)"],
  ["f", "x", "F (treble, top line)"],
  ["e", "x", "E (treble, top space)"],
  ["d", "x", "D (treble, 4th line)"],
  ["c", "x", "C (treble, 3rd space)"],
  ["B", "x", "B (treble, middle line)"],
  ["A", "x", "A (treble, 2nd space)"],
  ["G", "x", "G (treble, 2nd line)"],
  ["F", "x", "F (treble, bottom space)"],
  ["E", "x", "E (treble, bottom line)"],
  ["D", "x", "D (below treble)"],
  ["C", "x", "C (middle C)"],
  ["B,", "x", "B (above bass)"],
  ["x", "A,", "A (bass, top line)"],
  ["x", "G,", "G (bass, top space)"],
  ["x", "F,", "F (bass, 4th line)"],
  ["x", "E,", "E (bass, 3rd space)"],
  ["x", "D,", "D (bass, middle line)"],
  ["x", "C,", "C (bass, 2nd space)"],
  ["x", "B,,", "B (bass, 2nd line)"],
  ["x", "A,,", "A (bass, bottom space)"],
  ["x", "G,,", "G (bass, bottom line)"],
  ["x", "F,,", "F (below bass)"],
];

const cards: [Side, Side][] = notes.map(([treble, bass, answer]) => [
  {
    kind: "abc",
    text: `X:1\nM:none\nL:1/1\nK:C\n%%sysstaffsep 12\n%%staves {1 2}\nV:1 clef=treble\nV:2 clef=bass\n[V:1] ${treble} |\n[V:2] ${bass} |\n`,
  },
  { kind: "plain", text: answer },
]);
await seedDeck("Grand staff", cards);
