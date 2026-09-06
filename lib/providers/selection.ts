import type { CapturedProviderForecast, PrecipProviderId } from "../performance/types.ts";
import type { ProviderSnapshot, WeatherCondition } from "../types.ts";

/** Active comparisons in presentation order; historical identities remain valid in storage. */
export const COMPARED_PROVIDER_IDS = [
  "open-meteo",
  "kma",
  "pirate-weather",
  "weather-api",
  "visual-crossing",
] as const satisfies readonly PrecipProviderId[];

export type ComparedProviderId = typeof COMPARED_PROVIDER_IDS[number];
const compared = new Set<string>(COMPARED_PROVIDER_IDS);

/**
 * Select one day's compared forecasts without losing unavailable providers or faults.
 * Capture refuses faults; serving can still show the remaining forecasts. Input order
 * decides the day's primary weather, independently of probability and amount weighting.
 */
export function selectComparedForecasts(snapshots: readonly ProviderSnapshot[], date: string) {
  const rows = snapshots.flatMap((snapshot) => {
    if (!compared.has(snapshot.id)) return [];
    const daily = snapshot.daily.find((day) => day.date === date);
    const probability = daily?.precipitationProbability ?? null;
    const amount = daily?.precipitationAmount;
    return [{
      id: snapshot.id as ComparedProviderId,
      name: snapshot.status.name,
      probability,
      amountMm: amount !== null && amount !== undefined && Number.isFinite(amount) && amount >= 0 ? amount : null,
      temperatureMax: daily?.temperatureMax ?? null,
      temperatureMin: daily?.temperatureMin ?? null,
      condition: daily?.condition ?? "unknown" as WeatherCondition,
      available: Boolean(daily && probability !== null && Number.isFinite(probability) && probability >= 0 && probability <= 100),
      fault: snapshot.status.availability === "error" ? snapshot.status.message : null,
    }];
  });
  const forecasts: CapturedProviderForecast[] = rows.flatMap((row) => row.available
    ? [{ provider: row.id, probability: row.probability, amountMm: row.amountMm }]
    : []);
  const faultedProviders = rows.flatMap((row) => row.fault !== null
    ? [{ provider: row.id, message: row.fault }]
    : []);
  return { rows, forecasts, faultedProviders };
}
