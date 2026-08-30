import assert from "node:assert/strict";
import test from "node:test";
import { buildBehindTheDataView } from "./behindTheData.ts";
import type { LocalForecastEvidence } from "./localForecast.ts";
import type { PrecipProviderId, RecentPerformanceProfile } from "./performance/types.ts";

function providerRow(
  provider: PrecipProviderId,
  overrides: Partial<RecentPerformanceProfile["providers"][number]> = {},
): RecentPerformanceProfile["providers"][number] {
  return {
    provider,
    sampleCount: 40,
    windowSampleCount: 40,
    wetDays: 12,
    dryDays: 28,
    misses: 2,
    falseAlarms: 3,
    brierScore: 0.14,
    rainyAmountSampleCount: 10,
    rainyAmountMae: 1.2,
    last7Days: { sampleCount: 7, brierScore: 0.12 },
    eligible: true,
    ...overrides,
  };
}

function profile(overrides: Partial<RecentPerformanceProfile> = {}): RecentPerformanceProfile {
  return {
    stationId: "108",
    cohort: "06",
    generatedAt: "2026-08-31T00:00:00.000Z",
    windowStart: "2026-07-02",
    windowEnd: "2026-08-31",
    mode: "learned",
    reason: "learned",
    rampProgress: 1,
    providers: [providerRow("open-meteo"), providerRow("kma")],
    effectiveWeights: { "open-meteo": 0.55, kma: 0.45 },
    prospectiveBenchmark: {
      sampleCount: 40,
      adaptiveBrier: 0.138,
      equalBrier: 0.144,
      openMeteoBrier: 0.142,
      kmaBrier: 0.151,
      status: "passing",
    },
    seed: [],
    ...overrides,
  };
}

function evidence(overrides: Partial<LocalForecastEvidence> = {}): LocalForecastEvidence {
  return {
    status: "active",
    reason: "eligible-station",
    station: { id: "108", name: "서울", distanceKm: 1.8 },
    profile: profile(),
    ...overrides,
  };
}

test("every mode the profile can hold gets its own sentence", () => {
  // A mode with no branch would inherit the previous one's wording, which is how
  // a page meant to prove honesty starts describing a state it is not in.
  const modes: RecentPerformanceProfile["mode"][] = [
    "learned",
    "ramping",
    "seed",
    "suspended",
    "equal-fallback",
  ];
  const seen = new Set<string>();
  for (const mode of modes) {
    const view = buildBehindTheDataView(evidence({ profile: profile({ mode }) }));
    assert.equal(view.status.mode, mode, `${mode} must report itself`);
    assert.ok(view.status.label.length > 0, `${mode} has no label`);
    assert.ok(view.status.detail.length > 0, `${mode} has no sentence`);
    assert.ok(!seen.has(view.status.detail), `${mode} reuses another mode's sentence`);
    seen.add(view.status.detail);
  }
});

test("the seed is never described as learned skill", () => {
  const view = buildBehindTheDataView(evidence({ profile: profile({ mode: "seed" }) }));
  assert.ok(view.status.learningApplied, "the seed does affect the served blend");
  assert.ok(!view.status.label.includes("학습 가중치"), "the seed is not measured live skill");
  assert.ok(
    view.status.detail.includes("과거") && view.status.detail.includes("절반"),
    "the seed's sentence must say it is retrospective and capped",
  );
});

test("a suspended blend says plainly that learning is not being applied", () => {
  const regression = buildBehindTheDataView(evidence({
    profile: profile({ mode: "suspended", reason: "benchmark-regression" }),
  }));
  assert.equal(regression.status.learningApplied, false);
  assert.ok(regression.status.detail.includes("나빴습니다"));

  const insufficient = buildBehindTheDataView(evidence({
    profile: profile({ mode: "suspended", reason: "benchmark-insufficient" }),
  }));
  assert.equal(insufficient.status.learningApplied, false);
  assert.notEqual(insufficient.status.detail, regression.status.detail);
});

test("an unreadable store says so rather than rendering an empty table", () => {
  const view = buildBehindTheDataView({
    status: "unavailable",
    reason: "database-unavailable",
    station: null,
    profile: null,
  });
  assert.equal(view.status.mode, "unavailable");
  assert.equal(view.status.learningApplied, false);
  assert.equal(view.status.benchmark, null);
  assert.deepEqual(view.providers, []);
  assert.deepEqual(view.benchmarkRows, []);
  assert.ok(view.status.detail.includes("예보는 그대로 동작"));
});

test("a station-less location is distinguished from an unreachable store", () => {
  const noStation = buildBehindTheDataView({
    status: "unavailable",
    reason: "no-eligible-station",
    station: null,
    profile: null,
  });
  assert.ok(noStation.status.detail.includes("관측소"));
});

test("an ineligible provider is labelled short of samples, never as bad", () => {
  const view = buildBehindTheDataView(evidence({
    profile: profile({
      providers: [
        providerRow("open-meteo"),
        providerRow("kma", { eligible: false, sampleCount: 12 }),
        providerRow("pirate-weather", { eligible: false, wetDays: 0 }),
        providerRow("weather-api", { eligible: false, dryDays: 0 }),
      ],
    }),
  }));
  const byId = Object.fromEntries(view.providers.map((row) => [row.provider, row]));
  assert.equal(byId["open-meteo"].ineligibleReason, null);
  assert.equal(byId.kma.ineligibleReason, "too-few-samples");
  assert.equal(byId["pirate-weather"].ineligibleReason, "no-wet-day");
  assert.equal(byId["weather-api"].ineligibleReason, "no-dry-day");
});

test("a provider that is no longer compared never reaches the table", () => {
  // Stored rows outlive a provider; MET Norway's id survives so old captures stay
  // readable, and it must not appear beside a forecast it had no part in.
  const view = buildBehindTheDataView(evidence({
    profile: profile({ providers: [providerRow("open-meteo"), providerRow("met-norway")] }),
  }));
  assert.deepEqual(view.providers.map((row) => row.provider), ["open-meteo"]);
});

test("the benchmark offers the single-source comparison that could go against it", () => {
  const view = buildBehindTheDataView(evidence());
  assert.deepEqual(
    view.benchmarkRows.map((row) => row.label),
    ["성능 반영 평균", "단순 평균", "Open-Meteo 단독", "기상청 단독"],
  );
  assert.equal(view.benchmarkRows[0].verdict, "사용 중");
  assert.equal(view.benchmarkRows[1].verdict, "기준선");
});

test("an uncomputed benchmark shows no rows rather than dashes", () => {
  const view = buildBehindTheDataView(evidence({
    profile: profile({
      prospectiveBenchmark: {
        sampleCount: 0,
        adaptiveBrier: null,
        equalBrier: null,
        openMeteoBrier: null,
        kmaBrier: null,
        status: "insufficient",
      },
    }),
  }));
  assert.deepEqual(view.benchmarkRows, []);
});

test("a single-source score that was not computed is omitted, not printed as zero", () => {
  const view = buildBehindTheDataView(evidence({
    profile: profile({
      prospectiveBenchmark: {
        sampleCount: 40,
        adaptiveBrier: 0.13,
        equalBrier: 0.14,
        openMeteoBrier: null,
        kmaBrier: 0.15,
        status: "passing",
      },
    }),
  }));
  assert.deepEqual(
    view.benchmarkRows.map((row) => row.label),
    ["성능 반영 평균", "단순 평균", "기상청 단독"],
  );
});

test("the published policy figures come from the policy object, not the prose", () => {
  const view = buildBehindTheDataView(evidence());
  assert.equal(view.policy.windowDays, 60);
  assert.equal(view.policy.minimumSamples, 30);
  assert.equal(view.policy.halfLifeDays, 14);
  assert.equal(view.policy.scoreSharpness, 12);
  assert.equal(view.policy.weightFloorPercent, 5);
  assert.equal(view.policy.weightCapPercent, 60);
});
