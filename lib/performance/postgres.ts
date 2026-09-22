import { COMPARED_PROVIDER_IDS } from "../providers/selection.ts";
import postgres from "postgres";
import type {
  CaptureCohort,
  CompletedComparison,
  ForecastCapture,
  ObservationStation,
  PrecipObservation,
  SeedComparison,
} from "./types.ts";
import {
  assertSafeStationCatalogSync,
  type CaptureWriteResult,
  type PerformanceStore,
} from "./store.ts";

interface CompletedComparisonRow {
  station_id: string;
  target_date: string;
  cohort: CaptureCohort;
  captured_at: string;
  providers: ForecastCapture["providers"];
  frozen_blend: ForecastCapture["frozenBlend"];
  observation_date: string;
  observed_mm: number;
  observed_at: string;
  source: PrecipObservation["source"];
}

interface StationRow {
  id: string;
  name: string;
  network: ObservationStation["network"];
  latitude: number;
  longitude: number;
  elevation_m: number | null;
  active_from: string;
  active_to: string | null;
}

interface StationIdRow {
  id: string;
}

interface SeedComparisonRow {
  station_id: string;
  target_date: string;
  providers: SeedComparison["providers"];
  observed_mm: number;
  built_at: string;
}

export interface CompletedComparisonsQuery {
  text: string;
  parameters: Array<string | number>;
}

/** Build the parameterized bounded Completed Comparison query used in production. */
export function buildCompletedComparisonsQuery(
  stationId: string,
  cohort: CaptureCohort,
  limit: number,
): CompletedComparisonsQuery {
  const providerRows = COMPARED_PROVIDER_IDS
    .map((_, index) => `($${index + 4}::text)`)
    .join(",\n          ");
  return {
    text: `
      with provider_ids (provider) as (
        values
          ${providerRows}
      ),
      recent_dates as (
        select distinct recent.target_date
        from provider_ids
        cross join lateral (
          select capture.target_date
          from performance_captures as capture
          join performance_observations as observation
            on observation.station_id = capture.station_id
            and observation.date = capture.target_date
          where capture.station_id = $1
            and capture.cohort = $2
            and capture.providers @> jsonb_build_array(
              jsonb_build_object('provider', provider_ids.provider)
            )
            and exists (
              select 1
              from jsonb_array_elements(capture.providers) as forecast(value)
              where forecast.value ->> 'provider' = provider_ids.provider
                and case
                  when jsonb_typeof(forecast.value -> 'probability') = 'number'
                  then (forecast.value ->> 'probability')::double precision between 0 and 100
                  else false
                end
            )
          order by capture.target_date desc
          limit $3
        ) as recent
      )
      select
        capture.station_id,
        capture.target_date::text,
        capture.cohort,
        capture.captured_at::text,
        capture.providers,
        capture.frozen_blend,
        observation.date::text as observation_date,
        observation.observed_mm,
        observation.observed_at::text,
        observation.source
      from performance_captures as capture
      join performance_observations as observation
        on observation.station_id = capture.station_id
        and observation.date = capture.target_date
      join recent_dates on recent_dates.target_date = capture.target_date
      where capture.station_id = $1 and capture.cohort = $2
      order by capture.target_date
    `,
    parameters: [stationId, cohort, limit, ...COMPARED_PROVIDER_IDS],
  };
}

function isoTimestamp(value: string): string {
  return new Date(value).toISOString();
}

const RETRYABLE_PRECONNECT_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);
const DEFAULT_CONNECTION_RETRY_DELAY_MS = 1_000;
const MAX_ERROR_TREE_DEPTH = 8;
const MAX_ERROR_TREE_NODES = 32;
const MAX_ERROR_MESSAGE_LENGTH = 300;

type RecoverablePostgresOperation =
  // The cold-start window: every statement a cohort runs before it captures
  // anything. These are the first contact with the database, so they are the
  // ones a pre-connect flap actually meets. See #170.
  | "initialize"
  | "listStations"
  | "syncStations"
  | "saveObservation"
  | "saveCapture"
  | "loadCompletedComparisons";

export interface PostgresStatementRecoveryOptions {
  enabled: boolean;
  delayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

export interface PostgresPerformanceStoreOptions {
  readOnly?: boolean;
  retryConnectionFailures?: boolean;
}

function aggregateCauses(error: AggregateError): unknown[] {
  return Array.from(error.errors as Iterable<unknown>);
}

/**
 * Only a socket failure proven to happen while connecting is safe to replay.
 * An AggregateError qualifies only when every non-empty leaf carries that proof.
 */
export function isRetryablePreconnectFailure(error: unknown): boolean {
  return isRetryablePreconnectFailureNode(
    error,
    new Set<AggregateError>(),
    { remaining: MAX_ERROR_TREE_NODES },
    0,
  );
}

function isRetryablePreconnectFailureNode(
  error: unknown,
  ancestors: Set<AggregateError>,
  budget: { remaining: number },
  depth: number,
): boolean {
  if (depth > MAX_ERROR_TREE_DEPTH || budget.remaining <= 0) return false;
  budget.remaining -= 1;
  if (error instanceof AggregateError) {
    if (ancestors.has(error)) return false;
    const causes = aggregateCauses(error);
    if (causes.length === 0) return false;
    const nextAncestors = new Set(ancestors).add(error);
    return causes.every((cause) => isRetryablePreconnectFailureNode(
      cause,
      nextAncestors,
      budget,
      depth + 1,
    ));
  }
  if (!(error instanceof Error)) return false;
  const candidate = error as NodeJS.ErrnoException;
  return candidate.syscall === "connect"
    && typeof candidate.code === "string"
    && RETRYABLE_PRECONNECT_CODES.has(candidate.code);
}

function redactConnectionSecrets(message: string): string {
  const redacted = message
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/giu, "$1<REDACTED>@")
    .replace(/([?&](?:password|pass|pwd)=)[^&\s]+/giu, "$1<REDACTED>");
  return redacted.length <= MAX_ERROR_MESSAGE_LENGTH
    ? redacted
    : `${redacted.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`;
}

function describeErrorLeaf(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const candidate = error as NodeJS.ErrnoException;
  const facts = [candidate.syscall, candidate.code]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
  if (candidate.syscall && typeof candidate.code === "string" && /^E[A-Z]+$/u.test(candidate.code)) {
    const safeMessage = redactConnectionSecrets(error.message.trim());
    if (safeMessage) return safeMessage;
  }
  if (facts) return facts;
  return error.name || "Error";
}

/** Return a non-empty, credential-redacted diagnostic for driver errors. */
export function describePostgresError(error: unknown): string {
  return describePostgresErrorNode(
    error,
    new Set<AggregateError>(),
    { remaining: MAX_ERROR_TREE_NODES },
    0,
  );
}

function describePostgresErrorNode(
  error: unknown,
  ancestors: Set<AggregateError>,
  budget: { remaining: number },
  depth: number,
): string {
  if (depth > MAX_ERROR_TREE_DEPTH || budget.remaining <= 0) return "error details truncated";
  budget.remaining -= 1;
  if (error instanceof AggregateError) {
    if (ancestors.has(error)) return "cyclic AggregateError";
    const causes = aggregateCauses(error);
    if (causes.length === 0) return "AggregateError without causes";
    const nextAncestors = new Set(ancestors).add(error);
    const includedCauses = causes.slice(0, budget.remaining);
    const details = includedCauses.map((cause) =>
      describePostgresErrorNode(cause, nextAncestors, budget, depth + 1)).join("; ");
    const omitted = causes.length - includedCauses.length;
    return `AggregateError (${causes.length} causes: ${details}${omitted > 0 ? `; ${omitted} omitted` : ""})`;
  }
  return describeErrorLeaf(error);
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** Retry one exact statement once, and only for a proven pre-connect socket failure. */
export async function runPostgresStatementWithRecovery<T>(
  operation: RecoverablePostgresOperation,
  statement: () => Promise<T>,
  options: PostgresStatementRecoveryOptions,
): Promise<T> {
  try {
    return await statement();
  } catch (error) {
    if (!options.enabled) throw error;
    if (!isRetryablePreconnectFailure(error)) {
      throw new Error(`PostgreSQL ${operation} failed: ${describePostgresError(error)}`, {
        cause: error,
      });
    }
  }

  await (options.sleep ?? sleep)(options.delayMs ?? DEFAULT_CONNECTION_RETRY_DELAY_MS);
  try {
    return await statement();
  } catch (error) {
    throw new Error(
      `PostgreSQL ${operation} failed after connection retry: ${describePostgresError(error)}`,
      { cause: error },
    );
  }
}

export class PostgresPerformanceStore implements PerformanceStore {
  readonly #sql: ReturnType<typeof postgres>;
  readonly #statementRecovery: PostgresStatementRecoveryOptions;

  constructor(connectionUrl: string, options: PostgresPerformanceStoreOptions = {}) {
    if (!connectionUrl.trim()) throw new Error("PERFORMANCE_DATABASE_URL is required");
    this.#statementRecovery = {
      enabled: options.retryConnectionFailures ?? false,
      delayMs: DEFAULT_CONNECTION_RETRY_DELAY_MS,
    };
    this.#sql = postgres(connectionUrl, {
      max: 4,
      idle_timeout: 20,
      connect_timeout: 10,
      connection: options.readOnly ? {
        statement_timeout: 15_000,
        idle_in_transaction_session_timeout: 10_000,
        default_transaction_read_only: true,
      } : {},
    });
  }

  async initialize(): Promise<void> {
    // Every statement here is `if not exists`, and a refused connection is proof
    // none of them ran, so replaying the whole schema pass is idempotent twice over.
    await runPostgresStatementWithRecovery("initialize", async () => {
      await this.#sql`
        create table if not exists performance_stations (
          id text primary key,
          name text not null,
          network text not null check (network = 'ASOS'),
          latitude double precision not null,
          longitude double precision not null,
          elevation_m double precision,
          active_from date not null,
          active_to date
        )
      `;
      await this.#sql`
        create table if not exists performance_captures (
          station_id text not null references performance_stations(id),
          target_date date not null,
          cohort text not null check (cohort in ('06', '18')),
          captured_at timestamptz not null,
          providers jsonb not null,
          frozen_blend jsonb not null,
          primary key (station_id, target_date, cohort)
        )
      `;
      await this.#sql`
        create table if not exists performance_observations (
          station_id text not null references performance_stations(id),
          date date not null,
          observed_mm double precision not null check (observed_mm >= 0),
          observed_at timestamptz not null,
          source text not null check (source = 'kma-asos'),
          primary key (station_id, date)
        )
      `;
      await this.#sql`
        create index if not exists performance_captures_station_cohort_date
        on performance_captures (station_id, cohort, target_date)
      `;
      await this.#sql`
        create index if not exists performance_captures_providers
        on performance_captures using gin (providers jsonb_path_ops)
      `;
      await this.#sql`
        create index if not exists performance_observations_station_date
        on performance_observations (station_id, date)
      `;
      // Retrospective seed evidence. Deliberately a separate table from
      // performance_captures: it has no cohort and no frozen blend, so it cannot be
      // read back as a prospective Capture even by a mistaken join.
      await this.#sql`
        create table if not exists performance_seed_comparisons (
          station_id text not null references performance_stations(id),
          target_date date not null,
          providers jsonb not null,
          observed_mm double precision not null check (observed_mm >= 0),
          built_at timestamptz not null,
          primary key (station_id, target_date)
        )
      `;
      await this.#sql`
        create index if not exists performance_seed_station_date
        on performance_seed_comparisons (station_id, target_date desc)
      `;
    }, this.#statementRecovery);
  }

  async syncStations(
    stations: readonly ObservationStation[],
    catalogDate: string,
  ): Promise<void> {
    if (stations.length === 0) return;
    // Replaying a transaction is safe only because the retry demands proof the
    // connection was never established, so the first attempt applied nothing.
    await runPostgresStatementWithRecovery("syncStations", () => this.#sql.begin(async (sql) => {
      const currentRows = await sql<StationIdRow[]>`
        select id
        from performance_stations
        where network = 'ASOS' and active_to is null
      `;
      assertSafeStationCatalogSync(new Set(currentRows.map((row) => row.id)), stations);
      const activeIds = new Set(stations.map((station) => station.id));
      for (const row of currentRows) {
        if (activeIds.has(row.id)) continue;
        await sql`
          update performance_stations
          set active_to = ${catalogDate}::date - 1
          where id = ${row.id} and active_to is null
        `;
      }
      for (const station of stations) {
        await sql`
          insert into performance_stations (
            id, name, network, latitude, longitude, elevation_m, active_from, active_to
          ) values (
            ${station.id}, ${station.name}, ${station.network}, ${station.latitude},
            ${station.longitude}, ${station.elevationM}, ${station.activeFrom}, ${station.activeTo}
          )
          on conflict (id) do update set
            name = excluded.name,
            network = excluded.network,
            latitude = excluded.latitude,
            longitude = excluded.longitude,
            elevation_m = excluded.elevation_m,
            active_to = null
        `;
      }
    }), this.#statementRecovery);
  }

  async listStations(): Promise<ObservationStation[]> {
    const rows = await runPostgresStatementWithRecovery("listStations", () => this.#sql<StationRow[]>`
      select id, name, network, latitude, longitude, elevation_m, active_from::text, active_to::text
      from performance_stations
      order by id::integer
    `, this.#statementRecovery);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      network: row.network,
      latitude: row.latitude,
      longitude: row.longitude,
      elevationM: row.elevation_m,
      activeFrom: row.active_from,
      activeTo: row.active_to,
    }));
  }

  async saveCapture(capture: ForecastCapture): Promise<CaptureWriteResult> {
    const stationId = capture.stationId;
    const targetDate = capture.targetDate;
    const cohort = capture.cohort;
    const capturedAt = capture.capturedAt;
    const providers = structuredClone(capture.providers);
    const frozenBlend = structuredClone(capture.frozenBlend);
    return runPostgresStatementWithRecovery("saveCapture", async () => {
      const rows = await this.#sql`
        insert into performance_captures (
          station_id, target_date, cohort, captured_at, providers, frozen_blend
        ) values (
          ${stationId}, ${targetDate}, ${cohort}, ${capturedAt},
          ${this.#sql.json(providers as unknown as postgres.JSONValue)},
          ${this.#sql.json(frozenBlend as unknown as postgres.JSONValue)}
        )
        on conflict (station_id, target_date, cohort) do nothing
        returning station_id
      `;
      return rows.length === 0 ? "existing" : "inserted";
    }, this.#statementRecovery);
  }

  async saveObservation(observation: PrecipObservation): Promise<void> {
    const stationId = observation.stationId;
    const date = observation.date;
    const observedMm = observation.observedMm;
    const observedAt = observation.observedAt;
    const source = observation.source;
    await runPostgresStatementWithRecovery("saveObservation", async () => {
      await this.#sql`
        insert into performance_observations (
          station_id, date, observed_mm, observed_at, source
        ) values (
          ${stationId}, ${date}, ${observedMm}, ${observedAt}, ${source}
        )
        on conflict (station_id, date) do update set
          observed_mm = excluded.observed_mm,
          observed_at = excluded.observed_at,
          source = excluded.source
      `;
    }, this.#statementRecovery);
  }

  async loadCompletedComparisons(
    stationId: string,
    cohort: CaptureCohort,
    limit: number,
  ): Promise<CompletedComparison[]> {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new RangeError("invalid comparison limit");
    const query = buildCompletedComparisonsQuery(stationId, cohort, limit);
    const rows = await runPostgresStatementWithRecovery(
      "loadCompletedComparisons",
      () => this.#sql.unsafe<CompletedComparisonRow[]>(query.text, query.parameters),
      this.#statementRecovery,
    );
    return rows.map((row) => ({
      capture: {
        stationId: row.station_id,
        targetDate: row.target_date,
        cohort: row.cohort,
        capturedAt: isoTimestamp(row.captured_at),
        providers: row.providers,
        frozenBlend: row.frozen_blend,
      },
      observation: {
        stationId: row.station_id,
        date: row.observation_date,
        observedMm: row.observed_mm,
        observedAt: isoTimestamp(row.observed_at),
        source: row.source,
      },
    }));
  }

  async saveSeedComparisons(comparisons: readonly SeedComparison[]): Promise<number> {
    if (comparisons.length === 0) return 0;
    let inserted = 0;
    await this.#sql.begin(async (sql) => {
      for (const comparison of comparisons) {
        const rows = await sql`
          insert into performance_seed_comparisons (
            station_id, target_date, providers, observed_mm, built_at
          ) values (
            ${comparison.stationId}, ${comparison.targetDate},
            ${sql.json(comparison.providers as unknown as postgres.JSONValue)},
            ${comparison.observedMm}, ${comparison.builtAt}
          )
          on conflict (station_id, target_date) do nothing
          returning station_id
        `;
        if (rows.length > 0) inserted += 1;
      }
    });
    return inserted;
  }

  async loadSeedComparisons(stationId: string, limit: number): Promise<SeedComparison[]> {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new RangeError("invalid comparison limit");
    const rows = await this.#sql<SeedComparisonRow[]>`
      select station_id, target_date::text, providers, observed_mm, built_at::text
      from performance_seed_comparisons
      where station_id = ${stationId}
      order by target_date desc
      limit ${limit}
    `;
    return rows
      .map((row) => ({
        stationId: row.station_id,
        targetDate: row.target_date,
        providers: row.providers,
        observedMm: row.observed_mm,
        builtAt: isoTimestamp(row.built_at),
      }))
      .sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  }

  async close(): Promise<void> {
    await this.#sql.end({ timeout: 5 });
  }
}
