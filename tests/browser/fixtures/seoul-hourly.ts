import { readFileSync } from "node:fs";
import type { HourlyProviderId } from "../../../lib/forecast/hourlyComparison.ts";
import type { HourlyForecast, ProviderSnapshot } from "../../../lib/types.ts";

// Seoul ASOS 108, Nov 23 target day, Nov 22 19:30:26 KST evening capture.
// https://github.com/mhju0/raintoday/actions/runs/45000005773
const series = JSON.parse(readFileSync(new URL("./seoul-hourly-2026-11-23.json", import.meta.url), "utf8")) as
  Record<HourlyProviderId, [string, number | null, number | null, HourlyForecast["precipitationAmountRange"]?][]>;

const names: Record<HourlyProviderId, string> = {
  "open-meteo": "Open-Meteo",
  kma: "기상청 단기예보 (KMA)",
  "weather-api": "WeatherAPI",
  "visual-crossing": "Visual Crossing",
};

export const seoulCaptureTime = new Date("2026-11-22T19:30:26+09:00");
export const seoulHourlySnapshots: ProviderSnapshot[] = (Object.keys(series) as HourlyProviderId[]).map((id) => ({
  id,
  status: {
    id, name: names[id], availability: "ok", message: "", missingEnvVars: [],
    lastUpdated: null, fromCache: false,
  },
  current: null,
  daily: [],
  hourly: series[id].map(([stamp, chance, amount, range]) => ({
    time: `${stamp}:00+09:00`,
    temperature: 0,
    humidity: null,
    windSpeed: null,
    condition: "unknown",
    precipitationProbability: chance,
    precipitationAmount: amount,
    precipitationAmountRange: range,
  })),
}));
