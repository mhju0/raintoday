/**
 * 오늘비 (raintoday) internal weather schema.
 * Every provider response is normalized into these types.
 * Units: temperature °C, wind km/h, precipitation mm, probabilities/percentages 0–100.
 * All time strings are ISO 8601 with an explicit offset (Asia/Seoul or UTC).
 */

export type WeatherCondition =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "overcast"
  | "fog"
  | "drizzle"
  | "rain"
  | "heavy-rain"
  | "snow"
  | "sleet"
  | "thunderstorm"
  | "unknown";

export interface CurrentWeather {
  time: string;
  temperature: number;
  apparentTemperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  precipitation: number | null;
  cloudCover: number | null;
  condition: WeatherCondition;
  /**
   * Richer optional fields populated by Open-Meteo and consumed by the
   * cinematic scene. Other providers may omit them (degrade gracefully).
   */
  windGusts?: number | null;
  rain?: number | null;
  snowfall?: number | null;
  precipitationProbability?: number | null;
  visibility?: number | null;
  isDay?: boolean | null;
  weatherCode?: number | null;
}

export interface HourlyForecast {
  time: string;
  temperature: number;
  precipitationProbability: number | null;
  windSpeed: number | null;
  humidity: number | null;
  condition: WeatherCondition;
}

export interface DailyForecast {
  /** YYYY-MM-DD in Seoul local time */
  date: string;
  temperatureMax: number;
  temperatureMin: number;
  precipitationProbability: number | null;
  condition: WeatherCondition;
  sunrise: string | null;
  sunset: string | null;
  /**
   * Forecast daily precipitation total (mm). Optional enrichment populated only
   * by sources that publish a clean daily amount (Open-Meteo, WeatherAPI); other
   * sources omit it. Consumed by the forecast blend and by the performance
   * capture as the day's amount; sources that publish none stay null.
   */
  precipitationAmount?: number | null;
}

/**
 * Every provider id that can appear in a snapshot. `met-norway` is retained
 * deliberately: it is no longer implemented, but it remains a valid
 * `PrecipProviderId` in stored capture and seed rows, and it is the id the
 * capture's precip-provider filter exists to drop.
 */
export type ProviderId =
  | "open-meteo"
  | "met-norway"
  | "kma"
  | "pirate-weather"
  | "weather-api";

export type ProviderAvailability =
  /** Configured and returning live data */
  | "ok"
  /** Works, but missing optional credentials */
  | "needs-config"
  /** Configured but the last fetch failed */
  | "error";

export interface WeatherProviderStatus {
  id: ProviderId;
  /** Korean display name */
  name: string;
  availability: ProviderAvailability;
  /** Korean human-readable explanation */
  message: string;
  /** Names only — never values */
  missingEnvVars: string[];
  /** ISO timestamp of the data currently served, if any */
  lastUpdated: string | null;
  fromCache: boolean;
  /** true when an expired cache entry is being served after an upstream failure. */
  stale?: boolean;
}

/** Everything one provider knows right now. */
export interface ProviderSnapshot {
  id: ProviderId;
  status: WeatherProviderStatus;
  current: CurrentWeather | null;
  hourly: HourlyForecast[];
  daily: DailyForecast[];
}

