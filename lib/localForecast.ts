import { cachedFetch } from "./cache.ts";
import type { ForecastLocation } from "./location.ts";
import { blendPrecipitation } from "./performance/influence.ts";
import {
  buildRecentPerformanceProfile,
  DEFAULT_PERFORMANCE_POLICY,
} from "./performance/performance.ts";
import { PostgresPerformanceStore } from "./performance/postgres.ts";
import { findStationMatch } from "./performance/stations.ts";
import type { PerformanceStore } from "./performance/store.ts";
import type {
  CaptureCohort,
  CapturedProviderForecast,
  RecentPerformanceProfile,
  PrecipProviderId,
} from "./performance/types.ts";
import { forecastProviders } from "./providers/registry.ts";
import type { HourlyForecast, ProviderSnapshot, WeatherCondition } from "./types.ts";

// MET Norway is absent: it publishes no precipitation probability for Korea, so it
// could never survive the probability gate below. See `forecastProviders`.
const PRECIP_PROVIDERS = new Set<PrecipProviderId>([
  "open-meteo",
  "kma",
  "pirate-weather",
  "weather-api",
  "visual-crossing",
]);
const STATION_POLICY = { maxDistanceKm: 100, maxElevationDifferenceM: 400 };
let runtimePerformanceStore: PostgresPerformanceStore | null = null;

export interface LocalForecastEvidence {
  status: "active" | "collecting" | "unavailable";
  reason:
    | "eligible-station"
    | "insufficient-evidence"
    | "benchmark-insufficient"
    | "benchmark-regression"
    | "seed-evidence"
    | "no-eligible-station"
    | "database-not-configured"
    | "database-unavailable";
  station: { id: string; name: string; distanceKm: number } | null;
  profile: RecentPerformanceProfile | null;
}

export interface LocalForecastDay {
  date: string;
  precipitationProbability: number | null;
  precipitationAmountMm: number | null;
  /**
   * Providers behind the amount, which is not always the number behind the
   * probability: two of the compared services publish no daily amount. The page
   * must not print one provider count over both numbers.
   */
  amountProviderCount: number;
  temperatureMax: number | null;
  temperatureMin: number | null;
  condition: WeatherCondition;
}

export interface LocalForecastResponse {
  generatedAt: string;
  location: ForecastLocation;
  targetDate: string | null;
  captureCohort: CaptureCohort;
  /**
   * Observed conditions now, taken from the first provider in registry order
   * that is serving any. Availability is not gated on here: a stale last-good
   * snapshot still carries real observed weather, and dropping it would leave
   * the page emptier than the data warrants. Null when nobody has current
   * weather — the page shows an honest gap rather than reusing the target-date
   * blend, which describes tomorrow and not now.
   */
  current: {
    temperature: number;
    apparentTemperature: number | null;
    condition: WeatherCondition;
    observedAt: string;
    sourceName: string;
  } | null;
  /**
   * The next ~24 hours, from the first provider in registry order that
   * publishes an hourly series. Every provider anchors its series on "now", so
   * entries[0] always covers the current hour.
   *
   * Single-source on purpose. The headline probability is a blend across
   * providers, but their hourly series are not mutually comparable — different
   * issue times, resolutions and precipitation definitions — so averaging them
   * would draw a curve no provider ever issued. `sourceName` exists so the page
   * can say whose series it is rather than implying consensus. Null when nobody
   * publishes one.
   */
  hourly: { entries: HourlyForecast[]; sourceName: string } | null;
  recommendation: {
    precipitationProbability: number | null;
    precipitationAmountMm: number | null;
    amountProviderCount: number;
    temperatureMax: number | null;
    temperatureMin: number | null;
    condition: WeatherCondition;
  };
  /**
   * Today, always on equal weighting. The Recent Performance Profile scores
   * next-day forecasts only, so carrying it onto today's number would be an
   * accuracy claim nothing has verified. Null when no provider still publishes
   * a daily entry for today.
   */
  today: LocalForecastDay | null;
  outlook: LocalForecastDay[];
  providers: Array<{
    id: PrecipProviderId;
    name: string;
    probability: number | null;
    amountMm: number | null;
    available: boolean;
  }>;
  effectiveInfluence: Record<string, number>;
  performance: LocalForecastEvidence;
}

interface LocalForecastDependencies {
  now?: Date;
  readForecasts?: (location: ForecastLocation) => Promise<ProviderSnapshot[]>;
  readEvidence?: (
    location: ForecastLocation,
    elevationM: number | null,
    cohort: CaptureCohort,
    now: Date,
  ) => Promise<LocalForecastEvidence>;
}

function koreanHour(date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date),
  );
}

function koreanDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function nextCalendarDate(date: Date): string {
  return new Date(Date.parse(`${koreanDate(date)}T00:00:00.000Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Which fixed capture cohort's evidence a read at this instant is scored against. */
export function captureCohortAt(date: Date): CaptureCohort {
  const hour = koreanHour(date);
  return hour >= 6 && hour < 18 ? "06" : "18";
}

function validProbability(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100;
}

function validAmount(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function buildForecastDay(
  date: string,
  snapshots: readonly ProviderSnapshot[],
  profile: RecentPerformanceProfile | null,
): LocalForecastDay | null {
  const rows = snapshots.flatMap((snapshot) => {
    if (!PRECIP_PROVIDERS.has(snapshot.id as PrecipProviderId)) return [];
    const daily = snapshot.daily.find((day) => day.date === date);
    if (!daily || !validProbability(daily.precipitationProbability)) return [];
    return [{
      provider: snapshot.id as PrecipProviderId,
      probability: daily.precipitationProbability,
      amountMm: validAmount(daily.precipitationAmount),
      temperatureMax: daily.temperatureMax,
      temperatureMin: daily.temperatureMin,
      condition: daily.condition,
    }];
  });
  if (rows.length === 0) return null;
  const forecasts: CapturedProviderForecast[] = rows.map((row) => ({
    provider: row.provider,
    probability: row.probability,
    amountMm: row.amountMm,
  }));
  const blend = blendPrecipitation(forecasts, profile);
  return {
    date,
    precipitationProbability: blend.probability,
    precipitationAmountMm: blend.amountMm,
    amountProviderCount: blend.amountProviderCount,
    temperatureMax: rows[0].temperatureMax,
    temperatureMin: rows[0].temperatureMin,
    condition: rows[0].condition,
  };
}

async function readAllForecasts(location: ForecastLocation): Promise<ProviderSnapshot[]> {
  return Promise.all(forecastProviders.map((provider) => provider.read(location)));
}

export async function readDatabaseEvidence(
  location: ForecastLocation,
  elevationM: number | null,
  cohort: CaptureCohort,
  now: Date,
): Promise<LocalForecastEvidence> {
  return (await readEvidenceFromStore(performanceStore(), location, elevationM, cohort, now)).evidence;
}

function performanceStore(): PerformanceStore | null {
  const connectionUrl = process.env.PERFORMANCE_DATABASE_URL?.trim();
  if (!connectionUrl) return null;
  return runtimePerformanceStore ??= new PostgresPerformanceStore(connectionUrl);
}

/** Record pages reuse station history for ten minutes and report its actual read time. */
export const RECORD_EVIDENCE_TTL_MS = 10 * 60_000;
const recordStoreIds = new WeakMap<PerformanceStore, number>();
let nextRecordStoreId = 0;

/** Station ids let GPS visitors open their record without sharing device coordinates. */
export async function readRecordEvidence(
  location: ForecastLocation | string,
  cohort: CaptureCohort,
  now: Date,
  store: PerformanceStore | null = performanceStore(),
): Promise<{ evidence: LocalForecastEvidence; readAt: Date }> {
  let cachePrefix: string | undefined;
  if (store) {
    if (!recordStoreIds.has(store)) recordStoreIds.set(store, ++nextRecordStoreId);
    cachePrefix = `record:${recordStoreIds.get(store)}:${koreanDate(now)}`;
  }
  return readEvidenceFromStore(store, location, null, cohort, now, cachePrefix);
}

export async function readPerformanceEvidenceFromStore(
  store: PerformanceStore,
  location: ForecastLocation,
  elevationM: number | null,
  cohort: CaptureCohort,
  now: Date,
): Promise<LocalForecastEvidence> {
  return (await readEvidenceFromStore(store, location, elevationM, cohort, now)).evidence;
}

async function readEvidenceFromStore(
  store: PerformanceStore | null,
  location: ForecastLocation | string,
  elevationM: number | null,
  cohort: CaptureCohort,
  now: Date,
  cachePrefix?: string,
): Promise<{ evidence: LocalForecastEvidence; readAt: Date }> {
  const unavailable = (reason: LocalForecastEvidence["reason"]) => ({
    evidence: { status: "unavailable" as const, reason, station: null, profile: null },
    readAt: now,
  });
  if (!store) return unavailable("database-not-configured");
  try {
    const stations = cachePrefix
      ? (await cachedFetch(`${cachePrefix}:stations`, RECORD_EVIDENCE_TTL_MS, () => store.listStations(), { staleIfError: false })).value
      : await store.listStations();
    const requested = typeof location === "string"
      ? stations.find((station) => station.id === location)
      : location;
    if (!requested) return unavailable("no-eligible-station");
    const stationMatch = findStationMatch({
      location: { ...requested, elevationM },
      stations: typeof location === "string" ? stations.filter((station) => station.id === location) : stations,
      at: now,
      policy: STATION_POLICY,
    });
    if (!stationMatch.station || stationMatch.distanceKm === null) {
      return unavailable("no-eligible-station");
    }
    const stationId = stationMatch.station.id;
    const loadProfile = async () => {
      const [comparisons, seedComparisons] = await Promise.all([
        store.loadCompletedComparisons(stationId, cohort, DEFAULT_PERFORMANCE_POLICY.fullInfluenceSamples),
        store.loadSeedComparisons(stationId, DEFAULT_PERFORMANCE_POLICY.fullInfluenceSamples),
      ]);
      return buildRecentPerformanceProfile({
        stationId,
        cohort,
        captures: comparisons.map((comparison) => comparison.capture),
        observations: comparisons.map((comparison) => comparison.observation),
        asOf: now,
        seedComparisons,
      });
    };
    // Cache only station history. Distance and eligibility belong to this request.
    const profile = cachePrefix
      ? (await cachedFetch(`${cachePrefix}:${stationId}:${cohort}`, RECORD_EVIDENCE_TTL_MS, loadProfile, { staleIfError: false })).value
      : await loadProfile();
    const active =
      profile.mode === "learned" || profile.mode === "ramping" || profile.mode === "seed";
    const inactiveReason =
      profile.reason === "benchmark-insufficient" || profile.reason === "benchmark-regression"
        ? profile.reason
        : "insufficient-evidence";
    return {
      evidence: {
        status: active ? "active" : "collecting",
        reason: profile.mode === "seed" ? "seed-evidence" : active ? "eligible-station" : inactiveReason,
        station: {
          id: stationId,
          name: stationMatch.station.name,
          distanceKm: Math.round(stationMatch.distanceKm * 10) / 10,
        },
        profile,
      },
      readAt: new Date(profile.generatedAt),
    };
  } catch {
    return unavailable("database-unavailable");
  }
}

/** Build the user-facing exact-location forecast with nearby-station evidence. */
export async function readLocalForecast(
  input: { location: ForecastLocation; elevationM: number | null },
  dependencies: LocalForecastDependencies = {},
): Promise<LocalForecastResponse> {
  const now = dependencies.now ?? new Date();
  const cohort = captureCohortAt(now);
  const snapshotsPromise = (dependencies.readForecasts ?? readAllForecasts)(input.location);
  const performancePromise = (dependencies.readEvidence ?? readDatabaseEvidence)(
    input.location,
    input.elevationM,
    cohort,
    now,
  );
  const [snapshots, performance] = await Promise.all([snapshotsPromise, performancePromise]);
  const targetDate = nextCalendarDate(now);
  const providerRows = snapshots.flatMap((snapshot) => {
    if (!PRECIP_PROVIDERS.has(snapshot.id as PrecipProviderId)) return [];
    const daily = snapshot.daily.find((day) => day.date === targetDate);
    return [{
      id: snapshot.id as PrecipProviderId,
      name: snapshot.status.name,
      probability: daily?.precipitationProbability ?? null,
      amountMm: validAmount(daily?.precipitationAmount),
      temperatureMax: daily?.temperatureMax ?? null,
      temperatureMin: daily?.temperatureMin ?? null,
      condition: daily?.condition ?? "unknown" as WeatherCondition,
      available: Boolean(daily && validProbability(daily.precipitationProbability)),
    }];
  });
  const forecasts: CapturedProviderForecast[] = providerRows.flatMap((provider) =>
    provider.available
      ? [{ provider: provider.id, probability: provider.probability, amountMm: provider.amountMm }]
      : [],
  );
  // Learned influence is evidence for one cohort's next day, so only the target
  // date operates under the profile; later outlook days stay on Equal Fallback.
  const operatingProfile =
    performance.status === "active" ? performance.profile : null;
  const effectiveInfluence = blendPrecipitation(forecasts, operatingProfile).influence;
  const outlook = Array.from(
    new Set(
      snapshots.flatMap((snapshot) => snapshot.daily.map((day) => day.date))
        .filter((date) => date >= targetDate),
    ),
  )
    .sort()
    .slice(0, 7)
    .flatMap((date) => {
      const day = buildForecastDay(date, snapshots, date === targetDate ? operatingProfile : null);
      return day ? [day] : [];
    });
  const recommendation = outlook.find((day) => day.date === targetDate) ?? {
    date: targetDate,
    precipitationProbability: null,
    precipitationAmountMm: null,
    amountProviderCount: 0,
    temperatureMax: null,
    temperatureMin: null,
    condition: "unknown" as const,
  };
  const currentSource = snapshots.find((snapshot) => snapshot.current !== null);
  const hourlySource = snapshots.find((snapshot) => snapshot.hourly.length > 0);
  // Equal weighting on purpose — see the `today` field docs.
  const today = buildForecastDay(koreanDate(now), snapshots, null);
  return {
    generatedAt: now.toISOString(),
    location: input.location,
    targetDate,
    captureCohort: cohort,
    current: currentSource?.current
      ? {
          temperature: currentSource.current.temperature,
          apparentTemperature: currentSource.current.apparentTemperature,
          condition: currentSource.current.condition,
          observedAt: currentSource.current.time,
          sourceName: currentSource.status.name,
        }
      : null,
    hourly: hourlySource
      ? { entries: hourlySource.hourly, sourceName: hourlySource.status.name }
      : null,
    recommendation: {
      precipitationProbability: recommendation.precipitationProbability,
      precipitationAmountMm: recommendation.precipitationAmountMm,
      amountProviderCount: recommendation.amountProviderCount,
      temperatureMax: recommendation.temperatureMax,
      temperatureMin: recommendation.temperatureMin,
      condition: recommendation.condition,
    },
    today,
    outlook,
    providers: providerRows.map((provider) => ({
      id: provider.id,
      name: provider.name,
      probability: provider.probability,
      amountMm: provider.amountMm,
      available: provider.available,
    })),
    effectiveInfluence,
    performance,
  };
}
