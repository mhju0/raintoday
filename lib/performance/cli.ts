import { forecastProviders } from "../providers/registry.ts";
import type { PerformanceBatchResult } from "./batch.ts";
import { OUTAGE_EVIDENCE_THRESHOLD } from "./batch.ts";
import { MORNING_WINDOW_START_HOUR } from "./morning.ts";
import type { CaptureCohort } from "./types.ts";

/** Production cohorts must not freeze a smaller provider set because a key is missing. */
export function assertCaptureProvidersConfigured(): void {
  const missing = forecastProviders.flatMap((provider) => {
    const names = provider.missingConfiguration();
    return names.length > 0 ? [`${provider.id}: ${names.join(", ")}`] : [];
  });
  if (missing.length > 0) {
    throw new Error(`Capture provider configuration is missing (${missing.join("; ")}). No evidence was written.`);
  }
}

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
 * The largest cohort for which abandoning a proven-down source is guaranteed not
 * to discard a run that would otherwise have passed.
 *
 * Tripping the outage breaker needs `OUTAGE_EVIDENCE_THRESHOLD` consecutive
 * transport failures; a cohort fails once faults exceed `CAPTURE_FAULT_TOLERANCE`
 * of its stations. While the threshold is the larger of the two, every abandoned
 * run was already red, so the breaker can only ever save time.
 */
export const OUTAGE_SAFE_COHORT_LIMIT = OUTAGE_EVIDENCE_THRESHOLD / CAPTURE_FAULT_TOLERANCE;

/**
 * Whether a finished cohort should fail its run.
 *
 * Everything is still reported either way; this decides only whether anyone is
 * woken up. Observations keep zero tolerance — they had it before the capture
 * guard existed, they have not been noisy, and #87 is why their alarm is loud.
 *
 * An abandoned pass fails on its own account rather than on the counts it left
 * behind: unattempted stations are deliberately absent from both, so a cohort
 * that stopped early must never be able to read as a quiet success.
 */
export function cohortRunFailed(result: PerformanceBatchResult): boolean {
  const tolerated = result.stationCount * CAPTURE_FAULT_TOLERANCE;
  const faultsWithinTolerance = result.capturesFaulted <= tolerated;
  const unexpected = result.failures.filter((failure) => failure.kind !== "provider-fault");
  return result.abandonedReason !== null || unexpected.length > 0 || !faultsWithinTolerance;
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
  "40 3 * * *": "18",
};

/**
 * The cron of `.github/workflows/morning-forecast.yml`, 01:30 KST.
 *
 * The Morning Slot is graded as the forecast a reader saw at 07:00, so a capture
 * that GitHub starts late is a different, easier forecast. The 06:10 KST cron
 * started 110 to 183 minutes late on every run from 2026-10-16 to 10-21, and the
 * evening cron's early fire and wait has landed at 18:10 KST on six of seven days
 * since it shipped (18:18 on the seventh). This fires 5.5 hours early and waits
 * for 07:00 the same way. It is not a cohort: it targets today, not tomorrow.
 */
export const MORNING_SCHEDULE = "30 16 * * *";

/**
 * KST hours in which a manually dispatched Morning Capture may run. A scheduled
 * run that lands late is the platform's doing and keeps its own `capturedAt`; a
 * person dispatching at 14:00 would be writing an afternoon forecast into a table
 * read as the morning one.
 */
const MANUAL_MORNING_HOURS: readonly [number, number] = [MORNING_WINDOW_START_HOUR, MORNING_WINDOW_START_HOUR + 1];

/** The reason a manual Morning Capture contradicts the clock, or null when it does not. */
export function manualMorningHourMismatch(argv: readonly string[], now: Date): string | null {
  if (option(argv, "schedule")) return null;
  if (argv.includes("--force")) return null;
  const [from, to] = MANUAL_MORNING_HOURS;
  const hour = koreanHour(now);
  if (hour >= from && hour <= to) return null;
  return (
    `a Morning Capture is taken between ${from}:00 and ${to}:59 KST, and it is ` +
    `${String(hour).padStart(2, "0")}:00 KST now. It is graded as the forecast a reader ` +
    "saw that morning, so a later one would be scored as a forecast nobody was shown. " +
    "Wait for the window, or pass --force."
  );
}

/**
 * Crons fired ahead of their slot, with the KST minute of the day the slot opens.
 *
 * GitHub started the evening cron 4.4 to 9.2 hours after its 18:10 KST slot on
 * every run from 2026-09-20 to 2026-10-11. A capture targets the day after it is
 * taken, so a run that crossed midnight forecast a day later than one that did
 * not: twelve of nineteen did, the group mixed lead times near 0 and near 24
 * hours, and each crossing left one target date with no evening capture. The
 * cron now fires at 12:40 KST and the run waits here until 18:10, which absorbs
 * 5.5 hours of scheduler delay and leaves a longer one landing before midnight.
 * The 06 cohort's cron runs 2 to 4.5 hours late but never crosses a day boundary, so
 * it does not wait. The Morning Slot does, because its value is the hour it was taken.
 */
export const SCHEDULE_SLOT_OPENS: Readonly<Record<string, number>> = {
  "40 3 * * *": 18 * 60 + 10,
  [MORNING_SCHEDULE]: MORNING_WINDOW_START_HOUR * 60,
};

function koreanSecondOfDay(date: Date): number {
  return Math.floor((date.getTime() + 9 * 3_600_000) / 1000) % 86_400;
}

/**
 * Seconds a scheduled run should wait before capturing, or 0.
 *
 * Only a start between the cron's own time and its slot waits. A start before
 * the cron's time of day means the scheduler slipped past midnight, where the
 * slot opened yesterday; it captures at once, as every late run always has.
 */
export function secondsUntilSlotOpens(argv: readonly string[], now: Date): number {
  if (option(argv, "cohort")) return 0;
  const schedule = option(argv, "schedule");
  const opensAtMinute = schedule === undefined ? undefined : SCHEDULE_SLOT_OPENS[schedule];
  if (schedule === undefined || opensAtMinute === undefined) return 0;
  const [minute, hour] = schedule.split(" ").map(Number);
  const firesAt = ((hour * 60 + minute + 9 * 60) % 1440) * 60;
  const second = koreanSecondOfDay(now);
  return second >= firesAt && second < opensAtMinute * 60 ? opensAtMinute * 60 - second : 0;
}

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
