/**
 * One-shot ASOS observation backfill.
 *
 *     npm run performance:observations -- --start=2026-08-21 --end=2026-08-22
 *     npm run performance:observations -- --start=2026-08-21 --end=2026-08-22 --station=108
 *
 * Repairs a hole the scheduled cohorts cannot: each cohort reads one date fixed by
 * the clock, so a date missed while the pipeline was degraded stays missed, and every
 * comparison whose target date it is stays incomplete. Offline and idempotent — a
 * re-run costs only the re-fetch.
 *
 * Stations come from what the store already records for the window — including any
 * retired since, because a catalog failure is both what retires a station and what
 * leaves the hole. This tool reads the observation service only; it is not an
 * authority on the catalog and never syncs it.
 */
import {
  isImplausiblyEmpty,
  runObservationBackfill,
  stationsCoveringWindow,
} from "../lib/performance/observations.ts";
import { PostgresPerformanceStore } from "../lib/performance/postgres.ts";

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline !== undefined) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const startDate = option("start");
const endDate = option("end");
if (!startDate || !endDate) {
  console.error(
    "usage: performance:observations -- --start=YYYY-MM-DD --end=YYYY-MM-DD [--station=108]",
  );
  process.exit(1);
}

const connectionUrl = process.env.PERFORMANCE_DATABASE_URL?.trim();
if (!connectionUrl) {
  console.error("PERFORMANCE_DATABASE_URL is required");
  process.exit(1);
}

const store = new PostgresPerformanceStore(connectionUrl);
try {
  await store.initialize();
  const requested = option("station");
  const recorded = await store.listStations();
  const stations = requested
    ? recorded.filter((station) => station.id === requested)
    : stationsCoveringWindow(recorded, startDate, endDate);
  if (stations.length === 0) {
    console.error(
      requested
        ? `no recorded station matched --station=${requested}`
        : `the store records no station covering ${startDate}..${endDate}`,
    );
    process.exitCode = 1;
  } else {
    const retired = stations.filter((station) => station.activeTo !== null).length;
    if (retired > 0) {
      console.log(`including ${retired} station(s) retired since — they were active then`);
    }

    const result = await runObservationBackfill({
      stations,
      startDate,
      endDate,
      now: new Date(),
      store,
      onProgress: (stationId, stored) => console.log(`  ${stationId}: +${stored}`),
    });

    console.log(
      `\n${result.stationCount} stations x ${result.windowDays} days: ` +
        `${result.observationsStored} stored, ${result.observationsAbsent} with no row`,
    );
    for (const failure of result.failures) {
      console.warn(`  failed ${failure.stationId} ${failure.window}: ${failure.message}`);
    }
    if (result.failures.length > 0) {
      console.warn(
        `${result.failures.length} station(s) failed; their days are recorded nowhere. ` +
          "Re-run the same window — stations that already landed cost only the re-fetch.",
      );
      process.exitCode = 1;
    }
    if (isImplausiblyEmpty(result)) {
      console.warn(
        `no station has a row anywhere in ${startDate}..${endDate}. A gap that wide is ` +
          "far likelier to be an outage than the record — treat this as unread, not empty.",
      );
      process.exitCode = 1;
    }
  }
} catch (error) {
  // A mistyped date is a RangeError from the window guard, and the usage line above
  // is more use to whoever typed it than a stack trace.
  console.error(error instanceof Error ? error.message : "observation backfill failed");
  process.exitCode = 1;
} finally {
  await store.close();
}
