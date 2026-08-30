import assert from "node:assert/strict";
import test from "node:test";
import type { ForecastLocation } from "../location.ts";
import type { ProviderSnapshot } from "../types.ts";
import { captureStationForecast } from "./capture.ts";
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

function snapshot(
  id: ProviderSnapshot["id"],
  probability: number | null,
  amountMm?: number | null,
): ProviderSnapshot {
  return {
    id,
    status: {
      id,
      name: id,
      availability: "ok",
      message: "ok",
      missingEnvVars: [],
      lastUpdated: "2026-08-13T06:00:00+09:00",
      fromCache: false,
    },
    current: null,
    hourly: [],
    daily: [{
      date: "2026-08-14",
      temperatureMax: 30,
      temperatureMin: 24,
      precipitationProbability: probability,
      precipitationAmount: amountMm,
      condition: "rain",
      sunrise: null,
      sunset: null,
    }],
  };
}

test("fixed-cohort capture freezes the serving blend and is idempotent", async () => {
  const store = new InMemoryPerformanceStore();
  await store.syncStations([station], "2026-08-13");
  const seenLocations: ForecastLocation[] = [];
  const readForecasts = async (location: ForecastLocation): Promise<ProviderSnapshot[]> => {
    seenLocations.push(location);
    return [
      snapshot("open-meteo", 80, 7),
      snapshot("kma", 40),
      snapshot("met-norway", null),
    ];
  };

  const first = await captureStationForecast({
    station,
    cohort: "06",
    now: new Date("2026-08-13T06:10:00+09:00"),
    store,
    readForecasts,
  });
  const retry = await captureStationForecast({
    station,
    cohort: "06",
    now: new Date("2026-08-13T06:20:00+09:00"),
    store,
    readForecasts,
  });

  assert.equal(first.status, "inserted");
  assert.equal(retry.status, "existing");
  assert.equal(first.capture?.targetDate, "2026-08-14");
  assert.equal(first.capture?.frozenBlend.equalProbability, 60);
  assert.equal(first.capture?.frozenBlend.adaptiveProbability, 60);
  assert.deepEqual(first.capture?.providers, [
    { provider: "open-meteo", probability: 80, amountMm: 7 },
    { provider: "kma", probability: 40, amountMm: null },
  ]);
  assert.equal(seenLocations[0]?.latitude, station.latitude);
  assert.equal((await store.loadCaptures("108", "06")).length, 1);
});

test("capture skips a station when no provider has a valid next-day probability", async () => {
  const store = new InMemoryPerformanceStore();
  const result = await captureStationForecast({
    station,
    cohort: "18",
    now: new Date("2026-08-13T18:10:00+09:00"),
    store,
    readForecasts: async () => [snapshot("open-meteo", null)],
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "no-next-day-probability");
});

test("insufficient historical evidence keeps all current providers equally weighted", async () => {
  const store = new InMemoryPerformanceStore();
  await store.syncStations([station], "2026-08-13");
  await store.saveCapture({
    stationId: station.id,
    targetDate: "2026-08-01",
    cohort: "06",
    capturedAt: "2026-07-31T06:10:00+09:00",
    providers: [{ provider: "open-meteo", probability: 40, amountMm: null }],
    frozenBlend: {
      adaptiveProbability: 40,
      equalProbability: 40,
      influence: { "open-meteo": 1 },
    },
  });
  await store.saveObservation({
    stationId: station.id,
    date: "2026-08-01",
    observedMm: 0,
    observedAt: "2026-08-02T06:10:00+09:00",
    source: "kma-asos",
  });

  const result = await captureStationForecast({
    station,
    cohort: "06",
    now: new Date("2026-08-13T06:10:00+09:00"),
    store,
    readForecasts: async () => [snapshot("open-meteo", 80), snapshot("kma", 40)],
  });

  assert.deepEqual(result.capture?.frozenBlend.influence, { "open-meteo": 0.5, kma: 0.5 });
});

test("a provider that faulted is never frozen as a provider with nothing to publish", async () => {
  // The 18 KST cohort spent three evenings storing 97 captures whose KMA entry was
  // simply missing, because a runner could not reach Korea at all. A capture short
  // one provider by fault reads exactly like one short a provider that published
  // nothing, and `saveCapture` never overwrites, so a retry could not repair it.
  const store = new InMemoryPerformanceStore();
  await store.syncStations([station], "2026-08-13");
  const faulted = snapshot("kma", null);
  faulted.status.availability = "error";
  faulted.status.message = "fetch failed";
  faulted.daily = [];

  const result = await captureStationForecast({
    station,
    cohort: "18",
    now: new Date("2026-08-13T18:10:00+09:00"),
    store,
    readForecasts: async () => [
      snapshot("open-meteo", 80, 7),
      faulted,
      snapshot("pirate-weather", 55),
      snapshot("weather-api", 60),
    ],
  });

  assert.equal(result.status, "faulted");
  assert.equal(result.reason, "provider-fault");
  assert.equal(result.capture, null);
  assert.deepEqual(result.faultedProviders, ["kma"]);
  assert.deepEqual(
    await store.loadCaptures(station.id, "18"),
    [],
    "a degraded capture must not be stored, so a fresh runner can still write a whole one",
  );
});

test("a provider missing its credentials is an absence, not a fault", async () => {
  // `needs-config` is permanent and honest: the key is not there, and no retry on
  // any runner will make it appear. Refusing the capture for it would leave a local
  // or partially configured deployment unable to capture anything at all.
  const store = new InMemoryPerformanceStore();
  await store.syncStations([station], "2026-08-13");
  const unconfigured = snapshot("weather-api", null);
  unconfigured.status.availability = "needs-config";
  unconfigured.status.missingEnvVars = ["WEATHERAPI_KEY"];
  unconfigured.daily = [];

  const result = await captureStationForecast({
    station,
    cohort: "06",
    now: new Date("2026-08-13T06:10:00+09:00"),
    store,
    readForecasts: async () => [snapshot("open-meteo", 80), snapshot("kma", 40), unconfigured],
  });

  assert.equal(result.status, "inserted");
  assert.deepEqual(result.faultedProviders, []);
  assert.deepEqual(
    result.capture?.providers.map((forecast) => forecast.provider),
    ["open-meteo", "kma"],
  );
});

test("a provider outside the compared set cannot fault a capture", async () => {
  // MET Norway is in the id union for stored history only. A snapshot for a
  // provider the capture would never freeze must not be able to fail the run.
  const store = new InMemoryPerformanceStore();
  await store.syncStations([station], "2026-08-13");
  const stranger = snapshot("met-norway", null);
  stranger.status.availability = "error";

  const result = await captureStationForecast({
    station,
    cohort: "06",
    now: new Date("2026-08-13T06:10:00+09:00"),
    store,
    readForecasts: async () => [snapshot("open-meteo", 80), snapshot("kma", 40), stranger],
  });

  assert.equal(result.status, "inserted");
  assert.deepEqual(result.faultedProviders, []);
});
