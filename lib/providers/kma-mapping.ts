import type { WeatherCondition } from "../types";

/**
 * Pure KMA value mappers — no I/O, no env, no time. Kept separate from kma.ts so
 * the category/warning logic is unit-testable in isolation (see kma-mapping.test.ts).
 */

/**
 * 강수형태(PTY) takes priority; otherwise 하늘상태(SKY). Shared by both
 * 초단기실황 (PTY only) and 단기예보 (PTY + SKY).
 *
 * PTY: 0 없음 · 1 비 · 2 비/눈 · 3 눈 · 4 소나기 · 5 빗방울 · 6 빗방울눈날림 · 7 눈날림
 * SKY: 1 맑음 · 3 구름많음 · 4 흐림
 */
export function conditionFromKma(pty: number, sky: number): WeatherCondition {
  switch (pty) {
    case 1:
    case 4:
      return "rain";
    case 2:
    case 6:
      return "sleet";
    case 3:
    case 7:
      return "snow";
    case 5:
      return "drizzle";
  }
  switch (sky) {
    case 1:
      return "clear";
    case 3:
      return "cloudy";
    case 4:
      return "overcast";
  }
  return "unknown";
}

/**
 * 단기예보 1시간 강수량(PCP) → millimetres, only where KMA states an amount:
 * "강수없음" is 0, and an exact value ("1.0mm", or a bare "0") is that value. A band
 * is never turned into a value: it appears exactly when it rains, where a guessed
 * value would be most wrong (DECISIONS 2026-08-26); `amountRangeFromKmaPcp` keeps
 * it as a band. Anything else is unknown, never dry.
 */
export function amountFromKmaPcp(value: string | undefined): number | null {
  if (value === undefined) return null;
  const text = value.trim();
  if (text === "강수없음") return 0;
  const exact = /^(\d+(?:\.\d+)?)\s*(?:mm)?$/.exec(text);
  return exact ? Number(exact[1]) : null;
}

/**
 * A PCP band as its bounds in mm: "1mm 미만" is 0–1, "30.0~50.0mm" is 30–50, and
 * "50.0mm 이상" is 50 with no upper bound. Null for an exact value or anything else.
 */
export function amountRangeFromKmaPcp(
  value: string | undefined,
): { lowMm: number; highMm: number | null } | null {
  const text = value?.trim() ?? "";
  const range = /^(\d+(?:\.\d+)?)\s*~\s*(\d+(?:\.\d+)?)\s*mm$/.exec(text);
  if (range) return { lowMm: Number(range[1]), highMm: Number(range[2]) };
  const below = /^(\d+(?:\.\d+)?)\s*mm\s*미만$/.exec(text);
  if (below) return { lowMm: 0, highMm: Number(below[1]) };
  const atLeast = /^(\d+(?:\.\d+)?)\s*mm\s*이상$/.exec(text);
  return atLeast ? { lowMm: Number(atLeast[1]), highMm: null } : null;
}
