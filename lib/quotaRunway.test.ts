import assert from "node:assert/strict";
import test from "node:test";

import { evaluateQuotaRunway } from "./quotaRunway.ts";

const DAY = 86_400;

test("quota that exactly covers the projected burn and the reserve passes", () => {
  // 10 days left at 194/day = 1,940, plus a 1,000 reserve.
  const runway = evaluateQuotaRunway({
    remaining: 2_940,
    resetSeconds: 10 * DAY,
    dailyBurn: 194,
    reserve: 1_000,
  });
  assert.equal(runway.needed, 2_940);
  assert.equal(runway.ok, true);
  assert.equal(runway.shortfall, 0);
});

test("one call below the requirement fails, and reports how far short", () => {
  const runway = evaluateQuotaRunway({
    remaining: 2_939,
    resetSeconds: 10 * DAY,
    dailyBurn: 194,
    reserve: 1_000,
  });
  assert.equal(runway.ok, false);
  assert.equal(runway.shortfall, 1);
});

test("a large balance still fails when the period has long enough left to spend it", () => {
  // The point of runway over a fixed threshold: 5,000 left is comfortable with
  // three days to go and not nearly enough with thirty.
  const early = evaluateQuotaRunway({
    remaining: 5_000,
    resetSeconds: 30 * DAY,
    dailyBurn: 194,
    reserve: 1_000,
  });
  const late = evaluateQuotaRunway({
    remaining: 5_000,
    resetSeconds: 3 * DAY,
    dailyBurn: 194,
    reserve: 1_000,
  });
  assert.equal(early.ok, false);
  assert.equal(late.ok, true);
});

test("a partial day is projected as a whole one, so the check never under-reserves", () => {
  // 1.5 days at 194 is 291 exactly; 1.2 days is 232.8 and must round up to 233.
  const runway = evaluateQuotaRunway({
    remaining: 0,
    resetSeconds: 1.2 * DAY,
    dailyBurn: 194,
    reserve: 0,
  });
  assert.equal(runway.needed, 233);
});

test("at the moment of reset only the reserve is required", () => {
  const runway = evaluateQuotaRunway({
    remaining: 1_000,
    resetSeconds: 0,
    dailyBurn: 194,
    reserve: 1_000,
  });
  assert.equal(runway.needed, 1_000);
  assert.equal(runway.ok, true);
  assert.equal(runway.daysLeft, 0);
});

test("an unusable header value is rejected rather than silently passing", () => {
  // Fail closed: a quota we cannot read is not a quota we can vouch for.
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.throws(
      () =>
        evaluateQuotaRunway({
          remaining: bad,
          resetSeconds: DAY,
          dailyBurn: 194,
          reserve: 1_000,
        }),
      RangeError,
    );
  }
  assert.throws(
    () =>
      evaluateQuotaRunway({
        remaining: 1_000,
        resetSeconds: Number.NaN,
        dailyBurn: 194,
        reserve: 1_000,
      }),
    RangeError,
  );
});
