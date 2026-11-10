import { cachedFetch } from "../cache.ts";
import {
  DEFAULT_FORECAST_LOCATION,
  forecastLocationCacheKey,
  type ForecastLocation,
} from "../location.ts";
import type { ProviderSnapshot, WeatherProviderStatus } from "../types.ts";
import type { NormalizedForecast, WeatherProvider } from "./base.ts";

export interface ProviderMessages {
  ok: string;
  stale: string;
  needsConfig: string;
  error: string;
}

export interface WeatherProviderDefinition {
  id: WeatherProviderStatus["id"];
  name: string;
  statusName?: string;
  messages: ProviderMessages;
  missingConfiguration(): string[];
  ttlMs: number;
  load(location: ForecastLocation): Promise<NormalizedForecast>;
  failureMessage?(error: unknown): string;
}

function emptySnapshot(id: WeatherProviderStatus["id"], status: WeatherProviderStatus): ProviderSnapshot {
  return { id, status, current: null, hourly: [], daily: [] };
}

const MAX_CAUSE_DEPTH = 4;

/** Error text this codebase throws itself, quoted as is because it can hold no key. */
const OWN_FAILURE_TEXTS = [
  "response body too large",
  "unexpected response content type",
  "non-JSON response",
  "invalid JSON",
  "missing resultCode",
] as const;

/**
 * A short reason a provider read failed, such as `timeout`, `network ECONNRESET`
 * or `HTTP 503`, for operators reading capture logs.
 *
 * Key-free by construction: it never returns error text. Output is built only from
 * an error's name, a Node/undici error code, a three-digit HTTP status, a
 * data.go.kr result code, or text listed in `OWN_FAILURE_TEXTS`. Provider errors
 * can carry a request URL, and some providers put their key in the query string.
 */
export function providerFailureCause(error: unknown): string {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current instanceof Error && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current.name === "TimeoutError" || current.name === "AbortError") return "timeout";
    const code = (current as NodeJS.ErrnoException).code;
    if (typeof code === "string" && /^(?:E[A-Z]{2,20}|UND_ERR_[A-Z_]{2,30})$/u.test(code)) {
      return code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT" ? `timeout ${code}` : `network ${code}`;
    }
    const message = current.message;
    const resultCode = /\b(resultCode|returnReasonCode) (\d{1,3})\b/u.exec(message);
    if (resultCode) return `${resultCode[1]} ${resultCode[2]}`;
    const status = /\bHTTP (\d{3})\b/u.exec(message) ?? /\b([1-5]\d{2}) —/u.exec(message);
    if (status) return `HTTP ${status[1]}`;
    const own = OWN_FAILURE_TEXTS.find((text) => message.includes(text));
    if (own) return own;
    current = current instanceof AggregateError && current.errors.length > 0
      ? current.errors[0]
      : current.cause;
  }
  const name = error instanceof Error && /^[A-Za-z]{1,40}$/u.test(error.name) ? error.name : "unknown";
  return `unclassified ${name}`;
}

function failureMessage(definition: WeatherProviderDefinition, error: unknown): string {
  try {
    return definition.failureMessage?.(error) ?? definition.messages.error;
  } catch {
    return definition.messages.error;
  }
}

/** Create one provider boundary that reads coherent status and weather together. */
export function createWeatherProvider(definition: WeatherProviderDefinition): WeatherProvider {
  const cacheKey = definition.id;
  const statusName = definition.statusName ?? definition.name;

  return {
    id: definition.id,
    name: definition.name,
    missingConfiguration: () => definition.missingConfiguration(),

    async read(location = DEFAULT_FORECAST_LOCATION): Promise<ProviderSnapshot> {
      try {
        const missingEnvVars = definition.missingConfiguration();
        if (missingEnvVars.length > 0) {
          return emptySnapshot(definition.id, {
            id: definition.id,
            name: statusName,
            availability: "needs-config",
            message: definition.messages.needsConfig,
            missingEnvVars,
            lastUpdated: null,
            fromCache: false,
          });
        }

        const result = await cachedFetch(
          `${cacheKey}:${forecastLocationCacheKey(location)}`,
          definition.ttlMs,
          () => definition.load(location),
        );
        return {
          id: definition.id,
          status: {
            id: definition.id,
            name: statusName,
            availability: "ok",
            message: result.stale ? definition.messages.stale : definition.messages.ok,
            missingEnvVars: [],
            lastUpdated: result.value.current.time,
            fromCache: result.fromCache,
            stale: result.stale,
          },
          ...result.value,
        };
      } catch (error) {
        return emptySnapshot(definition.id, {
          id: definition.id,
          name: statusName,
          availability: "error",
          message: failureMessage(definition, error),
          cause: providerFailureCause(error),
          missingEnvVars: [],
          lastUpdated: null,
          fromCache: false,
        });
      }
    },
  };
}
