import assert from "node:assert/strict";
import test from "node:test";
import { assessRuns, parseQuotaHeader, transportFailure } from "./maintenance.ts";

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
