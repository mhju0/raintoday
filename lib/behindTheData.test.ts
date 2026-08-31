import assert from "node:assert/strict";
import test from "node:test";
import { buildBehindTheDataView, resolveRecordLocation } from "./behindTheData.ts";
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
    leadTime: { minHours: 18, maxHours: 18, medianHours: 18, sampleCount: 40 },
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
  // It does tilt the blend, but not as learned weighting — so the page must be
  // able to say "something is tilting this" and "learning is off" at once.
  assert.equal(view.status.influenceSource, "seed");
  assert.equal(view.status.learningApplied, false, "the seed is not learned weighting");
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
  // The weights have to agree with the rows: they come from one computation, and
  // a fixture where they disagree tests a state the profile cannot be in.
  const view = buildBehindTheDataView(evidence({
    profile: profile({
      providers: [providerRow("open-meteo"), providerRow("met-norway")],
      effectiveWeights: { "open-meteo": 0.6, "met-norway": 0.4 },
    }),
  }));
  assert.deepEqual(view.providers.map((row) => row.provider), ["open-meteo"]);
});

test("the benchmark offers the single-source comparison that could go against it", () => {
  const view = buildBehindTheDataView(evidence());
  assert.deepEqual(
    view.benchmarkRows.map((row) => row.label),
    ["성능 반영 평균", "단순 평균", "Open-Meteo 단독", "기상청 단독"],
  );
  assert.equal(view.benchmarkRows[0].verdict, "이김");
  assert.equal(view.benchmarkRows[1].verdict, "기준선");
});

test("the benchmark never claims a verdict it has not reached", () => {
  // The table is the benchmark's own judgement. With too few comparable captures
  // it has not ruled, and a row reading "in use" would invent one.
  const undecided = buildBehindTheDataView(evidence({
    profile: profile({
      mode: "seed",
      prospectiveBenchmark: {
        sampleCount: 7,
        adaptiveBrier: 0.223,
        equalBrier: 0.223,
        openMeteoBrier: 0.204,
        kmaBrier: 0.33,
        status: "insufficient",
      },
    }),
  }));
  assert.equal(undecided.benchmarkRows[0].verdict, "판정 전");

  const lost = buildBehindTheDataView(evidence({
    profile: profile({
      mode: "suspended",
      reason: "benchmark-regression",
      prospectiveBenchmark: {
        sampleCount: 40,
        adaptiveBrier: 0.19,
        equalBrier: 0.14,
        openMeteoBrier: null,
        kmaBrier: null,
        status: "regression",
      },
    }),
  }));
  assert.equal(lost.benchmarkRows[0].verdict, "짐");
  assert.equal(lost.status.learningApplied, false);
});

test("only learned modes report learned influence", () => {
  const sources = (["learned", "ramping", "seed", "suspended", "equal-fallback"] as const)
    .map((mode) => buildBehindTheDataView(evidence({ profile: profile({ mode }) })).status.influenceSource);
  assert.deepEqual(sources, ["learned", "learned", "seed", "none", "none"]);
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

test("the view carries the measured lead time, so the cohort claim stays checkable", () => {
  const measured = { minHours: 4, maxHours: 19, medianHours: 17, sampleCount: 12 };
  const view = buildBehindTheDataView(evidence({ profile: profile({ leadTime: measured }) }));
  assert.deepEqual(view.leadTime, measured);

  const none = buildBehindTheDataView({
    status: "unavailable",
    reason: "database-unavailable",
    station: null,
    profile: null,
  });
  assert.equal(none.leadTime, null, "no evidence must not become a lead time of zero");
});

test("the record follows a coordinate handed to it, and survives a bad one", () => {
  const seoul = resolveRecordLocation({});
  assert.equal(seoul.requested, false, "no coordinate is not a request");

  const busan = resolveRecordLocation({ lat: "35.1796", lon: "129.0756", name: "부산 중구" });
  assert.equal(busan.requested, true);
  assert.equal(Math.round(busan.location.latitude * 100), 3518);
  assert.equal(busan.location.name, "부산 중구");

  for (const bad of [
    { lat: "not-a-number", lon: "129" },
    { lat: "35.1", lon: "" },
    { lat: "0", lon: "0" },
    { lat: "48.85", lon: "2.35" },
    { lat: "35.1796" },
  ]) {
    const fallback = resolveRecordLocation(bad);
    assert.equal(fallback.requested, false, `${JSON.stringify(bad)} must not be honoured`);
    assert.equal(fallback.location.name, seoul.location.name);
  }
});

test("a repeated parameter takes the first value rather than crashing", () => {
  const view = resolveRecordLocation({ lat: ["35.1796", "0"], lon: ["129.0756", "0"] });
  assert.equal(view.requested, true);
});

test("a hostile name is bounded rather than rendered whole", () => {
  const long = resolveRecordLocation({ lat: "35.1796", lon: "129.0756", name: "가".repeat(500) });
  assert.ok(long.location.name.length <= 60);
});

/**
 * A newly added provider is in this state for its whole first month: weighted
 * neutrally because it has not been measured (#122), and scored not at all.
 * Omitting its row left the influence column summing to 80% with nothing on the
 * page to say where the rest went — on the one page whose claim is that a
 * sceptical reader can check it.
 */
test("a provider that holds influence but has no comparison still gets a row", () => {
  const view = buildBehindTheDataView(
    evidence({
      profile: profile({
        providers: [providerRow("open-meteo"), providerRow("kma")],
        effectiveWeights: { "open-meteo": 0.4, kma: 0.4, "visual-crossing": 0.2 },
      }),
    }),
  );

  const unscored = view.providers.find((row) => row.provider === "visual-crossing");
  assert.ok(unscored, "a weighted provider is on the page");
  assert.equal(unscored.influence, 0.2);
  assert.equal(unscored.sampleCount, 0);
  assert.equal(unscored.eligible, false);
  assert.equal(unscored.ineligibleReason, "too-few-samples");
  // Zero is a perfect Brier score. A provider with no score at all must not
  // borrow one, in either direction.
  assert.equal(unscored.brierScore, null);
  assert.equal(unscored.last7DaysBrier, null);

  const total = view.providers.reduce((sum, row) => sum + (row.influence ?? 0), 0);
  assert.ok(
    Math.abs(total - 1) < 1e-9,
    `the influence column accounts for the whole blend, got ${total}`,
  );
});

test("a weightless provider is not conjured into the table", () => {
  // The mirror of the case above: no influence and no comparisons means the
  // provider is not part of this station's blend at all, and inventing an empty
  // row for it would claim otherwise.
  const view = buildBehindTheDataView(
    evidence({
      profile: profile({
        providers: [providerRow("open-meteo"), providerRow("kma")],
        effectiveWeights: { "open-meteo": 0.55, kma: 0.45 },
      }),
    }),
  );
  assert.equal(view.providers.length, 2);
});
