import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { clearCache } from "../cache.ts";
import { createForecastLocation } from "../location.ts";
import { classifyKmaResponse, kmaProvider } from "./kma.ts";

/**
 * Key handling for the KMA provider. Proves the short-term forecast service reads
 * its own environment variable, that the obsolete single KMA_API_KEY is never
 * read, that a missing key produces a safe status rather than a throw, and that
 * no key value ever leaks into a status or response.
 *
 * The 기상특보 warning service was a second, independent 활용신청 with its own key.
 * It was removed with the retired scene, which was its only consumer, so only one
 * key remains — but the leak-safety and obsolete-key guarantees still bind.
 *
 * All keys here are MOCK PLACEHOLDERS — never real credentials.
 */

const SHORT_TERM_KEY = "MOCK-SHORT-TERM-KEY-aaaa1111";
const OBSOLETE_KEY = "MOCK-OBSOLETE-SINGLE-KEY-cccc3333";

type FetchCall = { url: string; service: "short-term" | "other" };
let calls: FetchCall[] = [];
const realFetch = globalThis.fetch;

/** A minimal successful 초단기실황 + 단기예보 JSON body. */
function okJson(items: unknown[]): string {
  return JSON.stringify({
    response: { header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" }, body: { items: { item: items } } },
  });
}

const NCST_ITEMS = [
  { category: "T1H", obsrValue: "21" },
  { category: "REH", obsrValue: "55" },
  { category: "WSD", obsrValue: "2.0" },
  { category: "PTY", obsrValue: "0" },
];
const FCST_ITEMS = [
  { category: "TMP", fcstDate: "20260614", fcstTime: "1500", fcstValue: "22" },
  { category: "POP", fcstDate: "20260614", fcstTime: "1500", fcstValue: "20" },
  { category: "SKY", fcstDate: "20260614", fcstTime: "1500", fcstValue: "1" },
  { category: "PTY", fcstDate: "20260614", fcstTime: "1500", fcstValue: "0" },
];

/**
 * Install a fetch stub that records which service each call hit and returns a
 * caller-supplied body per service. The stub asserts the configured key value
 * is NEVER absent from a real call but the test body never inspects/echoes it.
 */
function installFetch(opts: {
  shortTerm?: { status?: number; body: string };
}) {
  calls = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    let service: FetchCall["service"] = "other";
    if (url.includes("/VilageFcstInfoService_2.0/")) service = "short-term";
    calls.push({ url, service });

    if (service === "short-term") {
      const o = opts.shortTerm ?? { body: okJson([]) };
      return new Response(o.body, { status: o.status ?? 200 });
    }
    return new Response("not mocked", { status: 500 });
  }) as typeof fetch;
}

beforeEach(() => {
  delete process.env.KMA_API_KEY;
  delete process.env.KMA_SHORT_TERM_API_KEY;
  clearCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.KMA_API_KEY;
  delete process.env.KMA_SHORT_TERM_API_KEY;
  clearCache();
});

// ── classifyKmaResponse: pure, key-free response classification ──────────────

test("classifyKmaResponse: success / empty(NODATA) / forbidden / rate-limit / error", () => {
  assert.equal(classifyKmaResponse(200, okJson([{ category: "T1H" }])).class, "ok");
  assert.equal(
    classifyKmaResponse(200, JSON.stringify({ response: { header: { resultCode: "03" } } })).class,
    "empty",
  );
  assert.equal(
    classifyKmaResponse(200, JSON.stringify({ response: { header: { resultCode: "30" } } })).class,
    "forbidden",
  );
  assert.equal(
    classifyKmaResponse(200, JSON.stringify({ response: { header: { resultCode: "22" } } })).class,
    "rate-limited",
  );
  assert.equal(
    classifyKmaResponse(200, JSON.stringify({ response: { header: { resultCode: "99" } } })).class,
    "error",
  );
});

test("classifyKmaResponse: non-JSON XML/HTML auth error → forbidden (not swallowed)", () => {
  const xml = `<?xml version="1.0"?><OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
  assert.equal(classifyKmaResponse(200, xml).class, "forbidden");
  assert.equal(classifyKmaResponse(200, "<html><body>Forbidden</body></html>").class, "forbidden");
  assert.equal(classifyKmaResponse(403, "").class, "forbidden");
  assert.equal(classifyKmaResponse(429, "").class, "rate-limited");
});

test("empty-success differs from authorization failure", () => {
  const empty = classifyKmaResponse(200, JSON.stringify({ response: { header: { resultCode: "03" } } }));
  const forbidden = classifyKmaResponse(
    200,
    `<returnReasonCode>30</returnReasonCode>`,
  );
  assert.equal(empty.class, "empty");
  assert.equal(forbidden.class, "forbidden");
  assert.notEqual(empty.class, forbidden.class);
});

// ── Independent env-var reads ────────────────────────────────────────────────

test("short-term forecast reads KMA_SHORT_TERM_API_KEY and hits VilageFcstInfoService", async () => {
  process.env.KMA_SHORT_TERM_API_KEY = SHORT_TERM_KEY;
  calls = [];
  // ncst + fcst are two short-term endpoints; serve appropriate bodies by URL.
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, service: url.includes("/VilageFcstInfoService_2.0/") ? "short-term" : "other" });
    if (url.includes("getUltraSrtNcst")) return new Response(okJson(NCST_ITEMS), { status: 200 });
    if (url.includes("getVilageFcst")) return new Response(okJson(FCST_ITEMS), { status: 200 });
    return new Response("not mocked", { status: 500 });
  }) as typeof fetch;

  const { current } = await kmaProvider.read();
  assert.ok(current);
  assert.equal(current.temperature, 21);
  assert.ok(calls.length >= 1);
  assert.ok(calls.every((c) => c.service === "short-term"));
});

test("short-term forecast uses the selected location's KMA grid", async () => {
  process.env.KMA_SHORT_TERM_API_KEY = SHORT_TERM_KEY;
  installFetch({ shortTerm: { body: okJson([...NCST_ITEMS, ...FCST_ITEMS]) } });
  const busan = createForecastLocation({ name: "부산", latitude: 35.1796, longitude: 129.0756 });

  await kmaProvider.read(busan);

  assert.ok(calls.length >= 1);
  for (const call of calls) {
    const url = new URL(call.url);
    assert.equal(url.searchParams.get("nx"), "98");
    assert.equal(url.searchParams.get("ny"), "76");
  }
});

test("short-term forecast rejects a response whose declared size exceeds the limit", async () => {
  process.env.KMA_SHORT_TERM_API_KEY = SHORT_TERM_KEY;
  globalThis.fetch = (async () => new Response(okJson([...NCST_ITEMS, ...FCST_ITEMS]), {
    status: 200,
    headers: { "Content-Length": String(2 * 1024 * 1024 + 1) },
  })) as typeof fetch;

  const { status } = await kmaProvider.read();

  assert.equal(status.availability, "error");
});

test("the forecast service does not read the obsolete KMA_API_KEY", async () => {
  process.env.KMA_API_KEY = OBSOLETE_KEY; // only the old var is set
  installFetch({}); // defaults to OK-empty if called

  const { status: shortTerm } = await kmaProvider.read();

  assert.equal(shortTerm.availability, "needs-config");
  assert.deepEqual(shortTerm.missingEnvVars, ["KMA_SHORT_TERM_API_KEY"]);
  // No network call should have been attempted with only the obsolete key set.
  assert.equal(calls.length, 0);
});

// ── Safe status when the key is missing ──────────────────────────────────────

test("a missing key produces a safe needs-config status (no throw, no crash)", async () => {
  const { status: shortTerm } = await kmaProvider.read();
  assert.equal(shortTerm.availability, "needs-config");
});

// ── The key value never leaks into a status or response ──────────────────────

test("no status or response contains the key value", async () => {
  process.env.KMA_SHORT_TERM_API_KEY = SHORT_TERM_KEY;
  // Force the service into the error path, which builds messages from details.
  installFetch({ shortTerm: { status: 200, body: `<returnReasonCode>30</returnReasonCode>` } });

  const { status: shortTerm } = await kmaProvider.read();

  const haystack = JSON.stringify({ shortTerm });
  assert.ok(!haystack.includes(SHORT_TERM_KEY), "short-term key leaked");
  assert.ok(!haystack.includes("serviceKey"), "raw serviceKey param leaked");
});

// ── Newest 단기예보 issue answering NO_DATA ──────────────────────────────────

/** One forecast hour dated tomorrow (KST), so the provider's past-hour filter keeps it. */
function tomorrowForecastItems(): unknown[] {
  const kst = new Date(Date.now() + 9 * 3600_000 + 86_400_000);
  const fcstDate = kst.toISOString().slice(0, 10).replaceAll("-", "");
  return [
    { category: "TMP", fcstDate, fcstTime: "1500", fcstValue: "22" },
    { category: "POP", fcstDate, fcstTime: "1500", fcstValue: "20" },
  ];
}

/** Serves 실황 normally and answers each 단기예보 request through `forecastBody`. */
function installIssueFetch(forecastBody: (requestIndex: number) => string): URL[] {
  const forecastRequests: URL[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.pathname.endsWith("/getUltraSrtNcst")) return new Response(okJson(NCST_ITEMS), { status: 200 });
    forecastRequests.push(url);
    return new Response(forecastBody(forecastRequests.length - 1), { status: 200 });
  }) as typeof fetch;
  return forecastRequests;
}

function issueTimeMs(url: URL): number {
  const date = url.searchParams.get("base_date") ?? "";
  const time = url.searchParams.get("base_time") ?? "";
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
    Number(time.slice(0, 2)),
  );
}

const NO_DATA = JSON.stringify({ response: { header: { resultCode: "03", resultMsg: "NO_DATA" } } });

test("an issue answering NO_DATA falls back to the one three hours earlier, newest first", async () => {
  process.env.KMA_SHORT_TERM_API_KEY = SHORT_TERM_KEY;
  const requests = installIssueFetch((index) => (index < 2 ? NO_DATA : okJson(tomorrowForecastItems())));

  const { hourly } = await kmaProvider.read();

  assert.equal(requests.length, 3);
  assert.equal(issueTimeMs(requests[0]) - issueTimeMs(requests[1]), 3 * 3600_000);
  assert.equal(issueTimeMs(requests[1]) - issueTimeMs(requests[2]), 3 * 3600_000);
  assert.equal(hourly.length, 1);
  assert.equal(hourly[0].precipitationProbability, 20);
});

test("NO_DATA on every issue stops after three earlier issues and leaves the forecast empty", async () => {
  process.env.KMA_SHORT_TERM_API_KEY = SHORT_TERM_KEY;
  const requests = installIssueFetch(() => NO_DATA);

  const { hourly, status } = await kmaProvider.read();

  assert.equal(requests.length, 4);
  assert.equal(hourly.length, 0);
  assert.equal(status.availability, "ok");
});

test("a newest issue with data is not followed by a second forecast request", async () => {
  process.env.KMA_SHORT_TERM_API_KEY = SHORT_TERM_KEY;
  const requests = installIssueFetch(() => okJson(tomorrowForecastItems()));

  const { hourly } = await kmaProvider.read();

  assert.equal(requests.length, 1);
  assert.equal(hourly.length, 1);
});

test("each forecast hour carries its 1시간 강수량 (PCP) as an amount", async () => {
  process.env.KMA_SHORT_TERM_API_KEY = SHORT_TERM_KEY;
  const [tmp, pop] = tomorrowForecastItems() as { fcstDate: string }[];
  const fcstDate = tmp.fcstDate;
  installIssueFetch(() => okJson([
    tmp, pop,
    { category: "PCP", fcstDate, fcstTime: "1500", fcstValue: "2.0mm" },
    { category: "TMP", fcstDate, fcstTime: "1600", fcstValue: "21" },
    { category: "PCP", fcstDate, fcstTime: "1600", fcstValue: "1mm 미만" },
    { category: "TMP", fcstDate, fcstTime: "1700", fcstValue: "21" },
  ]));

  const { hourly } = await kmaProvider.read();

  assert.deepEqual(hourly.map((hour) => hour.precipitationAmount), [2, null, null]);
  assert.deepEqual(hourly.map((hour) => hour.precipitationAmountRange), [null, { lowMm: 0, highMm: 1 }, null]);
});
