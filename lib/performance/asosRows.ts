import type { HourlyRain } from "./types.ts";

/** Validate an entire ASOS daily response before any observation is stored. */
export function parseAsosRows(
  raw: unknown,
  stationId: string,
  startDate: string,
  endDate: string,
): Map<string, number> {
  const rows = envelopeRows(raw);
  const observed = new Map<string, number>();
  for (const rawRow of rows) {
    const row = record(rawRow);
    if (!row || row.stnId !== stationId) throw new Error("ASOS station identity mismatch");
    const date = row.tm;
    if (typeof date !== "string" || !validDate(date) || date < startDate || date > endDate) {
      throw new Error("ASOS date is outside the requested range");
    }
    if (observed.has(date)) throw new Error("ASOS response contains duplicate dates");
    if (typeof row.sumRn !== "string") throw new Error("ASOS precipitation is unavailable");
    const value = row.sumRn.trim();
    if (value !== "" && !/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(value)) {
      throw new Error("ASOS precipitation is invalid");
    }
    const mm = value === "" ? 0 : Number(value);
    if (!Number.isFinite(mm)) throw new Error("ASOS precipitation is invalid");
    observed.set(date, mm);
  }
  return observed;
}

const HOURLY_STAMP = /^(\d{4}-\d{2}-\d{2}) (\d{2}):00$/u;
const RAIN_VALUE = /^(?:\d+(?:\.\d*)?|\.\d+)$/u;
/** Flags under which a blank hour is a measured dry hour. See DECISIONS 2026-10-21. */
const DRY_BLANK_FLAGS = new Set(["", "9"]);

/**
 * Validate an entire ASOS hourly response and group it into KMA days.
 *
 * ASOS stamps an hour by its end: `08:00` is the rain from 07:00 to 08:00, so a KMA
 * day runs from the `01:00` row to the next date's `00:00` row, exactly the span
 * the daily `sumRn` totals. Every requested day comes back with 24 slots; a slot
 * with no row is null, an unknown hour rather than a dry one.
 */
export function parseAsosHourlyRows(
  raw: unknown,
  stationId: string,
  startDate: string,
  endDate: string,
): Map<string, (HourlyRain | null)[]> {
  const rows = envelopeRows(raw);
  const days = new Map<string, (HourlyRain | null)[]>();
  for (const rawRow of rows) {
    const row = record(rawRow);
    if (!row || row.stnId !== stationId) throw new Error("ASOS station identity mismatch");
    const stamp = typeof row.tm === "string" ? HOURLY_STAMP.exec(row.tm) : null;
    if (!stamp || !validDate(stamp[1]) || Number(stamp[2]) > 23) {
      throw new Error("ASOS hour stamp is malformed");
    }
    const hourEnding = Number(stamp[2]);
    const date = hourEnding === 0 ? previousDate(stamp[1]) : stamp[1];
    if (date < startDate || date > endDate) throw new Error("ASOS hour is outside the requested range");
    const slot = hourEnding === 0 ? 23 : hourEnding - 1;
    const hours = days.get(date) ?? Array.from({ length: 24 }, () => null);
    if (hours[slot] !== null) throw new Error("ASOS response contains duplicate hours");
    if (typeof row.rn !== "string") throw new Error("ASOS hourly precipitation is unavailable");
    const flag = typeof row.rnQcflg === "string" ? row.rnQcflg.trim() : "";
    const value = row.rn.trim();
    let mm: number | null;
    if (value === "") {
      mm = DRY_BLANK_FLAGS.has(flag) ? 0 : null;
    } else {
      if (!RAIN_VALUE.test(value)) throw new Error("ASOS hourly precipitation is invalid");
      mm = Number(value);
    }
    hours[slot] = { mm, qcFlag: flag === "" ? null : flag };
    days.set(date, hours);
  }
  return days;
}

function envelopeRows(raw: unknown): unknown[] {
  const response = record(raw)?.response;
  const body = record(record(response)?.body);
  if (!body) throw new Error("ASOS response body is malformed");
  const items = body.items === undefined ? null : record(body.items);
  if (body.items !== undefined && !items) throw new Error("ASOS items envelope is malformed");
  const item = items?.item;
  const rows = item === undefined || item === null
    ? []
    : Array.isArray(item) ? item : [item];
  const count = body.totalCount;
  if ((typeof count !== "string" && typeof count !== "number") ||
      (typeof count === "string" && !/^\d+$/u.test(count)) ||
      !Number.isSafeInteger(Number(count)) || Number(count) !== rows.length) {
    throw new Error("ASOS response row count is inconsistent");
  }
  return rows;
}

function previousDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
