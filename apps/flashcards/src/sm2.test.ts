import { expect, test } from "bun:test";
import { QUALITY, schedule, type Review } from "./sm2";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

test("the four buttons are SM-2 qualities 1, 3, 4, 5", () => {
  expect(QUALITY).toEqual({ again: 1, hard: 3, good: 4, easy: 5 });
});

test("a new card graded Good is due in one day at the initial ease", () => {
  expect(schedule(undefined, "good", NOW)).toEqual({
    ease: 2.5,
    interval: 1,
    reps: 1,
    due: NOW + DAY,
  });
});

test("the second Good is six days out, the third is round(6 * ease)", () => {
  const first = schedule(undefined, "good", NOW);
  const second = schedule(first, "good", NOW);
  expect(second.interval).toBe(6);
  expect(second.reps).toBe(2);
  expect(second.due).toBe(NOW + 6 * DAY);

  const third = schedule(second, "good", NOW);
  expect(third.interval).toBe(Math.round(6 * second.ease)); // 15
  expect(third.reps).toBe(3);
  expect(third.due).toBe(NOW + 15 * DAY);
});

test("Again after a streak resets reps to zero and the interval to one day", () => {
  let state = schedule(undefined, "good", NOW);
  state = schedule(state, "good", NOW);
  state = schedule(state, "good", NOW);
  expect(state.reps).toBe(3);

  const lapsed = schedule(state, "again", NOW);
  expect(lapsed.reps).toBe(0);
  expect(lapsed.interval).toBe(1);
  expect(lapsed.due).toBe(NOW + DAY);
  // SM-2 still updates the E-Factor on a failing grade.
  expect(lapsed.ease).toBeCloseTo(state.ease - 0.54, 10);

  // And the ladder restarts: one day, then six.
  expect(schedule(lapsed, "good", NOW).interval).toBe(1);
  expect(schedule(schedule(lapsed, "good", NOW), "good", NOW).interval).toBe(6);
});

test("ease never drops below 1.3 however often the card is failed", () => {
  let state = schedule(undefined, "again", NOW);
  for (let i = 0; i < 20; i++) state = schedule(state, "again", NOW);
  expect(state.ease).toBe(1.3);
  expect(state.interval).toBe(1);
});

test("Easy raises the ease, Hard lowers it, Good leaves it alone", () => {
  const start: Review = { ease: 2.5, interval: 10, reps: 3, due: NOW };
  expect(schedule(start, "easy", NOW).ease).toBeCloseTo(2.6, 10);
  expect(schedule(start, "hard", NOW).ease).toBeCloseTo(2.36, 10);
  expect(schedule(start, "good", NOW).ease).toBeCloseTo(2.5, 10);
});

test("Hard is a passing grade: it advances the ladder on the old ease", () => {
  const start: Review = { ease: 2.5, interval: 10, reps: 3, due: NOW };
  const next = schedule(start, "hard", NOW);
  expect(next.reps).toBe(4);
  expect(next.interval).toBe(25); // round(10 * 2.5), the ease carried in
  expect(next.due).toBe(NOW + 25 * DAY);
});

test("the same input always yields the same output", () => {
  const start: Review = { ease: 2.36, interval: 17, reps: 5, due: NOW };
  for (const button of ["again", "hard", "good", "easy"] as const) {
    const once = schedule(start, button, NOW);
    expect(schedule(start, button, NOW)).toEqual(once);
    expect(schedule({ ...start }, button, NOW)).toEqual(once);
    expect(start).toEqual({ ease: 2.36, interval: 17, reps: 5, due: NOW });
  }
});
