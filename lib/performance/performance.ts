import { buildSeedProfile, seedEffectiveWeights } from "./seedScore.ts";
import { PERFORMANCE_PROVIDERS } from "./store.ts";
import type {
  CapturedProviderForecast,
  ForecastCapture,
  LeadTimeSummary,
  ProspectiveBenchmark,
  RecentPerformanceProfile,
  PerformancePolicy,
  PrecipObservation,
  PrecipProviderId,
  ProviderRecentPerformance,
  SeedComparison,
} from "./types.ts";

export const DEFAULT_PERFORMANCE_POLICY: PerformancePolicy = {
  // 60, not 30. A cohort completes at most one comparison a day, so a 30-day window
  // beside a 30-sample bar demanded a flawless month: one missed run — an outage, a
  // runner that could not reach Korea, a day ASOS never published — put the
  // benchmark out of reach for another 30 days, and at the observed run-failure
  // rate it was never reachable at all. Widening costs nothing in recency, because
  // the half-life below is what enforces that: a 60-day-old comparison already
  // carries about 5% of a fresh one's weight. The bar itself is untouched.
  windowDays: 60,
  halfLifeDays: 14,
  reportDays: 7,
  minimumSamples: 30,
  fullInfluenceSamples: 60,
  rainThresholdMm: 0.1,
  decisionThreshold: 50,
  weightFloor: 0.05,
  weightCap: 0.6,
  // Exponential contrast between provider scores. Monotonic, so it can never
  // reorder providers — it only widens a gap that the evidence already shows.
  // Raised from 4: at 4 a real 3x difference in wet-day miss rate compressed to a
  // 1.18x weight spread, which read as "every service is the same". The
  // prospective benchmark still suspends the blend if sharpening makes it worse.
  scoreSharpness: 12,
};

interface CompletedCapture {
  capture: ForecastCapture;
  observation: PrecipObservation;
  ageDays: number;
  recencyWeight: number;
}

interface ProviderScoreRow {
  ageDays: number;
  recencyWeight: number;
  probability: number;
  amountMm: number | null;
  observedMm: number;
  wet: boolean;
}

interface ProfileInput {
  stationId: string;
  cohort: ForecastCapture["cohort"];
  captures: readonly ForecastCapture[];
  observations: readonly PrecipObservation[];
  asOf: Date;
  policy?: PerformancePolicy;
  /** Retrospective evidence for this station, used only before live maturity. */
  seedComparisons?: readonly SeedComparison[];
}

function koreanDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function dateAtUtcMidnight(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function calendarAgeDays(asOfDate: string, targetDate: string): number {
  return Math.round((dateAtUtcMidnight(asOfDate) - dateAtUtcMidnight(targetDate)) / 86_400_000);
}

function subtractCalendarDays(date: string, days: number): string {
  return new Date(dateAtUtcMidnight(date) - days * 86_400_000).toISOString().slice(0, 10);
}

function validProbability(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100;
}

function brier(probability: number, wet: boolean): number {
  return (probability / 100 - (wet ? 1 : 0)) ** 2;
}

function weightedMean(rows: readonly { value: number; weight: number }[]): number | null {
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight <= 0) return null;
  return rows.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight;
}

function round(value: number | null, places = 4): number | null {
  if (value === null) return null;
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function equalWeights(providers: readonly PrecipProviderId[]): Record<string, number> {
  const value = providers.length === 0 ? 0 : 1 / providers.length;
  return Object.fromEntries(providers.map((provider) => [provider, value]));
}

function renormalize(weights: Record<string, number>): Record<string, number> {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return equalWeights(entries.map(([provider]) => provider as PrecipProviderId));
  return Object.fromEntries(entries.map(([provider, value]) => [provider, value / total]));
}

/**
 * Project raw scores onto { sum = 1, floor <= w <= cap } by water-filling.
 * Exported for the cross-pipeline contract test; see ADR 0004.
 */
export function normalizeClamped(
  raw: Record<string, number>,
  floor: number,
  cap: number,
): Record<string, number> {
  const providers = Object.keys(raw);
  if (providers.length <= 1 || floor * providers.length > 1 || cap * providers.length < 1) {
    return equalWeights(providers as PrecipProviderId[]);
  }
  const weights = Object.fromEntries(providers.map((provider) => [provider, floor]));
  const active = new Set(providers);
  let remaining = 1 - floor * providers.length;
  while (active.size > 0 && remaining > 1e-12) {
    const rawTotal = Array.from(active).reduce(
      (sum, provider) => sum + Math.max(0, raw[provider]),
      0,
    );
    const denominator = rawTotal > 0 ? rawTotal : active.size;
    const capped = Array.from(active).filter((provider) => {
      const share = rawTotal > 0 ? Math.max(0, raw[provider]) : 1;
      return remaining * share / denominator > cap - weights[provider];
    });
    if (capped.length === 0) {
      for (const provider of active) {
        const share = rawTotal > 0 ? Math.max(0, raw[provider]) : 1;
        weights[provider] += remaining * share / denominator;
      }
      remaining = 0;
      break;
    }
    for (const provider of capped) {
      remaining -= cap - weights[provider];
      weights[provider] = cap;
      active.delete(provider);
    }
  }
  return weights;
}

function completedCaptures(input: ProfileInput, policy: PerformancePolicy): CompletedCapture[] {
  const asOfDate = koreanDate(input.asOf);
  const observations = new Map(
    input.observations
      .filter((observation) => observation.stationId === input.stationId)
      .map((observation) => [observation.date, observation]),
  );

  return input.captures.flatMap((capture) => {
    if (capture.stationId !== input.stationId || capture.cohort !== input.cohort) return [];
    const observation = observations.get(capture.targetDate);
    if (!observation) return [];
    const ageDays = calendarAgeDays(asOfDate, capture.targetDate);
    if (ageDays < 0) return [];
    return [{
      capture,
      observation,
      ageDays,
      recencyWeight: Math.pow(0.5, ageDays / policy.halfLifeDays),
    }];
  });
}

function providerMetrics(
  provider: PrecipProviderId,
  completed: readonly CompletedCapture[],
  policy: PerformancePolicy,
): ProviderRecentPerformance | null {
  const rows: ProviderScoreRow[] = completed.flatMap((entry) => {
    const forecast = entry.capture.providers.find((candidate) => candidate.provider === provider);
    if (!forecast || !validProbability(forecast.probability)) return [];
    return [{
      ageDays: entry.ageDays,
      recencyWeight: entry.recencyWeight,
      probability: forecast.probability,
      amountMm:
        forecast.amountMm !== null && Number.isFinite(forecast.amountMm) && forecast.amountMm >= 0
          ? forecast.amountMm
          : null,
      observedMm: entry.observation.observedMm,
      wet: entry.observation.observedMm >= policy.rainThresholdMm,
    }];
  });
  if (rows.length === 0) return null;

  const windowRows = rows.filter((row) => row.ageDays <= policy.windowDays);
  if (windowRows.length === 0) return null;
  const wetRows = windowRows.filter((row) => row.wet);
  const dryRows = windowRows.filter((row) => !row.wet);
  const rainyAmountRows = wetRows.filter((row) => row.amountMm !== null);
  const brierScore = weightedMean(
    windowRows.map((row) => ({
      value: brier(row.probability, row.wet),
      weight: row.recencyWeight,
    })),
  )!;
  const last7Rows = rows.filter((row) => row.ageDays <= policy.reportDays);
  const last7Brier = weightedMean(
    last7Rows.map((row) => ({ value: brier(row.probability, row.wet), weight: 1 })),
  );
  const sampleCount = Math.min(rows.length, policy.fullInfluenceSamples);

  return {
    provider,
    sampleCount,
    windowSampleCount: windowRows.length,
    wetDays: wetRows.length,
    dryDays: dryRows.length,
    misses: wetRows.filter((row) => row.probability < policy.decisionThreshold).length,
    falseAlarms: dryRows.filter((row) => row.probability >= policy.decisionThreshold).length,
    brierScore: round(brierScore)!,
    rainyAmountSampleCount: rainyAmountRows.length,
    rainyAmountMae: round(
      rainyAmountRows.length === 0
        ? null
        : rainyAmountRows.reduce(
            (sum, row) => sum + Math.abs(row.amountMm! - row.observedMm),
            0,
          ) / rainyAmountRows.length,
      2,
    ),
    last7Days: {
      sampleCount: last7Rows.length,
      brierScore: round(last7Brier),
    },
    eligible:
      sampleCount >= policy.minimumSamples && wetRows.length > 0 && dryRows.length > 0,
  };
}

/**
 * Hours from a capture to the start of its target day, in Asia/Seoul.
 *
 * Negative when a run started inside the day it was forecasting — which a badly
 * delayed scheduled run can do, and which the cohort label alone would hide.
 */
function leadTimeHours(capture: ForecastCapture): number {
  const targetStart = Date.parse(`${capture.targetDate}T00:00:00+09:00`);
  return (targetStart - Date.parse(capture.capturedAt)) / 3_600_000;
}

function leadTimeSummary(completed: readonly CompletedCapture[]): LeadTimeSummary | null {
  if (completed.length === 0) return null;
  const hours = completed.map((entry) => leadTimeHours(entry.capture)).sort((a, b) => a - b);
  const middle = hours.length >> 1;
  const median = hours.length % 2 === 1
    ? hours[middle]
    : (hours[middle - 1] + hours[middle]) / 2;
  // Whole hours. A run's start drifts by hours, so minutes of precision here
  // would dress a scheduling artefact up as a measurement.
  return {
    minHours: Math.round(hours[0]),
    maxHours: Math.round(hours[hours.length - 1]),
    medianHours: Math.round(median),
    sampleCount: hours.length,
  };
}

function prospectiveBenchmark(
  completed: readonly CompletedCapture[],
  policy: PerformancePolicy,
): ProspectiveBenchmark {
  const window = completed.filter((entry) => entry.ageDays <= policy.windowDays);
  const comparable = window.filter(
    (entry) =>
      validProbability(entry.capture.frozenBlend.adaptiveProbability) &&
      validProbability(entry.capture.frozenBlend.equalProbability),
  );
  const score = (probabilityOf: (entry: CompletedCapture) => number | null): number | null => {
    const rows = comparable.flatMap((entry) => {
      const probability = probabilityOf(entry);
      if (!validProbability(probability)) return [];
      return [{
        value: brier(
          probability,
          entry.observation.observedMm >= policy.rainThresholdMm,
        ),
        weight: entry.recencyWeight,
      }];
    });
    return weightedMean(rows);
  };
  const providerProbability =
    (provider: PrecipProviderId) =>
    (entry: CompletedCapture): number | null =>
      entry.capture.providers.find((candidate) => candidate.provider === provider)?.probability ?? null;
  const adaptive = score((entry) => entry.capture.frozenBlend.adaptiveProbability);
  const equal = score((entry) => entry.capture.frozenBlend.equalProbability);
  let status: ProspectiveBenchmark["status"] = "insufficient";
  if (comparable.length >= policy.minimumSamples && adaptive !== null && equal !== null) {
    status = adaptive <= equal + 1e-12 ? "passing" : "regression";
  }

  return {
    sampleCount: comparable.length,
    adaptiveBrier: round(adaptive),
    equalBrier: round(equal),
    openMeteoBrier: round(score(providerProbability("open-meteo"))),
    kmaBrier: round(score(providerProbability("kma"))),
    status,
  };
}

/**
 * Build one auditable recent-performance profile for a station and capture cohort.
 * Callers need not know scoring, recency, evidence, bounding, or benchmark rules.
 */
export function buildRecentPerformanceProfile(input: ProfileInput): RecentPerformanceProfile {
  const policy = input.policy ?? DEFAULT_PERFORMANCE_POLICY;
  const completed = completedCaptures(input, policy);
  // The union of live and seed providers. Deriving this from completed captures
  // alone made the seed unreachable in exactly the case it exists for: a station
  // with zero live captures has no provider ids, so nothing could be scored.
  const providerIds = Array.from(
    new Set([
      ...completed.flatMap((entry) => entry.capture.providers.map((forecast) => forecast.provider)),
      ...(input.seedComparisons ?? []).flatMap((comparison) =>
        comparison.providers.map((forecast) => forecast.provider),
      ),
    ]),
  ).sort();
  const providers = providerIds.flatMap((provider) => {
    const metrics = providerMetrics(provider, completed, policy);
    return metrics ? [metrics] : [];
  });
  const equal = equalWeights(providers.map((provider) => provider.provider));
  const eligible = providers.filter((provider) => provider.eligible);
  const evidenceReady = eligible.length >= 2;
  const currentBenchmark = prospectiveBenchmark(completed, policy);
  const minimumEvidence = evidenceReady
    ? Math.min(...eligible.map((provider) => provider.sampleCount))
    : 0;
  const rampProgress = evidenceReady
    ? Math.min(
        1,
        Math.max(
          0,
          (minimumEvidence - policy.minimumSamples) /
            (policy.fullInfluenceSamples - policy.minimumSamples),
        ),
      )
    : 0;
  const learned = normalizeClamped(
    Object.fromEntries(
      providers.map((provider) => [
        provider.provider,
        provider.eligible
          ? Math.exp(-policy.scoreSharpness * provider.brierScore)
          : policy.weightFloor,
      ]),
    ),
    policy.weightFloor,
    policy.weightCap,
  );

  // Seed evidence fills the gap BEFORE live evidence matures. It deliberately
  // cannot rescue a suspension: a benchmark regression is a live verdict that the
  // adaptive blend is currently worse than equal, and retrospective archive
  // evidence is not grounds to overrule it.
  // Span every known provider, not just the seeded ones: a provider that answers
  // at serving time but has no archive proxy must keep a neutral share rather than
  // be dropped from the blend for having no weight entry.
  //
  // Narrowed to the providers still compared, because the seed table outlives a
  // provider. Rows stored for one since dropped would otherwise be scored and shown
  // beside a blend it is not part of — a service's measured performance on the page
  // next to a forecast it had no part in.
  const compared = new Set<PrecipProviderId>(PERFORMANCE_PROVIDERS);
  const seedProviderIds = Array.from(
    new Set<PrecipProviderId>([...PERFORMANCE_PROVIDERS, ...providerIds]),
  ).filter((provider) => compared.has(provider)).sort();
  const seedProfile = buildSeedProfile({
    comparisons: input.seedComparisons ?? [],
    providers: seedProviderIds,
    policy,
  });

  let mode: RecentPerformanceProfile["mode"] = "equal-fallback";
  let reason: RecentPerformanceProfile["reason"] = "insufficient-evidence";
  let effectiveWeights = equal;
  if (evidenceReady && currentBenchmark.status === "insufficient") {
    mode = "suspended";
    reason = "benchmark-insufficient";
  } else if (evidenceReady && currentBenchmark.status === "regression") {
    mode = "suspended";
    reason = "benchmark-regression";
  } else if (!evidenceReady && seedProfile.ready) {
    mode = "seed";
    reason = "seed-evidence";
    effectiveWeights = seedEffectiveWeights(seedProfile.weights, seedProviderIds);

  } else if (evidenceReady) {
    mode = rampProgress < 1 ? "ramping" : "learned";
    reason = rampProgress < 1 ? "ramping" : "learned";
    effectiveWeights = renormalize(
      Object.fromEntries(
        providers.map((provider) => [
          provider.provider,
          equal[provider.provider] +
            rampProgress * (learned[provider.provider] - equal[provider.provider]),
        ]),
      ),
    );
  }

  const asOfDate = koreanDate(input.asOf);
  return {
    leadTime: leadTimeSummary(completed),
    stationId: input.stationId,
    cohort: input.cohort,
    generatedAt: input.asOf.toISOString(),
    windowStart: subtractCalendarDays(asOfDate, policy.windowDays),
    windowEnd: asOfDate,
    mode,
    reason,
    rampProgress,
    providers,
    effectiveWeights,
    prospectiveBenchmark: currentBenchmark,
    seed: seedProfile.providers,
  };
}

/** Blend only the provider probabilities present at serving time. */
export function blendPrecipProbability(
  forecasts: readonly CapturedProviderForecast[],
  weights: Readonly<Record<string, number>>,
): number | null {
  const available = forecasts.filter((forecast) => validProbability(forecast.probability));
  const totalWeight = available.reduce(
    (sum, forecast) => sum + Math.max(0, weights[forecast.provider] ?? 0),
    0,
  );
  if (totalWeight <= 0) {
    if (available.length === 0) return null;
    return available.reduce((sum, forecast) => sum + forecast.probability!, 0) / available.length;
  }
  return available.reduce(
    (sum, forecast) =>
      sum + forecast.probability! * Math.max(0, weights[forecast.provider] ?? 0) / totalWeight,
    0,
  );
}
