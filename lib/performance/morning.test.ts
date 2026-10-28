import assert from "node:assert/strict";
import test from "node:test";
import type { HourlyForecast, ProviderSnapshot } from "../types.ts";
import {
  captureStationEveningForecast,
  captureStationMorningForecast,
  morningProviders,
  morningWindowHours,
} from "./morning.ts";
import { InMemoryPerformanceStore } from "./store.ts";
import type { ObservationStation } from "./types.ts";

const station: ObservationStation = {
  id: "108",
  name: "서울",
  network: "ASOS",
  latitude: 37.5714,
  longitude: 126.9658,
  elevationM: 85.7,
  activeFrom: "2026-01-01",
  activeTo: null,
};

const SEVEN_AM = new Date("2026-10-22T07:00:00+09:00");

function hour(time: string, probability: number | null, amount?: number | null): HourlyForecast {
  return {
    time,
    temperature: 15,
    precipitationProbability: probability,
    precipitationAmount: amount,
    windSpeed: null,
    humidity: null,
    condition: "cloudy",
  };
}

function snapshot(
  id: ProviderSnapshot["id"],
  hourly: HourlyForecast[],
  availability: ProviderSnapshot["status"]["availability"] = "ok",
): ProviderSnapshot {
  return {
    id,
    status: {
      id,
      name: id,
      availability,
      message: availability === "error" ? `${id} timed out` : "ok",
      missingEnvVars: [],
      lastUpdated: null,
      fromCache: false,
    },
    current: null,
    hourly,
    daily: [],
  };
}

test("the window runs from 07:00 KST through the stamp at midnight that ends the capture's date", () => {
  const hours = morningWindowHours(snapshot("open-meteo", [
    hour("2026-10-22T06:00:00+09:00", 90),
    hour("2026-10-22T07:00:00+09:00", 10),
    // The same instant written in UTC still lands inside the window.
    hour("2026-10-22T14:00:00Z", 30),
    hour("2026-10-22T23:00:00+09:00", 20),
    // Open-Meteo and KMA stamp the hour that ends then: 23:00–24:00 is the day's.
    hour("2026-10-23T00:00:00+09:00", 95),
    hour("2026-10-23T01:00:00+09:00", 80),
  ]), "2026-10-22");

  assert.deepEqual(hours.map((entry) => entry.time), [
    "2026-10-22T07:00:00+09:00",
    "2026-10-22T14:00:00Z",
    "2026-10-22T23:00:00+09:00",
    "2026-10-23T00:00:00+09:00",
  ]);
});

test("the Evening Slot freezes all of tomorrow, in its own record", async () => {
  const store = new InMemoryPerformanceStore();
  await store.syncStations([station], "2026-10-28");
  const result = await captureStationEveningForecast({
    station,
    now: new Date("2026-10-28T19:30:00+09:00"),
    store,
    readForecasts: async () => [
      snapshot("open-meteo", [
        hour("2026-10-28T23:00:00+09:00", 90),
        hour("2026-10-29T00:00:00+09:00", 10),
        hour("2026-10-29T15:00:00+09:00", 60),
        hour("2026-10-30T00:00:00+09:00", 20),
        hour("2026-10-30T01:00:00+09:00", 95),
      ]),
    ],
  });

  assert.equal(result.status, "inserted");
  assert.equal(result.capture?.targetDate, "2026-10-29");
  assert.equal(result.capture?.windowStartHour, 0);
  assert.deepEqual(result.capture?.providers[0].hours.map((entry) => entry.time), [
    "2026-10-29T00:00:00+09:00",
    "2026-10-29T15:00:00+09:00",
    "2026-10-30T00:00:00+09:00",
  ]);
  assert.equal(result.capture?.providers[0].probability, 60);
  assert.equal((await store.loadEveningCaptures("108")).length, 1);
  assert.deepEqual(await store.loadMorningCaptures("108"), []);
});

test("a provider's window chance is its highest hour, and the equal blend averages providers", async () => {
  const store = new InMemoryPerformanceStore();
  await store.syncStations([station], "2026-10-22");
  const result = await captureStationMorningForecast({
    station,
    now: SEVEN_AM,
    store,
    readForecasts: async () => [
      snapshot("open-meteo", [
        hour("2026-10-22T07:00:00+09:00", 10, 0),
        hour("2026-10-22T15:00:00+09:00", 70, 2.5),
        hour("2026-10-23T03:00:00+09:00", 100, 9),
      ]),
      snapshot("kma", [
        hour("2026-10-22T08:00:00+09:00", 30),
        hour("2026-10-22T18:00:00+09:00", 30),
      ]),
    ],
  });

  assert.equal(result.status, "inserted");
  assert.deepEqual(
    result.capture?.providers.map((forecast) => [forecast.provider, forecast.probability, forecast.hours.length]),
    [["open-meteo", 70, 2], ["kma", 30, 2]],
  );
  assert.equal(result.capture?.equalProbability, 50);
  assert.equal(result.capture?.targetDate, "2026-10-22");
  assert.equal(result.capture?.windowStartHour, 7);
  assert.equal(result.capture?.providers[0].hours[1].amountMm, 2.5);
});

test("a provider with no chance inside the window is left out rather than counted as dry", async () => {
  const store = new InMemoryPerformanceStore();
  await store.syncStations([station], "2026-10-22");
  const result = await captureStationMorningForecast({
    station,
    now: SEVEN_AM,
    store,
    readForecasts: async () => [
      snapshot("open-meteo", [hour("2026-10-22T09:00:00+09:00", 60)]),
      snapshot("weather-api", [hour("2026-10-22T09:00:00+09:00", null)]),
      snapshot("pirate-weather", []),
    ],
  });

  assert.deepEqual(result.capture?.providers.map((forecast) => forecast.provider), ["open-meteo"]);
  assert.equal(result.capture?.equalProbability, 60);
});

test("a provider that could not be read refuses the capture instead of storing a short one", async () => {
  const store = new InMemoryPerformanceStore();
  await store.syncStations([station], "2026-10-22");
  const result = await captureStationMorningForecast({
    station,
    now: SEVEN_AM,
    store,
    readForecasts: async () => [
      snapshot("open-meteo", [hour("2026-10-22T09:00:00+09:00", 60)]),
      snapshot("kma", [], "error"),
      snapshot("pirate-weather", [], "needs-config"),
    ],
  });

  assert.equal(result.status, "faulted");
  assert.deepEqual(result.faultedProviders, [{ provider: "kma", message: "kma timed out" }]);
  assert.deepEqual(await store.loadMorningCaptures("108"), []);
});

test("nothing in the window skips the station without storing anything", async () => {
  const store = new InMemoryPerformanceStore();
  await store.syncStations([station], "2026-10-22");
  const result = await captureStationMorningForecast({
    station,
    now: SEVEN_AM,
    store,
    readForecasts: async () => [snapshot("open-meteo", [hour("2026-10-23T09:00:00+09:00", 60)])],
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "no-window-probability");
  assert.deepEqual(await store.loadMorningCaptures("108"), []);
});

test("a later read never replaces the morning's frozen forecast", async () => {
  const store = new InMemoryPerformanceStore();
  await store.syncStations([station], "2026-10-22");
  const read = (probability: number) => async () => [
    snapshot("open-meteo", [hour("2026-10-22T12:00:00+09:00", probability)]),
  ];
  const first = await captureStationMorningForecast({ station, now: SEVEN_AM, store, readForecasts: read(20) });
  const retry = await captureStationMorningForecast({
    station,
    now: new Date("2026-10-22T07:25:00+09:00"),
    store,
    readForecasts: read(90),
  });

  assert.equal(first.status, "inserted");
  assert.equal(retry.status, "existing");
  const [stored] = await store.loadMorningCaptures("108");
  assert.equal(stored.providers[0].probability, 20);
  assert.equal(stored.capturedAt, SEVEN_AM.toISOString());
});

test("the Morning Slot never reads Pirate Weather, whose free quota covers only the cohorts", async () => {
  assert.deepEqual(
    morningProviders.map((provider) => provider.id),
    ["open-meteo", "kma", "weather-api", "visual-crossing"],
  );
  // Even handed one, a Pirate Weather snapshot neither counts nor faults the capture.
  const store = new InMemoryPerformanceStore();
  await store.syncStations([station], "2026-10-22");
  const result = await captureStationMorningForecast({
    station,
    now: SEVEN_AM,
    store,
    readForecasts: async () => [
      snapshot("open-meteo", [hour("2026-10-22T09:00:00+09:00", 40)]),
      snapshot("pirate-weather", [], "error"),
    ],
  });
  assert.equal(result.status, "inserted");
  assert.deepEqual(result.capture?.providers.map((forecast) => forecast.provider), ["open-meteo"]);
});

test("a band is captured as a band, and only where no amount is stated", async () => {
  const store = new InMemoryPerformanceStore();
  await store.syncStations([station], "2026-10-22");
  const banded = (time: string, amount: number | null, range: HourlyForecast["precipitationAmountRange"]) =>
    ({ ...hour(time, 60, amount), precipitationAmountRange: range });
  const result = await captureStationMorningForecast({
    station,
    now: SEVEN_AM,
    store,
    readForecasts: async () => [
      snapshot("kma", [
        banded("2026-10-22T08:00:00+09:00", null, { lowMm: 0, highMm: 1 }),
        banded("2026-10-22T09:00:00+09:00", null, { lowMm: 50, highMm: null }),
        banded("2026-10-22T10:00:00+09:00", 2, null),
        banded("2026-10-22T11:00:00+09:00", null, { lowMm: 5, highMm: 1 }),
      ]),
    ],
  });

  assert.deepEqual(
    result.capture?.providers[0].hours.map((h) => [h.amountMm, h.amountRangeMm ?? null]),
    [[null, { lowMm: 0, highMm: 1 }], [null, { lowMm: 50, highMm: null }], [2, null], [null, null]],
  );
});
