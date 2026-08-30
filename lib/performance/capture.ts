import { createForecastLocation, type ForecastLocation } from "../location.ts";
import { forecastProviders } from "../providers/registry.ts";
import type { ProviderSnapshot } from "../types.ts";
import { blendPrecipitation } from "./influence.ts";
import { buildRecentPerformanceProfile, DEFAULT_PERFORMANCE_POLICY } from "./performance.ts";
import type { PerformanceStore } from "./store.ts";
import type {
  CaptureCohort,
  CapturedProviderForecast,
  ForecastCapture,
  ObservationStation,
  PrecipProviderId,
} from "./types.ts";

// MET Norway is absent: it publishes no precipitation probability for Korea, so the
// probability gate below dropped every one of its forecasts. See `forecastProviders`.
const PRECIP_PROVIDERS = new Set<PrecipProviderId>([
  "open-meteo",
  "kma",
  "pirate-weather",
  "weather-api",
]);

export interface CaptureStationInput {
  station: ObservationStation;
  cohort: CaptureCohort;
  now: Date;
  store: PerformanceStore;
  readForecasts?: (location: ForecastLocation) => Promise<ProviderSnapshot[]>;
}

export interface CaptureStationResult {
  status: "inserted" | "existing" | "skipped" | "faulted";
  reason: "captured" | "already-captured" | "no-next-day-probability" | "provider-fault";
  capture: ForecastCapture | null;
  /** Compared providers whose read failed. Non-empty exactly when `faulted`. */
  faultedProviders: PrecipProviderId[];
}

function koreanDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addCalendarDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function validProbability(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100;
}

function validAmount(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

async function readAllForecasts(location: ForecastLocation): Promise<ProviderSnapshot[]> {
  return Promise.all(forecastProviders.map((provider) => provider.read(location)));
}

/** Freeze one station's next-day provider predictions before the outcome exists. */
export async function captureStationForecast(
  input: CaptureStationInput,
): Promise<CaptureStationResult> {
  const targetDate = addCalendarDays(koreanDate(input.now), 1);
  const location = createForecastLocation({
    name: input.station.name,
    latitude: input.station.latitude,
    longitude: input.station.longitude,
  });
  const snapshots = await (input.readForecasts ?? readAllForecasts)(location);
  // A provider that could not be read is not a provider with nothing to say — the
  // same distinction `absent` and a failed read carry on the observation side. A
  // capture short one provider by fault is indistinguishable from an honest one,
  // and `saveCapture` never overwrites, so storing it makes the loss permanent:
  // three evenings of runner egress failure froze 97 KMA-less captures a retry
  // could never repair. `needs-config` is excluded on purpose; a missing key is
  // permanent, and no runner will ever supply it.
  const faultedProviders = snapshots
    .filter((snapshot) =>
      PRECIP_PROVIDERS.has(snapshot.id as PrecipProviderId) &&
      snapshot.status.availability === "error"
    )
    .map((snapshot) => snapshot.id as PrecipProviderId);
  if (faultedProviders.length > 0) {
    return { status: "faulted", reason: "provider-fault", capture: null, faultedProviders };
  }
  const forecasts = snapshots.flatMap((snapshot): CapturedProviderForecast[] => {
    if (!PRECIP_PROVIDERS.has(snapshot.id as PrecipProviderId)) return [];
    const daily = snapshot.daily.find((day) => day.date === targetDate);
    if (!daily || !validProbability(daily.precipitationProbability)) return [];
    return [{
      provider: snapshot.id as PrecipProviderId,
      probability: daily.precipitationProbability,
      amountMm: validAmount(daily.precipitationAmount),
    }];
  });
  if (forecasts.length === 0) {
    return {
      status: "skipped",
      reason: "no-next-day-probability",
      capture: null,
      faultedProviders,
    };
  }

  const comparisons = await input.store.loadCompletedComparisons(
    input.station.id,
    input.cohort,
    DEFAULT_PERFORMANCE_POLICY.fullInfluenceSamples,
  );
  const profile = buildRecentPerformanceProfile({
    stationId: input.station.id,
    cohort: input.cohort,
    captures: comparisons.map((comparison) => comparison.capture),
    observations: comparisons.map((comparison) => comparison.observation),
    asOf: input.now,
  });
  // Both blends come from the module the serving path uses, so the Prospective
  // Benchmark compares the adaptive and equal probabilities a user would have
  // been shown rather than two separately derived numbers.
  const adaptive = blendPrecipitation(forecasts, profile);
  const equal = blendPrecipitation(forecasts, null);
  const capture: ForecastCapture = {
    stationId: input.station.id,
    targetDate,
    cohort: input.cohort,
    capturedAt: input.now.toISOString(),
    providers: forecasts,
    frozenBlend: {
      adaptiveProbability: adaptive.probability,
      equalProbability: equal.probability,
      influence: adaptive.influence,
    },
  };
  const status = await input.store.saveCapture(capture);
  return {
    status,
    reason: status === "inserted" ? "captured" : "already-captured",
    capture,
    faultedProviders,
  };
}
