import { classifyKmaResponse } from "../providers/kma.ts";
import { readResponseBytes } from "../httpResponse.ts";
import { parseAsosDailyRange } from "./seed.ts";
import type { ObservationStation, PrecipObservation } from "./types.ts";

const STATION_CATALOG_URL = "https://apihub.kma.go.kr/api/typ01/url/stn_inf.php";
const ASOS_DAILY_URL =
  "https://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList";
const MAX_STATION_CATALOG_BYTES = 1024 * 1024;
const STATION_CATALOG_ATTEMPTS = 3;
const STATION_CATALOG_RETRY_BASE_MS = 3_000;
const MAX_ASOS_OBSERVATION_BYTES = 256 * 1024;
const ASOS_OBSERVATION_ATTEMPTS = 3;
// Shorter than the catalog's, because this runs once per station rather than once
// per cohort: 97 stations each waiting the catalog's 3s and 6s would add minutes
// to a run whose whole point is to finish inside the cohort's hour.
const ASOS_OBSERVATION_RETRY_BASE_MS = 750;
/** One window is one request, so it is bounded by what a single response can carry. */
export const MAX_OBSERVATION_WINDOW_DAYS = 31;
const MAX_ASOS_WINDOW_BYTES = 1024 * 1024;

function koreanDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function koreanTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}${value("month")}${value("day")}${value("hour")}${value("minute")}`;
}

function serviceKey(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return value.includes("%") ? decodeURIComponent(value) : value;
}

/** Parse KMA's whitespace-delimited current surface-station catalog. */
export function parseKmaStationCatalog(body: string, at: Date): ObservationStation[] {
  const activeFrom = koreanDate(at);
  return body.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const columns = trimmed.split(/\s+/);
    if (columns.length < 11) return [];
    const id = columns[0];
    const longitude = Number(columns[1]);
    const latitude = Number(columns[2]);
    const elevation = Number(columns[4]);
    const name = columns[10];
    if (
      !/^\d+$/.test(id) ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      !name ||
      latitude < 32 ||
      latitude > 39.5 ||
      longitude < 124 ||
      longitude > 132
    ) {
      return [];
    }
    return [{
      id,
      name,
      network: "ASOS" as const,
      latitude,
      longitude,
      elevationM: Number.isFinite(elevation) && elevation >= 0 ? elevation : null,
      activeFrom,
      activeTo: null,
    }];
  });
}

export type RetryDelay = (ms: number) => Promise<void>;

const sleep: RetryDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The catalog runs before any station is read, so a single dropped connection used to
 * discard the whole run. Scheduled runners reach apihub only intermittently, so retry a
 * thrown transport error — a connect failure or a timeout. A refusal is the server's
 * actual answer and is never retried.
 *
 * The attempts back off rather than firing back to back: the runner failures this
 * exists for are blips lasting seconds, and three immediate retries all land inside
 * the same one. Backing off is not a guarantee either, which is why the batch can
 * still proceed without a live catalog.
 */
async function fetchCatalog(
  url: string,
  fetchImpl: typeof fetch,
  delay: RetryDelay,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < STATION_CATALOG_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await delay(STATION_CATALOG_RETRY_BASE_MS * 2 ** (attempt - 1));
    try {
      return await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * apihub serves the typ01 catalog as EUC-KR, not UTF-8. Decoding it as UTF-8 turns
 * every Korean station name into replacement characters, and those names are shown
 * to the reader, so honour the declared charset and fall back to EUC-KR.
 */
function decodeCatalog(response: Response, bytes: Uint8Array): string {
  const declared = /charset=([\w-]+)/i.exec(response.headers.get("content-type") ?? "")?.[1];
  try {
    return new TextDecoder(declared ?? "euc-kr").decode(bytes);
  } catch {
    return new TextDecoder("euc-kr").decode(bytes);
  }
}

export async function fetchKmaAsosStations(
  at: Date,
  fetchImpl: typeof fetch = fetch,
  delay: RetryDelay = sleep,
): Promise<ObservationStation[]> {
  const key = serviceKey(process.env.KMA_APIHUB_KEY);
  if (!key) throw new Error("KMA_APIHUB_KEY is required for the ASOS station catalog");
  const params = new URLSearchParams({
    inf: "SFC",
    stn: "0",
    tm: koreanTimestamp(at),
    help: "0",
    authKey: key,
  });
  const response = await fetchCatalog(`${STATION_CATALOG_URL}?${params}`, fetchImpl, delay);
  if (!response.ok) throw new Error(`KMA station catalog returned HTTP ${response.status}`);
  const catalog = await readResponseBytes(response, { maxBytes: MAX_STATION_CATALOG_BYTES });
  const stations = parseKmaStationCatalog(decodeCatalog(response, catalog), at);
  if (stations.length === 0) throw new Error("KMA station catalog contained no usable ASOS rows");
  return stations;
}

interface AsosDailyItem {
  sumRn?: string;
}

export function parseAsosDailyObservation(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const response = (raw as { response?: unknown }).response;
  if (!response || typeof response !== "object") return null;
  const body = (response as { body?: unknown }).body;
  if (!body || typeof body !== "object") return null;
  const items = (body as { items?: unknown }).items;
  if (!items || typeof items !== "object") return null;
  const item = (items as { item?: unknown }).item;
  const row = (Array.isArray(item) ? item[0] : item) as AsosDailyItem | null | undefined;
  if (!row || typeof row !== "object") return null;
  const value = (row.sumRn ?? "").trim();
  const observedMm = value === "" ? 0 : Number(value);
  return Number.isFinite(observedMm) && observedMm >= 0 ? observedMm : null;
}

/**
 * The outcome of one station-day observation read.
 *
 * `absent` and `failed` used to be the same bare `null`, so a refused request was
 * indistinguishable from a station ASOS simply has no row for. A run once stored 10
 * of 97 observations and reported no failures at all, and nothing in the output said
 * why. Only `absent` is a real answer; `failed` is a fault and must be reported.
 */
export type AsosObservationRead =
  | { status: "observed"; observation: PrecipObservation; reason?: undefined }
  | { status: "absent"; observation?: undefined; reason?: undefined }
  | { status: "failed"; observation?: undefined; reason: string };

function transportReason(error: unknown): string {
  return error instanceof Error ? error.message : "observation request failed";
}

export async function fetchAsosObservation(
  stationId: string,
  date: string,
  now: Date,
  fetchImpl: typeof fetch = fetch,
  delay: RetryDelay = sleep,
): Promise<AsosObservationRead> {
  const key = serviceKey(
    process.env.KMA_OBSERVATION_API_KEY ?? process.env.KMA_SHORT_TERM_API_KEY,
  );
  // Reporting this per station is noisy, but an unset key silently scoring every
  // station as unobserved is how a whole pipeline stalls without anyone noticing.
  if (!key) return { status: "failed", reason: "KMA_OBSERVATION_API_KEY is not configured" };
  const compactDate = date.replace(/-/g, "");
  const params = new URLSearchParams({
    serviceKey: key,
    dataType: "JSON",
    dataCd: "ASOS",
    dateCd: "DAY",
    startDt: compactDate,
    endDt: compactDate,
    stnIds: stationId,
    numOfRows: "10",
    pageNo: "1",
  });

  let reason = "observation request failed";
  for (let attempt = 0; attempt < ASOS_OBSERVATION_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await delay(ASOS_OBSERVATION_RETRY_BASE_MS * 2 ** (attempt - 1));
    let response: Response;
    try {
      response = await fetchImpl(`${ASOS_DAILY_URL}?${params}`, {
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      reason = transportReason(error);
      continue;
    }
    const bytes = await readResponseBytes(response, { maxBytes: MAX_ASOS_OBSERVATION_BYTES });
    const classified = classifyKmaResponse(response.status, new TextDecoder().decode(bytes));
    // NODATA is the service answering that the row does not exist. That is a fact
    // about the weather record, not a fault, and must not turn the run red.
    if (classified.class === "empty") return { status: "absent" };
    if (classified.class === "forbidden") {
      // A key the service refuses will be refused again; retrying only spends quota.
      return { status: "failed", reason: `forbidden — ${classified.detail}` };
    }
    if (classified.class !== "ok") {
      reason = `${classified.class} — ${classified.detail}`;
      continue;
    }
    const observedMm = parseAsosDailyObservation(classified.json);
    // An OK response with no readable row is the same absence as NODATA: KMA
    // publishes a blank sumRn for a dry day, so a missing row means no record.
    if (observedMm === null) return { status: "absent" };
    return {
      status: "observed",
      observation: {
        stationId,
        date,
        observedMm,
        observedAt: now.toISOString(),
        source: "kma-asos",
      },
    };
  }
  return { status: "failed", reason };
}

/**
 * The outcome of one station's observation window.
 *
 * A window that could not be read is `failed`, never an empty list. The seed path
 * answers an unusable window with an empty map on purpose — a skipped seed window
 * costs only evidence — but a backfilled observation is benchmark ground truth, and
 * an empty window is indistinguishable from a station-day ASOS has no row for. One
 * would leave a hole that every later read reports as filled.
 */
export type AsosObservationWindowRead =
  | { status: "observed"; observations: PrecipObservation[]; reason?: undefined }
  | { status: "failed"; observations?: undefined; reason: string };

/**
 * Read one station's observed daily precipitation across a past date range.
 *
 * The ASOS daily service accepts a range, so a whole window costs one request rather
 * than one per station-day. Dates missing from the response are simply absent: the
 * request itself succeeded, so the record has no row for them.
 */
export async function fetchAsosObservationWindow(
  stationId: string,
  startDate: string,
  endDate: string,
  now: Date,
  fetchImpl: typeof fetch = fetch,
  delay: RetryDelay = sleep,
): Promise<AsosObservationWindowRead> {
  const key = serviceKey(
    process.env.KMA_OBSERVATION_API_KEY ?? process.env.KMA_SHORT_TERM_API_KEY,
  );
  if (!key) return { status: "failed", reason: "KMA_OBSERVATION_API_KEY is not configured" };
  const params = new URLSearchParams({
    serviceKey: key,
    dataType: "JSON",
    dataCd: "ASOS",
    dateCd: "DAY",
    startDt: startDate.replace(/-/g, ""),
    endDt: endDate.replace(/-/g, ""),
    stnIds: stationId,
    numOfRows: String(MAX_OBSERVATION_WINDOW_DAYS + 1),
    pageNo: "1",
  });

  let reason = "observation window request failed";
  for (let attempt = 0; attempt < ASOS_OBSERVATION_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await delay(ASOS_OBSERVATION_RETRY_BASE_MS * 2 ** (attempt - 1));
    let response: Response;
    try {
      response = await fetchImpl(`${ASOS_DAILY_URL}?${params}`, {
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      reason = transportReason(error);
      continue;
    }
    const bytes = await readResponseBytes(response, { maxBytes: MAX_ASOS_WINDOW_BYTES });
    const classified = classifyKmaResponse(response.status, new TextDecoder().decode(bytes));
    // NODATA over a whole window is the service answering that it holds no row for
    // any of those days. That is a fact about the record, not a fault.
    if (classified.class === "empty") return { status: "observed", observations: [] };
    if (classified.class === "forbidden") {
      return { status: "failed", reason: `forbidden — ${classified.detail}` };
    }
    if (classified.class !== "ok") {
      reason = `${classified.class} — ${classified.detail}`;
      continue;
    }
    const observedAt = now.toISOString();
    const observations = Array.from(parseAsosDailyRange(classified.json))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, observedMm]) => ({
        stationId,
        date,
        observedMm,
        observedAt,
        source: "kma-asos" as const,
      }));
    return { status: "observed", observations };
  }
  return { status: "failed", reason };
}
