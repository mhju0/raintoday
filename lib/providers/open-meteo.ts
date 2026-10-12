import { conditionFromWmoCode } from "../conditions.ts";
import { readResponseBytes } from "../httpResponse.ts";
import type { ForecastLocation } from "../location.ts";
import { CACHE_TTL_MS } from "../providerCache.ts";
import type {
  CurrentWeather,
  DailyForecast,
  HourlyForecast,
} from "../types";
import { createWeatherProvider } from "./read.ts";

/**
 * Open-Meteo — the default provider. Free, no API key, no signup.
 * https://open-meteo.com/en/docs
 */

interface OpenMeteoResponse {
  current: {
    time: string;
    temperature_2m: number;
    relative_humidity_2m: number;
    apparent_temperature: number;
    precipitation: number;
    rain: number;
    snowfall: number;
    weather_code: number;
    cloud_cover: number;
    wind_speed_10m: number;
    wind_gusts_10m: number;
    wind_direction_10m: number;
    is_day: number;
    visibility: number;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    precipitation_probability: (number | null)[];
    weather_code: number[];
    wind_speed_10m: number[];
    relative_humidity_2m: number[];
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
    precipitation_sum: (number | null)[];
    sunrise: string[];
    sunset: string[];
  };
}

interface Snapshot {
  current: CurrentWeather;
  hourly: HourlyForecast[];
  daily: DailyForecast[];
}

const OPEN_METEO_MAX_BYTES = 2 * 1024 * 1024;
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_ENSEMBLE_URL = "https://ensemble-api.open-meteo.com/v1/ensemble";

/**
 * Open-Meteo's default hourly `precipitation_probability` for Korea is the
 * share of ECMWF IFS 0.25° ensemble runs that are wet, while any single run's
 * `precipitation` can be dry, so one hour can read 66% over 0 mm. The hourly
 * amount is the mean of those same runs instead.
 */
const HOURLY_AMOUNT_MODEL = "ecmwf_ifs025";

interface EnsembleResponse {
  hourly?: { time?: string[] } & Record<string, unknown>;
}

/**
 * Mean hourly amount across the ensemble runs, by naive local hour. An hour no
 * run publishes is left out, and a failed read leaves every hour missing
 * rather than pairing the probability with a single run's amounts.
 */
async function fetchHourlyAmounts(location: ForecastLocation): Promise<Map<string, number>> {
  const amounts = new Map<string, number>();
  try {
    const params = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      timezone: location.timezone,
      forecast_days: "3",
      hourly: "precipitation",
      models: HOURLY_AMOUNT_MODEL,
    });
    const res = await fetch(`${OPEN_METEO_ENSEMBLE_URL}?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return amounts;
    const bytes = await readResponseBytes(res, {
      maxBytes: OPEN_METEO_MAX_BYTES,
      contentType: "application/json",
    });
    const data = JSON.parse(new TextDecoder().decode(bytes)) as EnsembleResponse;
    const hourly = data.hourly ?? {};
    // `precipitation` is the control run; the rest are `precipitation_memberNN`.
    const runs = Object.entries(hourly)
      .filter(([key]) => key === "precipitation" || key.startsWith("precipitation_member"))
      .map(([, series]) => (Array.isArray(series) ? (series as unknown[]) : []));
    hourly.time?.forEach((time, i) => {
      const values = runs.map((run) => run[i]).filter((v): v is number => typeof v === "number");
      if (values.length === 0) return;
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      amounts.set(time, Math.round(mean * 100) / 100);
    });
  } catch {
    amounts.clear();
  }
  return amounts;
}

/** Open-Meteo returns naive local timestamps ("2026-06-12T23:45") — pin them to KST. */
function toKstIso(naive: string): string {
  return `${naive}:00+09:00`.replace(/:00:00\+/, ":00+");
}

/**
 * One forecast read, retried once when the connection fails or the server
 * answers 429 or 5xx. Both tries share a single 10-second budget, so a read that
 * runs out the clock is not retried and a caller never waits longer than before.
 * The collector lost one to three stations a run to a single failed read here.
 */
async function fetchForecast(url: string): Promise<Response> {
  const signal = AbortSignal.timeout(10_000);
  try {
    const res = await fetch(url, { signal });
    if (res.status !== 429 && res.status < 500) return res;
  } catch (error) {
    if (signal.aborted) throw error;
  }
  return fetch(url, { signal });
}

async function fetchSnapshot(location: ForecastLocation): Promise<Snapshot> {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    timezone: location.timezone,
    forecast_days: "7",
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day,visibility",
    hourly:
      "temperature_2m,precipitation_probability,weather_code,wind_speed_10m,relative_humidity_2m",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset",
  });

  const [res, hourlyAmounts] = await Promise.all([
    fetchForecast(`${OPEN_METEO_URL}?${params}`),
    fetchHourlyAmounts(location),
  ]);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const bytes = await readResponseBytes(res, {
    maxBytes: OPEN_METEO_MAX_BYTES,
    contentType: "application/json",
  });
  const data = JSON.parse(new TextDecoder().decode(bytes)) as OpenMeteoResponse;

  // Index of the hour bucket covering "now" — also the start of the 24h slice.
  const nowMs = Date.parse(toKstIso(data.current.time));
  const startIdx = Math.max(
    data.hourly.time.findIndex((t) => Date.parse(toKstIso(t)) >= nowMs - 30 * 60 * 1000),
    0,
  );

  const current: CurrentWeather = {
    time: toKstIso(data.current.time),
    temperature: data.current.temperature_2m,
    apparentTemperature: data.current.apparent_temperature,
    humidity: data.current.relative_humidity_2m,
    windSpeed: data.current.wind_speed_10m,
    windDirection: data.current.wind_direction_10m,
    precipitation: data.current.precipitation,
    cloudCover: data.current.cloud_cover,
    condition: conditionFromWmoCode(data.current.weather_code),
    windGusts: data.current.wind_gusts_10m ?? null,
    rain: data.current.rain ?? null,
    snowfall: data.current.snowfall ?? null,
    precipitationProbability: data.hourly.precipitation_probability[startIdx] ?? null,
    visibility: data.current.visibility ?? null,
    isDay: typeof data.current.is_day === "number" ? data.current.is_day === 1 : null,
    weatherCode: data.current.weather_code ?? null,
  };
  const hourly: HourlyForecast[] = data.hourly.time
    .slice(startIdx, startIdx + 24)
    .map((t, i) => {
      const idx = startIdx + i;
      return {
        time: toKstIso(t),
        temperature: data.hourly.temperature_2m[idx],
        precipitationProbability: data.hourly.precipitation_probability[idx] ?? null,
        precipitationAmount: hourlyAmounts.get(t) ?? null,
        windSpeed: data.hourly.wind_speed_10m[idx],
        humidity: data.hourly.relative_humidity_2m[idx],
        condition: conditionFromWmoCode(data.hourly.weather_code[idx]),
      };
    });

  const daily: DailyForecast[] = data.daily.time.map((date, i) => ({
    date,
    temperatureMax: data.daily.temperature_2m_max[i],
    temperatureMin: data.daily.temperature_2m_min[i],
    precipitationProbability: data.daily.precipitation_probability_max[i] ?? null,
    condition: conditionFromWmoCode(data.daily.weather_code[i]),
    sunrise: toKstIso(data.daily.sunrise[i]),
    sunset: toKstIso(data.daily.sunset[i]),
    precipitationAmount: data.daily.precipitation_sum?.[i] ?? null,
  }));

  return { current, hourly, daily };
}

export const openMeteoProvider = createWeatherProvider({
  id: "open-meteo",
  name: "Open-Meteo",
  messages: {
    ok: "무료 글로벌 예보 모델 (API 키 불필요)",
    stale: "일시적 연결 오류 — 최근 캐시 데이터 표시 중",
    needsConfig: "",
    error: "Open-Meteo 서버에 연결할 수 없습니다",
  },
  missingConfiguration: () => [],
  ttlMs: CACHE_TTL_MS,
  load: fetchSnapshot,
  failureMessage: () => "Open-Meteo 서버에 연결할 수 없습니다",
});
