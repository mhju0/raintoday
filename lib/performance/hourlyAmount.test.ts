import assert from "node:assert/strict";
import test from "node:test";
import {
  amountBlocks,
  amountSwitchVerdict,
  amountWeights,
  blendBlockAmount,
  observedHourIndex,
  providerAmountErrors,
  providerBlockAmount,
  type AmountBlock,
} from "./hourlyAmount.ts";
import type {
  HourlyGradingPair,
  HourlyPrecipObservation,
  MorningCapture,
  MorningProviderForecast,
} from "./types.ts";

const DATE = "2026-10-24";

function stampAt(date: string, hour: number): string {
  return `${date}T${String(hour).padStart(2, "0")}:00:00+09:00`;
}

/** Provider hours stamped `fromStamp`..`toStamp` on DATE (24 = next date's 00:00). */
function forecast(
  provider: MorningProviderForecast["provider"],
  amounts: Record<number, number | null>,
): MorningProviderForecast {
  return {
    provider,
    probability: 50,
    hours: Object.entries(amounts).map(([stamp, amountMm]) => ({
      time: Number(stamp) === 24 ? stampAt("2026-10-25", 0) : stampAt(DATE, Number(stamp)),
      probability: 50,
      amountMm,
    })),
  };
}

function observation(mm: (number | null)[]): HourlyPrecipObservation {
  return {
    stationId: "106",
    date: DATE,
    hours: Array.from({ length: 24 }, (_, i) => (mm[i] === undefined ? { mm: 0, qcFlag: null } : mm[i] === null ? null : { mm: mm[i], qcFlag: null })),
    observedAt: "2026-10-26T07:00:00+09:00",
    source: "kma-asos",
  };
}

function capture(providers: MorningProviderForecast[]): MorningCapture {
  return {
    stationId: "106",
    targetDate: DATE,
    capturedAt: "2026-10-24T07:00:00+09:00",
    windowStartHour: 7,
    providers,
    equalProbability: 50,
  };
}

test("an hour-ending stamp names the hour before it, and the next date's 00:00 is the day's last hour", () => {
  assert.equal(observedHourIndex(stampAt(DATE, 7), DATE, "ending"), 6);
  assert.equal(observedHourIndex(stampAt("2026-10-25", 0), DATE, "ending"), 23);
  assert.equal(observedHourIndex(stampAt(DATE, 0), DATE, "ending"), null);
  assert.equal(observedHourIndex(stampAt(DATE, 7), DATE, "starting"), 7);
  assert.equal(observedHourIndex(stampAt("2026-10-25", 0), DATE, "starting"), null);
});

test("a block amount needs all three of its hours; a gap is unknown, never dry", () => {
  const full = forecast("open-meteo", { 22: 0.5, 23: 1, 24: 1.5 });
  assert.equal(providerBlockAmount(full, DATE, 21, "ending"), 3);
  const gap = forecast("open-meteo", { 22: 0.5, 23: null, 24: 1.5 });
  assert.equal(providerBlockAmount(gap, DATE, 21, "ending"), null);
});

test("blocks keep only those every scored provider and the station fill completely", () => {
  const pair: HourlyGradingPair = {
    capture: capture([
      // Open-Meteo stamps the hour ending: stamps 10–12 cover hours 9–11.
      forecast("open-meteo", { 10: 1, 11: 1, 12: 1, 13: 0, 14: 0, 15: 0 }),
      // Visual Crossing documents nothing; assumed hour-starting here.
      forecast("visual-crossing", { 9: 2, 10: 2, 11: 2, 12: 0, 13: 0 }),
    ]),
    observation: observation([]),
  };
  const blocks = amountBlocks([pair], ["open-meteo", "visual-crossing"], "starting");
  assert.deepEqual(blocks.map((block) => block.start), [9]);
  assert.deepEqual(blocks[0].forecastMm, { "open-meteo": 3, "visual-crossing": 6 });

  const unknownHour = { ...pair, observation: observation(Object.assign([], { 10: null })) };
  assert.deepEqual(amountBlocks([unknownHour], ["open-meteo", "visual-crossing"], "starting"), []);
});

test("the average renormalizes over the providers that carry an amount", () => {
  assert.equal(blendBlockAmount({ "open-meteo": 2, "visual-crossing": 4 }, null), 3);
  assert.equal(blendBlockAmount({ "open-meteo": 2, "visual-crossing": 4 }, { "open-meteo": 0.75, "visual-crossing": 0.25 }), 2.5);
  assert.equal(blendBlockAmount({ "open-meteo": 2 }, { "open-meteo": 0.6, "visual-crossing": 0.4 }), 2);
});

function block(date: string, observedMm: number, om: number, vc: number, stationId = "106"): AmountBlock {
  return { stationId, targetDate: date, start: 9, observedMm, forecastMm: { "open-meteo": om, "visual-crossing": vc } };
}

test("the provider that misses by less gets more weight, held under the cap", () => {
  const blocks = [block(DATE, 2, 2.5, 4), block(DATE, 0, 0, 0)];
  const errors = providerAmountErrors(blocks, ["open-meteo", "visual-crossing"]);
  // The dry block is not wet for anyone and is left out.
  assert.equal(errors["open-meteo"]?.wetBlocks, 1);
  assert.equal(errors["open-meteo"]?.meanAbsErrorMm, 0.5);
  assert.equal(errors["visual-crossing"]?.meanAbsErrorMm, 2);
  const weights = amountWeights(errors, 0.05, 0.6);
  assert.ok(Math.abs((weights["open-meteo"] ?? 0) - 0.6) < 1e-12);
  assert.ok(Math.abs((weights["visual-crossing"] ?? 0) - 0.4) < 1e-12);
});

function dates(count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(2026, 9, 1) + i * 86_400_000).toISOString().slice(0, 10));
}

function stationDays(make: (stationId: string) => AmountBlock): AmountBlock[] {
  return ["90", "106", "143"].map((stationId) => make(stationId));
}

test("the switch rule holds when one provider is better day after day", () => {
  const blocks = dates(60).flatMap((date) =>
    stationDays((stationId) => block(date, 2, 2.2, 3.5, stationId)));
  const verdict = amountSwitchVerdict(blocks, ["open-meteo", "visual-crossing"], 0.05, 0.6);
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.ready, true);
  assert.equal(verdict.outOfSample.datesWon, 30);
});

test("the switch rule refuses too few days, even when the weights help", () => {
  const blocks = dates(5).flatMap((date) =>
    stationDays((stationId) => block(date, 2, 2.2, 3.5, stationId)));
  const verdict = amountSwitchVerdict(blocks, ["open-meteo", "visual-crossing"], 0.05, 0.6);
  assert.equal(verdict.ready, false);
  assert.ok(verdict.reasons.includes("5 of 60 days"));
});

test("the switch rule refuses weights that win on one storm and lose on most days", () => {
  const all = dates(60);
  const blocks = all.flatMap((date, i) => stationDays((stationId) => {
    // Earlier dates teach the weights to favour Open-Meteo.
    if (i < 30) return block(date, 2, 2.2, 3.5, stationId);
    // One later storm where Open-Meteo is far closer…
    if (i === 30) return block(date, 40, 38, 10, stationId);
    // …and every other later day Visual Crossing is closer.
    return block(date, 2, 3, 2.1, stationId);
  }));
  const verdict = amountSwitchVerdict(blocks, ["open-meteo", "visual-crossing"], 0.05, 0.6);
  assert.ok((verdict.outOfSample.weighted.meanAbsErrorMm ?? 1e9) < (verdict.outOfSample.equal.meanAbsErrorMm ?? 0));
  assert.equal(verdict.ready, false);
  assert.ok(verdict.reasons.some((reason) => reason.startsWith("weights win on 1 of 30")));
});
