import type { ProviderSnapshot } from "../types.ts";

const HOUR_MS = 3_600_000;
const KST_OFFSET = 9 * HOUR_MS;

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

export type HourlyMode = "primary" | "average" | "compare" | HourlyProviderId;
export type DetailedReading = HourlyReading & { source: HourlyProviderSeries };
interface Member {
  id: HourlyProviderId;
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

export function hourlyRows(comparison: HourlyComparison, date: string, selected?: HourlyProviderSeries) {
  const native = selected !== undefined && !HOURLY_ALIGNMENT[selected.id].chance;
  const midnight = Date.parse(`${date}T00:00:00+09:00`);
  return Array.from({ length: 24 }, (_, hour) => {
    const start = midnight + hour * HOUR_MS;
    const end = start + HOUR_MS;
    const elapsed = native ? start < Math.floor(comparison.asOf / HOUR_MS) * HOUR_MS : end <= comparison.asOf;
    const details = comparison.sources.map((source): DetailedReading => {
      const alignment = HOURLY_ALIGNMENT[source.id];
      const reading = source.hours[end];
      return {
        source,
        chance: !elapsed && alignment.chance ? reading?.chance ?? null : null,
        amount: !elapsed && alignment.amount ? reading?.amount ?? null : null,
      };
    });
    const members = (metric: "chance" | "amount"): Member[] => details.flatMap((detail) => {
      const value = detail[metric];
      return detail.source.status === "fresh" && typeof value === "number" ? [{ id: detail.source.id, value }] : [];
    });
    const reading = elapsed ? undefined : native
      ? selected.hours[start]
      : details.find(({ source }) => source.id === selected?.id);
    return { start, end, elapsed, details, reading, chance: members("chance"), amount: members("amount") };
  });
}

export type HourlyRow = ReturnType<typeof hourlyRows>[number];

export function hourlyBlocks(rows: readonly HourlyRow[], mode: HourlyMode, source?: HourlyProviderSeries) {
  return Array.from({ length: 8 }, (_, index) => {
    const hours = rows.slice(index * 3, index * 3 + 3);
    const amounts = hours.map((row) => mode === "average" ? hourlyMean(row.amount) : row.reading?.amount);
    const numeric = hours.flatMap((row) => {
      const range = mode === "compare" ? hourlyExtremes(row.chance) : null;
      const value = mode === "average" ? hourlyMean(row.chance)
        : mode === "compare" ? range?.high
        : source?.status === "fresh" ? row.reading?.chance : null;
      return typeof value === "number" ? [{ value, range }] : [];
    });
    const peak = numeric.reduce<(typeof numeric)[number] | null>(
      (best, next) => !best || next.value > best.value ? next : best, null,
    );
    const sum = source && (!HOURLY_ALIGNMENT[source.id].chance || source.status !== "fresh")
      ? null
      : amounts.every((value) => typeof value === "number")
        ? amounts.reduce((total, value) => total + value, 0)
        : null;
    return {
      hours,
      peak,
      sum,
      chanceHours: numeric.length,
      amountHours: amounts.filter((value) => typeof value === "number").length,
      hasRange: amounts.some((value) => value !== null && typeof value === "object"),
    };
  });
}
