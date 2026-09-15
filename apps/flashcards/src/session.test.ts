import { expect, test } from "bun:test";
import { FRESH_PER_DAY } from "./model";
import { LEARNING_STEPS, REINSERT_DISTANCE, startSession, type Outcome } from "./session";

// mulberry32: a tiny seeded generator so shuffles are fixed per test.
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Walk a session to the end, answering every prompt with `outcome` and
// advancing every intro; returns the cards in the order they were shown.
function walk(session: ReturnType<typeof startSession>, outcome: Outcome = "hit") {
  const shown: { id: string; phase: string }[] = [];
  for (let cur = session.current(); cur; cur = session.current()) {
    shown.push(cur);
    session.answer(cur.phase === "intro" ? "advance" : outcome);
  }
  return shown;
}

test("a fresh card is introduced, then prompted N times, and graduates with one Good", () => {
  const session = startSession({ warmup: [], review: [], fresh: ["f"] }, seeded(1));
  expect(session.current()).toEqual({ id: "f", phase: "intro" });
  expect(session.answer("advance")).toBeUndefined();

  for (let step = 1; step < LEARNING_STEPS; step++) {
    expect(session.current()).toEqual({ id: "f", phase: "prompt" });
    expect(session.answer("hit")).toBeUndefined();
  }
  expect(session.current()).toEqual({ id: "f", phase: "prompt" });
  expect(session.answer("hit")).toEqual({ id: "f", button: "good" });
  expect(session.current()).toBeUndefined();
});

test("a learning miss writes nothing and resets the card to step 1", () => {
  const session = startSession({ warmup: [], review: [], fresh: ["f"] }, seeded(1));
  session.answer("advance");
  for (let step = 1; step < LEARNING_STEPS; step++) expect(session.answer("hit")).toBeUndefined();
  // One step short of graduating: a miss starts the count over.
  expect(session.answer("miss")).toBeUndefined();
  for (let step = 1; step < LEARNING_STEPS; step++) {
    expect(session.current()).toEqual({ id: "f", phase: "prompt" });
    expect(session.answer("hit")).toBeUndefined();
  }
  expect(session.answer("hit")).toEqual({ id: "f", button: "good" });
  expect(session.current()).toBeUndefined();
});

test("a learning card re-enters a few positions ahead, not at the end", () => {
  const fresh = ["a", "b", "c", "d", "e", "f", "g"];
  const session = startSession({ warmup: [], review: [], fresh }, seeded(2));
  const first = session.current()!;
  expect(first.phase).toBe("intro");
  session.answer("advance");
  // The other intros fill the gap, then the same card comes back as a prompt.
  const next: string[] = [];
  for (let i = 0; i <= REINSERT_DISTANCE; i++) {
    next.push(session.current()!.id);
    session.answer("advance");
  }
  expect(next.indexOf(first.id)).toBe(REINSERT_DISTANCE);
  expect(REINSERT_DISTANCE).toBeLessThan(fresh.length - 1);
});

test("a day's new cards are all introduced before any is asked back", () => {
  const fresh = Array.from({ length: FRESH_PER_DAY }, (_, i) => `f${i}`);
  const shown = walk(startSession({ warmup: [], review: [], fresh }, seeded(5)));
  expect(shown.slice(0, FRESH_PER_DAY).map((s) => s.phase)).toEqual(fresh.map(() => "intro"));
  // Then each card is asked, all the others between its two askings.
  const prompts = shown.slice(FRESH_PER_DAY).map((s) => s.id);
  expect(prompts.slice(0, FRESH_PER_DAY).sort()).toEqual([...fresh].sort());
  expect(prompts.slice(FRESH_PER_DAY).sort()).toEqual([...fresh].sort());
});

test("a missed learning card re-enters ahead too, and at the end when fewer remain", () => {
  const session = startSession({ warmup: [], review: [], fresh: ["a", "b", "c", "d", "e", "f", "g"] }, seeded(3));
  const first = session.current()!.id;
  for (let i = 0; i <= REINSERT_DISTANCE; i++) session.answer("advance");
  expect(session.current()).toEqual({ id: first, phase: "prompt" });
  expect(session.answer("miss")).toBeUndefined();
  const next: string[] = [];
  for (let i = 0; i <= REINSERT_DISTANCE; i++) {
    next.push(session.current()!.id);
    session.answer("hit");
  }
  expect(next.indexOf(first)).toBe(REINSERT_DISTANCE);

  // With fewer than that left, the card goes last.
  const small = startSession({ warmup: [], review: ["r"], fresh: ["f"] }, seeded(3));
  small.answer("hit");
  small.answer("advance");
  expect(small.answer("miss")).toBeUndefined();
  expect(small.current()).toEqual({ id: "f", phase: "prompt" });
});

test("a review miss writes one Again; the relearning hit writes nothing and the card leaves", () => {
  const session = startSession({ warmup: [], review: ["r1", "r2", "r3", "r4", "r5", "r6", "r7"], fresh: [] }, seeded(4));
  const missed = session.current()!;
  expect(missed.phase).toBe("prompt");
  expect(session.answer("miss")).toEqual({ id: missed.id, button: "again" });

  const seen: string[] = [];
  for (let i = 0; i < REINSERT_DISTANCE; i++) {
    seen.push(session.current()!.id);
    expect(session.answer("hit")).toEqual({ id: seen[i], button: "good" });
  }
  expect(seen).not.toContain(missed.id);

  expect(session.current()).toEqual({ id: missed.id, phase: "prompt" });
  expect(session.answer("hit")).toBeUndefined();
  expect(walk(session).map((s) => s.id)).not.toContain(missed.id);
});

test("a relearning miss brings the card back again without another grade", () => {
  const session = startSession({ warmup: [], review: ["r"], fresh: [] }, seeded(5));
  expect(session.answer("miss")).toEqual({ id: "r", button: "again" });
  expect(session.answer("miss")).toBeUndefined();
  expect(session.current()).toEqual({ id: "r", phase: "prompt" });
  expect(session.answer("hit")).toBeUndefined();
  expect(session.current()).toBeUndefined();
});

test("a warm-up hit writes nothing and the card leaves; a warm-up miss writes Again and it returns as relearning", () => {
  const hit = startSession({ warmup: ["w"], review: ["r"], fresh: [] }, seeded(9));
  expect(hit.current()).toEqual({ id: "w", phase: "prompt" });
  expect(hit.answer("hit")).toBeUndefined();
  expect(walk(hit).map((s) => s.id)).toEqual(["r"]);

  const miss = startSession({ warmup: ["w"], review: ["r"], fresh: [] }, seeded(9));
  expect(miss.answer("miss")).toEqual({ id: "w", button: "again" });
  expect(miss.answer("hit")).toEqual({ id: "r", button: "good" });
  expect(miss.current()).toEqual({ id: "w", phase: "prompt" });
  expect(miss.answer("hit")).toBeUndefined();
  expect(miss.current()).toBeUndefined();
});

test("a session of warm-up and review cards ends after each is answered once", () => {
  const warmup = ["w1", "w2"];
  const review = ["r1", "r2", "r3"];
  const session = startSession({ warmup, review, fresh: [] }, seeded(6));
  const shown = walk(session);
  expect(shown.every((s) => s.phase === "prompt")).toBe(true);
  expect(shown.map((s) => s.id).sort()).toEqual([...warmup, ...review].sort());
  expect(session.current()).toBeUndefined();
});

test("groups appear in order under a fixed seed and are shuffled within the group", () => {
  const warmup = ["w1", "w2", "w3", "w4"];
  const review = ["r1", "r2", "r3", "r4", "r5"];
  const fresh = ["f1", "f2", "f3", "f4", "f5"];
  const session = startSession({ warmup, review, fresh }, seeded(7));

  const firstSeen: string[] = [];
  for (const s of walk(session)) if (!firstSeen.includes(s.id)) firstSeen.push(s.id);

  const w = firstSeen.slice(0, warmup.length);
  const r = firstSeen.slice(warmup.length, warmup.length + review.length);
  const f = firstSeen.slice(warmup.length + review.length);
  expect([...w].sort()).toEqual(warmup);
  expect([...r].sort()).toEqual(review);
  expect([...f].sort()).toEqual(fresh);
  expect(w).not.toEqual(warmup);
  expect(r).not.toEqual(review);
  expect(f).not.toEqual(fresh);

  // Same seed, same order.
  const again = startSession({ warmup, review, fresh }, seeded(7));
  expect(again.current()).toEqual({ id: w[0], phase: "prompt" });
});

test("the summary counts distinct cards answered, how many were new, and what is left", () => {
  const session = startSession({ warmup: ["w"], review: ["r"], fresh: ["f"] }, seeded(8));
  expect(session.summary()).toEqual({ answered: 0, fresh: 0, remaining: 3 });
  session.answer("hit"); // w
  expect(session.summary()).toEqual({ answered: 1, fresh: 0, remaining: 2 });
  session.answer("miss"); // r, comes back
  expect(session.summary()).toEqual({ answered: 2, fresh: 0, remaining: 2 });
  session.answer("advance"); // f intro
  expect(session.summary()).toEqual({ answered: 2, fresh: 1, remaining: 2 });
  walk(session);
  expect(session.summary()).toEqual({ answered: 3, fresh: 1, remaining: 0 });
});

test("the random function defaults to Math.random", () => {
  const session = startSession({ warmup: ["w"], review: [], fresh: [] });
  expect(session.current()).toEqual({ id: "w", phase: "prompt" });
});
