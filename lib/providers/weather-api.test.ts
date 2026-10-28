import assert from "node:assert/strict";
import test from "node:test";
import { clearCache } from "../cache.ts";
import { createForecastLocation } from "../location.ts";
import { weatherApiProvider } from "./weather-api.ts";

const SEOUL = createForecastLocation({ name: "서울", latitude: 37.5665, longitude: 126.978 });

/** 2026-08-31T16:30+09:00 and the hours after it, as unix seconds. */
const NOW_EPOCH = 1788161400;
const HOUR = 3_600;

function hour(offset: number, precip?: number) {
  return {
    time_epoch: NOW_EPOCH + offset * HOUR,
    temp_c: 22,
    humidity: 90,
    wind_kph: 7,
    chance_of_rain: 84,
    ...(precip === undefined ? {} : { precip_mm: precip }),
    condition: { code: 1183 },
  };
}

function payload() {
  return {
    current: {
      last_updated_epoch: NOW_EPOCH,
      temp_c: 25,
      humidity: 99,
      wind_kph: 10,
      condition: { code: 1183 },
    },
    forecast: {
      forecastday: [
        {
          date: "2026-08-31",
          day: { maxtemp_c: 25, mintemp_c: 21, daily_chance_of_rain: 89, totalprecip_mm: 5.3, condition: { code: 1183 } },
          astro: { sunrise: "06:01 AM", sunset: "07:03 PM" },
          hour: [hour(1, 4.3), hour(2, 0), hour(3)],
        },
      ],
    },
  };
}

async function read() {
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  const previousKey = process.env.WEATHERAPI_KEY;
  process.env.WEATHERAPI_KEY = "weather-api-fake-key-for-tests";
  clearCache();
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify(payload()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
    Date.now = () => NOW_EPOCH * 1_000;
    return await weatherApiProvider.read(SEOUL);
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
    if (previousKey === undefined) delete process.env.WEATHERAPI_KEY;
    else process.env.WEATHERAPI_KEY = previousKey;
    clearCache();
  }
}

test("each hour carries its own amount; a published zero stays zero and a missing one is a gap", async () => {
  const snapshot = await read();
  assert.equal(snapshot.status.availability, "ok");
  assert.deepEqual(snapshot.hourly.map((h) => h.precipitationAmount), [4.3, 0, null]);
  assert.equal(snapshot.daily[0].precipitationAmount, 5.3);
});
