import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { secondsUntilSlotOpens } from "./cli.ts";

const workflow = readFileSync(
  join(import.meta.dirname, "..", "..", ".github", "workflows", "evening-forecast.yml"),
  "utf8",
);
const cron = workflow.match(/- cron: "([^"]+)"/)![1];
const target = new Date("2026-11-03T19:30:00+09:00").getTime();
const scheduledAt = (): number => {
  const [minute, hour] = cron.split(" ").map(Number);
  return Date.UTC(2026, 10, 3, hour, minute);
};
const job = (name: string): string => {
  const body = workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][\\w-]*:|$(?![\\s\\S]))`, "m"))?.[1];
  assert.ok(body, `missing ${name} job`);
  return body;
};
const shell = (name: string): string => {
  const body = job(name).match(/        run: \|\n((?:          .*\n|\n)+)/)?.[1];
  assert.ok(body, `missing ${name} shell`);
  return body.replace(/^          /gm, "");
};

// Run the workflow's Bash with virtual sleep and clock-derived CLI output.
function runWait(name: string, now: number, options: {
  schedule?: string;
  skipWait?: string;
  nodeFails?: boolean;
  sleepFails?: boolean;
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "evening-wait-"));
  try {
    const output = join(directory, "output");
    const sleeps = join(directory, "sleeps");
    const seconds = secondsUntilSlotOpens([`--schedule=${options.schedule ?? cron}`], new Date(now));
    const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", `
node() { if [[ "$NODE_FAILS" == true ]]; then return 1; fi; echo "$FAKE_SECONDS"; }
sleep() { if [[ "$SLEEP_FAILS" == true ]]; then return 1; fi; echo "$1" >> "$SLEEPS"; }
${shell(name)}`], {
      encoding: "utf8",
      timeout: 5_000,
      env: {
        ...process.env,
        SCHEDULE: options.schedule ?? cron,
        SKIP_WAIT: options.skipWait ?? "",
        NODE_FAILS: String(options.nodeFails ?? false),
        SLEEP_FAILS: String(options.sleepFails ?? false),
        FAKE_SECONDS: String(seconds),
        GITHUB_OUTPUT: output,
        SLEEPS: sleeps,
      },
    });
    assert.ifError(result.error);
    const read = (file: string) => {
      try { return readFileSync(file, "utf8"); } catch { return ""; }
    };
    const durations = read(sleeps).trim().split("\n").filter(Boolean).map(Number);
    return {
      status: result.status,
      output: read(output),
      sleeps: durations,
      now: now + durations.reduce((sum, value) => sum + value, 0) * 1000,
      log: result.stdout + result.stderr,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("the evening cron absorbs both measured scheduler delays before 19:30 KST", () => {
  for (const delay of [7 * 3600 + 37 * 60 + 58, 8 * 3600 + 16 * 60 + 12]) {
    const started = scheduledAt() + delay * 1000;
    const waited = secondsUntilSlotOpens([`--schedule=${cron}`], new Date(started));
    assert.equal(started + waited * 1000, target, `${delay}s delay misses 19:30 by ${(started - target) / 60_000} min`);
  }
});

test("an on-time evening trigger spans two bounded waits and opens only at 19:30", () => {
  const early = runWait("wait_early", scheduledAt());
  assert.equal(early.status, 0);
  assert.deepEqual(early.sleeps, [300 * 60]);
  assert.doesNotMatch(early.output, /opened=true/);
  // Queue/setup time between jobs must reduce the final sleep.
  const final = runWait("wait", early.now + 90_000);
  assert.equal(final.status, 0);
  assert.deepEqual(final.sleeps, [265 * 60 - 90]);
  assert.equal(final.now, target);
  assert.match(final.output, /^opened=true$/m);
  for (const name of ["wait_early", "wait"]) {
    assert.match(job(name), /timeout-minutes: 345/);
    assert.match(job(name), /timeout-minutes: 1/);
    assert.match(job(name), /timeout-minutes: 2/);
  }
});

test("measured delays, a beyond-buffer start, and manual dispatch execute the wait shell", () => {
  for (const delay of [7 * 3600 + 37 * 60 + 58, 8 * 3600 + 16 * 60 + 12, 10 * 3600]) {
    const start = scheduledAt() + delay * 1000;
    const early = runWait("wait_early", start);
    const final = runWait("wait", early.now, { skipWait: early.output.includes("skip_wait=true") ? "true" : "" });
    assert.equal(early.status, 0);
    assert.equal(final.status, 0);
    assert.equal(final.now, Math.max(start, target));
    assert.match(final.output, /opened=true/);
  }
  const manual = runWait("wait_early", scheduledAt(), { schedule: "" });
  assert.match(manual.output, /skip_wait=true/);
  const final = runWait("wait", manual.now, { schedule: "", skipWait: "true" });
  assert.equal(final.now, scheduledAt());
  assert.match(final.output, /opened=true/);
});

test("a previous-day late run crossing the cron minute still captures immediately", () => {
  const early = runWait("wait_early", scheduledAt() - 1000);
  assert.match(early.output, /skip_wait=true/);
  const final = runWait("wait", scheduledAt() + 1000, { skipWait: "true" });
  assert.equal(final.now, scheduledAt() + 1000);
  assert.match(final.output, /opened=true/);
});

test("failed early waits recover only when the remaining wait fits the final job", () => {
  const early = runWait("wait_early", scheduledAt(), { nodeFails: true });
  assert.notEqual(early.status, 0);
  const tooLong = runWait("wait", early.now);
  assert.notEqual(tooLong.status, 0);
  assert.deepEqual(tooLong.sleeps, []);
  assert.doesNotMatch(tooLong.output, /opened=true/);
  const recovered = runWait("wait", target - 330 * 60_000);
  assert.equal(recovered.status, 0);
  assert.equal(recovered.now, target);
  assert.match(recovered.output, /opened=true/);
  for (const options of [{ nodeFails: true }, { sleepFails: true }]) {
    const failed = runWait("wait", target - 60_000, options);
    assert.notEqual(failed.status, 0);
    assert.doesNotMatch(failed.output, /opened=true/);
  }
});

test("all capture attempts require the explicit opened gate and retain retry dependencies", () => {
  assert.match(job("wait"), /needs: wait_early/);
  assert.match(job("wait"), /if: \$\{\{ always\(\) && !cancelled\(\) \}\}/);
  assert.match(job("wait_early"), /skip_wait: \$\{\{ steps\.early\.outputs\.skip_wait \}\}/);
  assert.match(job("wait"), /SKIP_WAIT: \$\{\{ needs\.wait_early\.outputs\.skip_wait \}\}/);
  assert.match(job("wait"), /opened: \$\{\{ steps\.open\.outputs\.opened \}\}/);
  for (const attempt of [1, 2, 3]) {
    const body = job(`capture_${attempt}`);
    const dependencies = body.match(/needs: (.+)/)![1].replace(/[\[\] ]/g, "").split(",");
    assert.deepEqual(dependencies, ["wait", ...Array.from({ length: attempt - 1 }, (_, i) => `capture_${i + 1}`)]);
    const expression = body.match(/if: \$\{\{ (.+) \}\}/)![1];
    const allowed = (opened: string, succeeded = "false", cancelled = false): boolean => {
      const evaluated = expression.replaceAll("always()", "true").replaceAll("cancelled()", String(cancelled))
        .replaceAll("needs.wait.outputs.opened", JSON.stringify(opened))
        .replace(/needs\.capture_\d\.outputs\.succeeded/g, JSON.stringify(succeeded));
      return Function(`return ${evaluated}`)() as boolean;
    };
    assert.equal(allowed(""), false, `attempt ${attempt} runs after a failed wait`);
    assert.equal(allowed("false"), false);
    assert.equal(allowed("true"), true);
    assert.equal(allowed("true", "false", true), false);
    if (attempt > 1) assert.equal(allowed("true", "true"), false);
  }
  const verdict = spawnSync("bash", ["-e", "-o", "pipefail", "-c", shell("verdict")], {
    encoding: "utf8",
    env: { ...process.env, CAPTURE_1_SUCCEEDED: "", CAPTURE_2_SUCCEEDED: "", CAPTURE_3_SUCCEEDED: "" },
  });
  assert.equal(verdict.status, 1, "a closed gate must leave the run red");
});
