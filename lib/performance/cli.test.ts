import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  CAPTURE_FAULT_TOLERANCE,
  cohortRunFailed,
  manualCohortHourMismatch,
  resolveCaptureCohort,
  SCHEDULE_COHORTS,
} from "./cli.ts";

test("manual capture cohort takes precedence over schedule metadata", () => {
  assert.equal(
    resolveCaptureCohort(["--cohort=18", "--schedule=10 21 * * *"]),
    "18",
  );
});

test("scheduled cohort comes from the triggering cron, not the delayed start hour", () => {
  assert.equal(resolveCaptureCohort(["--cohort=", "--schedule=10 21 * * *"]), "06");
  assert.equal(resolveCaptureCohort(["--cohort=", "--schedule=10 9 * * *"]), "18");
});

test("capture cohort rejects unknown or missing trigger metadata", () => {
  assert.throws(() => resolveCaptureCohort([]), /cohort/);
  assert.throws(() => resolveCaptureCohort(["--schedule=10 8 * * *"]), /schedule/);
  assert.throws(() => resolveCaptureCohort(["--cohort=07"]), /cohort/);
});

test("every scheduled cron in the capture workflow resolves to a cohort", () => {
  const workflow = readFileSync(
    join(import.meta.dirname, "..", "..", ".github", "workflows", "local-performance.yml"),
    "utf8",
  );
  const crons = Array.from(workflow.matchAll(/^\s*-\s*cron:\s*"([^"]+)"/gm), (m) => m[1]);

  assert.ok(crons.length > 0, "workflow declares no cron schedules");
  for (const cron of crons) {
    assert.equal(
      resolveCaptureCohort([`--schedule=${cron}`]),
      SCHEDULE_COHORTS[cron],
      `workflow cron ${cron} has no capture cohort`,
    );
  }
  assert.deepEqual(
    crons.slice().sort(),
    Object.keys(SCHEDULE_COHORTS).sort(),
    "capture cohort table and workflow crons have drifted",
  );
});

/**
 * A blackout is a property of the runner's egress address, not of the hour: three
 * probe rounds lost every Korean host at 22:28, 08:15 and 06:29 KST while three
 * non-Korean controls answered from the same VM. Retrying inside the run cannot
 * help — the address is fixed for its lifetime — so the recovery is a second job,
 * which gets its own machine. The two jobs must stay identically credentialled,
 * because a retry missing one secret would fail in a way that looks like the
 * outage it exists to survive.
 */
test("the capture workflow retries on a fresh runner, identically credentialled", () => {
  const workflow = readFileSync(
    join(import.meta.dirname, "..", "..", ".github", "workflows", "local-performance.yml"),
    "utf8",
  );
  const jobsBody = workflow.slice(workflow.indexOf("\njobs:"));
  const jobNames = Array.from(jobsBody.matchAll(/^ {2}([a-z][\w-]*):$/gm), (m) => m[1]);
  assert.deepEqual(jobNames, ["capture", "retry"], "capture workflow jobs have drifted");

  const bodyOf = (name: string): string => {
    const start = jobsBody.indexOf(`\n  ${name}:\n`);
    const rest = jobsBody.slice(start + 1);
    const next = rest.slice(1).search(/^ {2}[a-z][\w-]*:$/m);
    return next < 0 ? rest : rest.slice(0, next + 1);
  };
  const retry = bodyOf("retry");
  assert.match(retry, /needs:\s*capture/, "the retry must follow the first attempt");
  assert.match(
    retry,
    /if:\s*needs\.capture\.outputs\.failed == 'true'/,
    "the retry must run exactly when the first attempt failed",
  );
  // The first attempt tolerates its own failure so a rescued run finishes green;
  // that only works while the output it publishes is the one the retry reads.
  const capture = bodyOf("capture");
  assert.match(capture, /failed: \$\{\{ steps\.capture\.outcome == 'failure' \}\}/);
  assert.match(capture, /id: capture\n\s*continue-on-error: true/);

  const secretsOf = (name: string): string[] =>
    Array.from(bodyOf(name).matchAll(/^\s*([A-Z][A-Z0-9_]*):\s*\$\{\{\s*secrets\./gm), (m) => m[1])
      .sort();
  assert.ok(secretsOf("capture").length > 0, "the capture job reads no secrets");
  assert.deepEqual(
    secretsOf("retry"),
    secretsOf("capture"),
    "the retry job's credentials have drifted from the first attempt's",
  );
});

/**
 * A capture fault stores nothing, so a handful of them is missing data, never
 * wrong data. Failing the whole cohort over three transient provider blips out
 * of 97 stations trains the reader to ignore the alert — which is the same way
 * #103's daily red runs stopped meaning anything. The alarm belongs to an
 * outage; a blip is reported and survived.
 */
test("a cohort survives a few faulted stations and fails on an outage", () => {
  const base = {
    stationCount: 97,
    observationsStored: 97,
    observationsAbsent: 0,
    observationsFailed: 0,
    capturesInserted: 94,
    capturesExisting: 0,
    capturesSkipped: 0,
    capturesFaulted: 0,
    failures: [],
    catalogSource: "kma" as const,
    catalogError: null,
  };

  assert.equal(cohortRunFailed({ ...base, capturesFaulted: 0 }), false, "a clean run passes");
  assert.equal(
    cohortRunFailed({ ...base, capturesFaulted: 3 }),
    false,
    "3 of 97 is a blip, not an outage",
  );
  assert.equal(
    cohortRunFailed({ ...base, capturesInserted: 0, capturesFaulted: 97 }),
    true,
    "a whole cohort that could not be captured must go red",
  );
  assert.equal(
    cohortRunFailed({ ...base, capturesFaulted: Math.ceil(97 * CAPTURE_FAULT_TOLERANCE) + 1 }),
    true,
    "just past the tolerance is an outage",
  );
});

test("a failed observation still fails the cohort at any count", () => {
  // Unchanged by the capture tolerance: observations kept zero tolerance before
  // it and have not been noisy. #87 is why their alarm stays loud.
  const result = {
    stationCount: 97,
    observationsStored: 96,
    observationsAbsent: 0,
    observationsFailed: 1,
    capturesInserted: 97,
    capturesExisting: 0,
    capturesSkipped: 0,
    capturesFaulted: 0,
    failures: [{
      stationId: "108",
      phase: "observation" as const,
      kind: "error" as const,
      message: "fetch failed",
    }],
    catalogSource: "kma" as const,
    catalogError: null,
  };
  assert.equal(cohortRunFailed(result), true);
});

test("a failure that is neither an observation nor a tolerated capture fault fails the run", () => {
  const result = {
    stationCount: 97,
    observationsStored: 97,
    observationsAbsent: 0,
    observationsFailed: 0,
    capturesInserted: 96,
    capturesExisting: 0,
    capturesSkipped: 0,
    capturesFaulted: 0,
    failures: [{
      stationId: "108",
      phase: "capture" as const,
      kind: "error" as const,
      message: "boom",
    }],
    catalogSource: "kma" as const,
    catalogError: null,
  };
  assert.equal(cohortRunFailed(result), true, "an unexpected capture error is not a fault blip");
});

/**
 * A cohort label is a claim about when a forecast was issued, and scoring reads
 * it as one. A delayed scheduled run is the platform's doing and its capture is
 * still worth keeping; a manual dispatch is a person choosing a label, and
 * nothing stopped them choosing one the clock contradicts. The 2026-08-30
 * dispatch would have written cohort-06 rows at 13 KST had it not faulted every
 * station. See #118.
 */
test("a manual dispatch may not label a cohort the clock contradicts", () => {
  const at = (hour: number): Date => new Date(`2026-08-31T${String(hour).padStart(2, "0")}:20:00+09:00`);

  assert.equal(manualCohortHourMismatch(["--cohort=06"], at(6)), null, "on time is fine");
  assert.equal(manualCohortHourMismatch(["--cohort=06"], at(11)), null, "modestly late is fine");
  assert.equal(manualCohortHourMismatch(["--cohort=18"], at(23)), null);

  assert.match(
    manualCohortHourMismatch(["--cohort=06"], at(13)) ?? "",
    /06/,
    "13 KST is not the morning cohort",
  );
  assert.match(manualCohortHourMismatch(["--cohort=18"], at(4)) ?? "", /18/);
});

test("a delayed scheduled run is never refused, however far it drifted", () => {
  // The measured drift is the scheduler's, not a mislabelling: cohort 06 has run
  // as late as 14 KST and cohort 18 as late as 04. Refusing those would discard
  // real captures to tidy a label.
  const at = (hour: number): Date => new Date(`2026-08-31T${String(hour).padStart(2, "0")}:20:00+09:00`);
  assert.equal(manualCohortHourMismatch(["--schedule=10 21 * * *"], at(14)), null);
  assert.equal(manualCohortHourMismatch(["--schedule=10 9 * * *"], at(4)), null);
});

test("a forced manual dispatch is allowed, so the guard is never a dead end", () => {
  const at = new Date("2026-08-31T13:20:00+09:00");
  assert.equal(manualCohortHourMismatch(["--cohort=06", "--force"], at), null);
});
