import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { clearCache } from "../cache.ts";
import { openMeteoProvider } from "./open-meteo.ts";

const realFetch = globalThis.fetch;

// Default-model response: a 74% hour whose amount, from a different model, is 0.
const forecastBody = JSON.stringify({
  current: {
    time: "2026-10-12T17:00",
    temperature_2m: 20,
    relative_humidity_2m: 70,
    apparent_temperature: 20,
    precipitation: 0,
    rain: 0,
    snowfall: 0,
    weather_code: 3,
    cloud_cover: 90,
    wind_speed_10m: 4,
    wind_gusts_10m: 8,
    wind_direction_10m: 180,
    is_day: 1,
    visibility: 10_000,
  },
  hourly: {
    time: ["2026-10-12T16:00", "2026-10-12T17:00", "2026-10-12T18:00", "2026-10-12T19:00"],
    temperature_2m: [21, 20, 19, 18],
    precipitation_probability: [69, 74, 73, 62],
    precipitation: [0, 0, 0, 0],
    weather_code: [3, 61, 61, 3],
    wind_speed_10m: [4, 4, 4, 4],
    relative_humidity_2m: [70, 70, 70, 70],
  },
  daily: {
    time: ["2026-10-12"],
    weather_code: [61],
    temperature_2m_max: [25],
    temperature_2m_min: [17],
    precipitation_probability_max: [74],
    precipitation_sum: [0.2],
    sunrise: ["2026-10-12T06:38"],
    sunset: ["2026-10-12T17:58"],
  },
});

// The runs behind the probability, on a series that starts one hour later. The
// control run is dry at 17:00 while the others are not; one run is unpublished
// at 18:00 and every run is unpublished at 19:00.
const ensembleBody = JSON.stringify({
  hourly: {
    time: ["2026-10-12T17:00", "2026-10-12T18:00", "2026-10-12T19:00"],
    precipitation: [0, 0.3, null],
    precipitation_member01: [0.6, 0.9, null],
    precipitation_member02: [0.3, null, null],
    temperature_2m_member01: [9, 9, 9],
  },
});

function json(body: string): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
}

function isEnsembleRequest(input: Parameters<typeof fetch>[0]): boolean {
  const url = new URL(String(input));
  return url.hostname === "ensemble-api.open-meteo.com" && url.searchParams.get("models") === "ecmwf_ifs025";
}

beforeEach(() => clearCache());

afterEach(() => {
  globalThis.fetch = realFetch;
  clearCache();
});

test("Open-Meteo hourly amounts are the mean of the runs behind its hourly probability", async () => {
  globalThis.fetch = (async (input) =>
    json(isEnsembleRequest(input) ? ensembleBody : forecastBody)) as typeof fetch;

  const snapshot = await openMeteoProvider.read();

  assert.equal(snapshot.status.availability, "ok");
  assert.deepEqual(
    snapshot.hourly.map((hour) => [hour.time, hour.precipitationProbability, hour.precipitationAmount]),
    [
      ["2026-10-12T17:00+09:00", 74, 0.3],
      ["2026-10-12T18:00+09:00", 73, 0.6],
      ["2026-10-12T19:00+09:00", 62, null],
    ],
  );
  // The daily amount is the blended, scored value and keeps its default-model source.
  assert.equal(snapshot.daily[0].precipitationAmount, 0.2);
});

test("Open-Meteo hourly amounts stay missing when the runs behind the probability cannot be read", async () => {
  globalThis.fetch = (async (input) =>
    isEnsembleRequest(input)
      ? new Response("unavailable", { status: 503 })
      : json(forecastBody)) as typeof fetch;

  const snapshot = await openMeteoProvider.read();

  assert.equal(snapshot.status.availability, "ok");
  assert.deepEqual(snapshot.hourly.map((hour) => hour.precipitationProbability), [74, 73, 62]);
  assert.deepEqual(snapshot.hourly.map((hour) => hour.precipitationAmount), [null, null, null]);
  assert.equal(snapshot.daily[0].precipitationAmount, 0.2);
});
