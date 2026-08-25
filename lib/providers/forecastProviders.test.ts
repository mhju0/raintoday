import assert from "node:assert/strict";
import test from "node:test";
import { forecastProviders, providers } from "./registry.ts";

test("the forecast compares only providers that can publish a probability", () => {
  // MET Norway answers `ok` for Korea and publishes an amount, but no
  // `probability_of_precipitation` — that field is Nordic-only in their detailed
  // model. Both scoring gates require a next-day probability, so every capture and
  // every blend dropped it while the chooser still named it to the reader as one of
  // the services being compared. It is not fetched on the forecast path at all now.
  assert.equal(
    forecastProviders.some((provider) => provider.id === "met-norway"),
    false,
    "MET Norway cannot contribute a scored forecast, so it is not requested",
  );
  assert.deepEqual(
    forecastProviders.map((provider) => provider.id),
    ["open-meteo", "kma", "pirate-weather", "weather-api"],
    "order is preserved: the first available current snapshot is the comparison primary",
  );
});

test("the full registry still carries MET Norway for the reliability pipeline", () => {
  // lib/reliability/ reads this same registry and scores MET Norway on its own
  // terms. That pipeline is under separate review (#88); narrowing the forecast
  // path must not quietly change what it collects.
  assert.equal(providers.some((provider) => provider.id === "met-norway"), true);
});
