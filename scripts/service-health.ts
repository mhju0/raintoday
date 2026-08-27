/**
 * Checks that a visitor can use 오늘비 right now, and that the one metered
 * provider quota still has runway.
 *
 *     npm run service:health
 *     npm run service:health -- --target=local
 *
 * Everything else that watches this project watches the evidence pipeline. The
 * scheduled jobs prove the collector's credentials work; they say nothing about
 * the served path, which reads its keys from a different store. A key rotated in
 * one place and not the other leaves the pipeline green while the site degrades,
 * with nothing to report it — this closes that gap.
 *
 * Deliberately tolerant of one missing provider. Losing one of four is ordinary
 * upstream noise and self-heals; losing two is systemic. A check that pages on
 * noise gets ignored, which is worse than not having it.
 */
import { FALLBACK_STATION_CATALOG } from "../lib/performance/stationCatalog.ts";
import { evaluateQuotaRunway } from "../lib/quotaRunway.ts";

/** Two scheduled cohorts a day, one call per station per cohort. */
const DAILY_PIPELINE_BURN = FALLBACK_STATION_CATALOG.length * 2;
/** Calls held back for visitor traffic beyond the pipeline's own projection. */
const VISITOR_RESERVE = 1_000;
/** Below this many compared providers the served blend is meaningfully degraded. */
const MINIMUM_PROVIDERS = 3;

const REQUEST_TIMEOUT_MS = 20_000;
const ATTEMPTS = 3;
const RETRY_GAP_MS = 5_000;

/**
 * Named targets rather than a free-form `--base`, so every URL this script
 * requests is a constant in this file. An operator cannot point the check at an
 * arbitrary host by typo or by an inherited environment variable, and the origin
 * never derives from input — which is also what keeps CodeQL's request-forgery
 * rule quiet without dismissing a finding.
 */
const TARGETS = {
  production: "https://raintoday.vercel.app",
  local: "http://localhost:3000",
} as const;

type TargetName = keyof typeof TARGETS;

function isTargetName(value: string): value is TargetName {
  return Object.hasOwn(TARGETS, value);
}

/** 서울 종로 — inside the service area and the reference station for the evidence. */
const PROBE = { name: "서울", latitude: 37.5665, longitude: 126.978 };

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline !== undefined) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const results: { name: string; ok: boolean; detail: string }[] = [];

function record(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? "  ok  " : "  FAIL"}  ${name.padEnd(24)} ${detail}\n`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A 4xx is a real answer and is returned as-is; only a transport failure, a 429
 * or a 5xx is retried. Retrying a deterministic rejection would just delay the
 * report by fifteen seconds and tell us nothing new.
 */
async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status < 500 && response.status !== 429) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < ATTEMPTS) await sleep(RETRY_GAP_MS);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function checkHomePage(base: string): Promise<void> {
  try {
    const started = Date.now();
    const response = await fetchWithRetry(base);
    const ms = Date.now() - started;
    record("page", response.ok, `HTTP ${response.status} in ${ms}ms`);
  } catch (error) {
    record("page", false, `unreachable after ${ATTEMPTS} attempts: ${(error as Error).message}`);
  }
}

async function checkForecast(base: string): Promise<void> {
  try {
    const started = Date.now();
    const response = await fetchWithRetry(`${base}/api/local-forecast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(PROBE),
    });
    const ms = Date.now() - started;
    if (!response.ok) {
      record("forecast", false, `HTTP ${response.status} in ${ms}ms`);
      return;
    }
    const body = (await response.json()) as {
      influence?: { id: string }[];
      recommendation?: { precipitationProbability?: unknown };
    };
    const providers = body.influence ?? [];
    const probability = body.recommendation?.precipitationProbability;
    // A probability outside 0..100 means something fabricated a number rather
    // than omitting an unavailable source, which the honest-fallback rule forbids.
    const usable =
      typeof probability === "number" &&
      Number.isFinite(probability) &&
      probability >= 0 &&
      probability <= 100;
    const names = providers.map((provider) => provider.id).join(", ");
    if (providers.length < MINIMUM_PROVIDERS) {
      record("forecast", false, `only ${providers.length} providers [${names}] in ${ms}ms`);
      return;
    }
    if (!usable) {
      record("forecast", false, `probability not usable: ${String(probability)}`);
      return;
    }
    record(
      "forecast",
      true,
      `${providers.length} providers, ${probability.toFixed(0)}% in ${ms}ms`,
    );
  } catch (error) {
    record("forecast", false, `unreachable after ${ATTEMPTS} attempts: ${(error as Error).message}`);
  }
}

async function checkLocationSearch(base: string): Promise<void> {
  try {
    const response = await fetchWithRetry(`${base}/api/locations/search?q=${encodeURIComponent("강남")}`);
    if (!response.ok) {
      record("location search", false, `HTTP ${response.status}`);
      return;
    }
    const body = (await response.json()) as { results?: unknown[] };
    const count = Array.isArray(body.results) ? body.results.length : 0;
    // Zero results for a real Korean place name means the Kakao credential is
    // rejected or its quota is spent — and the chooser is the only way in.
    record(
      "location search",
      count > 0,
      count > 0 ? `${count} result(s) for 강남` : "no results for 강남",
    );
  } catch (error) {
    record(
      "location search",
      false,
      `unreachable after ${ATTEMPTS} attempts: ${(error as Error).message}`,
    );
  }
}

async function checkPirateWeatherQuota(): Promise<void> {
  const key = process.env.PIRATE_WEATHER_API_KEY;
  if (!key) {
    // Fail closed. A quota we did not read is not a quota we can vouch for, and
    // in CI a missing secret is itself the finding.
    record("pirate quota", false, "PIRATE_WEATHER_API_KEY is not set");
    return;
  }
  // Pirate Weather carries its key in the path, so a key containing a slash or a
  // colon would silently retarget the request at another host. Refuse a
  // malformed secret rather than build a URL we did not intend.
  if (!/^[A-Za-z0-9_-]+$/.test(key)) {
    record("pirate quota", false, "PIRATE_WEATHER_API_KEY has an unexpected shape");
    return;
  }
  try {
    const response = await fetchWithRetry(
      `https://api.pirateweather.net/forecast/${encodeURIComponent(key)}` +
        `/${PROBE.latitude},${PROBE.longitude}?exclude=minutely,hourly,alerts`,
    );
    const remaining = Number(response.headers.get("ratelimit-remaining"));
    const reset = Number(response.headers.get("ratelimit-reset"));
    const limit = Number(response.headers.get("ratelimit-limit"));
    if (!Number.isFinite(remaining) || !Number.isFinite(reset)) {
      record("pirate quota", false, `HTTP ${response.status}, quota headers unreadable`);
      return;
    }
    const runway = evaluateQuotaRunway({
      remaining,
      resetSeconds: reset,
      dailyBurn: DAILY_PIPELINE_BURN,
      reserve: VISITOR_RESERVE,
    });
    const summary =
      `${remaining}/${Number.isFinite(limit) ? limit : "?"} left, ` +
      `${runway.daysLeft.toFixed(1)}d to reset, need ${runway.needed} ` +
      `(${DAILY_PIPELINE_BURN}/day + ${VISITOR_RESERVE} reserve)`;
    record(
      "pirate quota",
      runway.ok,
      runway.ok ? summary : `${summary} — short by ${runway.shortfall}`,
    );
  } catch (error) {
    record("pirate quota", false, `unreachable: ${(error as Error).message}`);
  }
}

async function main(): Promise<void> {
  const requested = option("target") ?? "production";
  if (!isTargetName(requested)) {
    process.stderr.write(
      `unknown --target=${requested}; expected one of ${Object.keys(TARGETS).join(", ")}\n`,
    );
    process.exitCode = 1;
    return;
  }
  const base = TARGETS[requested];
  process.stdout.write(`오늘비 service health — ${requested} (${base})\n\n`);

  await checkHomePage(base);
  await checkForecast(base);
  await checkLocationSearch(base);
  await checkPirateWeatherQuota();

  const failed = results.filter((result) => !result.ok);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  if (failed.length > 0) {
    process.stdout.write(`failing: ${failed.map((result) => result.name).join(", ")}\n`);
    process.exitCode = 1;
  }
}

await main();
