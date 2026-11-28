import { HOUR_MS, hourlyMean, hourlySourceReading, kstStamp, type HourlyComparison, type HourlyRibbonBlock } from "./hourlyComparison.ts";

/** Compare available evidence for the same complete KST hours. */
export function readUmbrellaEvidence(
  data: HourlyComparison,
  blocks: HourlyRibbonBlock[],
  viewedAt: number,
  primaryName: string | undefined,
  dailyAmount: number | null,
  threshold: number,
) {
  const stamp = kstStamp(viewedAt);
  const date = stamp.slice(0, 10);
  const current = date === data.dates[0];
  const source = data.sources.find((candidate) => candidate.name === primaryName && candidate.status === "fresh");
  const rows = blocks.flatMap((block) => block.hours).filter((row) => row.state === "complete").map((row) => {
    const chance = source && hourlySourceReading(data, source, row.start, "chance");
    const amount = source && hourlySourceReading(data, source, row.start, "amount");
    return {
      start: row.start,
      end: row.end,
      primary: chance?.aligned && typeof chance.value === "number" ? chance.value : null,
      primaryAmount: amount?.aligned && typeof amount.value === "number" ? amount.value : null,
      chance: hourlyMean(row.chance),
      amount: hourlyMean(row.amount),
      members: row.chance,
    };
  });
  const today = rows.filter((row) => kstStamp(row.start).startsWith(date));
  const first = rows.find((row) => (row.chance ?? -1) >= threshold || (row.primary ?? -1) >= threshold);
  const disagreement = today.find((row) => (row.primary ?? -1) >= threshold && row.chance !== null && row.chance < threshold ||
    row.primary !== null && row.primary < threshold && (row.chance ?? -1) >= threshold);
  const primaryWet = today.some((row) => (row.primary ?? -1) >= threshold);
  const primaryStrong = today.some((row) => (row.primary ?? -1) >= 70) ||
    today.reduce((sum, row) => sum + (row.primaryAmount ?? 0), 0) >= 10;
  const morning = Number(stamp.slice(11, 13)) < 12 && dailyAmount !== null && dailyAmount >= 10;
  const comparedHours = today.filter((row) => row.chance !== null).length;
  const midnight = Date.parse(`${date}T00:00:00+09:00`) + 24 * HOUR_MS;
  const remainingHours = Math.max(0, (midnight - Math.ceil(viewedAt / HOUR_MS) * HOUR_MS) / HOUR_MS);
  const dry = remainingHours > 0 && today.length === remainingHours &&
    today.every((row) => row.primary !== null && row.primary < threshold && row.chance !== null && row.chance < threshold);
  return { current, date, first, disagreement, primaryWet, primaryStrong, morning, dry, comparedHours, remainingHours };
}
