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

const compared = new Set<string>(COMPARED_PROVIDER_IDS);

function validProbability(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0 && value <= 100;
}

/** The provider hours from the window's first hour to midnight on `targetDate`. */
export function morningWindowHours(
  snapshot: ProviderSnapshot,
  targetDate: string,
): MorningHourForecast[] {
  return snapshot.hourly.flatMap((hour) => {
    const at = new Date(hour.time);
    if (Number.isNaN(at.getTime())) return [];
    const kst = koreanDateAndHour(at);
    if (kst.date !== targetDate || kst.hour < MORNING_WINDOW_START_HOUR) return [];
    const amount = hour.precipitationAmount;
    return [{
      time: hour.time,
      probability: validProbability(hour.precipitationProbability) ? hour.precipitationProbability : null,
      amountMm: amount !== null && amount !== undefined && Number.isFinite(amount) && amount >= 0 ? amount : null,
    }];
  });
}

async function readAllForecasts(location: ForecastLocation): Promise<ProviderSnapshot[]> {
  return Promise.all(forecastProviders.map((provider) => provider.read(location)));
}

/** Freeze one station's rain chances for the rest of today before any of it is observed. */
export async function captureStationMorningForecast(
  input: MorningCaptureInput,
): Promise<MorningCaptureResult> {
  const targetDate = koreanDateAndHour(input.now).date;
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
    const hours = morningWindowHours(snapshot, targetDate);
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
    windowStartHour: MORNING_WINDOW_START_HOUR,
    providers,
    equalProbability: equal.probability,
  };
  const status = await input.store.saveMorningCapture(capture);
  return {
    status,
    reason: status === "inserted" ? "captured" : "already-captured",
    capture,
    faultedProviders,
  };
}
