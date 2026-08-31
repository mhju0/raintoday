import assert from "node:assert/strict";
import test from "node:test";
import { clearCache } from "../cache.ts";
import { createForecastLocation } from "../location.ts";
import { visualCrossingProvider } from "./visual-crossing.ts";

const SEOUL = createForecastLocation({ name: "서울", latitude: 37.5665, longitude: 126.978 });

/** 2026-08-31T16:30+09:00 and the hours after it, as unix seconds. */
const NOW_EPOCH = 1788161400;
const HOUR = 3_600;

function payload() {
  return {
    queryCost: 1,
    days: [
      {
        datetime: "2026-08-31",
        datetimeEpoch: NOW_EPOCH,
        tempmax: 25.5,
        tempmin: 21.5,
        precip: 56.5,
        // 100, not 1.0 — the whole point of the units note in the module.
        precipprob: 100,
        preciptype: ["rain"],
        icon: "rain",
        sunriseEpoch: 1788123667,
        sunsetEpoch: 1788170609,
        hours: [
          { datetimeEpoch: NOW_EPOCH + HOUR, temp: 22, precipprob: 84, precip: 4.3, windspeed: 7.6, humidity: 97.6, icon: "rain", preciptype: ["rain"] },
          { datetimeEpoch: NOW_EPOCH + 2 * HOUR, temp: 21.6, precipprob: 0, precip: 0, windspeed: 6, humidity: 90, icon: "cloudy", preciptype: null },
        ],
      },
      {
        datetime: "2026-09-01",
        datetimeEpoch: NOW_EPOCH + 24 * HOUR,
        tempmax: 26.6,
        tempmin: 21.5,
        precip: 15.9,
        precipprob: 97,
        preciptype: ["freezingrain"],
        icon: "rain",
        sunriseEpoch: 1788210117,
        sunsetEpoch: 1788257000,
        hours: [],
      },
    ],
    currentConditions: {
      datetimeEpoch: NOW_EPOCH,
      temp: 25,
      feelslike: 25,
      humidity: 99.6,
      windspeed: 10.5,
      winddir: 152,
      windgust: null,
      precip: 4.3,
      precipprob: 84,
      preciptype: ["rain"],
      cloudcover: 100,
      visibility: 9.3,
      icon: "rain",
    },
  };
}

async function readWith(body: unknown, nowMs = NOW_EPOCH * 1_000) {
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  const previousKey = process.env.VISUAL_CROSSING_API_KEY;
  process.env.VISUAL_CROSSING_API_KEY = "visual-crossing-fake-key-for-tests";
  clearCache();
  try {
    let requested = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested = String(input);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    Date.now = () => nowMs;
    const snapshot = await visualCrossingProvider.read(SEOUL);
    return { snapshot, requested };
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
    if (previousKey === undefined) delete process.env.VISUAL_CROSSING_API_KEY;
    else process.env.VISUAL_CROSSING_API_KEY = previousKey;
    clearCache();
  }
}

test("probabilities are read as percentages, never divided", async () => {
  const { snapshot } = await readWith(payload());
  assert.equal(snapshot.status.availability, "ok");
  // A provider that divided by 100 would put 1 here and quietly report every day
  // as almost certainly dry.
  assert.equal(snapshot.daily[0].precipitationProbability, 100);
  assert.equal(snapshot.daily[1].precipitationProbability, 97);
  assert.equal(snapshot.hourly[0].precipitationProbability, 84);
  assert.equal(snapshot.current?.precipitationProbability, 84);
});

test("a published zero stays a zero and never becomes a gap", async () => {
  const { snapshot } = await readWith(payload());
  assert.equal(snapshot.hourly[1].precipitationProbability, 0);
  assert.equal(snapshot.hourly[1].precipitationAmount, 0);
});

test("times normalize to KST and the day carries its own amount", async () => {
  const { snapshot } = await readWith(payload());
  assert.equal(snapshot.current?.time, "2026-08-31T16:30:00.000+09:00");
  assert.equal(snapshot.hourly[0].time, "2026-08-31T17:30:00.000+09:00");
  assert.equal(snapshot.daily[0].date, "2026-08-31");
  assert.equal(snapshot.daily[0].precipitationAmount, 56.5);
  assert.match(snapshot.daily[0].sunrise ?? "", /\+09:00$/);
});

test("freezing precipitation is read from preciptype, which has no icon of its own", async () => {
  const { snapshot } = await readWith(payload());
  assert.equal(snapshot.daily[0].condition, "rain");
  assert.equal(snapshot.daily[1].condition, "sleet", "icon says rain; their own preciptype says freezing");
});

test("the request stays on the fixed upstream origin and asks for metric units", async () => {
  const { requested } = await readWith(payload());
  const url = new URL(requested);
  assert.equal(url.origin, "https://weather.visualcrossing.com");
  assert.equal(url.searchParams.get("unitGroup"), "metric");
  assert.match(url.pathname, /\/timeline\/37\.5665,126\.978$/);
});

/**
 * The outlook keeps the first seven dates in the union of every provider's days.
 * Visual Crossing answers 15 for the same one-record cost, and letting all of them
 * through would put dates in that union only this provider can answer — a single
 * forecast rendered in a row the page presents as a multi-source average.
 */
test("the day horizon is bounded so one source cannot own an outlook row", async () => {
  const body = payload();
  const template = body.days[1];
  body.days = Array.from({ length: 15 }, (_unused, index) => ({
    ...template,
    datetime: `2026-09-${String(index + 1).padStart(2, "0")}`,
    datetimeEpoch: NOW_EPOCH + (index + 1) * 24 * HOUR,
  }));
  const { snapshot } = await readWith(body);
  assert.equal(snapshot.daily.length, 8);
});

test("a response with no current conditions fails rather than inventing one", async () => {
  const body = payload();
  delete (body as { currentConditions?: unknown }).currentConditions;
  const { snapshot } = await readWith(body);
  assert.equal(snapshot.status.availability, "error");
  assert.equal(snapshot.current, null);
});

test("a missing key is an honest absence, not a fault", async () => {
  const previousKey = process.env.VISUAL_CROSSING_API_KEY;
  delete process.env.VISUAL_CROSSING_API_KEY;
  clearCache();
  try {
    const snapshot = await visualCrossingProvider.read(SEOUL);
    assert.equal(snapshot.status.availability, "needs-config");
    assert.deepEqual(snapshot.status.missingEnvVars, ["VISUAL_CROSSING_API_KEY"]);
  } finally {
    if (previousKey !== undefined) process.env.VISUAL_CROSSING_API_KEY = previousKey;
    clearCache();
  }
});
