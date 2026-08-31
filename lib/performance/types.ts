export type CaptureCohort = "06" | "18";

export type PrecipProviderId =
  | "open-meteo"
  | "met-norway"
  | "kma"
  | "pirate-weather"
  | "weather-api";

export interface CapturedProviderForecast {
  provider: PrecipProviderId;
  probability: number | null;
  amountMm: number | null;
}

/** One immutable next-day forecast comparison captured at a fixed KST cohort. */
export interface ForecastCapture {
  stationId: string;
  targetDate: string;
  cohort: CaptureCohort;
  capturedAt: string;
  providers: CapturedProviderForecast[];
  /** Frozen at capture time so later observations cannot leak into the benchmark. */
  frozenBlend: {
    adaptiveProbability: number | null;
    equalProbability: number | null;
    influence: Record<string, number>;
  };
}

export interface PrecipObservation {
  stationId: string;
  date: string;
  observedMm: number;
  observedAt: string;
  source: "kma-asos";
}

/** One Forecast Capture paired with its later official observation. */
export interface CompletedComparison {
  capture: ForecastCapture;
  observation: PrecipObservation;
}

export interface ObservationStation {
  id: string;
  name: string;
  network: "ASOS";
  latitude: number;
  longitude: number;
  elevationM: number | null;
  activeFrom: string;
  activeTo: string | null;
}

export interface PerformancePolicy {
  windowDays: number;
  halfLifeDays: number;
  reportDays: number;
  minimumSamples: number;
  fullInfluenceSamples: number;
  rainThresholdMm: number;
  decisionThreshold: number;
  weightFloor: number;
  weightCap: number;
  scoreSharpness: number;
}

export interface PerformanceSlice {
  sampleCount: number;
  brierScore: number | null;
}

export interface ProviderRecentPerformance {
  provider: PrecipProviderId;
  /** Comparable completed captures in the bounded maturity set. */
  sampleCount: number;
  /** Comparable captures inside the operating lookback. */
  windowSampleCount: number;
  wetDays: number;
  dryDays: number;
  misses: number;
  falseAlarms: number;
  brierScore: number;
  rainyAmountSampleCount: number;
  rainyAmountMae: number | null;
  last7Days: PerformanceSlice;
  eligible: boolean;
}

export interface ProspectiveBenchmark {
  sampleCount: number;
  adaptiveBrier: number | null;
  equalBrier: number | null;
  openMeteoBrier: number | null;
  kmaBrier: number | null;
  status: "passing" | "regression" | "insufficient";
}

/** One provider's retrospective skill over the Seed Comparisons at a station. */
export interface SeedProviderPerformance {
  provider: PrecipProviderId;
  /** Seed days on which the provider supplied an amount. */
  sampleCount: number;
  /** Of those, the informative days; a correct-dry day carries no skill. */
  scoredCount: number;
  wetDays: number;
  dryDays: number;
  misses: number;
  falseAlarms: number;
  /** Mean amount-and-outcome skill in [0,1], or null with nothing informative. */
  meanSkill: number | null;
  eligible: boolean;
}

/**
 * How far ahead the scored captures were actually made.
 *
 * A Capture Cohort names the scheduled slot, not the hour a run started, and the
 * scheduler is best-effort. Measuring the spread is what keeps that from being
 * invisible: it is common to every provider inside one capture, so it does not
 * bias provider-against-provider comparison, but it does bound what the cohort's
 * own label can honestly claim.
 */
export interface LeadTimeSummary {
  /** Hours from the capture to the start of its target day, in Asia/Seoul. */
  minHours: number;
  maxHours: number;
  medianHours: number;
  sampleCount: number;
}

export interface RecentPerformanceProfile {
  stationId: string;
  cohort: CaptureCohort;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  /** `seed` applies retrospective archive evidence at capped influence, only
   *  while live prospective evidence is still immature. */
  mode: "equal-fallback" | "ramping" | "learned" | "suspended" | "seed";
  reason:
    | "insufficient-evidence"
    | "benchmark-insufficient"
    | "benchmark-regression"
    | "ramping"
    | "learned"
    | "seed-evidence";
  rampProgress: number;
  providers: ProviderRecentPerformance[];
  effectiveWeights: Record<string, number>;
  prospectiveBenchmark: ProspectiveBenchmark;
  /** Retrospective seed evidence, when any was supplied. Never benchmarked. */
  seed: SeedProviderPerformance[];
  /** Observed lead-time spread of the scored captures; null when there are none. */
  leadTime: LeadTimeSummary | null;
}

/**
 * One provider's archived day-ahead precipitation forecast for a completed date.
 *
 * Retrospective archives publish an amount but no probability, so this carries no
 * probability field rather than inventing one. See `seed.ts`.
 */
export interface SeedProviderForecast {
  provider: PrecipProviderId;
  amountMm: number | null;
}

/**
 * One retrospective day-ahead forecast/observation pair rebuilt from public
 * archives. Deliberately NOT a ForecastCapture: it was never frozen at capture
 * time, carries no cohort, and must never enter the prospective benchmark.
 */
export interface SeedComparison {
  stationId: string;
  targetDate: string;
  providers: SeedProviderForecast[];
  observedMm: number;
  builtAt: string;
}
