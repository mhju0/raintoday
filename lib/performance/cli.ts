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
 * KST hours in which a *manually dispatched* cohort may be captured.
 *
 * A cohort label is a claim about when a forecast was issued, and scoring reads
 * it as one. Two very different things produce an off-hour capture, and only one
 * of them is a mistake: a scheduled run that GitHub started late is the
 * platform's doing and its capture is still real evidence, so it is never
 * refused. A manual dispatch is a person choosing a label, and nothing stopped
 * them choosing one the clock contradicts — the 2026-08-30 dispatch would have
 * written cohort-06 rows at 13 KST had it not faulted every station. See #118.
 *
 * The bands are the slot plus a few hours of grace, not the full observed drift:
 * a human can wait, or pass `--force`.
 */
const MANUAL_COHORT_HOURS: Readonly<Record<CaptureCohort, readonly [number, number]>> = {
  "06": [6, 11],
  "18": [18, 23],
};

function koreanHour(date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date),
  );
}

/**
 * The reason a manual dispatch's cohort contradicts the clock, or null when it
 * does not — including for every scheduled run, and for an explicit `--force`.
 */
export function manualCohortHourMismatch(
  argv: readonly string[],
  now: Date,
): string | null {
  const requested = option(argv, "cohort");
  if (!requested) return null;
  if (argv.includes("--force")) return null;
  if (requested !== "06" && requested !== "18") return null;
  const [from, to] = MANUAL_COHORT_HOURS[requested];
  const hour = koreanHour(now);
  if (hour >= from && hour <= to) return null;
  return (
    `cohort ${requested} is captured between ${from}:00 and ${to}:59 KST, and it is ` +
    `${String(hour).padStart(2, "0")}:00 KST now. A capture stores its cohort as the ` +
    "hour its forecast was issued, so writing one outside that window would label the " +
    "row with a lead time it does not have. Wait for the window, or pass --force."
  );
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
