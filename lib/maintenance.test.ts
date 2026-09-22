import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assessExpiries,
  assessRuns,
  CREDENTIAL_EXPIRIES,
  parseQuotaHeader,
  summarizeCaptureAttempts,
  transportFailure,
} from "./maintenance.ts";

const now = Date.parse("2026-09-07T00:00:00Z");
test("a failed collection remains an incident even when an older run succeeded", () => {
  assert.match(assessRuns([
    { id: 1, status: "completed", conclusion: "failure", created_at: "2026-09-06T12:00:00Z", html_url: "failed" },
    { id: 2, status: "completed", conclusion: "success", created_at: "2026-09-06T00:00:00Z", html_url: "old" },
  ], now, 18)?.detail ?? "", /failure/);
});
test("queued runs cannot conceal an overdue collection", () => {
  assert.equal(assessRuns([{ id: 3, status: "queued", conclusion: null, created_at: "2026-09-06T23:00:00Z", html_url: "queued" }], now, 18)?.kind, "stale");
});
test("fresh recovery clears an incident; a stale success does not", () => {
  const run = { id: 4, status: "completed", conclusion: "success", created_at: "2026-09-06T12:00:00Z", html_url: "ok" };
  assert.equal(assessRuns([run], now, 18), null);
  assert.equal(assessRuns([run], now + 24 * 3600000, 18)?.kind, "stale");
});
test("missing quota headers are unknown, never zero", () => {
  for (const value of [null, "", " ", "NaN", "-1"]) assert.equal(parseQuotaHeader(value), null);
  assert.equal(parseQuotaHeader("0"), 0);
});
test("transport diagnostics preserve useful causes without leaking request URLs", () => {
  const error = new TypeError("fetch failed secret=private", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
  assert.equal(transportFailure(error), "connection timed out");
  assert.equal(transportFailure(new Error("https://example.com?key=private")), "network request failed");
});

const expiry = (expiresOn: string) => [{ variable: "KMA_SHORT_TERM_API_KEY", service: "단기예보", portal: "https://example.invalid/", expiresOn }];

test("a subscription far from expiry raises nothing", () => {
  assert.equal(assessExpiries(expiry("2028-03-27"), now), null);
});

test("the 30-day warning opens before the 7-day one escalates", () => {
  // 31 days out is silence; 30 warns without urgency; 7 is urgent. The boundary
  // is the whole point of the reminder, so pin both sides of it.
  assert.equal(assessExpiries(expiry("2026-10-09"), now), null);
  assert.equal(assessExpiries(expiry("2026-10-08"), now)?.urgent, false);
  assert.equal(assessExpiries(expiry("2026-09-14"), now)?.urgent, true);
});

test("an already-expired subscription reports elapsed days, never a negative countdown", () => {
  const finding = assessExpiries(expiry("2026-09-04"), now);
  assert.equal(finding?.urgent, true);
  assert.match(finding!.detail, /expired 3 day\(s\) ago/);
  assert.doesNotMatch(finding!.detail, /-\d+ day/);
});

test("the soonest expiry is reported first", () => {
  const finding = assessExpiries(
    [...expiry("2026-09-30"), { variable: "KMA_APIHUB_KEY", service: "stn_inf", portal: "https://example.invalid/", expiresOn: "2026-09-10" }],
    now,
  );
  assert.equal(finding?.rows[0].variable, "KMA_APIHUB_KEY");
});

test("expiry dates are measured in KST, not the runner's UTC day", () => {
  // 만료예정일 2026-11-06 falls due at 2026-11-05T15:00Z. From 2026-10-05T23:00Z
  // that is 30d16h — inside the window, so the reminder is due. Parsing the date
  // as UTC midnight instead puts the deadline 9 hours later, 31d01h out, and the
  // reminder stays silent through the day it should have opened. The cron runs
  // hourly-ish in UTC, so this is the boundary that actually decides the day.
  const finding = assessExpiries(expiry("2026-11-06"), Date.parse("2026-10-05T23:00:00Z"));
  assert.equal(finding?.rows[0].days, 30);
});

test("every recorded expiry names a credential .env.example still declares", () => {
  // A phantom row would keep nagging for a key that no longer exists, and a
  // renamed one would go unwatched. The env file is the project's credential
  // inventory (lib/environmentExample.test.ts), so bind the dates to it.
  const text = readFileSync(join(import.meta.dirname, "..", ".env.example"), "utf8");
  const declared = new Set(Array.from(text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm), (m) => m[1]));
  const phantom = CREDENTIAL_EXPIRIES.map((entry) => entry.variable).filter((name) => !declared.has(name));
  assert.deepEqual(phantom, [], `recorded expiries for ${phantom.join(", ")}, which .env.example never mentions`);
});

test("recorded expiry dates are real calendar dates", () => {
  assert.doesNotThrow(() => assessExpiries(CREDENTIAL_EXPIRIES, now));
});

/**
 * The real shape of run 35621896930, taken from the jobs API. Note that every
 * step reports `success`: `continue-on-error` masks the failure at the step
 * level too, so only `skipped` marks where the pipeline stopped. Attempts 1 and
 * 3 cleared the preflight and died in the capture within seconds; only attempt 2
 * met the KMA route. An incident that says "failure" cannot tell those apart.
 */
test("the incident records which stage each capture attempt died at", () => {
  const at = (iso: string) => Date.parse(`2026-09-21T${iso}Z`);
  const step = (name: string, conclusion: string, from: string, to: string) => ({
    name,
    conclusion,
    started_at: new Date(at(from)).toISOString(),
    completed_at: new Date(at(to)).toISOString(),
  });

  const summary = summarizeCaptureAttempts([
    { name: "capture_1", conclusion: "success", steps: [
      step("Set up job", "success", "15:52:41", "15:52:43"),
      step("Record when collection began", "success", "15:52:43", "15:52:43"),
      step("Check KMA ASOS transport", "success", "15:52:53", "15:52:55"),
      step("Record this runner's egress address", "success", "15:52:55", "15:52:55"),
      step("Install dependencies", "success", "15:52:55", "15:53:05"),
      step("Capture observations and next-day forecasts", "success", "15:53:05", "15:53:07"),
      step("Report an unsuccessful attempt", "success", "15:53:07", "15:53:07"),
      step("Post Checkout code", "success", "15:53:07", "15:53:07"),
    ] },
    { name: "capture_2", conclusion: "success", steps: [
      step("Wait for a distinct sample of the KMA route", "success", "15:53:18", "16:02:43"),
      step("Check KMA ASOS transport", "success", "16:02:43", "16:04:24"),
      // `if: always()`, so it runs *between* the failed preflight and the skips.
      step("Record this runner's egress address", "success", "16:04:24", "16:04:24"),
      step("Install dependencies", "skipped", "16:04:24", "16:04:24"),
      step("Capture observations and next-day forecasts", "skipped", "16:04:24", "16:04:24"),
    ] },
    { name: "verdict", conclusion: "failure", steps: [
      step("Report final collection result", "failure", "16:18:02", "16:18:02"),
    ] },
  ]);

  assert.ok(summary);
  // The distinction three fixes missed: attempt 1 never had a route problem.
  assert.match(summary, /`capture_1` — failed at \*\*Capture observations and next-day forecasts\*\* after 2s\./);
  // The always-run egress step must not be mistaken for the failure point.
  assert.match(summary, /`capture_2` — failed at \*\*Check KMA ASOS transport\*\* after 101s\./);
  // `verdict` fails on every failed run and names no cause; it is pure noise here.
  assert.doesNotMatch(summary, /verdict/);
});

test("a capture summary degrades rather than lying when steps are missing", () => {
  assert.equal(summarizeCaptureAttempts([]), null);
  assert.equal(summarizeCaptureAttempts([{ name: "verdict", conclusion: "failure" }]), null);
  assert.match(
    summarizeCaptureAttempts([{ name: "capture_1", conclusion: "success" }]) ?? "",
    /no steps recorded/,
  );
  // An unparseable timestamp must drop the duration, never print NaN.
  const summary = summarizeCaptureAttempts([{
    name: "capture", conclusion: "success",
    steps: [{ name: "Capture observations and next-day forecasts", conclusion: "success", started_at: "nope", completed_at: null }],
  }]) ?? "";
  assert.match(summary, /failed at \*\*Capture observations and next-day forecasts\*\*\./);
  assert.doesNotMatch(summary, /NaN/);
});
