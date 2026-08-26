import assert from "node:assert/strict";
import test from "node:test";
import { clearCache } from "../cache.ts";
import { buildPirateWeatherUrl, pirateWeatherProvider } from "./pirate-weather.ts";

test("Pirate Weather URL keeps credentials on the fixed upstream origin", () => {
  const url = buildPirateWeatherUrl("0123456789abcdef");
  assert.equal(url.origin, "https://api.pirateweather.net");
  assert.equal(url.searchParams.get("units"), "si");
  assert.match(url.pathname, /^\/forecast\/0123456789abcdef\//);
});

test("Pirate Weather URL rejects path and query injection in credentials", () => {
  for (const key of ["short", "0123456789abcdef/../admin", "0123456789abcdef?units=us"]) {
    assert.throws(() => buildPirateWeatherUrl(key), /invalid API key format/);
  }
});

test("Pirate Weather's daily amount is read from the intensity it publishes", async () => {
  // Its daily `precipIntensity` is the unconditional 24-hour mean in mm/h, so
  // intensity x 24 is the day's total — and it equals the sum of the provider's own
  // hourly series exactly, on every rainy day measured. Leaving it unread was the
  // reason a four-provider probability sat beside a two-provider amount.
  const real = globalThis.fetch;
  const previousKey = process.env.PIRATE_WEATHER_API_KEY;
  process.env.PIRATE_WEATHER_API_KEY = "0123456789abcdef0123456789abcdef";
  clearCache();
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      currently: { time: 1787600000, temperature: 25, precipProbability: 0.2 },
      hourly: { data: [] },
      daily: { data: [
        { time: 1787670000, icon: "rain", temperatureHigh: 29, temperatureLow: 23,
          precipProbability: 0.76, precipIntensity: 1.0042 },
        { time: 1787756400, icon: "clear-day", temperatureHigh: 30, temperatureLow: 24,
          precipProbability: 0, precipIntensity: 0 },
        { time: 1787842800, icon: "cloudy", temperatureHigh: 28, temperatureLow: 22,
          precipProbability: 0.3 },
      ] },
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;

    const snapshot = await pirateWeatherProvider.read(
      { latitude: 37.5714, longitude: 126.9658, name: "서울" } as never,
    );
    const amounts = snapshot.daily.map((day) => day.precipitationAmount);
    assert.equal(amounts[0], 24.1, "1.0042 mm/h over 24 h is the day's 24.1 mm total");
    assert.equal(amounts[1], 0, "a dry day is a measured zero, not a missing amount");
    assert.equal(amounts[2], null, "a day with no published intensity stays null, never 0");
  } finally {
    globalThis.fetch = real;
    if (previousKey === undefined) delete process.env.PIRATE_WEATHER_API_KEY;
    else process.env.PIRATE_WEATHER_API_KEY = previousKey;
    clearCache();
  }
});
