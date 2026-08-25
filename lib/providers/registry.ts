import type { WeatherProvider } from "./base";
import { kmaProvider } from "./kma.ts";
import { metNorwayProvider } from "./met-norway.ts";
import { openMeteoProvider } from "./open-meteo.ts";
import { pirateWeatherProvider } from "./pirate-weather.ts";
import { weatherApiProvider } from "./weather-api.ts";

/**
 * Every implemented provider, in order. The first live one becomes the primary
 * source. Open-Meteo first — free, keyless, reliable; MET Norway second
 * (keyless); KMA, Pirate Weather, WeatherAPI when keys are configured.
 *
 * `lib/reliability/` collects from this list and scores MET Norway on its own
 * terms. The forecast path does not — see `forecastProviders`.
 */
export const providers: WeatherProvider[] = [
  openMeteoProvider,
  metNorwayProvider,
  kmaProvider,
  pirateWeatherProvider,
  weatherApiProvider,
];

/**
 * The providers the forecast actually compares, in the same order.
 *
 * MET Norway is absent. It answers `ok` for Korea and publishes an amount, but no
 * `probability_of_precipitation` — that field is Nordic-only in their detailed
 * model — and both scoring gates require a next-day probability. So it was
 * requested on every forecast and every capture, and discarded every time, while
 * the chooser named it to the reader as one of the services being compared. A
 * round-trip whose result can never be used is not a comparison.
 *
 * This is narrower than `providers` on purpose: the reliability pipeline reads that
 * one, and it is under its own review. Narrowing the forecast path must not quietly
 * change what that collects.
 */
export const forecastProviders: readonly WeatherProvider[] = providers.filter(
  (provider) => provider.id !== "met-norway",
);
