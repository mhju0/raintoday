import type {
  CurrentWeather,
  DailyForecast,
  HourlyForecast,
  ProviderSnapshot,
  WeatherProviderStatus,
} from "../types.ts";
import type { ForecastLocation } from "../location.ts";

/**
 * Hours of hourly series an adapter keeps, counted from the current hour. The ribbon
 * draws 24 of them; the Evening Capture reads to the end of tomorrow, which is up
 * to 29 hours ahead at 19:30 KST.
 */
export const HOURLY_HORIZON_HOURS = 30;

/** One upstream response normalized into every forecast view consumers need. */
export interface NormalizedForecast {
  current: CurrentWeather;
  hourly: HourlyForecast[];
  daily: DailyForecast[];
}

/**
 * Contract every weather source must implement.
 *
 * Providers created by lib/providers/read.ts cache one upstream load per window
 * and isolate failures as non-ok snapshots. Consumers receive every normalized
 * view and the status describing that same cached generation in one read.
 */
export interface WeatherProvider {
  readonly id: WeatherProviderStatus["id"];
  /** Korean display name */
  readonly name: string;
  /** Missing variable names, without fetching weather or exposing credential values. */
  missingConfiguration(): string[];
  read(location?: ForecastLocation): Promise<ProviderSnapshot>;
}
