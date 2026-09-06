import assert from "node:assert/strict";
import test from "node:test";
import { blendPrecipitation } from "./influence.ts";
import type {
  CapturedProviderForecast,
  PrecipProviderId,
  RecentPerformanceProfile,
} from "./types.ts";

function forecast(
  provider: PrecipProviderId,
  probability: number | null,
  amountMm: number | null = null,
): CapturedProviderForecast {
  return { provider, probability, amountMm };
}

function profile(
  mode: RecentPerformanceProfile["mode"],
  effectiveWeights: Record<string, number>,
): RecentPerformanceProfile {
  return {
    stationId: "108",
    cohort: "06",
    generatedAt: "2026-03-02T00:00:00.000Z",
    windowStart: "2026-02-01",
    windowEnd: "2026-03-01",
    mode,
    reason: mode === "learned" ? "learned" : "insufficient-evidence",
    rampProgress: 1,
    providers: [],
    effectiveWeights,
    prospectiveBenchmark: {
      sampleCount: 0,
      adaptiveBrier: null,
      equalBrier: null,
      openMeteoBrier: null,
      kmaBrier: null,
      status: "insufficient",
    },
    seed: [],
    leadTime: null,
  };
}

test("Effective Influence is normalized over the providers actually present", () => {
  const blend = blendPrecipitation(
    [forecast("open-meteo", 60), forecast("kma", 20)],
    profile("learned", { "open-meteo": 0.5, kma: 0.25, "pirate-weather": 0.25 }),
  );

  const total = Object.values(blend.influence).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 1e-12, "influence must sum to one");
  assert.deepEqual(Object.keys(blend.influence).sort(), ["kma", "open-meteo"]);
  // The absent provider's weight is not silently handed to anyone.
  assert.ok(Math.abs(blend.influence["open-meteo"] - 2 / 3) < 1e-12);
});

test("the blended probability is exactly the influence-weighted sum", () => {
  const forecasts = [forecast("open-meteo", 80), forecast("kma", 20)];
  const blend = blendPrecipitation(forecasts, profile("learned", { "open-meteo": 0.75, kma: 0.25 }));

  const expected = forecasts.reduce(
    (sum, entry) => sum + entry.probability! * blend.influence[entry.provider],
    0,
  );
  assert.ok(Math.abs(blend.probability! - expected) < 1e-12);
  assert.ok(Math.abs(blend.probability! - 65) < 1e-12);
});

test("a profile that is not learning falls back to equal influence", () => {
  const forecasts = [forecast("open-meteo", 90), forecast("kma", 30)];
  const learnedShape = { "open-meteo": 0.9, kma: 0.1 };

  for (const mode of ["equal-fallback", "suspended"] as const) {
    const blend = blendPrecipitation(forecasts, profile(mode, learnedShape));
    assert.deepEqual(blend.influence, { "open-meteo": 0.5, kma: 0.5 }, mode);
    assert.equal(blend.probability, 60, mode);
  }
});

test("a null profile blends equally, which is the prospective equal benchmark", () => {
  const forecasts = [forecast("open-meteo", 90), forecast("kma", 30), forecast("weather-api", 60)];
  const blend = blendPrecipitation(forecasts, null);

  const mean = forecasts.reduce((sum, entry) => sum + entry.probability!, 0) / forecasts.length;
  assert.ok(Math.abs(blend.probability! - mean) < 1e-12);
});

for (const mode of ["learned", "ramping", "seed"] as const) {
  test(`${mode}: zero-history providers keep an equal share during provider outages`, () => {
    const weights = { "open-meteo": 0.6, kma: 0.3, "pirate-weather": 0.1 };
    for (const includeKma of [true, false]) {
      const forecasts = [
        forecast("open-meteo", 80, 10),
        ...(includeKma ? [forecast("kma", 20, 2)] : []),
        forecast("weather-api", 50, 4),
        forecast("visual-crossing", 40, null),
      ];
      const blend = blendPrecipitation(forecasts, profile(mode, weights));
      const neutral = 1 / forecasts.length;
      assert.ok(Math.abs(blend.influence["weather-api"] - neutral) < 1e-12);
      assert.ok(Math.abs(blend.influence["visual-crossing"] - neutral) < 1e-12);
      assert.ok(Math.abs(Object.values(blend.influence).reduce((a, b) => a + b, 0) - 1) < 1e-12);
      assert.equal(blend.influence["pirate-weather"], undefined);
      if (includeKma) {
        assert.ok(Math.abs(blend.influence["open-meteo"] / blend.influence.kma - 2) < 1e-12);
        assert.ok(blend.influence["open-meteo"] > neutral);
        assert.ok(blend.influence.kma < neutral);
      }
      const expectedProbability = forecasts.reduce(
        (sum, entry) => sum + entry.probability! * blend.influence[entry.provider], 0,
      );
      assert.ok(Math.abs(blend.probability! - expectedProbability) < 1e-12);
      const expectedAmount = forecasts.reduce(
        (sum, entry) => sum + (entry.amountMm ?? 0) * blend.influence[entry.provider], 0,
      ) / (1 - neutral);
      assert.ok(Math.abs(blend.amountMm! - expectedAmount) < 1e-12);
      assert.equal(blend.amountProviderCount, forecasts.length - 1);
    }
  });
}

test("no usable historical weights falls back to equal shares", () => {
  const profiles: Record<string, number>[] = [{}, { "open-meteo": 0 }, { "open-meteo": -1 }];
  for (const weights of profiles) {
    const blend = blendPrecipitation(
      [forecast("open-meteo", 80), forecast("weather-api", 20)],
      profile("learned", weights),
    );
    assert.deepEqual(blend.influence, { "open-meteo": 0.5, "weather-api": 0.5 });
    assert.equal(blend.probability, 50);
  }
  assert.deepEqual(blendPrecipitation([], profile("learned", {})).influence, {});
});

test("amount is blended only across providers that report one", () => {
  const blend = blendPrecipitation(
    [forecast("open-meteo", 60, 10), forecast("kma", 60, null)],
    null,
  );

  assert.equal(blend.amountMm, 10);
});

test("blending nothing yields no probability rather than a fabricated zero", () => {
  const blend = blendPrecipitation([], null);

  assert.equal(blend.probability, null);
  assert.equal(blend.amountMm, null);
  assert.deepEqual(blend.influence, {});
});

test("seed weights actually reach the blend, not just the evidence table", () => {
  // The seed table and the influence bars are shown on the same screen. If the
  // blend silently fell back to equal, the page would display a measured record
  // beside weights that ignore it.
  const seeded = profile("seed", { "open-meteo": 0.25, kma: 0.15, "weather-api": 0.2 });
  const blend = blendPrecipitation(
    [
      { provider: "open-meteo", probability: 80, amountMm: 5 },
      { provider: "kma", probability: 20, amountMm: 1 },
      { provider: "weather-api", probability: 50, amountMm: 2 },
    ],
    seeded,
  );

  assert.ok(
    blend.influence["open-meteo"] > blend.influence.kma,
    "the better-scoring provider must carry more influence",
  );
  assert.ok(
    Math.abs(blend.influence["open-meteo"] - 1 / 3) > 1e-9,
    "influence must not collapse to an equal share",
  );
  assert.ok(
    Math.abs(Object.values(blend.influence).reduce((a, b) => a + b, 0) - 1) < 1e-9,
    "influence sums to 1",
  );
});

test("a suspended benchmark still blends equally", () => {
  const suspended = profile("suspended", { "open-meteo": 0.6, kma: 0.4 });
  const blend = blendPrecipitation(
    [
      { provider: "open-meteo", probability: 80, amountMm: 5 },
      { provider: "kma", probability: 20, amountMm: 1 },
    ],
    suspended,
  );

  assert.deepEqual(blend.influence, { "open-meteo": 0.5, kma: 0.5 });
});
