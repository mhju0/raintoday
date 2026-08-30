import { runPerformanceBatch } from "../lib/performance/batch.ts";
import { cohortRunFailed, resolveCaptureCohort } from "../lib/performance/cli.ts";
import { PostgresPerformanceStore } from "../lib/performance/postgres.ts";

async function main(): Promise<void> {
  const cohort = resolveCaptureCohort(process.argv.slice(2));
  const connectionUrl = process.env.PERFORMANCE_DATABASE_URL?.trim();
  if (!connectionUrl) throw new Error("PERFORMANCE_DATABASE_URL is required");
  const store = new PostgresPerformanceStore(connectionUrl);
  try {
    const result = await runPerformanceBatch({
      cohort,
      now: new Date(),
      store,
    });
    console.log(JSON.stringify({ cohort, ...result }, null, 2));
    // 97 stations failing the same way prints 97 near-identical entries, which
    // buries the one thing worth reading: what actually went wrong, and how often.
    if (result.failures.length > 0) {
      const byReason = new Map<string, number>();
      for (const failure of result.failures) {
        const label = `${failure.phase}: ${failure.message}`;
        byReason.set(label, (byReason.get(label) ?? 0) + 1);
      }
      console.warn(`FAILURES (${result.failures.length} across ${byReason.size} distinct causes):`);
      for (const [label, count] of [...byReason].sort((a, b) => b[1] - a[1])) {
        console.warn(`  ${String(count).padStart(4)} x ${label}`);
      }
    }
    // The cohort was captured, so the run is not a failure — but it ran on a
    // station list nothing re-verified today, and a green run reports nothing.
    if (result.catalogSource === "store") {
      console.warn(
        `WARNING: the KMA station catalog was unreachable (${result.catalogError}). ` +
          `This cohort ran on the ${result.stationCount} stations already recorded. ` +
          "Station activations and retirements are not applied until a catalog read succeeds.",
      );
    }
    // A handful of refused captures is missing data, never wrong data, and the
    // retry on a fresh runner fills most of them in. Say so loudly, then let the
    // run stand: an alert that fires on three stations out of 97 is one nobody
    // reads by the time it matters.
    const failed = cohortRunFailed(result);
    if (result.capturesFaulted > 0 && !failed) {
      console.warn(
        `WARNING: ${result.capturesFaulted} of ${result.stationCount} stations could not be ` +
          "captured because a provider read failed. Nothing was stored for them, so the record " +
          "is short rather than wrong, and the next cohort continues normally.",
      );
    }
    if (failed) process.exitCode = 1;
  } finally {
    await store.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "local performance batch failed");
  process.exitCode = 1;
});
