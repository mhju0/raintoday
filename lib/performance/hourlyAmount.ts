import { normalizeClamped } from "./performance.ts";
import type {
  HourlyGradingPair,
  HourlyPrecipObservation,
  MorningProviderForecast,
  PrecipProviderId,
} from "./types.ts";

/**
 * Scores how well each provider forecast rain amounts in the Morning and Evening
 * Captures, in fixed KST 3-hour blocks, and turns that into amount weights for the
 * ribbon's average. Nothing served reads it yet: the served hourly blend waits for
 * the replay, and the weights for the switch rule below. Decision 2026-10-28
 * "The ribbon's rain amount is an average weighted by amount accuracy".
 */

/** Which hour a provider's stamp names: the one ending at `HH:00`, or the one starting then. */
export type HourStamp = "ending" | "starting";

/**
 * Stamp conventions the providers document. WeatherAPI and Visual Crossing say
 * nothing, so a report scores them under both conventions (DECISIONS 2026-10-28).
 */
export const DOCUMENTED_HOUR_STAMPS: Partial<Record<PrecipProviderId, HourStamp>> = {
  "open-meteo": "ending",
  kma: "ending",
  "pirate-weather": "starting",
};

export const BLOCK_HOURS = 3;
export const BLOCK_STARTS = [0, 3, 6, 9, 12, 15, 18, 21] as const;
/** A block is wet when any scored provider or the station has at least this much. */
export const WET_BLOCK_MM = 0.1;

/**
 * The switch rule for amount weights, the same bar as the hourly rain-chance
 * weights (DECISIONS 2026-10-28, recommendation 6): about 60 days of captures and
 * 100 wet station-days in the slot before weights may replace the plain average.
 */
export const AMOUNT_SWITCH_MIN_DAYS = 60;
export const AMOUNT_SWITCH_MIN_WET_STATION_DAYS = 100;

/** One station's 3-hour block where every scored provider and the station have a full amount. */
export interface AmountBlock {
  stationId: string;
  targetDate: string;
  start: number;
  observedMm: number;
  forecastMm: Partial<Record<PrecipProviderId, number>>;
}

export interface AmountError {
  wetBlocks: number;
  /** Mean absolute error over wet blocks, mm; null with no wet block. */
  meanAbsErrorMm: number | null;
  /** Mean forecast minus observed over wet blocks, mm; null with no wet block. */
  biasMm: number | null;
}

const kstParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function koreanDateAndHour(date: Date): { date: string; hour: number } {
  const parts = Object.fromEntries(kstParts.formatToParts(date).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function nextDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * The observation hour a provider stamp covers on `targetDate`, where `hours[i]` is
 * i:00 to i+1:00 KST, or null when the stamp's hour falls on another day.
 */
export function observedHourIndex(time: string, targetDate: string, stamp: HourStamp): number | null {
  const at = new Date(time);
  if (Number.isNaN(at.getTime())) return null;
  const kst = koreanDateAndHour(at);
  if (stamp === "starting") return kst.date === targetDate ? kst.hour : null;
  if (kst.date === targetDate) return kst.hour === 0 ? null : kst.hour - 1;
  return kst.date === nextDate(targetDate) && kst.hour === 0 ? 23 : null;
}

/** A provider's amount for the block, or null unless all three of its hours carry one. */
export function providerBlockAmount(
  forecast: MorningProviderForecast,
  targetDate: string,
  start: number,
  stamp: HourStamp,
): number | null {
  const amounts = new Map<number, number>();
  for (const hour of forecast.hours) {
    const index = observedHourIndex(hour.time, targetDate, stamp);
    if (index === null || index < start || index >= start + BLOCK_HOURS) continue;
    if (hour.amountMm !== null && Number.isFinite(hour.amountMm)) amounts.set(index, hour.amountMm);
  }
  if (amounts.size < BLOCK_HOURS) return null;
  return Array.from(amounts.values()).reduce((sum, mm) => sum + mm, 0);
}

/** The station's rainfall in the block, or null when any of its hours is unknown. */
export function observedBlockAmount(observation: HourlyPrecipObservation, start: number): number | null {
  let total = 0;
  for (let index = start; index < start + BLOCK_HOURS; index += 1) {
    const mm = observation.hours[index]?.mm;
    if (mm === null || mm === undefined || !Number.isFinite(mm)) return null;
    total += mm;
  }
  return total;
}

/**
 * Blocks every listed provider and the station fill completely, so each provider is
 * scored on the same blocks. `unknownStamp` is the convention assumed for providers
 * that document none.
 */
export function amountBlocks(
  pairs: readonly HourlyGradingPair[],
  providers: readonly PrecipProviderId[],
  unknownStamp: HourStamp,
): AmountBlock[] {
  const blocks: AmountBlock[] = [];
  for (const { capture, observation } of pairs) {
    if (observation.stationId !== capture.stationId || observation.date !== capture.targetDate) continue;
    for (const start of BLOCK_STARTS) {
      const observedMm = observedBlockAmount(observation, start);
      if (observedMm === null) continue;
      const forecastMm: Partial<Record<PrecipProviderId, number>> = {};
      for (const provider of providers) {
        const forecast = capture.providers.find((row) => row.provider === provider);
        const mm = forecast
          ? providerBlockAmount(forecast, capture.targetDate, start, DOCUMENTED_HOUR_STAMPS[provider] ?? unknownStamp)
          : null;
        if (mm === null) break;
        forecastMm[provider] = mm;
      }
      if (Object.keys(forecastMm).length !== providers.length) continue;
      blocks.push({ stationId: capture.stationId, targetDate: capture.targetDate, start, observedMm, forecastMm });
    }
  }
  return blocks;
}

export function isWetBlock(block: AmountBlock): boolean {
  return block.observedMm >= WET_BLOCK_MM ||
    Object.values(block.forecastMm).some((mm) => mm >= WET_BLOCK_MM);
}

/**
 * The weighted average of the providers' amounts, renormalized over the providers
 * that carry one. Equal weights when `weights` is null.
 */
export function blendBlockAmount(
  forecastMm: Partial<Record<PrecipProviderId, number>>,
  weights: Partial<Record<PrecipProviderId, number>> | null,
): number | null {
  const rows = Object.entries(forecastMm) as [PrecipProviderId, number][];
  if (rows.length === 0) return null;
  const weightOf = (provider: PrecipProviderId) => (weights ? weights[provider] ?? 0 : 1);
  const total = rows.reduce((sum, [provider]) => sum + weightOf(provider), 0);
  if (total <= 0) return rows.reduce((sum, [, mm]) => sum + mm, 0) / rows.length;
  return rows.reduce((sum, [provider, mm]) => sum + mm * weightOf(provider), 0) / total;
}

function errorOf(blocks: readonly AmountBlock[], forecast: (block: AmountBlock) => number | null): AmountError {
  let n = 0;
  let absolute = 0;
  let signed = 0;
  for (const block of blocks) {
    if (!isWetBlock(block)) continue;
    const mm = forecast(block);
    if (mm === null) continue;
    n += 1;
    absolute += Math.abs(mm - block.observedMm);
    signed += mm - block.observedMm;
  }
  return { wetBlocks: n, meanAbsErrorMm: n ? absolute / n : null, biasMm: n ? signed / n : null };
}

/** Each provider's amount error on wet blocks. */
export function providerAmountErrors(
  blocks: readonly AmountBlock[],
  providers: readonly PrecipProviderId[],
): Partial<Record<PrecipProviderId, AmountError>> {
  return Object.fromEntries(providers.map((provider) =>
    [provider, errorOf(blocks, (block) => block.forecastMm[provider] ?? null)]));
}

/** The plain or weighted average's amount error on wet blocks. */
export function blendAmountError(
  blocks: readonly AmountBlock[],
  weights: Partial<Record<PrecipProviderId, number>> | null,
): AmountError {
  return errorOf(blocks, (block) => blendBlockAmount(block.forecastMm, weights));
}

/**
 * Amount weights from wet-block error: inverse mean absolute error, held between
 * the rain-chance weights' floor and cap so no provider is dropped or takes over.
 * Providers without a scored wet block share equally.
 */
export function amountWeights(
  errors: Partial<Record<PrecipProviderId, AmountError>>,
  floor: number,
  cap: number,
): Partial<Record<PrecipProviderId, number>> {
  const raw: Record<string, number> = {};
  for (const [provider, error] of Object.entries(errors)) {
    raw[provider] = error?.meanAbsErrorMm === null || error?.meanAbsErrorMm === undefined
      ? 0
      : 1 / Math.max(error.meanAbsErrorMm, 0.01);
  }
  return normalizeClamped(raw, floor, cap);
}

export interface AmountSwitchVerdict {
  /** True only when every condition below holds; until then the ribbon uses the plain average. */
  ready: boolean;
  days: number;
  wetStationDays: number;
  /** Weights fitted on every block given. */
  weights: Partial<Record<PrecipProviderId, number>>;
  /** Weights fitted on the earlier half of the dates, scored on the later half. */
  outOfSample: {
    trainDates: number;
    testDates: number;
    equal: AmountError;
    weighted: AmountError;
    /** Test dates with a wet block where the weighted average missed by less than the plain one. */
    datesWon: number;
    datesCompared: number;
  };
  reasons: string[];
}

/**
 * The switch rule. Weights replace the plain average only with enough days and wet
 * station-days, when weights fitted on earlier dates beat the plain average on later
 * ones, and when they win on most of those later dates rather than on one storm.
 */
export function amountSwitchVerdict(
  blocks: readonly AmountBlock[],
  providers: readonly PrecipProviderId[],
  floor: number,
  cap: number,
): AmountSwitchVerdict {
  const dates = Array.from(new Set(blocks.map((block) => block.targetDate))).sort();
  const wetStationDays = new Set(
    blocks.filter(isWetBlock).map((block) => `${block.stationId}:${block.targetDate}`),
  ).size;
  const weights = amountWeights(providerAmountErrors(blocks, providers), floor, cap);

  const split = dates[Math.floor(dates.length / 2)];
  const train = blocks.filter((block) => split !== undefined && block.targetDate < split);
  const test = blocks.filter((block) => split !== undefined && block.targetDate >= split);
  const trainedWeights = amountWeights(providerAmountErrors(train, providers), floor, cap);
  const equal = blendAmountError(test, null);
  const weighted = blendAmountError(test, trainedWeights);
  let datesWon = 0;
  let datesCompared = 0;
  for (const date of dates.filter((date) => split !== undefined && date >= split)) {
    const day = test.filter((block) => block.targetDate === date);
    const dayEqual = blendAmountError(day, null);
    const dayWeighted = blendAmountError(day, trainedWeights);
    if (dayEqual.meanAbsErrorMm === null || dayWeighted.meanAbsErrorMm === null) continue;
    datesCompared += 1;
    if (dayWeighted.meanAbsErrorMm < dayEqual.meanAbsErrorMm) datesWon += 1;
  }

  const reasons: string[] = [];
  if (dates.length < AMOUNT_SWITCH_MIN_DAYS) {
    reasons.push(`${dates.length} of ${AMOUNT_SWITCH_MIN_DAYS} days`);
  }
  if (wetStationDays < AMOUNT_SWITCH_MIN_WET_STATION_DAYS) {
    reasons.push(`${wetStationDays} of ${AMOUNT_SWITCH_MIN_WET_STATION_DAYS} wet station-days`);
  }
  if (weighted.meanAbsErrorMm === null || equal.meanAbsErrorMm === null ||
      weighted.meanAbsErrorMm >= equal.meanAbsErrorMm) {
    reasons.push("weights fitted on earlier dates do not beat the plain average on later dates");
  }
  if (datesCompared === 0 || datesWon * 2 <= datesCompared) {
    reasons.push(`weights win on ${datesWon} of ${datesCompared} later wet dates, not most`);
  }
  return {
    ready: reasons.length === 0,
    days: dates.length,
    wetStationDays,
    weights,
    outOfSample: {
      trainDates: dates.filter((date) => split !== undefined && date < split).length,
      testDates: dates.filter((date) => split !== undefined && date >= split).length,
      equal,
      weighted,
      datesWon,
      datesCompared,
    },
    reasons,
  };
}
