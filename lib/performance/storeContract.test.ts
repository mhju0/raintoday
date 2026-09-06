import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryPerformanceStore } from "./store.ts";
import { runPerformanceStoreContract } from "./storeContract.ts";

runPerformanceStoreContract("in-memory store", async () => new InMemoryPerformanceStore());

/**
 * The PostgreSQL adapter re-implements bounded selection and station retirement
 * in SQL. Point PERFORMANCE_STORE_CONTRACT_URL at a disposable database to run
 * the identical contract against it — the suite truncates its tables, so it must
 * never be the production URL.
 */
const contractUrl = process.env.PERFORMANCE_STORE_CONTRACT_URL?.trim();

if (contractUrl) {
  const { PostgresPerformanceStore } = await import("./postgres.ts");
  const { default: postgres } = await import("postgres");

  runPerformanceStoreContract("postgresql store", async () => {
    const sql = postgres(contractUrl, { max: 1 });
    try {
      await sql.unsafe(`
        truncate table
          performance_captures,
          performance_observations,
          performance_stations
        restart identity cascade
      `);
    } catch {
      // First run against an empty database: initialize() creates the tables.
    } finally {
      await sql.end({ timeout: 5 });
    }
    return new PostgresPerformanceStore(contractUrl);
  });

  test("serving sessions can read but reject writes even with a writable credential", async () => {
    const writer = new PostgresPerformanceStore(contractUrl);
    const reader = new PostgresPerformanceStore(contractUrl, { readOnly: true });
    try {
      await writer.initialize();
      assert.ok(Array.isArray(await reader.listStations()));
      await assert.rejects(reader.saveObservation({
        stationId: "108", date: "2026-09-01", observedMm: 0,
        observedAt: "2026-09-02T00:00:00.000Z", source: "kma-asos",
      }), { code: "25006" });
    } finally {
      await Promise.all([writer.close(), reader.close()]);
    }
  });
} else {
  test("postgresql store contract", { skip: "set PERFORMANCE_STORE_CONTRACT_URL to run" }, () => {});
}
