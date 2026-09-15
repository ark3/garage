import { expect, test } from "bun:test";
import * as Y from "yjs";
import {
  addCard,
  cardsMap,
  FRESH_PER_DAY,
  gradeCard,
  planSession,
  recordReview,
  REVIEW_PER_SESSION,
  reviewLog,
  type Review,
} from "./model";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const DECK = "deck";
const LONG_AGO = NOW - 30 * DAY;

// A card whose createdAt is chosen, not clocked, so ordering is assertable.
function card(deck: Y.Doc, createdAt: number): string {
  const id = addCard(deck, { kind: "plain", text: "q" }, { kind: "plain", text: "a" });
  cardsMap(deck).get(id)!.set("createdAt", createdAt);
  return id;
}

// A card with progress; its log line is dated long ago so it never counts as
// introduced today.
function studied(progress: Y.Doc, cardId: string, review: Partial<Review>): void {
  recordReview(progress, DECK, cardId, 4, { ease: 2.5, reps: 3, interval: 1, due: NOW + DAY, ...review }, LONG_AGO);
}

test("warm-up is the two not-due cards with the longest intervals", () => {
  const deck = new Y.Doc();
  const progress = new Y.Doc();
  const short = card(deck, 1);
  const longest = card(deck, 2);
  const middle = card(deck, 3);
  const dueButLong = card(deck, 4);
  studied(progress, short, { interval: 3 });
  studied(progress, longest, { interval: 30 });
  studied(progress, middle, { interval: 10 });
  studied(progress, dueButLong, { interval: 100, due: NOW });

  expect(planSession(progress, DECK, deck, NOW).warmup).toEqual([longest, middle]);
});

test("warm-up is one card when only one is not due, and none on a deck never studied", () => {
  const deck = new Y.Doc();
  const progress = new Y.Doc();
  const only = card(deck, 1);
  card(deck, 2);
  card(deck, 3);
  expect(planSession(progress, DECK, deck, NOW).warmup).toEqual([]);

  studied(progress, only, { interval: 6 });
  expect(planSession(progress, DECK, deck, NOW).warmup).toEqual([only]);
});

test("review is the due cards, most overdue first, and a due card is not fresh", () => {
  const deck = new Y.Doc();
  const progress = new Y.Doc();
  const dueNow = card(deck, 1);
  const threeDays = card(deck, 2);
  const oneDay = card(deck, 3);
  const tomorrow = card(deck, 4);
  studied(progress, dueNow, { due: NOW });
  studied(progress, threeDays, { due: NOW - 3 * DAY });
  studied(progress, oneDay, { due: NOW - DAY });
  studied(progress, tomorrow, { due: NOW + DAY });

  const plan = planSession(progress, DECK, deck, NOW);
  expect(plan.review).toEqual([threeDays, oneDay, dueNow]);
  expect(plan.fresh).toEqual([]);
});

test("a backed-up queue is cut at the session cap, keeping the most overdue", () => {
  const deck = new Y.Doc();
  const progress = new Y.Doc();
  const ids: string[] = [];
  for (let i = 0; i < REVIEW_PER_SESSION + 5; i++) {
    const id = card(deck, i);
    studied(progress, id, { due: NOW - i * DAY });
    ids.push(id);
  }

  const plan = planSession(progress, DECK, deck, NOW);
  expect(plan.review).toHaveLength(REVIEW_PER_SESSION);
  expect(plan.review).toEqual(ids.slice(5).reverse());
});

test("fresh is the never-studied cards, oldest first, cut at the daily cap", () => {
  const deck = new Y.Doc();
  const progress = new Y.Doc();
  const created = [8, 3, 5, 1, 7, 2, 6, 4].map((t) => [card(deck, t), t] as const);
  const oldestFirst = [...created].sort((a, b) => a[1] - b[1]).map(([id]) => id);

  const plan = planSession(progress, DECK, deck, NOW);
  expect(plan.fresh).toHaveLength(FRESH_PER_DAY);
  expect(plan.fresh).toEqual(oldestFirst.slice(0, FRESH_PER_DAY));
  expect(plan.warmup).toEqual([]);
  expect(plan.review).toEqual([]);
});

test("cards graduated today use up the day's quota; tomorrow brings five more", () => {
  const deck = new Y.Doc();
  const progress = new Y.Doc();
  for (let i = 0; i < 30; i++) card(deck, i);

  const first = planSession(progress, DECK, deck, NOW).fresh;
  expect(first).toHaveLength(FRESH_PER_DAY);
  for (const id of first) gradeCard(progress, DECK, id, "good", NOW);

  expect(planSession(progress, DECK, deck, NOW).fresh).toEqual([]);

  const tomorrow = planSession(progress, DECK, deck, NOW + DAY);
  expect(tomorrow.fresh).toHaveLength(FRESH_PER_DAY);
  expect(tomorrow.fresh).not.toContainEqual(first[0]);
  // The graduates are due again tomorrow, so they come back as review.
  expect([...tomorrow.review].sort()).toEqual([...first].sort());
});

test("a log line with no progress entry counts toward today but leaves the card fresh", () => {
  const deck = new Y.Doc();
  const progress = new Y.Doc();
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) ids.push(card(deck, i));
  reviewLog(progress).push([{ deckId: DECK, cardId: ids[0], at: NOW, grade: 4 }]);

  const plan = planSession(progress, DECK, deck, NOW);
  expect(plan.fresh).toEqual(ids.slice(0, FRESH_PER_DAY - 1));
});
