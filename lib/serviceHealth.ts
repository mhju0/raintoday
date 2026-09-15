import { DEFAULT_FAILURE_RETRY_MS } from "./cache.ts";

export const EXPECTED_FORECAST_PROVIDER_IDS = [
  "open-meteo",
  "kma",
  "pirate-weather",
  "weather-api",
  "visual-crossing",
] as const;

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REQUESTS = 3;
const TRANSPORT_RETRY_GAP_MS = 5_000;
const SEMANTIC_CONFIRMATION_GAP_MS = DEFAULT_FAILURE_RETRY_MS + 1_000;

type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

interface ForecastCheckDependencies {
  fetchImpl?: FetchImplementation;
  delay?: (ms: number) => Promise<void>;
  requestTimeoutMs?: number;
  requestInit?: RequestInit;
  onIncomplete?: (detail: string, attempt: number) => void;
}

function transportFailure(error: unknown): string {
  return error instanceof DOMException && error.name === "TimeoutError"
    ? "request timed out"
    : "request failed";
}

export type ForecastCheckResult =
  | {
      ok: true;
      attempts: number;
      providerCount: number;
      probability: number;
      recovered: boolean;
      firstFailure: string | null;
    }
  | {
      ok: false;
      attempts: number;
      detail: string;
      firstFailure: string | null;
    };

function inspectForecast(body: unknown):
  | { ok: true; providerCount: number; probability: number }
  | { ok: false; detail: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, detail: "response body is not an object" };
  }
  const response = body as {
    influence?: unknown;
    recommendation?: { precipitationProbability?: unknown };
  };
  const ids = Array.isArray(response.influence)
    ? response.influence.flatMap((provider) =>
        typeof provider === "object" && provider !== null &&
          typeof (provider as { id?: unknown }).id === "string"
          ? [(provider as { id: string }).id]
          : [],
      )
    : [];
  const uniqueIds = new Set(ids);
  const missing = EXPECTED_FORECAST_PROVIDER_IDS.filter((id) => !uniqueIds.has(id));
  if (missing.length > 0) {
    const present = EXPECTED_FORECAST_PROVIDER_IDS.length - missing.length;
    return {
      ok: false,
      detail: `${present}/${EXPECTED_FORECAST_PROVIDER_IDS.length} expected providers; missing ${missing.join(", ")}`,
    };
  }

  const probability = response.recommendation?.precipitationProbability;
  if (
    typeof probability !== "number" ||
    !Number.isFinite(probability) ||
    probability < 0 ||
    probability > 100
  ) {
    return { ok: false, detail: `probability not usable: ${String(probability)}` };
  }
  return {
    ok: true,
    providerCount: EXPECTED_FORECAST_PROVIDER_IDS.length,
    probability,
  };
}

/**
 * Confirms one semantically incomplete HTTP 200 after the provider failure
 * cache can retry. Transport retries share the same three-request ceiling.
 */
export async function checkForecastResponse(
  url: string,
  dependencies: ForecastCheckDependencies = {},
): Promise<ForecastCheckResult> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const delay = dependencies.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const requestTimeoutMs = dependencies.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  let firstFailure: string | null = null;

  for (let attempt = 1; attempt <= MAX_REQUESTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...dependencies.requestInit,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      const detail = transportFailure(error);
      if (attempt === MAX_REQUESTS) return { ok: false, attempts: attempt, detail, firstFailure };
      await delay(TRANSPORT_RETRY_GAP_MS);
      continue;
    }

    if (!response.ok) {
      const detail = `HTTP ${response.status}`;
      await response.body?.cancel();
      if ((response.status < 500 && response.status !== 429) || attempt === MAX_REQUESTS) {
        return { ok: false, attempts: attempt, detail, firstFailure };
      }
      await delay(TRANSPORT_RETRY_GAP_MS);
      continue;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      const detail = "response body is not valid JSON";
      if (attempt === MAX_REQUESTS) return { ok: false, attempts: attempt, detail, firstFailure };
      await delay(TRANSPORT_RETRY_GAP_MS);
      continue;
    }
    const inspected = inspectForecast(body);
    if (inspected.ok) {
      return {
        ok: true,
        attempts: attempt,
        providerCount: inspected.providerCount,
        probability: inspected.probability,
        recovered: firstFailure !== null,
        firstFailure,
      };
    }

    if (firstFailure !== null || attempt === MAX_REQUESTS) {
      return { ok: false, attempts: attempt, detail: inspected.detail, firstFailure };
    }
    firstFailure = inspected.detail;
    dependencies.onIncomplete?.(inspected.detail, attempt);
    await delay(SEMANTIC_CONFIRMATION_GAP_MS);
  }

  return { ok: false, attempts: MAX_REQUESTS, detail: "forecast check exhausted", firstFailure };
}
