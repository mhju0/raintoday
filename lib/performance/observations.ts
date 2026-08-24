import {
  fetchAsosObservationWindow,
  MAX_OBSERVATION_WINDOW_DAYS,
  type AsosObservationWindowRead,
} from "./kma.ts";
import type { PerformanceStore } from "./store.ts";
import type { ObservationStation } from "./types.ts";

/**
 * One-shot observation backfill: read a past date range of ASOS ground truth for a
 * set of stations and store it.
 *
 * The scheduled cohorts each read one day, fixed by the clock, so a date they miss
 * is missed permanently — three consecutive catalog failures left 2026-08-21 short
 * 78 stations and 2026-08-22 empty, and a comparison whose target date has no
 * observation never completes. This repairs such a hole from the same service the
 * cohorts read, and does nothing else: it writes observations only, invents no
 * capture, and is not an authority on which stations are active.
 */

export interface ObservationBackfillFailure {
  stationId: string;
  window: string;
  message: string;
}

export interface ObservationBackfillResult {
  stationCount: number;
  /** Calendar days in the requested window, inclusive of both ends. */
  windowDays: number;
  observationsStored: number;
  /** Station-days a station that answered has no row for. Not a fault. */
  observationsAbsent: number;
  /** Stations whose window could not be read at all. Their days are counted nowhere. */
  failures: ObservationBackfillFailure[];
}

interface ObservationBackfillInput {
  stations: readonly ObservationStation[];
  startDate: string;
  endDate: string;
  now: Date;
  store: PerformanceStore;
  fetchObservations?: typeof fetchAsosObservationWindow;
  onProgress?: (stationId: string, stored: number) => void;
  concurrency?: number;
}

const DAY_MS = 86_400_000;

function koreanDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parseDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`${value} is not YYYY-MM-DD`);
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) throw new RangeError(`${value} is not YYYY-MM-DD`);
  return parsed;
}

/**
 * Refuse a window ASOS may not have compiled.
 *
 * A calendar day's summary lands hours after midnight, and until it does the service
 * answers NODATA — indistinguishable from a station-day with no row. A backfill that
 * accepted such a day would record an absence and write the very hole it exists to
 * fill, so the newest readable day is the same two-days-back boundary the 06 KST
 * cohort uses. A repair tool loses nothing by waiting a day.
 */
export function assertObservationWindow(startDate: string, endDate: string, now: Date): void {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (start > end) throw new RangeError("the window ends before it starts — check the order");
  const days = (end - start) / DAY_MS + 1;
  if (days > MAX_OBSERVATION_WINDOW_DAYS) {
    throw new RangeError(
      `a window of ${days} days exceeds the ${MAX_OBSERVATION_WINDOW_DAYS}-day per-request bound`,
    );
  }
  const newestReadable = parseDate(koreanDate(now)) - 2 * DAY_MS;
  if (end > newestReadable) {
    throw new RangeError(
      `${endDate} is not compiled yet — the newest readable day is ` +
        `${new Date(newestReadable).toISOString().slice(0, 10)}`,
    );
  }
}

/** Rebuild stored ASOS observations for one past window. Idempotent by (station, date). */
export async function runObservationBackfill(
  input: ObservationBackfillInput,
): Promise<ObservationBackfillResult> {
  assertObservationWindow(input.startDate, input.endDate, input.now);
  await input.store.initialize();
  const window = `${input.startDate}..${input.endDate}`;
  const windowDays = (parseDate(input.endDate) - parseDate(input.startDate)) / DAY_MS + 1;
  const result: ObservationBackfillResult = {
    stationCount: input.stations.length,
    windowDays,
    observationsStored: 0,
    observationsAbsent: 0,
    failures: [],
  };
  const fetchObservations = input.fetchObservations ?? fetchAsosObservationWindow;
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < input.stations.length) {
      const station = input.stations[nextIndex++];
      let read: AsosObservationWindowRead;
      try {
        read = await fetchObservations(
          station.id,
          input.startDate,
          input.endDate,
          input.now,
        );
      } catch (error) {
        read = {
          status: "failed",
          reason: error instanceof Error ? error.message : "unknown error",
        };
      }
      if (read.status === "failed") {
        // A station that never answered has no absences to report. Counting its days
        // as absent is exactly the conflation that let a hole look filled.
        result.failures.push({ stationId: station.id, window, message: read.reason });
        continue;
      }
      let stored = 0;
      for (const observation of read.observations) {
        await input.store.saveObservation(observation);
        stored += 1;
      }
      result.observationsStored += stored;
      result.observationsAbsent += Math.max(0, windowDays - stored);
      input.onProgress?.(station.id, stored);
    }
  };

  const concurrency = Math.max(
    1,
    Math.min(input.concurrency ?? 4, input.stations.length || 1),
  );
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return result;
}
