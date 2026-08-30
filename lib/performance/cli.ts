import type { PerformanceBatchResult } from "./batch.ts";
import type { CaptureCohort } from "./types.ts";

/**
 * The share of a cohort that may fault before the run is treated as an outage.
 *
 * A faulted capture stores nothing, so a few of them are missing data, never
 * wrong data — and the retry on a fresh runner fills most of them in. Failing
 * the whole cohort over three transient provider reads out of 97 stations
 * teaches the reader to ignore the alert, which is exactly how #103's nightly
 * red runs stopped carrying information. Observed separation is wide: clean
 * runs fault 0, a blip faulted 3, and an egress blackout faulted all 97.
 */
export const CAPTURE_FAULT_TOLERANCE = 0.1;

/**
 * Whether a finished cohort should fail its run.
 *
 * Everything is still reported either way; this decides only whether anyone is
 * woken up. Observations keep zero tolerance — they had it before the capture
 * guard existed, they have not been noisy, and #87 is why their alarm is loud.
 */
export function cohortRunFailed(result: PerformanceBatchResult): boolean {
  const tolerated = result.stationCount * CAPTURE_FAULT_TOLERANCE;
  const faultsWithinTolerance = result.capturesFaulted <= tolerated;
  const unexpected = result.failures.filter((failure) => failure.kind !== "provider-fault");
  return unexpected.length > 0 || !faultsWithinTolerance;
}

/**
 * Every cron in `.github/workflows/local-performance.yml` must appear here; the
 * workflow cannot see this table, so `cli.test.ts` binds the two together.
 */
export const SCHEDULE_COHORTS: Readonly<Record<string, CaptureCohort>> = {
  "10 21 * * *": "06",
  "10 9 * * *": "18",
};

function option(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = argv.find((argument) => argument.startsWith(prefix));
  if (inline !== undefined) return inline.slice(prefix.length);
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** Resolve one fixed cohort from explicit dispatch input or the triggering cron. */
export function resolveCaptureCohort(argv: readonly string[]): CaptureCohort {
  const cohort = option(argv, "cohort");
  if (cohort) {
    if (cohort === "06" || cohort === "18") return cohort;
    throw new Error("--cohort must be 06 or 18");
  }
  const schedule = option(argv, "schedule");
  if (!schedule) throw new Error("--cohort or --schedule is required");
  const scheduledCohort = SCHEDULE_COHORTS[schedule];
  if (!scheduledCohort) throw new Error("--schedule is not a supported capture cohort");
  return scheduledCohort;
}
