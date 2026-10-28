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

/** A block amount as bounds; a stated amount has equal bounds, an open top band no high. */
export interface AmountRange {
  lowMm: number;
  highMm: number | null;
}

/** One station's 3-hour block where every scored provider and the station have a full amount. */
export interface AmountBlock {
  stationId: string;
  targetDate: string;
  start: number;
  observedMm: number;
  /** Providers whose three hours all stated an amount. */
  forecastMm: Partial<Record<PrecipProviderId, number>>;
  /** Providers that gave a band for at least one of the hours (KMA), as the block's bounds. */
  forecastRangeMm: Partial<Record<PrecipProviderId, AmountRange>>;
}

export interface AmountError {
  wetBlocks: number;
  /** Of `wetBlocks`, those scored against a band: the miss is the distance to the band. */
  bandBlocks: number;
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

/**
 * A provider's amount for the block as bounds, or null unless all three of its hours
 * carry an amount or a band. Bounds add up hour by hour; one open band leaves the
 * block open at the top.
 */
export function providerBlockRange(
  forecast: MorningProviderForecast,
  targetDate: string,
  start: number,
  stamp: HourStamp,
): AmountRange | null {
  const hours = new Map<number, AmountRange>();
  for (const hour of forecast.hours) {
    const index = observedHourIndex(hour.time, targetDate, stamp);
    if (index === null || index < start || index >= start + BLOCK_HOURS) continue;
    if (hour.amountMm !== null && Number.isFinite(hour.amountMm)) {
      hours.set(index, { lowMm: hour.amountMm, highMm: hour.amountMm });
    } else if (hour.amountRangeMm) {
      hours.set(index, hour.amountRangeMm);
    }
  }
  if (hours.size < BLOCK_HOURS) return null;
  const ranges = Array.from(hours.values());
  return {
    lowMm: ranges.reduce((sum, range) => sum + range.lowMm, 0),
    highMm: ranges.some((range) => range.highMm === null)
      ? null
      : ranges.reduce((sum, range) => sum + (range.highMm ?? 0), 0),
  };
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
      const forecastRangeMm: Partial<Record<PrecipProviderId, AmountRange>> = {};
      let complete = true;
      for (const provider of providers) {
        const forecast = capture.providers.find((row) => row.provider === provider);
        const range = forecast
          ? providerBlockRange(forecast, capture.targetDate, start, DOCUMENTED_HOUR_STAMPS[provider] ?? unknownStamp)
          : null;
        if (range === null) {
          complete = false;
          break;
        }
        if (range.highMm === range.lowMm) forecastMm[provider] = range.lowMm;
        else forecastRangeMm[provider] = range;
      }
      if (!complete) continue;
      blocks.push({
        stationId: capture.stationId,
        targetDate: capture.targetDate,
        start,
        observedMm,
        forecastMm,
        forecastRangeMm,
      });
    }
  }
  return blocks;
}

/** Every KMA band forecasts some rain, so a block with a band is wet. */
export function isWetBlock(block: AmountBlock): boolean {
  return block.observedMm >= WET_BLOCK_MM ||
    Object.values(block.forecastMm).some((mm) => mm >= WET_BLOCK_MM) ||
    Object.keys(block.forecastRangeMm).length > 0;
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

/** Forecast minus observed, where a band's miss is its distance to the observation. */
function signedMiss(range: AmountRange, observedMm: number): number {
  if (observedMm < range.lowMm) return range.lowMm - observedMm;
  if (range.highMm !== null && observedMm > range.highMm) return range.highMm - observedMm;
  return 0;
}

function errorOf(blocks: readonly AmountBlock[], forecast: (block: AmountBlock) => AmountRange | null): AmountError {
  let n = 0;
  let bands = 0;
  let absolute = 0;
  let signed = 0;
  for (const block of blocks) {
    if (!isWetBlock(block)) continue;
    const range = forecast(block);
    if (range === null) continue;
    const miss = signedMiss(range, block.observedMm);
    n += 1;
    if (range.highMm !== range.lowMm) bands += 1;
    absolute += Math.abs(miss);
    signed += miss;
  }
  return { wetBlocks: n, bandBlocks: bands, meanAbsErrorMm: n ? absolute / n : null, biasMm: n ? signed / n : null };
}

const point = (mm: number | null | undefined): AmountRange | null =>
  mm === null || mm === undefined ? null : { lowMm: mm, highMm: mm };

/** Each provider's amount error on wet blocks. */
export function providerAmountErrors(
  blocks: readonly AmountBlock[],
  providers: readonly PrecipProviderId[],
): Partial<Record<PrecipProviderId, AmountError>> {
  return Object.fromEntries(providers.map((provider) =>
    [provider, errorOf(blocks, (block) => block.forecastRangeMm[provider] ?? point(block.forecastMm[provider]))]));
}

/**
 * The plain or weighted average's amount error on wet blocks. A block where any
 * provider gave a band has no average, since a band is never turned into a number,
 * so both averages and the switch rule use only blocks of stated amounts.
 */
export function blendAmountError(
  blocks: readonly AmountBlock[],
  weights: Partial<Record<PrecipProviderId, number>> | null,
): AmountError {
  return errorOf(blocks, (block) =>
    Object.keys(block.forecastRangeMm).length > 0 ? null : point(blendBlockAmount(block.forecastMm, weights)));
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
