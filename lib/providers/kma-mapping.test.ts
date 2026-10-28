import { test } from "node:test";
import assert from "node:assert/strict";
import { amountFromKmaPcp, amountRangeFromKmaPcp, conditionFromKma } from "./kma-mapping.ts";

test("conditionFromKma: PTY (강수형태) maps to precipitation", () => {
  assert.equal(conditionFromKma(1, 1), "rain"); // 비
  assert.equal(conditionFromKma(4, 1), "rain"); // 소나기
  assert.equal(conditionFromKma(2, 1), "sleet"); // 비/눈
  assert.equal(conditionFromKma(6, 1), "sleet"); // 빗방울눈날림
  assert.equal(conditionFromKma(3, 1), "snow"); // 눈
  assert.equal(conditionFromKma(7, 1), "snow"); // 눈날림
  assert.equal(conditionFromKma(5, 1), "drizzle"); // 빗방울
});

test("conditionFromKma: PTY overrides SKY (precip wins over a clear sky code)", () => {
  // Raining but SKY says clear → must read as rain, not clear.
  assert.equal(conditionFromKma(1, 1), "rain");
});

test("conditionFromKma: SKY (하늘상태) used only when PTY is 0", () => {
  assert.equal(conditionFromKma(0, 1), "clear");
  assert.equal(conditionFromKma(0, 3), "cloudy");
  assert.equal(conditionFromKma(0, 4), "overcast");
});

test("conditionFromKma: unknown codes fall back to 'unknown'", () => {
  assert.equal(conditionFromKma(0, 0), "unknown");
  assert.equal(conditionFromKma(0, 2), "unknown"); // SKY 2 is not a KMA code
  assert.equal(conditionFromKma(9, 0), "unknown");
});

test("amountFromKmaPcp: reads the amounts KMA states exactly", () => {
  assert.equal(amountFromKmaPcp("강수없음"), 0);
  assert.equal(amountFromKmaPcp("0"), 0);
  assert.equal(amountFromKmaPcp("1.0mm"), 1);
  assert.equal(amountFromKmaPcp("4.0mm"), 4);
});

test("amountFromKmaPcp: a band is unknown, never a midpoint, and so is anything unreadable", () => {
  assert.equal(amountFromKmaPcp("1mm 미만"), null);
  assert.equal(amountFromKmaPcp("30.0~50.0mm"), null);
  assert.equal(amountFromKmaPcp("50.0mm 이상"), null);
  assert.equal(amountFromKmaPcp(undefined), null);
  assert.equal(amountFromKmaPcp(""), null);
  assert.equal(amountFromKmaPcp("-"), null);
});

test("amountRangeFromKmaPcp: keeps each band as its bounds, and only bands", () => {
  assert.deepEqual(amountRangeFromKmaPcp("1mm 미만"), { lowMm: 0, highMm: 1 });
  assert.deepEqual(amountRangeFromKmaPcp("30.0~50.0mm"), { lowMm: 30, highMm: 50 });
  assert.deepEqual(amountRangeFromKmaPcp("50.0mm 이상"), { lowMm: 50, highMm: null });
  assert.equal(amountRangeFromKmaPcp("2.0mm"), null);
  assert.equal(amountRangeFromKmaPcp("강수없음"), null);
  assert.equal(amountRangeFromKmaPcp(undefined), null);
});
