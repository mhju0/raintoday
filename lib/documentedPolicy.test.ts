import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DEFAULT_PERFORMANCE_POLICY } from "./performance/performance.ts";

/**
 * `docs/weather-sources.md` and `README.md` both quoted `exp(-4 × Brier)` for
 * months after the code moved to 12. Nothing could notice: the number lived in
 * prose, and prose is not compiled. These pins put the policy object back in
 * charge of the sentence that describes it, so raising a default and leaving the
 * documents behind fails the suite instead of misleading a reader.
 *
 * A reworded sentence that drops a pin fails too. That is deliberate — the
 * numbers are the claim, and rewriting the claim is exactly when they should be
 * re-checked against the code.
 */
const DOCUMENTS = ["../README.md", "../docs/weather-sources.md"] as const;

const policy = DEFAULT_PERFORMANCE_POLICY;

const PINS: { label: string; pattern: RegExp; expected: string }[] = [
  {
    label: "score transform sharpness",
    pattern: /`exp\(-([\d.]+) × Brier\)`/g,
    expected: String(policy.scoreSharpness),
  },
  {
    label: "influence ramp",
    pattern: /(?:through|to-)(\d+)[ -]captures?|influence ramping through (\d+)/g,
    expected: String(policy.fullInfluenceSamples),
  },
  {
    label: "rain threshold",
    pattern: /([\d.]+) ?mm rain threshold|rain at ([\d.]+) ?mm/g,
    expected: String(policy.rainThresholdMm),
  },
  {
    label: "decision threshold",
    pattern: /(\d+)% decision threshold|decisions at (\d+)%/g,
    expected: String(policy.decisionThreshold),
  },
  {
    label: "operating window",
    pattern: /(\d+)-day (?:operating window|lookback)/g,
    expected: String(policy.windowDays),
  },
  {
    label: "provider influence bounds",
    pattern: /(?:bounded to |bounds? |influence )(\d+)–(\d+)%/g,
    expected: `${policy.weightFloor * 100}–${policy.weightCap * 100}`,
  },
];

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

test("the published policy numbers are the ones the code actually uses", () => {
  const corpus = DOCUMENTS.map(read).join("\n");

  for (const pin of PINS) {
    const found = [...corpus.matchAll(pin.pattern)].map((match) =>
      match.slice(1).filter((group) => group !== undefined).join("–"),
    );
    assert.ok(
      found.length > 0,
      `no document states the ${pin.label}; a pin that matches nothing proves nothing`,
    );
    for (const value of found) {
      assert.equal(value, pin.expected, `documented ${pin.label} drifted from the policy`);
    }
  }
});

test("the minimum sample bar is stated as a count, not a window", () => {
  // #89 was filed on the belief that the bar was 30 comparisons *within* the
  // 30-day window, back when both numbers were 30 and no reader could tell them
  // apart. They now differ on purpose: the bar is a count of comparisons, the
  // window is a span of days, and pairing 30 with 30 had quietly demanded a
  // flawless month of the benchmark. Keep them unequal, so the prose cannot
  // silently return to conflating them.
  const corpus = DOCUMENTS.map(read).join("\n");
  assert.equal(policy.minimumSamples, 30);
  assert.notEqual(policy.windowDays, policy.minimumSamples);
  assert.match(corpus, /at least 30 comparable captures/);
});
