import assert from "node:assert/strict";
import test from "node:test";

import { ERROR_REPORT_ORIGIN, scrubErrorReport } from "./errorReport.ts";

test("an error report carries the page address without the chosen place", () => {
  const report = scrubErrorReport({
    request: { url: "https://raintoday.vercel.app/?lat=37.5665&lon=126.978&name=%EC%84%9C%EC%9A%B8&area=h" },
  });
  assert.equal(report.request?.url, "https://raintoday.vercel.app/");
});

test("the referring address in an error report loses the chosen place too", () => {
  const report = scrubErrorReport({
    request: {
      url: "https://raintoday.vercel.app/behind-the-data",
      headers: { Referer: "https://raintoday.vercel.app/?lat=37.5&lon=127", "User-Agent": "x" },
    },
  });
  assert.deepEqual(report.request?.headers, { Referer: "https://raintoday.vercel.app/", "User-Agent": "x" });
});

test("an error report names no visitor", () => {
  const report = scrubErrorReport({ user: { ip_address: "203.0.113.7", id: "x" } });
  assert.equal(report.user, undefined);
});

test("a report without an address passes through", () => {
  const report: { message: string; user?: unknown } = { message: "boom" };
  assert.deepEqual(scrubErrorReport(report), { message: "boom" });
});

test("the content security policy allows the report address and nothing wider", async () => {
  const config = (await import("../next.config.ts")).default;
  const headers = await config.headers!();
  const policy = headers[0].headers.find((header) => header.key === "Content-Security-Policy")!.value;
  assert.match(policy, new RegExp(`connect-src 'self' ${ERROR_REPORT_ORIGIN.replaceAll(".", "\\.")}(;|$| )`));
});
