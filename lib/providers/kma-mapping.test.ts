import { test } from "node:test";
import assert from "node:assert/strict";
import { conditionFromKma } from "./kma-mapping.ts";

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
