import assert from "node:assert/strict";
import test from "node:test";
import { forecastProviders } from "./registry.ts";

test("the forecast compares only providers that can publish a probability", () => {
  // MET Norway answers `ok` for Korea and publishes an amount, but no
  // `probability_of_precipitation` — that field is Nordic-only in their detailed
  // model. Both scoring gates require a next-day probability, so every capture and
  // every blend dropped it while the chooser still named it to the reader as one of
  // the services being compared. It is not implemented at all now: the scheduled
  // reliability pipeline was the only reader that could use it, and that is gone.
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
