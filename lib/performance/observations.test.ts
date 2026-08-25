import assert from "node:assert/strict";
import test from "node:test";
import {
  assertObservationWindow,
  isImplausiblyEmpty,
  runObservationBackfill,
  stationsCoveringWindow,
} from "./observations.ts";
import { InMemoryPerformanceStore } from "./store.ts";
import type { ObservationStation, PrecipObservation } from "./types.ts";

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

const NOW = new Date("2026-08-25T10:00:00+09:00");

test("a backfill stores the days ASOS published and counts the ones it has no row for", async () => {
  const store = new InMemoryPerformanceStore();
  await store.initialize();
  await store.syncStations(stations, "2026-08-25");
  const windows: string[] = [];

  const result = await runObservationBackfill({
    stations,
    startDate: "2026-08-21",
    endDate: "2026-08-22",
    now: NOW,
    store,
    // 부산 has a row for one of the two days only. That is a fact about the record,
    // so it is counted rather than stored as a dry day nobody measured.
    fetchObservations: async (stationId, startDate, endDate, now) => {
      windows.push(`${stationId} ${startDate}..${endDate}`);
      const dates = stationId === "108"
        ? [["2026-08-21", 0], ["2026-08-22", 30.4]] as const
        : [["2026-08-22", 49.8]] as const;
      return {
        status: "observed",
        observations: dates.map(([date, observedMm]) => ({
          stationId,
          date,
          observedMm,
          observedAt: now.toISOString(),
          source: "kma-asos" as const,
        })),
      };
    },
    concurrency: 1,
  });

  assert.deepEqual(windows, ["108 2026-08-21..2026-08-22", "159 2026-08-21..2026-08-22"]);
  assert.deepEqual(result, {
    stationCount: 2,
    windowDays: 2,
    observationsStored: 3,
    observationsAbsent: 1,
    failures: [],
  });
  assert.deepEqual(
    (await store.loadObservations("108")).map((observation) => observation.observedMm).sort(),
    [0, 30.4],
  );
  assert.equal((await store.loadObservations("159")).length, 1);
});

test("a station whose window could not be read is reported and stores nothing", async () => {
  // The whole reason this tool exists is that a hole in the record looked filled.
  // A station that answered with a fault must never be counted as absent, or the
  // backfill would report a date covered that nothing ever read.
  const store = new InMemoryPerformanceStore();
  await store.initialize();
  await store.syncStations(stations, "2026-08-25");

  const result = await runObservationBackfill({
    stations,
    startDate: "2026-08-21",
    endDate: "2026-08-22",
    now: NOW,
    store,
    fetchObservations: async (stationId) =>
      stationId === "108"
        ? { status: "failed", reason: "forbidden — the key is not registered" }
        : { status: "observed", observations: [] },
    concurrency: 1,
  });

  assert.equal(result.observationsStored, 0);
  assert.equal(result.observationsAbsent, 2, "only the station that answered is counted absent");
  assert.deepEqual(result.failures, [{
    stationId: "108",
    window: "2026-08-21..2026-08-22",
    message: "forbidden — the key is not registered",
  }]);
  assert.equal((await store.loadObservations("108")).length, 0);
});

test("a backfill refuses a window ASOS cannot have compiled yet", () => {
  // The same publication lag the 06 cohort ran into: asking for a day before ASOS
  // has compiled it returns NODATA, and this tool would record that as an absence —
  // writing the very hole it exists to fill.
  assert.doesNotThrow(() => assertObservationWindow("2026-08-21", "2026-08-23", NOW));
  assert.throws(
    () => assertObservationWindow("2026-08-21", "2026-08-24", NOW),
    /not compiled/,
  );
  assert.throws(() => assertObservationWindow("2026-08-22", "2026-08-21", NOW), /order/);
  assert.throws(() => assertObservationWindow("2026-06-01", "2026-08-23", NOW), /exceeds/);
  assert.throws(() => assertObservationWindow("21 Aug 2026", "2026-08-23", NOW), /YYYY-MM-DD/);
});

test("a station that could not be stored is a fault, not a silently short window", async () => {
  // A dropped write is as much a fault as a dropped read. Letting it reject the worker
  // would take the whole run's summary down with it — including the stations that did
  // land — and the operator would see a stack trace instead of what was repaired.
  class FailingStore extends InMemoryPerformanceStore {
    override async saveObservation(observation: PrecipObservation): Promise<void> {
      if (observation.stationId === "159") throw new Error("connection terminated");
      await super.saveObservation(observation);
    }
  }
  const store = new FailingStore();
  await store.initialize();
  await store.syncStations(stations, "2026-08-25");

  const result = await runObservationBackfill({
    stations,
    startDate: "2026-08-21",
    endDate: "2026-08-22",
    now: NOW,
    store,
    fetchObservations: async (stationId, _startDate, _endDate, now) => ({
      status: "observed",
      observations: [{
        stationId,
        date: "2026-08-21",
        observedMm: 1.5,
        observedAt: now.toISOString(),
        source: "kma-asos" as const,
      }],
    }),
    concurrency: 1,
  });

  assert.equal(result.observationsStored, 1, "the station that landed is still reported");
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].message, /connection terminated/);
  assert.equal(result.observationsAbsent, 1, "only the station that answered and stored counts");
});

test("a window nothing anywhere has a row for is treated as unread, not as empty", () => {
  // 97 stations with no row on the same past days is far likelier to be an outage than
  // the record. Reporting that as absence with a clean exit is how a hole comes to look
  // filled — the failure this whole tool exists to undo.
  const empty = {
    stationCount: 97,
    windowDays: 2,
    observationsStored: 0,
    observationsAbsent: 194,
    failures: [],
  };
  assert.equal(isImplausiblyEmpty(empty), true);
  assert.equal(isImplausiblyEmpty({ ...empty, observationsStored: 1 }), false);
  // One station genuinely having no row is a real answer, not a suspicious one.
  assert.equal(isImplausiblyEmpty({ ...empty, stationCount: 1, observationsAbsent: 2 }), false);
});

test("the backfill covers a station retired after the window it is repairing", () => {
  // A catalog failure is both what retires a station and what leaves the hole, so a
  // currently-active filter drops exactly the stations most likely to need repair.
  const retired: ObservationStation[] = [
    { ...stations[0], activeTo: "2026-08-24" },
    { ...stations[1], activeFrom: "2026-08-23", activeTo: null },
  ];
  assert.deepEqual(
    stationsCoveringWindow(retired, "2026-08-21", "2026-08-22").map((station) => station.id),
    ["108"],
    "the retired station is included and the one not yet active is not",
  );
});
