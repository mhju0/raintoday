import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assessExpiries, assessRuns, CREDENTIAL_EXPIRIES, parseQuotaHeader, transportFailure } from "./maintenance.ts";

const now = Date.parse("2026-09-07T00:00:00Z");
test("a failed collection remains an incident even when an older run succeeded", () => {
  assert.match(assessRuns([
    { status: "completed", conclusion: "failure", created_at: "2026-09-06T12:00:00Z", html_url: "failed" },
    { status: "completed", conclusion: "success", created_at: "2026-09-06T00:00:00Z", html_url: "old" },
  ], now, 18)?.detail ?? "", /failure/);
});
test("queued runs cannot conceal an overdue collection", () => {
  assert.equal(assessRuns([{ status: "queued", conclusion: null, created_at: "2026-09-06T23:00:00Z", html_url: "queued" }], now, 18)?.kind, "stale");
});
test("fresh recovery clears an incident; a stale success does not", () => {
  const run = { status: "completed", conclusion: "success", created_at: "2026-09-06T12:00:00Z", html_url: "ok" };
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
