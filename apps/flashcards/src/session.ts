// One study session as a state machine over the planner's three card lists.
// Learning state is session-local and never stored: a new card graduates by
// receiving its first SM-2 grade, and anything still learning when the tab
// closes is new again tomorrow. No Yjs, no DOM, no clock: the machine only
// hands out card ids and says which grade to write, so it stays testable on
// plain string lists.
//
//   startSession({ warmup, review, fresh }, random?) -> Session
//   session.current()  -> { id, phase: "intro" | "prompt" } | undefined (done)
//   session.answer(o)  -> { id, button } to write, or undefined
//   session.summary()  -> { answered, fresh, remaining }
//
// Order is warm-up, then review, then fresh, each group shuffled with the
// injected random (seeded in tests). Outcomes: "advance" leaves an intro,
// "hit" and "miss" grade a prompt. A fresh card is introduced (both sides
// shown), then prompted until it has been produced LEARNING_STEPS times in a
// row; that last hit writes Good, a miss resets the count. A review hit writes
// Good; a review miss writes Again and the card returns once as relearning,
// whose hit writes nothing, so one miss is one log entry. A warm-up card was
// not due, so its hit writes nothing (a Good from today would push a card the
// scheduler had not asked about); its miss is a review miss. A card that comes
// back re-enters REINSERT_DISTANCE positions ahead, or last if fewer remain.

import { FRESH_PER_DAY } from "./model";
import type { Button } from "./sm2";

export const LEARNING_STEPS = 2;
// A day's new cards are all introduced before any of them is asked back: a
// shorter distance lets the early ones leapfrog the last intro until they have
// graduated, and that card is then introduced last and drilled back to back.
export const REINSERT_DISTANCE = FRESH_PER_DAY;

export type Plan = { warmup: string[]; review: string[]; fresh: string[] };
export type Phase = "intro" | "prompt";
export type Outcome = "advance" | "hit" | "miss";
export type Grade = { id: string; button: Button };

export type Session = {
  current(): { id: string; phase: Phase } | undefined;
  answer(outcome: Outcome): Grade | undefined;
  summary(): { answered: number; fresh: number; remaining: number };
};

type Entry =
  | { id: string; kind: "intro" }
  | { id: string; kind: "learning"; hits: number }
  | { id: string; kind: "warmup" }
  | { id: string; kind: "review" }
  | { id: string; kind: "relearning" };

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function startSession(plan: Plan, random: () => number = Math.random): Session {
  const queue: Entry[] = [
    ...shuffle(plan.warmup, random).map((id) => ({ id, kind: "warmup" }) as Entry),
    ...shuffle(plan.review, random).map((id) => ({ id, kind: "review" }) as Entry),
    ...shuffle(plan.fresh, random).map((id) => ({ id, kind: "intro" }) as Entry),
  ];
  const answered = new Set<string>();
  let fresh = 0;

  const requeue = (entry: Entry) => {
    queue.splice(Math.min(REINSERT_DISTANCE, queue.length), 0, entry);
  };

  return {
    current() {
      const head = queue[0];
      if (!head) return undefined;
      return { id: head.id, phase: head.kind === "intro" ? "intro" : "prompt" };
    },

    answer(outcome) {
      const entry = queue.shift()!;
      if (entry.kind === "intro") {
        fresh++;
        requeue({ id: entry.id, kind: "learning", hits: 0 });
        return undefined;
      }
      answered.add(entry.id);
      const hit = outcome === "hit";
      switch (entry.kind) {
        case "learning": {
          const hits = hit ? entry.hits + 1 : 0;
          if (hits === LEARNING_STEPS) return { id: entry.id, button: "good" };
          requeue({ ...entry, hits });
          return undefined;
        }
        case "warmup":
        case "review":
          if (hit) return entry.kind === "review" ? { id: entry.id, button: "good" } : undefined;
          requeue({ id: entry.id, kind: "relearning" });
          return { id: entry.id, button: "again" };
        case "relearning":
          if (!hit) requeue(entry);
          return undefined;
      }
    },

    summary() {
      return { answered: answered.size, fresh, remaining: queue.length };
    },
  };
}
