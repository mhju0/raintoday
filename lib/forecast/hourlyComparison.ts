import type { ProviderSnapshot } from "../types.ts";

export const HOUR_MS = 3_600_000;
const KST_OFFSET = 9 * HOUR_MS;
const BLOCK_MS = 3 * HOUR_MS;

// The three confirmed accumulations end at the published timestamp. Native
// metrics keep that timestamp but have no confirmed one-hour interval.
export const HOURLY_ALIGNMENT = {
  "open-meteo": { chance: true, amount: true },
  kma: { chance: true, amount: true },
  "weather-api": { chance: false, amount: false },
  "visual-crossing": { chance: false, amount: true },
} as const;

export type HourlyProviderId = keyof typeof HOURLY_ALIGNMENT;
type Amount = number | { lowMm: number; highMm: number | null } | "invalid" | null;
type Chance = number | "invalid" | null;

interface HourlyReading {
  chance: Chance;
  amount: Amount;
}

export interface HourlyProviderSeries {
  id: HourlyProviderId;
  name: string;
  status: "fresh" | "stale" | "unavailable";
  hours: Record<number, HourlyReading>;
}

export interface HourlyComparison {
  dates: [string, string];
  asOf: number;
  sources: HourlyProviderSeries[];
}

export function kstStamp(at: number): string {
  return new Date(at + KST_OFFSET).toISOString().slice(0, 16);
}

function validNumber(value: number | null | undefined, max = Infinity): Chance {
  if (value == null) return null;
  return Number.isFinite(value) && value >= 0 && value <= max ? value : "invalid";
}

function isHourlyProvider(id: string): id is HourlyProviderId {
  return Object.hasOwn(HOURLY_ALIGNMENT, id);
}

export function buildHourlyComparison(snapshots: readonly ProviderSnapshot[], now: Date): HourlyComparison {
  const asOf = now.getTime();
  const dates: HourlyComparison["dates"] = [
    kstStamp(asOf).slice(0, 10),
    kstStamp(asOf + 24 * HOUR_MS).slice(0, 10),
  ];
  const dayStart = Date.parse(`${dates[0]}T00:00:00+09:00`);
  const sources = snapshots.flatMap((snapshot): HourlyProviderSeries[] => {
    if (!isHourlyProvider(snapshot.id)) return [];
    const hours: HourlyProviderSeries["hours"] = {};
    for (const hour of snapshot.hourly) {
      const stamp = Date.parse(hour.time);
      if (!Number.isFinite(stamp) || stamp % HOUR_MS !== 0 || stamp < dayStart || stamp > dayStart + 48 * HOUR_MS) continue;
      const chance = validNumber(hour.precipitationProbability, 100);
      const range = hour.precipitationAmountRange;
      const amount = range
        ? Number.isFinite(range.lowMm) && range.lowMm >= 0 &&
          (range.highMm === null || (Number.isFinite(range.highMm) && range.highMm > range.lowMm))
          ? range : "invalid"
        : validNumber(hour.precipitationAmountUnrounded ?? hour.precipitationAmount);
      // Conflicting duplicate timestamps cannot be attributed to an exact hour.
      hours[stamp] = hours[stamp] ? { chance: "invalid", amount: "invalid" } : { chance, amount };
    }
    return [{
      id: snapshot.id,
      name: snapshot.status.name,
      status: snapshot.status.availability !== "ok" ? "unavailable" : snapshot.status.stale ? "stale" : "fresh",
      hours,
    }];
  });
  return { dates, asOf, sources };
}

/** Last displayable hour in the snapshot, bounded by the two dates it carries. */
export function hourlyComparisonEnd(comparison: HourlyComparison): number | null {
  const dayEnd = Date.parse(`${comparison.dates[1]}T00:00:00+09:00`) + 24 * HOUR_MS;
  let latest: number | null = null;
  for (const source of comparison.sources) {
    if (source.status === "unavailable") continue;
    const alignment = HOURLY_ALIGNMENT[source.id];
    for (const [key, reading] of Object.entries(source.hours)) {
      const stamp = Number(key);
      for (const metric of ["chance", "amount"] as const) {
        const value = reading[metric];
        if (value === null || value === "invalid") continue;
        // Native metrics have no confirmed interval. Keep their existing
        // display rule: a stamp is readable through the hour it names.
        const end = alignment[metric] ? stamp : stamp + HOUR_MS;
        if (end <= dayEnd) latest = Math.max(latest ?? end, end);
      }
    }
  }
  return latest;
}

interface Member {
  source: HourlyProviderSeries;
  value: number;
}

export function hourlyMean(members: readonly Member[]): number | null {
  return members.length >= 2
    ? members.reduce((sum, member) => sum + member.value, 0) / members.length
    : null;
}

export function hourlyExtremes(members: readonly Member[]) {
  if (members.length < 2) return null;
  const values = members.map((member) => member.value);
  return { low: Math.min(...values), high: Math.max(...values) };
}

/** Keep each metric's original timestamp, even when a provider mixes conventions. */
export function hourlySourceReading(source: HourlyProviderSeries, start: number, metric: keyof HourlyReading) {
  const aligned = HOURLY_ALIGNMENT[source.id][metric];
  const stamp = aligned ? start + HOUR_MS : start;
  const value = source.status === "unavailable" ? null : source.hours[stamp]?.[metric] ?? null;
  return { aligned, stamp, value };
}

export type HourlyRow = ReturnType<typeof alignedHour>;
export type HourlyRibbonBlock = ReturnType<typeof hourlyRibbon>[number];

function alignedHour(sources: readonly HourlyProviderSeries[], start: number, viewedAt: number) {
  const end = start + HOUR_MS;
  const state = end <= viewedAt ? "elapsed" : start < viewedAt ? "in-progress" : "complete";
  const members = (metric: keyof HourlyReading): Member[] => state !== "complete" ? [] : sources.flatMap((source) => {
    if (source.status !== "fresh" || !HOURLY_ALIGNMENT[source.id][metric]) return [];
    const value = source.hours[end]?.[metric];
    return typeof value === "number" ? [{ source, value }] : [];
  });
  return { start, end, state, chance: members("chance"), amount: members("amount") };
}

export function hourlyRibbon(comparison: HourlyComparison, viewedAt: number) {
  const first = Math.floor((viewedAt + KST_OFFSET) / BLOCK_MS) * BLOCK_MS - KST_OFFSET;
  return Array.from({ length: 8 }, (_, index) => {
    const start = first + index * BLOCK_MS;
    const hours = Array.from({ length: 3 }, (_, hour) => alignedHour(comparison.sources, start + hour * HOUR_MS, viewedAt));
    const chances = hours.map((row) => hourlyMean(row.chance)).filter((value) => value !== null);
    const amounts = hours.map((row) => hourlyMean(row.amount));
    return {
      start, end: start + BLOCK_MS, hours,
      peak: chances.length ? Math.max(...chances) : null,
      sum: amounts.every((value) => value !== null) ? amounts.reduce((total, value) => total + value, 0) : null,
      chanceHours: chances.length,
      completeHours: hours.filter((row) => row.state === "complete").length,
    };
  });
}
