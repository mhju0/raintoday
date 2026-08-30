import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { resolveCaptureCohort, SCHEDULE_COHORTS } from "./cli.ts";

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
