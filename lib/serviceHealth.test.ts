import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkForecastResponse,
  EXPECTED_FORECAST_PROVIDER_IDS,
} from "./serviceHealth.ts";

const fullForecast = {
  influence: EXPECTED_FORECAST_PROVIDER_IDS.map((id) => ({ id })),
  recommendation: { precipitationProbability: 42 },
};

test("a complete forecast passes on the first request", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await checkForecastResponse("https://example.test/forecast", {
    fetchImpl: async () => {
      calls += 1;
      return Response.json(fullForecast);
    },
    delay: async (ms) => { delays.push(ms); },
  });

  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
  assert.deepEqual(result, {
    ok: true,
    attempts: 1,
    providerCount: 5,
    probability: 42,
    recovered: false,
    firstFailure: null,
  });
});

test("an incomplete 200 is confirmed once after the provider failure cooldown", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await checkForecastResponse("https://example.test/forecast", {
    fetchImpl: async () => Response.json(calls++ === 0
      ? { ...fullForecast, influence: fullForecast.influence.slice(0, 4) }
      : fullForecast),
    delay: async (ms) => { delays.push(ms); },
  });

  assert.equal(calls, 2);
  assert.deepEqual(delays, [31_000]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.recovered, true);
    assert.match(result.firstFailure ?? "", /missing visual-crossing/);
  }
});

test("duplicate provider ids cannot make a partial response pass", async () => {
  let calls = 0;
  const duplicate = {
    ...fullForecast,
    influence: [
      ...fullForecast.influence.slice(0, 4),
      { id: "open-meteo" },
    ],
  };
  const result = await checkForecastResponse("https://example.test/forecast", {
    fetchImpl: async () => {
      calls += 1;
      return Response.json(duplicate);
    },
    delay: async () => {},
  });

  assert.equal(calls, 2);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.detail, /missing visual-crossing/);
});

test("an absent recommendation probability cannot pass", async () => {
  let calls = 0;
  const result = await checkForecastResponse("https://example.test/forecast", {
    fetchImpl: async () => {
      calls += 1;
      return Response.json({ influence: fullForecast.influence, recommendation: {} });
    },
    delay: async () => {},
  });

  assert.equal(calls, 2);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.detail, /probability not usable/);
});

test("retryable HTTP failures cancel their bodies and do not expose fetch errors", async () => {
  let cancelled = false;
  let calls = 0;
  const result = await checkForecastResponse("https://example.test/forecast", {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(new ReadableStream({
          cancel() { cancelled = true; },
        }), { status: 503 });
      }
      throw new Error("secret-bearing diagnostic");
    },
    delay: async () => {},
  });

  assert.equal(calls, 3);
  assert.equal(cancelled, true);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.detail, "request failed");
    assert.doesNotMatch(JSON.stringify(result), /secret-bearing/);
  }
});

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

async function runHealthScript(mode: "recover" | "persistent") {
  const preload = `
    const ids = ["open-meteo", "kma", "pirate-weather", "weather-api", "visual-crossing"];
    let forecastCalls = 0;
    globalThis.setTimeout = (callback) => { queueMicrotask(callback); return 1; };
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/api/local-forecast")) {
        forecastCalls += 1;
        const complete = process.env.HEALTH_FIXTURE_MODE === "recover" && forecastCalls === 2;
        return Response.json({
          influence: (complete ? ids : ids.slice(0, 4)).map((id) => ({ id })),
          recommendation: { precipitationProbability: 42 },
        });
      }
      if (url.includes("/api/locations/search")) return Response.json({ results: [{}] });
      if (url.startsWith("https://api.pirateweather.net/forecast/")) {
        return new Response("{}", { status: 200, headers: {
          "ratelimit-remaining": "10000",
          "ratelimit-reset": "0",
          "ratelimit-limit": "10000",
        }});
      }
      return new Response("ok", { status: 200 });
    };
  `;
  const importUrl = `data:text/javascript;base64,${Buffer.from(preload).toString("base64")}`;
  const child = spawn(process.execPath, ["--import", importUrl, "scripts/service-health.ts"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      HEALTH_FIXTURE_MODE: mode,
      PIRATE_WEATHER_API_KEY: "fixture-key",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const exitCode = await new Promise<number | null>((resolve) => child.once("close", resolve));
  return { exitCode, stdout, stderr };
}

test("the service-health script logs and recovers a transient partial forecast", async () => {
  const result = await runHealthScript("recover");
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /forecast attempt 1 incomplete.*missing visual-crossing/);
  assert.match(result.stdout, /forecast.*recovered on attempt 2/);
  assert.match(result.stdout, /4\/4 checks passed/);
});

test("the service-health script fails after one confirmation stays partial", async () => {
  const result = await runHealthScript("persistent");
  assert.equal(result.exitCode, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /forecast attempt 1 incomplete.*missing visual-crossing/);
  assert.match(result.stdout, /FAIL  forecast.*missing visual-crossing/);
  assert.match(result.stdout, /failing: forecast/);
});
