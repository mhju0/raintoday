
/**
 * Pure precipitation verification + daily skill scoring. No I/O, no network, no
 * clock — fully unit-tested in precipSkill.test.ts. Its one caller is seedScore.ts, which feeds it one
 * source's forecast (pop, predicted_mm) plus the day's observed_mm and gets back
 * a single skill in [0,1], or null when the day must be skipped.
 *
 * Design (per the Phase 1 spec):
 *  • Categorical rain/no-rain via a contingency table; CSI = hits/(hits+misses+
 *    false_alarms) so correct-negatives (dry days) cannot inflate the score.
 *  • An ASYMMETRIC penalty so a miss costs more than a false alarm.
 *  • A quantitative amount term (MAE) computed ONLY on days it actually rained.
 *  • Combined into one [0,1] daily skill per source.
 *
 * Every threshold/weight below is a named, tunable constant — Phase 2 may
 * calibrate them without touching the logic.
 */

/** Which of the four contingency cells a source's day fell into. */
export type RainOutcome = "hit" | "miss" | "false_alarm" | "correct_dry";

/** The 2x2 rain/no-rain contingency table for one scored day. */
export interface Contingency {
  hits: number;
  misses: number;
  false_alarms: number;
  correct_negatives: number;
}

/** Pure scoring output for one source on one day (no I/O fields). */
export interface SourceDayScore {
  predicted_rain: boolean;
  observed_rain: boolean;
  outcome: RainOutcome;
  contingency: Contingency;
  /** CSI for the day: 1 (hit), 0 (miss/false alarm); never null here because a
   *  correct-dry day is not emitted (it carries no precipitation skill). */
  csi: number | null;
  /** Categorical skill in [0,1] with the asymmetric miss/false-alarm penalty. */
  categorical_skill: number;
  /** Quantitative skill in [0,1] from the rainy-day amount error, or null. */
  quantitative_skill: number | null;
  /** Absolute amount error |predicted_mm - observed_mm| (mm), or null. */
  mae: number | null;
  /** Combined daily skill in [0,1]. */
  skill: number;
}

/** Measurable precipitation threshold (mm). Used for both observed and amount-based predicted rain. */
export const RAIN_THRESHOLD_MM = 0.1;
/** When a source gives no amount, predicted-rain is decided by POP ≥ this (%). */
export const POP_RAIN_THRESHOLD = 50;
/** Penalty applied to a miss (forecast dry, it rained). Miss → categorical 0. */
export const MISS_PENALTY = 1.0;
/** Penalty applied to a false alarm (forecast rain, stayed dry). FA → categorical 0.5. */
export const FALSE_ALARM_PENALTY = 0.5;
/** Amount error (mm) at which the quantitative skill reaches 0. */
export const QUANT_SCALE_MM = 20;
/** Weight of the categorical term when blended with the quantitative term. */
export const CATEGORICAL_WEIGHT = 0.6;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Did the source predict rain? Prefers a forecast amount when available, else
 * falls back to POP. Returns null when the source provided neither — the caller
 * then skips that source-day as "missing forecast data".
 */
export function predictedRain(pop: number | null, predictedMm: number | null): boolean | null {
  if (predictedMm !== null) return predictedMm >= RAIN_THRESHOLD_MM;
  if (pop !== null) return pop >= POP_RAIN_THRESHOLD;
  return null;
}

export function observedRain(observedMm: number): boolean {
  return observedMm >= RAIN_THRESHOLD_MM;
}

export function classifyOutcome(pred: boolean, obs: boolean): RainOutcome {
  if (pred && obs) return "hit";
  if (!pred && obs) return "miss";
  if (pred && !obs) return "false_alarm";
  return "correct_dry";
}

export function contingencyOf(outcome: RainOutcome): Contingency {
  return {
    hits: outcome === "hit" ? 1 : 0,
    misses: outcome === "miss" ? 1 : 0,
    false_alarms: outcome === "false_alarm" ? 1 : 0,
    // textbook "correct negative" cell ↔ the correct_dry outcome
    correct_negatives: outcome === "correct_dry" ? 1 : 0,
  };
}

/**
 * Critical Success Index: hits / (hits + misses + false_alarms). Correct
 * negatives are deliberately excluded from the denominator so dry days don't
 * inflate the score. Returns null when the denominator is 0 (a pure
 * correct-negative), which is exactly the case the caller skips.
 */
export function criticalSuccessIndex(c: Contingency): number | null {
  const denom = c.hits + c.misses + c.false_alarms;
  return denom === 0 ? null : c.hits / denom;
}

/**
 * Categorical skill in [0,1] — CSI re-graded with an ASYMMETRIC penalty so a
 * miss (dangerous: unforecast rain) costs more than a false alarm. Returns null
 * for a correct-dry day (excluded, like CSI's denominator).
 */
export function categoricalSkill(outcome: RainOutcome): number | null {
  switch (outcome) {
    case "hit":
      return 1;
    case "false_alarm":
      return clamp01(1 - FALSE_ALARM_PENALTY);
    case "miss":
      return clamp01(1 - MISS_PENALTY);
    case "correct_dry":
      return null;
  }
}

/**
 * Quantitative skill from the day's absolute amount error, computed ONLY on days
 * it actually rained and only when the source provided an amount. Otherwise null.
 */
export function quantitativeSkill(
  predictedMm: number | null,
  observedMm: number,
  obsRain: boolean,
): number | null {
  if (!obsRain || predictedMm === null) return null;
  const mae = Math.abs(predictedMm - observedMm);
  return clamp01(1 - mae / QUANT_SCALE_MM);
}

/**
 * Blend the categorical and quantitative terms into one [0,1] skill. Returns
 * null only when BOTH are null (a correct-negative day), telling the caller to
 * skip — so dry days never inflate a source's running skill.
 */
export function combineDailySkill(
  categorical: number | null,
  quantitative: number | null,
): number | null {
  if (categorical === null && quantitative === null) return null;
  if (quantitative === null) return categorical;
  if (categorical === null) return quantitative;
  return clamp01(CATEGORICAL_WEIGHT * categorical + (1 - CATEGORICAL_WEIGHT) * quantitative);
}

/**
 * Full per-source daily score, or null when the day must be skipped:
 *  • the source gave no usable forecast signal (no amount and no POP), or
 *  • the day was a correct-dry day (both dry → no precipitation skill to learn).
 */
export function scoreSourceDay(input: {
  pop: number | null;
  predicted_mm: number | null;
  observed_mm: number;
}): SourceDayScore | null {
  const pred = predictedRain(input.pop, input.predicted_mm);
  if (pred === null) return null; // missing forecast → skip

  const obs = observedRain(input.observed_mm);
  const outcome = classifyOutcome(pred, obs);
  const contingency = contingencyOf(outcome);
  const cat = categoricalSkill(outcome);
  const quant = quantitativeSkill(input.predicted_mm, input.observed_mm, obs);
  const skill = combineDailySkill(cat, quant);
  if (skill === null) return null; // correct-dry → nothing to record

  // Raw amount error, carried for the Phase 2 hit-loss term; null when the
  // source supplied no amount (independent of the rain/no-rain outcome).
  const mae = input.predicted_mm === null ? null : Math.abs(input.predicted_mm - input.observed_mm);

  return {
    predicted_rain: pred,
    observed_rain: obs,
    outcome,
    contingency,
    csi: criticalSuccessIndex(contingency),
    // cat is non-null here: skill === null already returned for the only
    // outcome (correct_dry) where categoricalSkill is null.
    categorical_skill: cat ?? 0,
    quantitative_skill: quant,
    mae,
    skill,
  };
}
