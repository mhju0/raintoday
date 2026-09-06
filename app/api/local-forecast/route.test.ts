import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route.ts";
import { clearRateLimits } from "../../../lib/rateLimit.ts";

test("invalid forecast bodies return 400 through the actual route", async () => {
  clearRateLimits();
  for (const body of ["", "{", "null", "[]", "42", '{"latitude":35.6,"longitude":139.6}']) {
    const response = await POST(new Request("https://example.test/api/local-forecast", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    }));
    assert.equal(response.status, 400, `body: ${body}`);
    assert.deepEqual(await response.json(), { error: "invalid_location" });
  }
});

test("GPS naming and forecast retrieval start together and retain the resolved name", async (t) => {
  const keys = ["KAKAO_REST_API_KEY", "KMA_SHORT_TERM_API_KEY", "PIRATE_WEATHER_API_KEY",
    "WEATHERAPI_KEY", "VISUAL_CROSSING_API_KEY", "PERFORMANCE_DATABASE_URL"];
  const saved = keys.map((key) => process.env[key]);
  for (const key of keys) delete process.env[key];
  process.env.KAKAO_REST_API_KEY = "test-only";
  t.after(() => keys.forEach((key, index) => {
    if (saved[index] === undefined) delete process.env[key];
    else process.env[key] = saved[index];
  }));
  const started: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const hostname = new URL(String(input)).hostname;
    started.push(hostname);
    await gate;
    if (hostname === "dapi.kakao.com") return Response.json({ documents: [{
      region_type: "H", region_1depth_name: "서울특별시", region_2depth_name: "종로구",
      region_3depth_name: "청운효자동",
    }] });
    assert.equal(hostname, "api.open-meteo.com");
    return Response.json({
      current: { time: "2026-09-05T12:00", temperature_2m: 24, weather_code: 0 },
      hourly: { time: [] }, daily: { time: [] },
    });
  });
  const read = POST(new Request("https://example.test/api/local-forecast", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latitude: 37.5714, longitude: 126.9658 }),
  }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  try { assert.deepEqual(started.sort(), ["api.open-meteo.com", "dapi.kakao.com"]); }
  finally { release(); await read; }
  const response = await read;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.locationName, "서울특별시 종로구 청운효자동");
});
