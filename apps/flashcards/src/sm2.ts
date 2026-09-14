// SM-2, the published SuperMemo 2 algorithm, as one pure function. No imports:
// scheduling is arithmetic over a plain state object, so it stays testable
// without a Y.Doc and the progress doc (model.ts) stores exactly what this
// produces.

// SM-2 state for one card, as stored in a progress doc.
export type Review = {
  ease: number;
  interval: number; // days
  reps: number;
  due: number; // epoch ms
};

// Anki's four buttons on SM-2's 0-5 quality scale.
export type Button = "again" | "hard" | "good" | "easy";

export const QUALITY: Record<Button, number> = {
  again: 1,
  hard: 3,
  good: 4,
  easy: 5,
};

const INITIAL_EASE = 2.5;
const MIN_EASE = 1.3;
const DAY_MS = 86_400_000;

// `prev` is absent for a card answered for the first time.
export function schedule(prev: Review | undefined, button: Button, now: number): Review {
  const q = QUALITY[button];
  const ease = prev ? prev.ease : INITIAL_EASE;

  // Published order: the interval uses the E-Factor the card carried into this
  // repetition, and the E-Factor is updated afterwards, on every grade.
  let reps: number;
  let interval: number;
  if (q < 3) {
    // "Start repetitions for the item from the beginning."
    reps = 0;
    interval = 1;
  } else if (!prev || prev.reps === 0) {
    reps = 1;
    interval = 1;
  } else if (prev.reps === 1) {
    reps = 2;
    interval = 6;
  } else {
    reps = prev.reps + 1;
    interval = Math.round(prev.interval * ease);
  }

  const next = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  return {
    ease: Math.max(MIN_EASE, next),
    interval,
    reps,
    due: now + interval * DAY_MS,
  };
}
