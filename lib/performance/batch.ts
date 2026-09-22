import type { ForecastLocation } from "../location.ts";
import type { ProviderSnapshot } from "../types.ts";
import { DEFAULT_FAILURE_RETRY_MS } from "../cache.ts";
// `failureMessage` used to be `error.message`, which is empty on an AggregateError:
// run 35351001382 reported `4 x observation: ` and failed a 93-of-97 cohort on a
// reason nobody could read. Observations have zero fault tolerance. See #170.
import { failureDetail as failureMessage } from "./errorDetail.ts";
import { captureStationForecast } from "./capture.ts";
import { fetchAsosObservation, fetchKmaAsosStations, type AsosObservationRead } from "./kma.ts";
import type { PerformanceStore } from "./store.ts";
import type { CaptureCohort, ObservationStation } from "./types.ts";

export interface PerformanceBatchFailure {
  stationId: string;
  phase: "observation" | "capture";
  /**
   * `provider-fault` is a capture refused because a provider could not be read:
   * nothing was stored, so a few of them are missing data rather than wrong
   * data. `error` is anything else, and is never tolerated.
   */
  kind: "provider-fault" | "error";
  message: string;
}

export interface PerformanceBatchResult {
  stationCount: number;
  observationsStored: number;
  /** Stations ASOS has no row for. A fact about the record, not a fault. */
  observationsAbsent: number;
  /** Stations whose observation could not be read. Always also in `failures`. */
  observationsFailed: number;
  /** Failed observation reads resolved during the one end-of-batch retry pass. */
  observationsRecovered: number;
  capturesInserted: number;
  capturesExisting: number;
  capturesSkipped: number;
  /** Stations whose capture was refused because a provider read failed. */
  capturesFaulted: number;
  /** Faulted provider reads resolved during the one end-of-batch retry pass. */
  capturesRecovered: number;
  failures: PerformanceBatchFailure[];
  /** Where the run's station list came from. `store` means the cohort ran degraded. */
  catalogSource: "kma" | "store";
  /** Why the live catalog was abandoned, so a degraded run is never silent. */
  catalogError: string | null;
}

interface PerformanceBatchInput {
  cohort: CaptureCohort;
  now: Date;
  store: PerformanceStore;
  fetchStations?: (at: Date) => Promise<ObservationStation[]>;
  fetchObservation?: (
    stationId: string,
    date: string,
    now: Date,
  ) => Promise<AsosObservationRead>;
  readForecasts?: (location: ForecastLocation) => Promise<ProviderSnapshot[]>;
  concurrency?: number;
  retryDelay?: (ms: number) => Promise<void>;
}

function koreanDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addCalendarDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * ASOS compiles a calendar day's summary hours after midnight, not at it. Every
 * scheduled 06 KST cohort reading yesterday found 5, 10, 15, 17 and 19 of 97 rows on
 * consecutive days, while every 18 KST cohort at the same one-day offset found 97 —
 * and one manual 06 cohort run at midday found 97 too. An uncompiled day answers
 * NODATA, which is indistinguishable from a station that has no row, so the early
 * cohort reported up to 92 absences a day that were nothing of the kind. Reach one
 * day further back at 06 KST: both cohorts then read a published day, every date
 * still gets two reads, and the later one is a real second chance rather than a
 * premature one.
 */
function observationDate(cohort: CaptureCohort, now: Date): string {
  return addCalendarDays(koreanDate(now), cohort === "06" ? -2 : -1);
}

const PARTIAL_FAILURE_RETRY_DELAY_MS = DEFAULT_FAILURE_RETRY_MS + 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run one bounded nationwide ASOS observation-and-capture cohort. */
export async function runPerformanceBatch(
  input: PerformanceBatchInput,
): Promise<PerformanceBatchResult> {
  await input.store.initialize();
  // The catalog is the cohort's only apihub call: the forecast captures read the
  // weather providers and the observations read data.go.kr, so an apihub outage used
  // to discard a nationwide run that never needed it. Fall back to the active
  // stations the last successful sync recorded, and make no retirement decisions
  // from a list that could not be verified.
  let stations: ObservationStation[];
  let catalogSource: "kma" | "store" = "kma";
  let catalogError: string | null = null;
  try {
    stations = await (input.fetchStations ?? fetchKmaAsosStations)(input.now);
  } catch (error) {
    stations = (await input.store.listStations()).filter((station) => station.activeTo === null);
    // With nothing recorded yet there is no cohort to run, and reporting zero
    // stations would read as a successful empty run rather than a failed one.
    if (stations.length === 0) throw error;
    catalogSource = "store";
    catalogError = failureMessage(error);
  }
  // Only a catalog we actually read may retire a station, so the sync — and the
  // drop guard inside it, which is meant to halt a run on a suspicious catalog —
  // is skipped entirely on the fallback path rather than fed the recorded list.
  if (catalogSource === "kma") {
    await input.store.syncStations(stations, koreanDate(input.now));
  }
  const result: PerformanceBatchResult = {
    stationCount: stations.length,
    observationsStored: 0,
    observationsAbsent: 0,
    observationsFailed: 0,
    observationsRecovered: 0,
    capturesInserted: 0,
    capturesExisting: 0,
    capturesSkipped: 0,
    capturesFaulted: 0,
    capturesRecovered: 0,
    failures: [],
    catalogSource,
    catalogError,
  };
  const targetObservationDate = observationDate(input.cohort, input.now);
  const fetchObservation = input.fetchObservation ?? fetchAsosObservation;
  const concurrency = Math.max(1, Math.min(input.concurrency ?? 4, stations.length || 1));
  type RetryCandidate = {
    station: ObservationStation;
    failure: PerformanceBatchFailure;
    failedAt: number;
  };
  const observationRetries = new Map<string, RetryCandidate>();
  const captureRetries = new Map<string, RetryCandidate>();
  let observationSequence = 0;
  let captureSequence = 0;
  let latestObservationProgress = 0;
  let latestCaptureProgress = 0;

  const removeFailure = (failure: PerformanceBatchFailure): void => {
    const index = result.failures.indexOf(failure);
    if (index >= 0) result.failures.splice(index, 1);
  };

  const processObservation = async (
    station: ObservationStation,
    retry?: RetryCandidate,
  ): Promise<void> => {
    let read: AsosObservationRead;
    try {
      read = await fetchObservation(station.id, targetObservationDate, input.now);
    } catch (error) {
      const message = failureMessage(error);
      if (retry) {
        retry.failure.message = message;
      } else {
        result.observationsFailed += 1;
        result.failures.push({ stationId: station.id, phase: "observation", kind: "error", message });
      }
      return;
    }
    const completedAt = ++observationSequence;
    if (read.status === "observed" || read.status === "absent") {
      latestObservationProgress = completedAt;
    }
    if (read.status === "observed") {
      try {
        await input.store.saveObservation(read.observation);
      } catch (error) {
        const message = failureMessage(error);
        if (retry) retry.failure.message = message;
        else {
          result.observationsFailed += 1;
          result.failures.push({ stationId: station.id, phase: "observation", kind: "error", message });
        }
        return;
      }
      if (retry) {
        result.observationsFailed -= 1;
        result.observationsRecovered += 1;
        removeFailure(retry.failure);
      }
      result.observationsStored += 1;
      return;
    }
    if (read.status === "absent") {
      if (retry) {
        result.observationsFailed -= 1;
        result.observationsRecovered += 1;
        removeFailure(retry.failure);
      }
      result.observationsAbsent += 1;
      return;
    }
    if (retry) {
      retry.failure.message = read.reason;
      return;
    }
    // Not the same as `absent`. Only transport exhaustion is eligible for the
    // later recovery pass; configuration and API responses are terminal.
    const failure: PerformanceBatchFailure = {
      stationId: station.id,
      phase: "observation",
      kind: "error",
      message: read.reason,
    };
    result.observationsFailed += 1;
    result.failures.push(failure);
    if (read.retryable === true) {
      observationRetries.set(station.id, { station, failure, failedAt: completedAt });
    }
  };

  const processCapture = async (
    station: ObservationStation,
    retry?: RetryCandidate,
  ): Promise<void> => {
    try {
      const capture = await captureStationForecast({
        station,
        cohort: input.cohort,
        now: input.now,
        store: input.store,
        readForecasts: input.readForecasts,
      });
      const completedAt = ++captureSequence;
      if (capture.status !== "faulted") latestCaptureProgress = completedAt;
      if (capture.status === "faulted") {
        const message = `could not read ${capture.faultedProviders
          .map((fault) => `${fault.provider} (${fault.message})`)
          .join(", ")}`;
        if (retry) {
          retry.failure.message = message;
        } else {
          const failure: PerformanceBatchFailure = {
            stationId: station.id,
            phase: "capture",
            kind: "provider-fault",
            message,
          };
          result.capturesFaulted += 1;
          result.failures.push(failure);
          captureRetries.set(station.id, { station, failure, failedAt: completedAt });
        }
        return;
      }
      if (retry) {
        result.capturesFaulted -= 1;
        result.capturesRecovered += 1;
        removeFailure(retry.failure);
      }
      if (capture.status === "inserted") result.capturesInserted += 1;
      if (capture.status === "existing") result.capturesExisting += 1;
      if (capture.status === "skipped") result.capturesSkipped += 1;
    } catch (error) {
      const message = failureMessage(error);
      if (retry) {
        result.capturesFaulted -= 1;
        retry.failure.kind = "error";
        retry.failure.message = message;
      } else {
        result.failures.push({ stationId: station.id, phase: "capture", kind: "error", message });
      }
    }
  };

  const runStations = async (
    selected: readonly ObservationStation[],
    process: (station: ObservationStation) => Promise<void>,
  ): Promise<void> => {
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (nextIndex < selected.length) await process(selected[nextIndex++]);
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, selected.length || 1) }, () => worker()));
  };

  await runStations(stations, async (station) => {
    await processObservation(station);
    await processCapture(station);
  });

  const retryableObservationIds = new Set(
    [...observationRetries.values()]
      .filter((candidate) => candidate.failedAt < latestObservationProgress)
      .map((candidate) => candidate.station.id),
  );
  const retryableCaptureIds = new Set(
    [...captureRetries.values()]
      .filter((candidate) => candidate.failedAt < latestCaptureProgress)
      .map((candidate) => candidate.station.id),
  );
  const retryStations = stations.filter((station) =>
    retryableObservationIds.has(station.id) || retryableCaptureIds.has(station.id));
  if (retryStations.length > 0) {
    await (input.retryDelay ?? sleep)(PARTIAL_FAILURE_RETRY_DELAY_MS);
    await runStations(retryStations, async (station) => {
      const observationRetry = observationRetries.get(station.id);
      if (observationRetry && retryableObservationIds.has(station.id)) {
        await processObservation(station, observationRetry);
      }
      const captureRetry = captureRetries.get(station.id);
      if (captureRetry && retryableCaptureIds.has(station.id)) {
        await processCapture(station, captureRetry);
      }
    });
  }
  return result;
}
