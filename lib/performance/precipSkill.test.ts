import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORICAL_WEIGHT,
  FALSE_ALARM_PENALTY,
  categoricalSkill,
  classifyOutcome,
  combineDailySkill,
  contingencyOf,
  criticalSuccessIndex,
  observedRain,
  POP_RAIN_THRESHOLD,
  predictedRain,
  QUANT_SCALE_MM,
  quantitativeSkill,
  RAIN_THRESHOLD_MM,
  scoreSourceDay,
} from "./precipSkill.ts";

test("predictedRain prefers amount, falls back to POP, else null", () => {
  // amount wins when present
  assert.equal(predictedRain(0, RAIN_THRESHOLD_MM), true);
  assert.equal(predictedRain(100, 0), false); // dry amount overrides a high POP
  // POP fallback when no amount
  assert.equal(predictedRain(POP_RAIN_THRESHOLD, null), true);
  assert.equal(predictedRain(POP_RAIN_THRESHOLD - 1, null), false);
  // neither → undecidable
  assert.equal(predictedRain(null, null), null);
});

test("observedRain uses the measurable-precip threshold", () => {
  assert.equal(observedRain(0), false);
  assert.equal(observedRain(RAIN_THRESHOLD_MM - 0.01), false);
  assert.equal(observedRain(RAIN_THRESHOLD_MM), true);
  assert.equal(observedRain(12.3), true);
});

test("classifyOutcome maps the four contingency cells", () => {
  assert.equal(classifyOutcome(true, true), "hit");
  assert.equal(classifyOutcome(false, true), "miss");
  assert.equal(classifyOutcome(true, false), "false_alarm");
  assert.equal(classifyOutcome(false, false), "correct_dry");
});

test("CSI excludes correct-negatives (dry days don't inflate)", () => {
  assert.equal(criticalSuccessIndex(contingencyOf("hit")), 1);
  assert.equal(criticalSuccessIndex(contingencyOf("miss")), 0);
  assert.equal(criticalSuccessIndex(contingencyOf("false_alarm")), 0);
  // correct-negative → 0/0 → null (not 1, which would inflate a dry forecaster)
  assert.equal(criticalSuccessIndex(contingencyOf("correct_dry")), null);
});

test("categoricalSkill applies an asymmetric penalty: miss < false alarm < hit", () => {
  const hit = categoricalSkill("hit");
  const fa = categoricalSkill("false_alarm");
  const miss = categoricalSkill("miss");
  assert.equal(hit, 1);
  assert.equal(fa, 1 - FALSE_ALARM_PENALTY); // 0.5
  assert.equal(miss, 0);
  assert.ok(miss! < fa! && fa! < hit!, "miss must be penalized more than a false alarm");
  assert.equal(categoricalSkill("correct_dry"), null);
});

test("quantitativeSkill: only on rainy days, only with an amount, clamped", () => {
  // not a rainy day → null even with an amount
  assert.equal(quantitativeSkill(5, 0, false), null);
  // rainy day but source gave no amount → null
  assert.equal(quantitativeSkill(null, 10, true), null);
  // perfect amount on a rainy day → 1
  assert.equal(quantitativeSkill(10, 10, true), 1);
  // a QUANT_SCALE_MM error → 0
  assert.equal(quantitativeSkill(0, QUANT_SCALE_MM, true), 0);
  // a larger error stays clamped at 0 (never negative)
  assert.equal(quantitativeSkill(0, QUANT_SCALE_MM * 3, true), 0);
  // a known partial error
  assert.equal(quantitativeSkill(8, 10, true), 1 - 2 / QUANT_SCALE_MM); // 0.9
});

test("combineDailySkill blends, falls back, and returns null only when both null", () => {
  assert.equal(combineDailySkill(null, null), null);
  assert.equal(combineDailySkill(0.5, null), 0.5); // categorical-only day
  assert.equal(combineDailySkill(1, 0.9), CATEGORICAL_WEIGHT * 1 + (1 - CATEGORICAL_WEIGHT) * 0.9);
});

test("scoreSourceDay: missing forecast signal → skip", () => {
  assert.equal(scoreSourceDay({ pop: null, predicted_mm: null, observed_mm: 10 }), null);
});

test("scoreSourceDay: correct-dry (both dry) → skip, no inflation", () => {
  assert.equal(scoreSourceDay({ pop: 10, predicted_mm: null, observed_mm: 0 }), null);
  assert.equal(scoreSourceDay({ pop: null, predicted_mm: 0, observed_mm: 0 }), null);
});

test("scoreSourceDay: hit with a good amount blends to a high skill", () => {
  const s = scoreSourceDay({ pop: 80, predicted_mm: 12, observed_mm: 10 });
  assert.ok(s);
  assert.equal(s.outcome, "hit");
  assert.equal(s.categorical_skill, 1);
  assert.equal(s.quantitative_skill, 1 - 2 / QUANT_SCALE_MM); // 0.9
  assert.equal(s.mae, 2); // |12 − 10|
  assert.equal(s.skill, CATEGORICAL_WEIGHT * 1 + (1 - CATEGORICAL_WEIGHT) * 0.9); // 0.96
  assert.equal(s.csi, 1);
});

test("scoreSourceDay: mae is null when the source supplied no amount", () => {
  const s = scoreSourceDay({ pop: 95, predicted_mm: null, observed_mm: 40 });
  assert.ok(s);
  assert.equal(s.outcome, "hit"); // POP-only hit
  assert.equal(s.mae, null);
});

test("scoreSourceDay: a miss is penalized more than a false alarm", () => {
  // miss: forecast dry (POP-only source), it rained 10mm
  const miss = scoreSourceDay({ pop: 10, predicted_mm: null, observed_mm: 10 });
  // false alarm: forecast rain, stayed dry
  const fa = scoreSourceDay({ pop: 90, predicted_mm: null, observed_mm: 0 });
  assert.ok(miss && fa);
  assert.equal(miss.outcome, "miss");
  assert.equal(fa.outcome, "false_alarm");
  assert.equal(miss.skill, 0); // categorical 0, no amount → quant null
  assert.equal(fa.skill, 1 - FALSE_ALARM_PENALTY); // 0.5
  assert.ok(miss.skill < fa.skill, "a miss must score lower than a false alarm");
});

test("scoreSourceDay: a closer amount beats a worse one on the same rainy day", () => {
  const close = scoreSourceDay({ pop: 70, predicted_mm: 9, observed_mm: 10 });
  const far = scoreSourceDay({ pop: 70, predicted_mm: 30, observed_mm: 10 });
  assert.ok(close && far);
  assert.ok(close.skill > far.skill, "amount accuracy must move the combined skill");
});

test("scoreSourceDay: every emitted skill stays within [0,1]", () => {
  const cases = [
    { pop: 0, predicted_mm: 0, observed_mm: 50 }, // big miss with amount
    { pop: 100, predicted_mm: 100, observed_mm: 0 }, // big false alarm with amount
    { pop: 50, predicted_mm: 5, observed_mm: 5 }, // tidy hit
    { pop: 95, predicted_mm: null, observed_mm: 40 }, // POP-only hit, heavy rain
  ];
  for (const c of cases) {
    const s = scoreSourceDay(c);
    if (!s) continue;
    assert.ok(s.skill >= 0 && s.skill <= 1, `skill out of range for ${JSON.stringify(c)}`);
  }
});
