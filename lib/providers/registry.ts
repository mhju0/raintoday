import type { WeatherProvider } from "./base";
import { kmaProvider } from "./kma.ts";
import { openMeteoProvider } from "./open-meteo.ts";
import { pirateWeatherProvider } from "./pirate-weather.ts";
import { weatherApiProvider } from "./weather-api.ts";

/**
 * The providers the forecast compares, in order. The first live one becomes the
 * comparison primary. Open-Meteo first — free, keyless, reliable; then KMA,
 * Pirate Weather and WeatherAPI when their keys are configured.
 *
 * This was two lists until the scheduled reliability pipeline was retired. That
 * pipeline read a wider one so it could score MET Norway on its own terms, while
 * the forecast path excluded it: MET Norway answers `ok` for Korea and publishes
 * an amount, but no `probability_of_precipitation` — that field is Nordic-only in
 * their detailed model — and both scoring gates require a next-day probability.
 * With the second reader gone, nothing consumed the wider list, so there is one.
 */
export const forecastProviders: readonly WeatherProvider[] = [
  openMeteoProvider,
  kmaProvider,
  pirateWeatherProvider,
  weatherApiProvider,
];
