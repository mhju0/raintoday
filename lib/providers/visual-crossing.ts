import { readResponseBytes } from "../httpResponse.ts";
import type { ForecastLocation } from "../location.ts";
import { CACHE_TTL_MS } from "../providerCache.ts";
import type {
  CurrentWeather,
  DailyForecast,
  HourlyForecast,
  WeatherCondition,
} from "../types";
import { createWeatherProvider } from "./read.ts";

/**
 * Visual Crossing Timeline — requires a free API key from visualcrossing.com.
 * Set VISUAL_CROSSING_API_KEY to activate; without it the provider reports
 * needs-config.
 * https://www.visualcrossing.com/resources/documentation/weather-api/timeline-weather-api/
 *
 * Billing is what admitted this source at all (#110). A forecast call costs one
 * record no matter how many days or hours come back — verified live, not taken
 * from the docs: the full 15-day hourly response answers `queryCost: 1`. Against
 * the free tier's 1,000 records/day the pipeline's 194 fits with room. Note the
 * Timeline guide's "query cost will therefore be 24" example is a *history*
 * query; history is billed per hour and is a different economy entirely.
 *
 * Units: `unitGroup=metric` gives °C, km/h wind (not m/s), mm precipitation, and
 * `precipprob` as 0–100. DO NOT divide `precipprob`; it is not a fraction.
 */

function apiKey(): string | null {
  return process.env.VISUAL_CROSSING_API_KEY?.trim() || null;
}

/**
 * The fields the schema actually consumes. Trimming the response is worth doing
 * — it cuts the 15-day payload by about 38% — and costs nothing: an `elements`
 * filter does not change `queryCost`, also verified live.
 */
const ELEMENTS = [
  "datetime",
  "datetimeEpoch",
  "temp",
  "tempmax",
  "tempmin",
  "feelslike",
  "humidity",
  "windspeed",
  "winddir",
  "windgust",
  "precip",
  "precipprob",
  "preciptype",
  "cloudcover",
  "visibility",
  "conditions",
  "icon",
  "sunriseEpoch",
  "sunsetEpoch",
].join(",");

/**
 * Visual Crossing icon → internal WeatherCondition.
 *
 * Their icon set is deliberately coarse: it has no drizzle, no heavy-rain and no
 * sleet member, so those three are not reachable from an icon alone. Deriving
 * them from mm/h would be our invention rather than their forecast, so the
 * mapping stays at what they actually publish. `preciptype` is their own field,
 * so it may refine — see `conditionFrom`.
 */
function conditionFromIcon(icon: string | undefined): WeatherCondition {
  switch (icon) {
    case "clear-day":
    case "clear-night":
      return "clear";
    case "partly-cloudy-day":
    case "partly-cloudy-night":
      return "partly-cloudy";
    case "cloudy":
      return "cloudy";
    case "fog":
      return "fog";
    case "rain":
    case "showers-day":
    case "showers-night":
      return "rain";
    case "thunder-rain":
    case "thunder-showers-day":
    case "thunder-showers-night":
      return "thunderstorm";
    case "snow":
    case "snow-showers-day":
    case "snow-showers-night":
      return "snow";
    // "wind" describes air movement, not the sky. There is no honest member for
    // it, and picking a cloud state would be inventing one.
    default:
      return "unknown";
  }
}

/** Freezing precipitation is a `preciptype` member and has no icon of its own. */
function conditionFrom(icon: string | undefined, precipType: string[] | null | undefined): WeatherCondition {
  const types = precipType ?? [];
  if (types.includes("freezingrain") || types.includes("ice")) return "sleet";
  return conditionFromIcon(icon);
}

/** Unix seconds → ISO 8601 KST. Every provider here normalizes to +09:00. */
function unixToKstIso(seconds: number): string {
  return new Date(seconds * 1000 + 9 * 3_600 * 1_000).toISOString().replace("Z", "+09:00");
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

interface VcHour {
  datetimeEpoch: number;
  temp: number;
  feelslike?: number | null;
  humidity?: number | null;
  windspeed?: number | null;
  winddir?: number | null;
  windgust?: number | null;
  precip?: number | null;
  precipprob?: number | null;
  preciptype?: string[] | null;
  cloudcover?: number | null;
  visibility?: number | null;
  icon?: string;
}

interface VcDay extends VcHour {
  datetime: string;
  tempmax: number;
  tempmin: number;
  sunriseEpoch?: number | null;
  sunsetEpoch?: number | null;
  hours?: VcHour[];
}

interface VcResponse {
  days?: VcDay[];
  currentConditions?: VcHour;
}

interface Snapshot {
  current: CurrentWeather;
  hourly: HourlyForecast[];
  daily: DailyForecast[];
}

const VISUAL_CROSSING_MAX_BYTES = 2 * 1024 * 1024;
/**
 * Today plus seven. The outlook takes the union of every provider's dates and
 * keeps the first seven from tomorrow, so a source reaching further than the
 * others would put a date in that union only it can answer — one provider's
 * forecast rendered in a row the page presents as a multi-source average.
 */
const MAX_DAYS = 8;

async function fetchSnapshot(location: ForecastLocation): Promise<Snapshot> {
  const key = apiKey();
  if (!key) throw new Error("Visual Crossing: VISUAL_CROSSING_API_KEY not configured");
  const url =
    "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/" +
    `${location.latitude},${location.longitude}` +
    `?unitGroup=metric&include=current,hours,days&contentType=json` +
    `&elements=${ELEMENTS}&key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 401 || res.status === 403)
    throw new Error(`Visual Crossing ${res.status} — invalid or expired API key`);
  // The free tier's daily record allowance is answered with 429, and there is no
  // header to see it coming: the response carries no rate-limit fields at all.
  if (res.status === 429) throw new Error("Visual Crossing 429 — daily record allowance exhausted");
  if (!res.ok) throw new Error(`Visual Crossing HTTP ${res.status}`);
  const bytes = await readResponseBytes(res, {
    maxBytes: VISUAL_CROSSING_MAX_BYTES,
    contentType: "application/json",
  });
  const data = JSON.parse(new TextDecoder().decode(bytes)) as VcResponse;

  const days = (data.days ?? []).slice(0, MAX_DAYS);
  const now = data.currentConditions;
  if (!now || !Number.isFinite(now.temp)) {
    throw new Error("Visual Crossing: response carried no current conditions");
  }

  const current: CurrentWeather = {
    time: unixToKstIso(now.datetimeEpoch),
    temperature: now.temp,
    apparentTemperature: finiteOrNull(now.feelslike),
    humidity: finiteOrNull(now.humidity),
    windSpeed: finiteOrNull(now.windspeed),
    windDirection: finiteOrNull(now.winddir),
    precipitation: finiteOrNull(now.precip),
    cloudCover: finiteOrNull(now.cloudcover),
    condition: conditionFrom(now.icon, now.preciptype),
    windGusts: finiteOrNull(now.windgust),
    visibility: finiteOrNull(now.visibility),
    precipitationProbability: finiteOrNull(now.precipprob),
  };

  // Hours are nested per day; flatten, then keep from the current hour onward as
  // every other provider here does.
  const nowMs = Date.now();
  const hourly: HourlyForecast[] = days
    .flatMap((day) => day.hours ?? [])
    .filter((hour) => hour.datetimeEpoch * 1_000 >= nowMs - 30 * 60 * 1_000)
    .slice(0, 24)
    .map(
      (hour): HourlyForecast => ({
        time: unixToKstIso(hour.datetimeEpoch),
        temperature: hour.temp,
        // Already 0–100 — do not divide.
        precipitationProbability: finiteOrNull(hour.precipprob),
        precipitationAmount: finiteOrNull(hour.precip),
        windSpeed: finiteOrNull(hour.windspeed),
        humidity: finiteOrNull(hour.humidity),
        condition: conditionFrom(hour.icon, hour.preciptype),
      }),
    );

  const daily: DailyForecast[] = days.map(
    (day): DailyForecast => ({
      date: day.datetime,
      temperatureMax: day.tempmax,
      temperatureMin: day.tempmin,
      // Already 0–100 — do not divide.
      precipitationProbability: finiteOrNull(day.precipprob),
      condition: conditionFrom(day.icon, day.preciptype),
      sunrise: day.sunriseEpoch ? unixToKstIso(day.sunriseEpoch) : null,
      sunset: day.sunsetEpoch ? unixToKstIso(day.sunsetEpoch) : null,
      precipitationAmount: finiteOrNull(day.precip),
    }),
  );

  return { current, hourly, daily };
}

export const visualCrossingProvider = createWeatherProvider({
  id: "visual-crossing",
  name: "Visual Crossing",
  messages: {
    ok: "Visual Crossing Timeline 예보 모델",
    stale: "일시적 연결 오류 — 최근 캐시 데이터 표시 중",
    needsConfig: "VISUAL_CROSSING_API_KEY를 설정하면 비교 소스로 활성화됩니다",
    error: "Visual Crossing 연결 실패 (인증 오류 또는 네트워크 — 잠시 후 재시도)",
  },
  missingConfiguration: () => (apiKey() ? [] : ["VISUAL_CROSSING_API_KEY"]),
  ttlMs: CACHE_TTL_MS,
  load: fetchSnapshot,
  failureMessage: () => "Visual Crossing 연결 실패 (인증 오류 또는 네트워크 — 잠시 후 재시도)",
});
