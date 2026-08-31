import assert from "node:assert/strict";
import test from "node:test";
import {
  blendPrecipProbability,
  buildRecentPerformanceProfile,
  DEFAULT_PERFORMANCE_POLICY,
} from "./performance.ts";
import type {
  CaptureCohort,
  ForecastCapture,
  PrecipObservation,
  PrecipProviderId,
  SeedComparison,
} from "./types.ts";

const DAY_MS = 86_400_000;
const AS_OF = new Date("2026-08-01T12:00:00+09:00");

function dateDaysAgo(daysAgo: number): string {
  return new Date(AS_OF.getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

interface SeriesOptions {
  days: number;
  cohort?: CaptureCohort;
  /** Days with no completed comparison — a cohort run that failed that day. */
  skip?(daysAgo: number): boolean;
  probability(provider: PrecipProviderId, daysAgo: number, wet: boolean): number | null;
  amount?(provider: PrecipProviderId, daysAgo: number, wet: boolean): number | null;
  frozen?(daysAgo: number, wet: boolean): { adaptive: number | null; equal: number | null };
}

function series(options: SeriesOptions): {
  captures: ForecastCapture[];
  observations: PrecipObservation[];
} {
  const providers: PrecipProviderId[] = ["open-meteo", "kma"];
  const captures: ForecastCapture[] = [];
  const observations: PrecipObservation[] = [];
  for (let daysAgo = options.days; daysAgo >= 1; daysAgo--) {
    if (options.skip?.(daysAgo)) continue;
    const targetDate = dateDaysAgo(daysAgo);
    const wet = daysAgo % 2 === 0;
    const frozen = options.frozen?.(daysAgo, wet) ?? { adaptive: 50, equal: 50 };
    captures.push({
      stationId: "108",
      targetDate,
      cohort: options.cohort ?? "06",
      // A capture is made the day before the day it forecasts, at the cohort's
      // scheduled hour: 06:10 KST is 18 hours ahead of the target day's start.
      capturedAt: `${dateDaysAgo(daysAgo + 1)}T06:00:00+09:00`,
      providers: providers.map((provider) => ({
        provider,
        probability: options.probability(provider, daysAgo, wet),
        amountMm: options.amount?.(provider, daysAgo, wet) ?? null,
      })),
      frozenBlend: {
        adaptiveProbability: frozen.adaptive,
        equalProbability: frozen.equal,
        influence: { "open-meteo": 0.5, kma: 0.5 },
      },
    });
    observations.push({
      stationId: "108",
      date: targetDate,
      observedMm: wet ? 10 : 0,
      observedAt: `${targetDate}T23:59:00+09:00`,
      source: "kma-asos",
    });
  }
  return { captures, observations };
}

test("probability performance includes completed dry days", () => {
  const data = series({
    days: 30,
    probability: () => 100,
  });

  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...data,
    asOf: AS_OF,
  });

  const provider = profile.providers.find((entry) => entry.provider === "open-meteo");
  assert.equal(provider?.sampleCount, 30);
  assert.equal(provider?.dryDays, 15);
  assert.equal(provider?.falseAlarms, 15);
  assert.ok((provider?.brierScore ?? 0) > 0);
});

test("operating performance uses a 60-day window with a 14-day recency half-life", () => {
  const data = series({
    days: 90,
    probability: (provider, daysAgo, wet) => {
      const recent = daysAgo <= 15;
      const openMeteoCorrect = recent;
      const correct = provider === "open-meteo" ? openMeteoCorrect : !openMeteoCorrect;
      if (correct) return wet ? 90 : 10;
      return wet ? 10 : 90;
    },
  });

  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...data,
    asOf: AS_OF,
  });

  const openMeteo = profile.providers.find((entry) => entry.provider === "open-meteo");
  const kma = profile.providers.find((entry) => entry.provider === "kma");
  assert.ok(openMeteo && kma);
  assert.ok(openMeteo.brierScore < kma.brierScore);
  assert.equal(openMeteo.windowSampleCount, 60, "the window still bounds a longer history");
  assert.equal(openMeteo.last7Days.sampleCount, 7);
});

test("fewer than 30 comparable captures cannot influence the forecast", () => {
  const data = series({
    days: 29,
    probability: (_provider, _daysAgo, wet) => (wet ? 80 : 20),
  });

  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...data,
    asOf: AS_OF,
  });

  assert.equal(profile.mode, "equal-fallback");
  assert.equal(profile.reason, "insufficient-evidence");
  assert.deepEqual(profile.effectiveWeights, { "open-meteo": 0.5, kma: 0.5 });
});

test("eligible recent performance tilts softly and remains bounded", () => {
  const data = series({
    days: 60,
    probability: (provider, _daysAgo, wet) =>
      provider === "open-meteo" ? (wet ? 90 : 10) : wet ? 30 : 70,
    frozen: (_daysAgo, wet) => ({ adaptive: wet ? 80 : 20, equal: 50 }),
  });

  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...data,
    asOf: AS_OF,
  });

  assert.equal(profile.mode, "learned");
  assert.ok(profile.effectiveWeights["open-meteo"] > profile.effectiveWeights.kma);
  assert.ok(profile.effectiveWeights["open-meteo"] <= 0.6);
  assert.ok(profile.effectiveWeights.kma >= 0.05);
  assert.ok(Math.abs(Object.values(profile.effectiveWeights).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

/**
 * #122. `series` compares two providers; this needs three, because the claim is
 * about how an unmeasured provider ranks against measured ones.
 */
function threeProviderSeries(days: number): {
  captures: ForecastCapture[];
  observations: PrecipObservation[];
} {
  const captures: ForecastCapture[] = [];
  const observations: PrecipObservation[] = [];
  for (let daysAgo = days; daysAgo >= 1; daysAgo--) {
    const targetDate = dateDaysAgo(daysAgo);
    const wet = daysAgo % 2 === 0;
    const called = (well: boolean) => (well ? (wet ? 90 : 10) : (wet ? 55 : 45));
    captures.push({
      stationId: "108",
      targetDate,
      cohort: "06",
      capturedAt: `${dateDaysAgo(daysAgo + 1)}T06:00:00+09:00`,
      providers: [
        { provider: "open-meteo", probability: called(true), amountMm: null },
        { provider: "pirate-weather", probability: called(false), amountMm: null },
        // Forecasts as well as the best of them, but publishes on a fifth of the
        // days — the shape of a provider whose reads keep faulting.
        {
          provider: "kma",
          probability: daysAgo % 5 === 0 ? called(true) : null,
          amountMm: null,
        },
      ],
      frozenBlend: { adaptiveProbability: 50, equalProbability: 50, influence: {} },
    });
    observations.push({
      stationId: "108",
      date: targetDate,
      observedMm: wet ? 10 : 0,
      observedAt: `${targetDate}T23:59:00+09:00`,
      source: "kma-asos",
    });
  }
  return { captures, observations };
}

/**
 * A provider short of samples has not been measured, so it may not be demoted.
 * It used to be handed `weightFloor` — the weight for a provider that WAS
 * measured and scored badly — which would have shown KMA at 5% influence for
 * accumulating captures slowly, and called that measured performance.
 */
test("a provider short of samples keeps a neutral share, not the floor", () => {
  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...threeProviderSeries(60),
    asOf: AS_OF,
  });

  assert.equal(profile.mode, "learned");
  assert.equal(profile.rampProgress, 1, "the eligible providers are fully ramped");

  const kma = profile.providers.find((entry) => entry.provider === "kma");
  const best = profile.providers.find((entry) => entry.provider === "open-meteo");
  const worst = profile.providers.find((entry) => entry.provider === "pirate-weather");
  assert.equal(kma?.eligible, false, "short of samples");
  assert.equal(best?.eligible, true);
  assert.equal(worst?.eligible, true);

  const unmeasured = profile.effectiveWeights.kma;
  assert.ok(
    Math.abs(unmeasured - 1 / 3) < 1e-6,
    `an unmeasured provider holds the equal share, got ${unmeasured}`,
  );
  assert.ok(
    unmeasured > DEFAULT_PERFORMANCE_POLICY.weightFloor,
    "never the floor, which is reserved for a provider that was measured and scored badly",
  );
  assert.ok(
    unmeasured > profile.effectiveWeights["pirate-weather"],
    "not measured outranks measured-and-worse",
  );
  assert.ok(
    unmeasured < profile.effectiveWeights["open-meteo"],
    "and does not outrank measured-and-better either",
  );
});

test("a prospectively worse adaptive blend suspends learned influence", () => {
  const data = series({
    days: 60,
    probability: (provider, _daysAgo, wet) =>
      provider === "open-meteo" ? (wet ? 90 : 10) : wet ? 30 : 70,
    frozen: (_daysAgo, wet) => ({ adaptive: wet ? 10 : 90, equal: 50 }),
  });

  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...data,
    asOf: AS_OF,
  });

  assert.equal(profile.mode, "suspended");
  assert.equal(profile.reason, "benchmark-regression");
  assert.ok(
    profile.prospectiveBenchmark.adaptiveBrier! > profile.prospectiveBenchmark.equalBrier!,
  );
  assert.deepEqual(profile.effectiveWeights, { "open-meteo": 0.5, kma: 0.5 });
});

test("benchmark compares adaptive and equal blends on identical captures", () => {
  const data = series({
    days: 32,
    probability: (_provider, _daysAgo, wet) => (wet ? 80 : 20),
    frozen: (daysAgo) => {
      if (daysAgo === 1) return { adaptive: 100, equal: null };
      if (daysAgo === 2) return { adaptive: null, equal: 100 };
      return { adaptive: 50, equal: 50 };
    },
  });

  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...data,
    asOf: AS_OF,
    policy: { ...DEFAULT_PERFORMANCE_POLICY, minimumSamples: 28 },
  });

  assert.equal(
    profile.prospectiveBenchmark.sampleCount,
    30,
    "the two captures missing one side of the blend are excluded, the other 30 are not",
  );
  assert.equal(profile.prospectiveBenchmark.adaptiveBrier, 0.25);
  assert.equal(profile.prospectiveBenchmark.equalBrier, 0.25);
  assert.equal(profile.prospectiveBenchmark.status, "passing");
});

test("provider metrics keep amount error separate and never invent missing amounts", () => {
  const data = series({
    days: 60,
    probability: (_provider, _daysAgo, wet) => (wet ? 80 : 20),
    amount: (provider, _daysAgo, wet) =>
      !wet || provider === "kma" ? null : 8,
  });

  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...data,
    asOf: AS_OF,
  });

  const openMeteo = profile.providers.find((entry) => entry.provider === "open-meteo");
  const kma = profile.providers.find((entry) => entry.provider === "kma");
  assert.equal(openMeteo?.rainyAmountSampleCount, 30);
  assert.equal(openMeteo?.rainyAmountMae, 2);
  assert.equal(kma?.rainyAmountSampleCount, 0);
  assert.equal(kma?.rainyAmountMae, null);
});

test("capture cohorts are evaluated independently", () => {
  const morning = series({
    days: 30,
    cohort: "06",
    probability: (_provider, _daysAgo, wet) => (wet ? 80 : 20),
  });
  const evening = series({
    days: 30,
    cohort: "18",
    probability: () => 50,
  });

  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    captures: [...morning.captures, ...evening.captures],
    observations: morning.observations,
    asOf: AS_OF,
  });

  assert.equal(profile.cohort, "06");
  assert.equal(profile.providers[0]?.sampleCount, 30);
});

test("serving-time blend renormalizes over probabilities that are actually present", () => {
  assert.equal(
    blendPrecipProbability(
      [
        { provider: "open-meteo", probability: 80, amountMm: 5 },
        { provider: "kma", probability: null, amountMm: null },
        { provider: "weather-api", probability: 20, amountMm: 1 },
      ],
      { "open-meteo": 0.6, kma: 0.3, "weather-api": 0.1 },
    ),
    71.42857142857143,
  );
  assert.equal(blendPrecipProbability([], {}), null);
});

/** Seed history where open-meteo tracks the observation and kma always says dry. */
function seedHistory(days: number): SeedComparison[] {
  return Array.from({ length: days }, (_, index) => {
    const wet = index % 2 === 0;
    const observedMm = wet ? 10 : 0;
    return {
      stationId: "108",
      targetDate: new Date(Date.parse("2025-06-01T00:00:00.000Z") + index * DAY_MS)
        .toISOString()
        .slice(0, 10),
      providers: [
        { provider: "open-meteo" as PrecipProviderId, amountMm: observedMm },
        { provider: "kma" as PrecipProviderId, amountMm: 0 },
      ],
      observedMm,
      builtAt: "2026-08-18T00:00:00.000Z",
    };
  });
}

test("seed evidence weights a station that has no live evidence yet", () => {
  const data = series({ days: 3, probability: () => 50 });

  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...data,
    asOf: AS_OF,
    seedComparisons: seedHistory(40),
  });

  assert.equal(profile.mode, "seed");
  assert.equal(profile.reason, "seed-evidence");
  assert.ok(
    profile.effectiveWeights["open-meteo"] > profile.effectiveWeights.kma,
    "the archive-accurate provider must lead",
  );
});

test("seed influence stays capped below the raw seed weight", () => {
  const data = series({ days: 3, probability: () => 50 });

  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...data,
    asOf: AS_OF,
    seedComparisons: seedHistory(40),
  });

  assert.ok(
    profile.effectiveWeights["open-meteo"] < DEFAULT_PERFORMANCE_POLICY.weightCap,
    "seed evidence must never reach the full learned cap",
  );
});

test("seed evidence never rescues a benchmark regression", () => {
  const data = series({
    days: 40,
    probability: (provider, daysAgo, wet) => (wet ? 90 : 10),
    // The frozen adaptive blend was prospectively WORSE than equal.
    frozen: (daysAgo, wet) => ({ adaptive: wet ? 10 : 90, equal: wet ? 90 : 10 }),
  });

  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...data,
    asOf: AS_OF,
    seedComparisons: seedHistory(40),
  });

  assert.equal(profile.mode, "suspended");
  assert.equal(profile.reason, "benchmark-regression");
  assert.deepEqual(
    profile.effectiveWeights,
    { "open-meteo": 0.5, kma: 0.5 },
    "a live verdict that the blend is worse must not be overridden by archives",
  );
});

test("mature live evidence supersedes the seed entirely", () => {
  const data = series({
    days: 60,
    probability: (provider, daysAgo, wet) =>
      provider === "open-meteo" ? (wet ? 90 : 10) : (wet ? 10 : 90),
  });

  const withSeed = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...data,
    asOf: AS_OF,
    seedComparisons: seedHistory(60),
  });
  const withoutSeed = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...data,
    asOf: AS_OF,
  });

  assert.equal(withSeed.mode, "learned");
  assert.deepEqual(
    withSeed.effectiveWeights,
    withoutSeed.effectiveWeights,
    "live weights must be unchanged by the presence of seed evidence",
  );
});

test("seed evidence never enters the prospective benchmark", () => {
  const data = series({ days: 3, probability: () => 50 });

  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...data,
    asOf: AS_OF,
    seedComparisons: seedHistory(60),
  });

  assert.equal(
    profile.prospectiveBenchmark.sampleCount,
    3,
    "the benchmark counts frozen captures only",
  );
  assert.equal(profile.prospectiveBenchmark.status, "insufficient");
});

test("no seed evidence leaves the profile exactly as before", () => {
  const data = series({ days: 3, probability: () => 50 });

  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...data,
    asOf: AS_OF,
  });

  assert.equal(profile.mode, "equal-fallback");
  assert.equal(profile.reason, "insufficient-evidence");
  assert.deepEqual(profile.seed, []);
});

test("a station with no live captures at all still gets seed weights", () => {
  // The real cold start: nothing has ever been captured here. Deriving the
  // provider set from captures alone left this case on equal weights forever.
  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    captures: [],
    observations: [],
    asOf: AS_OF,
    seedComparisons: seedHistory(40),
  });

  assert.equal(profile.mode, "seed");
  assert.equal(profile.reason, "seed-evidence");
  assert.ok(
    profile.effectiveWeights["open-meteo"] > profile.effectiveWeights.kma,
    "the seed must actually rank providers with no live history present",
  );
  assert.ok(
    Math.abs(Object.values(profile.effectiveWeights).reduce((a, b) => a + b, 0) - 1) < 1e-9,
    "weights sum to 1",
  );
});

test("a provider with no archive proxy keeps a neutral share in seed mode", () => {
  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    captures: [],
    observations: [],
    asOf: AS_OF,
    seedComparisons: seedHistory(40),
  });

  // weather-api is deliberately unseeded. It must still be weighted, or it would
  // be silently dropped from the serving blend for lacking an archive.
  const unseeded = profile.effectiveWeights["weather-api"];
  assert.ok(unseeded !== undefined && unseeded > 0, "an unseeded provider must still be blended");
  assert.ok(
    unseeded > profile.effectiveWeights.kma,
    "no opinion must outrank a measured poor record",
  );
});

test("seed rows for a provider no longer compared are not scored or shown", () => {
  // The seed table outlives a provider. MET Norway was seeded from ecmwf_ifs025
  // before it was dropped from the comparison for publishing no probability in
  // Korea, and those rows are still in the tables. Scoring them would put a
  // service's measured performance on the page beside a blend it is not part of —
  // the same claim-versus-reality gap that got it dropped.
  const stale = seedHistory(40).map((comparison) => ({
    ...comparison,
    providers: [
      ...comparison.providers,
      { provider: "met-norway" as PrecipProviderId, amountMm: comparison.observedMm },
    ],
  }));
  const data = series({ days: 3, probability: () => 50 });
  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "18",
    captures: data.captures,
    observations: data.observations,
    asOf: new Date("2025-07-12T00:00:00.000Z"),
    seedComparisons: stale,
  });

  assert.equal(profile.mode, "seed");
  assert.equal(
    profile.seed?.some((provider) => provider.provider === "met-norway"),
    false,
    "a provider the forecast never reads must not carry seed evidence",
  );
  assert.equal(
    Object.hasOwn(profile.effectiveWeights, "met-norway"),
    false,
    "and must not hold a share of the blend",
  );
});

/**
 * The benchmark counts comparisons inside the window, and a cohort can complete at
 * most one a day. Pairing a 30-day window with a 30-sample bar therefore demanded a
 * flawless month: a single missed run — a KMA outage, a runner that could not reach
 * Korea, a day ASOS never published — put `learned` out of reach for another month.
 * The window is 60 days because the 14-day half-life is what enforces recency: a
 * 60-day-old comparison already carries about 5% of a fresh one's weight.
 */
test("a month with missed runs still reaches the benchmark", () => {
  const data = series({
    days: 45,
    skip: (daysAgo) => daysAgo % 4 === 0,
    probability: (provider, _daysAgo, wet) =>
      provider === "open-meteo" ? (wet ? 90 : 10) : wet ? 30 : 70,
    frozen: (_daysAgo, wet) => ({ adaptive: wet ? 80 : 20, equal: 50 }),
  });
  assert.equal(data.captures.length, 34, "the fixture must be gappy, not merely short");

  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...data,
    asOf: AS_OF,
  });

  assert.ok(
    profile.prospectiveBenchmark.sampleCount >= DEFAULT_PERFORMANCE_POLICY.minimumSamples,
    "a quarter of the runs missing must not starve the benchmark",
  );
  assert.notEqual(profile.mode, "suspended");
  assert.equal(profile.reason, "ramping");
});

test("the profile measures how far ahead its captures were actually made", () => {
  // The cohort names a scheduled slot; the scheduler is best-effort, and stored
  // captures have run anywhere from 06 to 14 KST under the 06 label. Measuring
  // the spread is what stops that from being invisible.
  const data = series({
    days: 4,
    probability: (_provider, _daysAgo, wet) => (wet ? 80 : 20),
  });
  // The fixture captures at 06:00 KST for a target that starts at 00:00 KST the
  // next day, so every row is 18 hours ahead.
  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...data,
    asOf: AS_OF,
  });
  assert.deepEqual(profile.leadTime, {
    minHours: 18,
    maxHours: 18,
    medianHours: 18,
    sampleCount: 4,
  });
});

test("a drifted run widens the measured lead time rather than hiding in the label", () => {
  const data = series({
    days: 3,
    probability: (_provider, _daysAgo, wet) => (wet ? 80 : 20),
  });
  // One run started after midnight: still labelled 18, but further ahead of its
  // target day than any on-time 06 capture.
  data.captures[0] = {
    ...data.captures[0],
    // Started after midnight, so it is 4 hours INTO the day it forecasts.
    capturedAt: `${data.captures[0].targetDate}T04:00:00+09:00`,
  };
  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...data,
    asOf: AS_OF,
  });
  assert.ok(profile.leadTime);
  assert.equal(profile.leadTime.minHours, -4, "a capture taken inside its target day is behind it");
  assert.equal(profile.leadTime.maxHours, 18, "the on-time rows are still 18 hours ahead");
  assert.equal(profile.leadTime.sampleCount, 3);
});

test("a profile with nothing scored reports no lead time rather than zero", () => {
  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    captures: [],
    observations: [],
    asOf: AS_OF,
  });
  assert.equal(profile.leadTime, null);
});

test("lead time is reported in whole hours, not scheduling noise", () => {
  const data = series({
    days: 2,
    probability: (_provider, _daysAgo, wet) => (wet ? 80 : 20),
  });
  data.captures[0] = {
    ...data.captures[0],
    capturedAt: `${data.captures[0].capturedAt.slice(0, 11)}06:29:00+09:00`,
  };
  const profile = buildRecentPerformanceProfile({
    stationId: "108",
    cohort: "06",
    ...data,
    asOf: AS_OF,
  });
  assert.ok(profile.leadTime);
  for (const value of [profile.leadTime.minHours, profile.leadTime.maxHours, profile.leadTime.medianHours]) {
    assert.equal(value, Math.trunc(value), "an hour figure must not carry minutes of false precision");
  }
});
