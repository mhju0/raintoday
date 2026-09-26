/** Validate an entire ASOS daily response before any observation is stored. */
export function parseAsosRows(
  raw: unknown,
  stationId: string,
  startDate: string,
  endDate: string,
): Map<string, number> {
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

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
