import { expect, test } from "bun:test";
import { FLAVOURS, flavourFor } from "./reward";

const morning = (day: number) => new Date(2026, 2, day, 7).getTime();

test("the flavour is fixed for a local calendar day, whatever the hour", () => {
  const evening = new Date(2026, 2, 5, 22).getTime();
  expect(flavourFor(morning(5))).toBe(flavourFor(evening));
});

test("every flavour turns up within a few weeks, and it changes from day to day", () => {
  const seen = new Set<string>();
  let changes = 0;
  for (let d = 1; d <= 30; d++) {
    seen.add(flavourFor(morning(d)).emoji);
    if (d > 1 && flavourFor(morning(d)) !== flavourFor(morning(d - 1))) changes++;
  }
  expect(seen.size).toBe(FLAVOURS.length);
  expect(changes).toBeGreaterThan(15);
});
