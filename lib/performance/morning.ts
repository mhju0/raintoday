import { createForecastLocation, type ForecastLocation } from "../location.ts";
import { forecastProviders } from "../providers/registry.ts";
import { COMPARED_PROVIDER_IDS } from "../providers/selection.ts";
import type { ProviderSnapshot } from "../types.ts";
import type { FaultedProvider } from "./capture.ts";
import { blendPrecipitation } from "./influence.ts";
import type { CaptureWriteResult, PerformanceStore } from "./store.ts";
import type {
  MorningCapture,
  MorningHourForecast,
  MorningProviderForecast,
  ObservationStation,
} from "./types.ts";

/**
 * The KST hour the Morning Slot opens, and the first hour its window covers.
 *
 * People decide about an umbrella before they leave, so this is the forecast to
 * grade for "today". The window starts here rather than at the capture's own
 * minute: a capture that lands late keeps whatever hours its providers still
 * publish, and its `capturedAt` says how late it was.
 */
export const MORNING_WINDOW_START_HOUR = 7;

/**
 * The Evening Slot freezes all of tomorrow, hour by hour, so its window starts at
 * midnight. It gives the learned hourly weights a second lead band (about 5 to
 * 29 hours) beside the morning's 0 to 17. Decision 2026-10-28.
 */
export const EVENING_WINDOW_START_HOUR = 0;

export interface MorningCaptureInput {
  station: ObservationStation;
  now: Date;
  store: PerformanceStore;
  readForecasts?: (location: ForecastLocation) => Promise<ProviderSnapshot[]>;
}

export interface MorningCaptureResult {
  status: CaptureWriteResult | "skipped" | "faulted";
  reason: "captured" | "already-captured" | "no-window-probability" | "provider-fault";
  capture: MorningCapture | null;
  /** Compared providers whose read failed. Non-empty exactly when `faulted`. */
  faultedProviders: FaultedProvider[];
}

const kstParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function koreanDateAndHour(date: Date): { date: string; hour: number } {
  const parts = Object.fromEntries(kstParts.formatToParts(date).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/**
 * Compared providers the Morning and Evening Slots never read. Pirate Weather's free 10,000
 * calls a month cover the two cohorts but not a third daily run, and a 429 would
 * fault every capture, cohort and morning alike. Decision 2026-10-21.
 */
export const MORNING_SKIPPED_PROVIDERS: ReadonlySet<string> = new Set(["pirate-weather"]);

const compared = new Set<string>(
  COMPARED_PROVIDER_IDS.filter((id) => !MORNING_SKIPPED_PROVIDERS.has(id)),
);

/** The registry's providers the Morning Slot reads, in serving order. */
export const morningProviders = forecastProviders.filter((provider) => compared.has(provider.id));

function validProbability(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0 && value <= 100;
}

/**
 * The provider hours from the window's first hour to midnight on `targetDate`, as
 * stamped. The stamp at the next date's 00:00 is kept too: Open-Meteo and KMA stamp
 * the hour that ends then, so it is the day's last hour for them, while Pirate
 * Weather stamps the hour that starts then. Grading maps each provider's stamps to
 * observation hours by its own convention (docs/research/hourly-forecast-blending.md).
 */
export function morningWindowHours(
  snapshot: ProviderSnapshot,
  targetDate: string,
  windowStartHour: number = MORNING_WINDOW_START_HOUR,
): MorningHourForecast[] {
  const nextDate = addCalendarDays(targetDate, 1);
  return snapshot.hourly.flatMap((hour) => {
    const at = new Date(hour.time);
    if (Number.isNaN(at.getTime())) return [];
    const kst = koreanDateAndHour(at);
    const inDay = kst.date === targetDate && kst.hour >= windowStartHour;
    const endsDay = kst.date === nextDate && kst.hour === 0;
    if (!inDay && !endsDay) return [];
    const amount = hour.precipitationAmount;
    const amountMm = amount !== null && amount !== undefined && Number.isFinite(amount) && amount >= 0 ? amount : null;
    const range = hour.precipitationAmountRange;
    const validRange = amountMm === null && range != null && Number.isFinite(range.lowMm) && range.lowMm >= 0 &&
      (range.highMm === null || (Number.isFinite(range.highMm) && range.highMm >= range.lowMm));
    return [{
      time: hour.time,
      probability: validProbability(hour.precipitationProbability) ? hour.precipitationProbability : null,
      amountMm,
      ...(validRange ? { amountRangeMm: { lowMm: range.lowMm, highMm: range.highMm } } : {}),
    }];
  });
}

function addCalendarDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

async function readAllForecasts(location: ForecastLocation): Promise<ProviderSnapshot[]> {
  return Promise.all(morningProviders.map((provider) => provider.read(location)));
}

/** Freeze one station's rain chances for the rest of today before any of it is observed. */
export function captureStationMorningForecast(
  input: MorningCaptureInput,
): Promise<MorningCaptureResult> {
  return captureStationWindow(input, koreanDateAndHour(input.now).date, MORNING_WINDOW_START_HOUR, (capture) =>
    input.store.saveMorningCapture(capture));
}

/** Freeze one station's rain chances for all of tomorrow, hour by hour, at the Evening Slot. */
export function captureStationEveningForecast(
  input: MorningCaptureInput,
): Promise<MorningCaptureResult> {
  const tomorrow = addCalendarDays(koreanDateAndHour(input.now).date, 1);
  return captureStationWindow(input, tomorrow, EVENING_WINDOW_START_HOUR, (capture) =>
    input.store.saveEveningCapture(capture));
}

async function captureStationWindow(
  input: MorningCaptureInput,
  targetDate: string,
  windowStartHour: number,
  save: (capture: MorningCapture) => Promise<CaptureWriteResult>,
): Promise<MorningCaptureResult> {
  const location = createForecastLocation({
    name: input.station.name,
    latitude: input.station.latitude,
    longitude: input.station.longitude,
  });
  const snapshots = await (input.readForecasts ?? readAllForecasts)(location);
  // The same refusal as a cohort capture, for the same reason: a capture short one
  // provider by fault is indistinguishable from an honest one, and it is never
  // rewritten. A missing key is permanent, so `needs-config` is not a fault.
  const faultedProviders: FaultedProvider[] = snapshots.flatMap((snapshot) =>
    compared.has(snapshot.id) && snapshot.status.availability === "error"
      ? [{ provider: snapshot.id as FaultedProvider["provider"], message: snapshot.status.message }]
      : []);
  if (faultedProviders.length > 0) {
    return { status: "faulted", reason: "provider-fault", capture: null, faultedProviders };
  }
  const providers: MorningProviderForecast[] = snapshots.flatMap((snapshot) => {
    if (!compared.has(snapshot.id)) return [];
    const hours = morningWindowHours(snapshot, targetDate, windowStartHour);
    const chances = hours.map((hour) => hour.probability).filter(validProbability);
    return chances.length === 0
      ? []
      : [{ provider: snapshot.id as MorningProviderForecast["provider"], probability: Math.max(...chances), hours }];
  });
  if (providers.length === 0) {
    return { status: "skipped", reason: "no-window-probability", capture: null, faultedProviders };
  }
  const equal = blendPrecipitation(
    providers.map((forecast) => ({ provider: forecast.provider, probability: forecast.probability, amountMm: null })),
    null,
  );
  const capture: MorningCapture = {
    stationId: input.station.id,
    targetDate,
    capturedAt: input.now.toISOString(),
    windowStartHour,
    providers,
    equalProbability: equal.probability,
  };
  const status = await save(capture);
  return {
    status,
    reason: status === "inserted" ? "captured" : "already-captured",
    capture,
    faultedProviders,
  };
}
