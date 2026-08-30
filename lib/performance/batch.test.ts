import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderSnapshot } from "../types.ts";
import { runPerformanceBatch } from "./batch.ts";
import { InMemoryPerformanceStore } from "./store.ts";
import type { ObservationStation } from "./types.ts";

const stations: ObservationStation[] = [
  {
    id: "108",
    name: "서울",
    network: "ASOS",
    latitude: 37.5714,
    longitude: 126.9658,
    elevationM: 85.7,
    activeFrom: "2026-01-01",
    activeTo: null,
  },
  {
    id: "159",
    name: "부산",
    network: "ASOS",
    latitude: 35.1047,
    longitude: 129.032,
    elevationM: 69.6,
    activeFrom: "2026-01-01",
    activeTo: null,
  },
];

function forecastSnapshot(): ProviderSnapshot {
  return {
    id: "open-meteo",
    status: {
      id: "open-meteo",
      name: "Open-Meteo",
      availability: "ok",
      message: "ok",
      missingEnvVars: [],
      lastUpdated: "2026-08-13T18:00:00+09:00",
      fromCache: false,
    },
    current: null,
    hourly: [],
    daily: [{
      date: "2026-08-14",
      temperatureMax: 30,
      temperatureMin: 24,
      precipitationProbability: 35,
      condition: "partly-cloudy",
      sunrise: null,
      sunset: null,
    }],
  };
}

test("nationwide batch stores yesterday's observation before an idempotent next-day capture", async () => {
  const store = new InMemoryPerformanceStore();
  const result = await runPerformanceBatch({
    cohort: "18",
    now: new Date("2026-08-13T18:10:00+09:00"),
    store,
    fetchStations: async () => stations,
    fetchObservation: async (stationId, date, now) => ({
      status: "observed",
      observation: {
        stationId,
        date,
        observedMm: stationId === "108" ? 0 : 4.2,
        observedAt: now.toISOString(),
        source: "kma-asos",
      },
    }),
    readForecasts: async () => [forecastSnapshot()],
    concurrency: 2,
  });

  assert.deepEqual(result, {
    stationCount: 2,
    observationsStored: 2,
    capturesInserted: 2,
    capturesExisting: 0,
    capturesSkipped: 0,
    capturesFaulted: 0,
    failures: [],
    catalogSource: "kma",
    catalogError: null,
    observationsAbsent: 0,
    observationsFailed: 0,
  });
  assert.equal((await store.loadObservations("159"))[0]?.date, "2026-08-12");
  assert.equal((await store.loadCaptures("159", "18"))[0]?.targetDate, "2026-08-14");

  const retry = await runPerformanceBatch({
    cohort: "18",
    now: new Date("2026-08-13T18:20:00+09:00"),
    store,
    fetchStations: async () => stations,
    fetchObservation: async () => ({ status: "absent" }),
    readForecasts: async () => [forecastSnapshot()],
    concurrency: 2,
  });
  assert.equal(retry.capturesExisting, 2);
  assert.equal((await store.loadCaptures("159", "18")).length, 1);
});

test("an unreachable station catalog falls back to the stations already recorded", async () => {
  // The catalog is the cohort's only apihub call — the forecast captures and the
  // ASOS observations reach different hosts entirely. A runner that cannot resolve
  // apihub used to discard a whole cohort of captures that never needed it.
  class SyncCountingStore extends InMemoryPerformanceStore {
    syncCalls = 0;
    override async syncStations(
      catalog: readonly ObservationStation[],
      catalogDate: string,
    ): Promise<void> {
      this.syncCalls += 1;
      return super.syncStations(catalog, catalogDate);
    }
  }
  const store = new SyncCountingStore();
  await store.syncStations(stations, "2026-08-13");
  const syncsBeforeRun = store.syncCalls;

  const result = await runPerformanceBatch({
    cohort: "18",
    now: new Date("2026-08-13T18:10:00+09:00"),
    store,
    fetchStations: async () => {
      throw new TypeError("fetch failed");
    },
    fetchObservation: async () => ({ status: "absent" }),
    readForecasts: async () => [forecastSnapshot()],
    concurrency: 2,
  });

  assert.equal(result.catalogSource, "store");
  assert.match(result.catalogError ?? "", /fetch failed/);
  assert.equal(result.stationCount, 2);
  assert.equal(result.capturesInserted, 2, "the cohort is captured despite the dead catalog");
  assert.deepEqual(result.failures, []);
  assert.equal(
    store.syncCalls,
    syncsBeforeRun,
    "a catalog we could not read must not drive retirement decisions",
  );
});

test("a dead catalog with nothing recorded yet still fails rather than reporting an empty cohort", async () => {
  // On a first run there is no recorded station set to fall back to, and a batch
  // that quietly reports zero stations would look like a successful empty cohort.
  const store = new InMemoryPerformanceStore();
  await assert.rejects(
    () => runPerformanceBatch({
      cohort: "06",
      now: new Date("2026-08-13T06:10:00+09:00"),
      store,
      fetchStations: async () => {
        throw new TypeError("fetch failed");
      },
      fetchObservation: async () => ({ status: "absent" }),
      readForecasts: async () => [forecastSnapshot()],
    }),
    /fetch failed/,
  );
});

test("retired stations are not resurrected by the fallback", async () => {
  const store = new InMemoryPerformanceStore();
  await store.syncStations(stations, "2026-08-13");
  // 부산 leaves the catalog on the next successful sync.
  await store.syncStations([stations[0]], "2026-08-14");

  const result = await runPerformanceBatch({
    cohort: "18",
    now: new Date("2026-08-14T18:10:00+09:00"),
    store,
    fetchStations: async () => {
      throw new TypeError("fetch failed");
    },
    fetchObservation: async () => ({ status: "absent" }),
    readForecasts: async () => [forecastSnapshot()],
  });

  assert.equal(result.catalogSource, "store");
  assert.equal(result.stationCount, 1, "only the still-active station is captured");
});

test("an observation that could not be read is reported, and an absent one is not", async () => {
  // A green run once stored 10 of 97 observations with `failures: []`, because a
  // refused request and a station with no row were the same bare null.
  const store = new InMemoryPerformanceStore();
  const result = await runPerformanceBatch({
    cohort: "18",
    now: new Date("2026-08-13T18:10:00+09:00"),
    store,
    fetchStations: async () => stations,
    fetchObservation: async (stationId) => stationId === "108"
      ? { status: "failed", reason: "rate-limited — resultCode 22" }
      : { status: "absent" },
    readForecasts: async () => [forecastSnapshot()],
  });

  assert.equal(result.observationsStored, 0);
  assert.equal(result.observationsFailed, 1);
  assert.equal(result.observationsAbsent, 1);
  assert.deepEqual(result.failures, [
    {
      stationId: "108",
      phase: "observation",
      kind: "error",
      message: "rate-limited — resultCode 22",
    },
  ]);
  // The forecasts never needed the observation service, so they are still captured.
  assert.equal(result.capturesInserted, 2);
});

test("a failed observation never reaches the store as a reading", async () => {
  const store = new InMemoryPerformanceStore();
  await runPerformanceBatch({
    cohort: "18",
    now: new Date("2026-08-13T18:10:00+09:00"),
    store,
    fetchStations: async () => stations,
    fetchObservation: async () => ({ status: "failed", reason: "fetch failed" }),
    readForecasts: async () => [forecastSnapshot()],
  });
  assert.deepEqual(await store.loadObservations("108"), [], "a fault must not be scored as 0 mm");
});

test("the 06 cohort reads a day ASOS has already published rather than yesterday", async () => {
  // ASOS compiles a calendar day's summary hours after midnight. Every scheduled
  // 06 KST run asking for yesterday found 5, 10, 15, 17 and 19 of 97 rows on
  // consecutive days, while every 18 KST run at the same one-day offset found 97 —
  // and one manual 06 cohort run at midday found 97 too. The unpublished rows come
  // back as NODATA, which the read reports as `absent`, so the early cohort was
  // claiming up to 92 station-days a day had no record when they simply had not been
  // compiled yet. Reaching one day further back keeps both cohorts on a published
  // day and turns the second read of a date into a real second chance.
  const requested: string[] = [];
  const readObservationDate = async (cohort: "06" | "18", now: Date): Promise<string> => {
    requested.length = 0;
    await runPerformanceBatch({
      cohort,
      now,
      store: new InMemoryPerformanceStore(),
      fetchStations: async () => stations,
      fetchObservation: async (_stationId, date) => {
        requested.push(date);
        return { status: "absent" };
      },
      readForecasts: async () => [forecastSnapshot()],
      concurrency: 1,
    });
    return requested[0];
  };

  assert.equal(await readObservationDate("06", new Date("2026-08-25T06:10:00+09:00")), "2026-08-23");
  assert.equal(await readObservationDate("18", new Date("2026-08-25T18:10:00+09:00")), "2026-08-24");
});

test("a cohort that could not reach a provider fails rather than storing a short capture", async () => {
  const store = new InMemoryPerformanceStore();
  const kmaDown: ProviderSnapshot = {
    id: "kma",
    status: {
      id: "kma",
      name: "기상청",
      availability: "error",
      message: "fetch failed",
      missingEnvVars: [],
      lastUpdated: null,
      fromCache: false,
    },
    current: null,
    hourly: [],
    daily: [],
  };

  const result = await runPerformanceBatch({
    cohort: "18",
    now: new Date("2026-08-13T18:10:00+09:00"),
    store,
    fetchStations: async () => stations,
    fetchObservation: async (stationId) => ({
      status: "observed",
      observation: {
        stationId,
        date: "2026-08-12",
        observedMm: 0,
        observedAt: "2026-08-13T18:10:00+09:00",
        source: "kma-asos",
      },
    }),
    readForecasts: async () => [forecastSnapshot(), kmaDown],
  });

  assert.equal(result.capturesInserted, 0, "no station may store a KMA-less capture");
  assert.equal(result.capturesFaulted, stations.length);
  assert.equal(
    result.failures.filter((failure) => failure.phase === "capture").length,
    stations.length,
    "every faulted capture must be reported, so the run goes red",
  );
  assert.ok(
    result.failures.some((failure) => failure.message.includes("kma")),
    "the failure names the provider that could not be read",
  );
  assert.deepEqual(await store.loadCaptures(stations[0].id, "18"), []);
});
