import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderSnapshot } from "../types.ts";
import { OUTAGE_EVIDENCE_THRESHOLD, runPerformanceBatch } from "./batch.ts";
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

function faultSnapshot(): ProviderSnapshot {
  return {
    ...forecastSnapshot(),
    status: {
      ...forecastSnapshot().status,
      availability: "error",
      message: "connection timed out",
      lastUpdated: null,
    },
    daily: [],
  };
}

function observed(stationId: string, date: string, now: Date) {
  return {
    status: "observed" as const,
    observation: {
      stationId,
      date,
      observedMm: 1.2,
      observedAt: now.toISOString(),
      source: "kma-asos" as const,
    },
  };
}

test("a partial transport outage retries only the early failed reads after later stations recover", async () => {
  const store = new InMemoryPerformanceStore();
  const observationCalls = new Map<string, number>();
  const forecastCalls = new Map<string, number>();
  const events: string[] = [];
  const retryWaits: number[] = [];

  const result = await runPerformanceBatch({
    cohort: "18",
    now: new Date("2026-08-13T18:10:00+09:00"),
    store,
    fetchStations: async () => stations,
    fetchObservation: async (stationId, date, now) => {
      const call = (observationCalls.get(stationId) ?? 0) + 1;
      observationCalls.set(stationId, call);
      events.push(`observation:${stationId}:${date}:${call}`);
      if (stationId === "108" && call === 1) {
        return { status: "failed", reason: "connection timed out", retryable: true };
      }
      return observed(stationId, date, now);
    },
    readForecasts: async (location) => {
      const stationId = stations.find((station) => station.name === location.name)!.id;
      const call = (forecastCalls.get(stationId) ?? 0) + 1;
      forecastCalls.set(stationId, call);
      events.push(`forecast:${stationId}:2026-08-14:${call}`);
      return stationId === "108" && call === 1 ? [faultSnapshot()] : [forecastSnapshot()];
    },
    concurrency: 1,
    retryDelay: async (ms) => { retryWaits.push(ms); },
  });

  assert.equal(result.observationsStored, 2);
  assert.equal(result.observationsFailed, 0);
  assert.equal(result.capturesInserted, 2);
  assert.equal(result.capturesFaulted, 0);
  assert.equal(result.observationsRecovered, 1);
  assert.equal(result.capturesRecovered, 1);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(retryWaits, [31_000], "both phases share one wait beyond the cache cooldown");
  assert.deepEqual(Object.fromEntries(observationCalls), { "108": 2, "159": 1 });
  assert.deepEqual(Object.fromEntries(forecastCalls), { "108": 2, "159": 1 });
  assert.deepEqual(events.slice(-2), [
    "observation:108:2026-08-12:2",
    "forecast:108:2026-08-14:2",
  ], "the failed station keeps observation-before-capture ordering and dates on retry");
  assert.equal((await store.loadObservations("108")).length, 1, "recovery stores one observation");
  assert.equal((await store.loadCaptures("108", "18")).length, 1, "recovery stores one immutable capture");
  assert.equal((await store.loadObservations("108"))[0]?.date, "2026-08-12");
  assert.equal((await store.loadCaptures("108", "18"))[0]?.targetDate, "2026-08-14");
});

test("a persistent transport outage remains failed without a blind retry", async () => {
  let observationCalls = 0;
  let forecastCalls = 0;
  const result = await runPerformanceBatch({
    cohort: "18",
    now: new Date("2026-08-13T18:10:00+09:00"),
    store: new InMemoryPerformanceStore(),
    fetchStations: async () => [stations[0]],
    fetchObservation: async () => {
      observationCalls += 1;
      return { status: "failed", reason: "connection timed out", retryable: true };
    },
    readForecasts: async () => {
      forecastCalls += 1;
      return [faultSnapshot()];
    },
    concurrency: 1,
  });

  assert.equal(observationCalls, 1, "without later observation progress a blind retry cannot help");
  assert.equal(forecastCalls, 1, "without later capture progress a blind retry cannot help");
  assert.equal(result.observationsFailed, 1);
  assert.equal(result.capturesFaulted, 1);
  assert.deepEqual(result.failures.map(({ phase, kind }) => ({ phase, kind })), [
    { phase: "observation", kind: "error" },
    { phase: "capture", kind: "provider-fault" },
  ]);
});

test("a phase that fails last is not retried without evidence of later recovery", async () => {
  const observationCalls = new Map<string, number>();
  const forecastCalls = new Map<string, number>();
  const result = await runPerformanceBatch({
    cohort: "18",
    now: new Date("2026-08-13T18:10:00+09:00"),
    store: new InMemoryPerformanceStore(),
    fetchStations: async () => stations,
    fetchObservation: async (stationId, date, now) => {
      observationCalls.set(stationId, (observationCalls.get(stationId) ?? 0) + 1);
      return stationId === "159"
        ? { status: "failed", reason: "connection timed out", retryable: true }
        : observed(stationId, date, now);
    },
    readForecasts: async (location) => {
      const stationId = stations.find((station) => station.name === location.name)!.id;
      forecastCalls.set(stationId, (forecastCalls.get(stationId) ?? 0) + 1);
      return stationId === "159" ? [faultSnapshot()] : [forecastSnapshot()];
    },
    concurrency: 1,
    retryDelay: async () => assert.fail("a last failure must not start the recovery pass"),
  });

  assert.deepEqual(Object.fromEntries(observationCalls), { "108": 1, "159": 1 });
  assert.deepEqual(Object.fromEntries(forecastCalls), { "108": 1, "159": 1 });
  assert.equal(result.observationsFailed, 1);
  assert.equal(result.capturesFaulted, 1);
});

test("resolved absence and skip count as recovery without claiming stored evidence", async () => {
  const observationCalls = new Map<string, number>();
  const forecastCalls = new Map<string, number>();
  const emptyForecast = { ...forecastSnapshot(), daily: [] };
  const store = new InMemoryPerformanceStore();
  const result = await runPerformanceBatch({
    cohort: "18",
    now: new Date("2026-08-13T18:10:00+09:00"),
    store,
    fetchStations: async () => stations,
    fetchObservation: async (stationId, date, now) => {
      const call = (observationCalls.get(stationId) ?? 0) + 1;
      observationCalls.set(stationId, call);
      if (stationId === "108") {
        return call === 1
          ? { status: "failed", reason: "connection timed out", retryable: true }
          : { status: "absent" };
      }
      return observed(stationId, date, now);
    },
    readForecasts: async (location) => {
      const stationId = stations.find((station) => station.name === location.name)!.id;
      const call = (forecastCalls.get(stationId) ?? 0) + 1;
      forecastCalls.set(stationId, call);
      if (stationId === "108") return call === 1 ? [faultSnapshot()] : [emptyForecast];
      return [forecastSnapshot()];
    },
    concurrency: 1,
    retryDelay: async () => {},
  });

  assert.equal(result.observationsRecovered, 1);
  assert.equal(result.capturesRecovered, 1);
  assert.equal(result.observationsStored, 1);
  assert.equal(result.observationsAbsent, 1);
  assert.equal(result.capturesInserted, 1);
  assert.equal(result.capturesSkipped, 1);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(await store.loadObservations("108"), []);
  assert.deepEqual(await store.loadCaptures("108", "18"), []);
});

test("an absent observation is not repeated when only its capture needs recovery", async () => {
  const observationCalls = new Map<string, number>();
  const forecastCalls = new Map<string, number>();
  const result = await runPerformanceBatch({
    cohort: "18",
    now: new Date("2026-08-13T18:10:00+09:00"),
    store: new InMemoryPerformanceStore(),
    fetchStations: async () => stations,
    fetchObservation: async (stationId) => {
      observationCalls.set(stationId, (observationCalls.get(stationId) ?? 0) + 1);
      return { status: "absent" };
    },
    readForecasts: async (location) => {
      const stationId = stations.find((station) => station.name === location.name)!.id;
      const call = (forecastCalls.get(stationId) ?? 0) + 1;
      forecastCalls.set(stationId, call);
      return stationId === "108" && call === 1 ? [faultSnapshot()] : [forecastSnapshot()];
    },
    concurrency: 1,
    retryDelay: async () => {},
  });

  assert.deepEqual(Object.fromEntries(observationCalls), { "108": 1, "159": 1 });
  assert.deepEqual(Object.fromEntries(forecastCalls), { "108": 2, "159": 1 });
  assert.equal(result.observationsAbsent, 2);
  assert.equal(result.capturesInserted, 2);
  assert.equal(result.capturesRecovered, 1);
  assert.deepEqual(result.failures, []);
});

test("database write errors are reported once and are never retried as transport failures", async () => {
  class FailingWriteStore extends InMemoryPerformanceStore {
    override async saveObservation(): Promise<void> {
      throw new Error("observation database unavailable");
    }
    override async saveCapture(): Promise<"inserted"> {
      throw new Error("capture database unavailable");
    }
  }
  let observationCalls = 0;
  let forecastCalls = 0;
  const result = await runPerformanceBatch({
    cohort: "18",
    now: new Date("2026-08-13T18:10:00+09:00"),
    store: new FailingWriteStore(),
    fetchStations: async () => [stations[0]],
    fetchObservation: async (stationId, date, now) => {
      observationCalls += 1;
      return observed(stationId, date, now);
    },
    readForecasts: async () => {
      forecastCalls += 1;
      return [forecastSnapshot()];
    },
    concurrency: 1,
  });

  assert.equal(observationCalls, 1);
  assert.equal(forecastCalls, 1);
  assert.equal(result.observationsFailed, 1);
  assert.deepEqual(result.failures.map((failure) => failure.message), [
    "observation database unavailable",
    "capture database unavailable",
  ]);
});

test("a successful existing capture is not repeated while its observation recovers", async () => {
  const store = new InMemoryPerformanceStore();
  const now = new Date("2026-08-13T18:10:00+09:00");
  await runPerformanceBatch({
    cohort: "18",
    now,
    store,
    fetchStations: async () => stations,
    fetchObservation: async (stationId, date, at) => observed(stationId, date, at),
    readForecasts: async () => [forecastSnapshot()],
    concurrency: 1,
  });

  let observationCalls = 0;
  let forecastCalls = 0;
  const result = await runPerformanceBatch({
    cohort: "18",
    now,
    store,
    fetchStations: async () => stations,
    fetchObservation: async (stationId, date, at) => {
      observationCalls += 1;
      return stationId === "108" && observationCalls === 1
        ? { status: "failed", reason: "connection timed out", retryable: true }
        : observed(stationId, date, at);
    },
    readForecasts: async () => {
      forecastCalls += 1;
      return [forecastSnapshot()];
    },
    concurrency: 1,
    retryDelay: async () => {},
  });

  assert.equal(observationCalls, 3);
  assert.equal(forecastCalls, 2);
  assert.equal(result.observationsStored, 2);
  assert.equal(result.observationsRecovered, 1);
  assert.equal(result.capturesExisting, 2);
  assert.deepEqual(result.failures, []);
  assert.equal((await store.loadCaptures("108", "18")).length, 1);
});

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
    observationsRecovered: 0,
    observationsAbandoned: 0,
    capturesInserted: 2,
    capturesExisting: 0,
    capturesSkipped: 0,
    capturesFaulted: 0,
    capturesRecovered: 0,
    capturesAbandoned: 0,
    abandonedReason: null,
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

/**
 * The #175 defect. During a KMA outage every station pays three 15s ASOS attempts
 * with backoff and a 10s provider timeout — roughly 47s — and the batch walks all
 * 97 of them at concurrency 4. Five separate failed runs spent 1139, 1141, 1141,
 * 1139 and 1141 seconds: an outage does not land within two seconds of itself five
 * times, so that number is the collector's own cost, not the route's.
 *
 * The consequence is not just a slow run. `local-performance.yml` aims its attempts
 * at +0/+10/+25 minutes, but attempt 1 does not *return* until +19, so the samples
 * actually land at 0/19/38 and the spacing #169 added never runs. Making a proven
 * outage cheap to detect is what lets the route be sampled more than twice.
 */
const manyStations = (count: number): ObservationStation[] =>
  Array.from({ length: count }, (_, index) => ({
    ...stations[0],
    id: String(200 + index),
    name: `관측소${index}`,
  }));

test("a source proven down stops being called instead of being re-proven station by station", async () => {
  let observationCalls = 0;
  let forecastCalls = 0;
  const all = manyStations(40);
  const result = await runPerformanceBatch({
    cohort: "18",
    now: new Date("2026-08-13T18:10:00+09:00"),
    store: new InMemoryPerformanceStore(),
    fetchStations: async () => all,
    fetchObservation: async () => {
      observationCalls += 1;
      return { status: "failed", reason: "connection timed out", retryable: true };
    },
    readForecasts: async () => {
      forecastCalls += 1;
      return [faultSnapshot()];
    },
    concurrency: 1,
  });

  assert.ok(
    observationCalls <= OUTAGE_EVIDENCE_THRESHOLD,
    `ASOS was called ${observationCalls} times to establish one outage`,
  );
  assert.ok(
    forecastCalls <= OUTAGE_EVIDENCE_THRESHOLD,
    `providers were read ${forecastCalls} times to establish one outage`,
  );
  // What was never attempted must be counted as such, never as a read that failed
  // and never as an absence: `observationsAbsent` is a claim about the weather record.
  assert.equal(result.observationsAbandoned, all.length - OUTAGE_EVIDENCE_THRESHOLD);
  assert.equal(result.capturesAbandoned, all.length - OUTAGE_EVIDENCE_THRESHOLD);
  assert.equal(result.observationsAbsent, 0);
  assert.equal(result.observationsFailed, OUTAGE_EVIDENCE_THRESHOLD);
  assert.match(result.abandonedReason ?? "", /observation/);
  assert.match(result.abandonedReason ?? "", /capture/);
});

/**
 * The invariant that makes abandoning safe: one success anywhere proves the source
 * is reachable, so the pass must keep walking. Without this a thirty-second blip at
 * the head of a run would discard the 85 stations that came after it.
 */
test("a single success anywhere keeps a flaking source in play", async () => {
  let observationCalls = 0;
  const all = manyStations(40);
  const result = await runPerformanceBatch({
    cohort: "18",
    now: new Date("2026-08-13T18:10:00+09:00"),
    store: new InMemoryPerformanceStore(),
    fetchStations: async () => all,
    fetchObservation: async (stationId, date, now) => {
      observationCalls += 1;
      // The very first station answers; every later one fails on transport.
      return stationId === all[0].id
        ? observed(stationId, date, now)
        : { status: "failed" as const, reason: "connection timed out", retryable: true };
    },
    readForecasts: async () => [forecastSnapshot()],
    concurrency: 1,
    retryDelay: async () => {},
  });

  assert.equal(observationCalls >= all.length, true, "a reachable source must not be abandoned");
  assert.equal(result.observationsAbandoned, 0);
  assert.equal(result.capturesAbandoned, 0);
  assert.equal(result.abandonedReason, null);
});
