/**
 * Read-only report: how well each provider forecast rain amounts in the Morning and
 * Evening Captures, the amount weights that would follow, and whether the switch
 * rule lets those weights replace the plain average.
 *
 *     npm run performance:hourly-amounts
 *     npm run performance:hourly-amounts -- --providers=open-meteo,visual-crossing
 *     npm run performance:hourly-amounts -- --from=2026-10-30
 *
 * Each provider is scored on the same blocks, so a provider that started publishing
 * hourly amounts later narrows the dates: pass `--from` to the first date all of
 * them carry. Providers that document no hour-stamp convention are scored under
 * both. A KMA band is scored by the distance from the measured rain to the band
 * (`bandBlocks`), and blocks with a band are left out of both averages. Opens the
 * database read-only and writes nothing.
 */
import {
  amountBlocks,
  amountSwitchVerdict,
  blendAmountError,
  providerAmountErrors,
  type AmountError,
  type HourStamp,
} from "../lib/performance/hourlyAmount.ts";
import { DEFAULT_PERFORMANCE_POLICY } from "../lib/performance/performance.ts";
import { PostgresPerformanceStore } from "../lib/performance/postgres.ts";
import type { HourlySlot, PrecipProviderId } from "../lib/performance/types.ts";

const HOURLY_BLEND_PROVIDERS: PrecipProviderId[] = ["open-meteo", "kma", "weather-api", "visual-crossing"];

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline !== undefined) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

// Options only select from known values; anything else is ignored, and the report
// echoes the providers and date it actually used.
const requested = option("providers")?.split(",") ?? [];
const chosen = HOURLY_BLEND_PROVIDERS.filter((provider) => requested.includes(provider));
const providers = chosen.length > 0 ? chosen : HOURLY_BLEND_PROVIDERS;
const from = /^\d{4}-\d{2}-\d{2}$/.exec(option("from") ?? "")?.[0];

const connectionUrl = process.env.PERFORMANCE_DATABASE_URL?.trim();
if (!connectionUrl) {
  console.error("PERFORMANCE_DATABASE_URL is required");
  process.exit(1);
}

const round = (value: number | null) => (value === null ? null : Math.round(value * 1000) / 1000);
const summary = (error: AmountError | undefined) => ({
  wetBlocks: error?.wetBlocks ?? 0,
  bandBlocks: error?.bandBlocks ?? 0,
  meanAbsErrorMm: round(error?.meanAbsErrorMm ?? null),
  biasMm: round(error?.biasMm ?? null),
});

const store = new PostgresPerformanceStore(connectionUrl, { readOnly: true });
try {
  const report: Record<string, unknown> = { providers, from: from ?? null };
  for (const slot of ["morning", "evening"] satisfies HourlySlot[]) {
    // The slot's table is created by its first scheduled run; until then it has no captures.
    const loaded = await store.loadHourlyGradingPairs(slot).catch((error: unknown) => {
      if ((error as { code?: string }).code === "42P01") return null;
      throw error;
    });
    if (loaded === null) {
      report[slot] = "no table yet: the slot has not run";
      continue;
    }
    const pairs = loaded.filter((pair) => from === undefined || pair.capture.targetDate >= from);
    const byStamp: Record<string, unknown> = {};
    for (const stamp of ["starting", "ending"] satisfies HourStamp[]) {
      const blocks = amountBlocks(pairs, providers, stamp);
      const errors = providerAmountErrors(blocks, providers);
      const verdict = amountSwitchVerdict(
        blocks,
        providers,
        DEFAULT_PERFORMANCE_POLICY.weightFloor,
        DEFAULT_PERFORMANCE_POLICY.weightCap,
      );
      byStamp[`undocumented stamps read as hour-${stamp}`] = {
        blocks: blocks.length,
        providers: Object.fromEntries(providers.map((provider) => [provider, summary(errors[provider])])),
        plainAverage: summary(blendAmountError(blocks, null)),
        weightedAverage: summary(blendAmountError(blocks, verdict.weights)),
        weights: Object.fromEntries(Object.entries(verdict.weights).map(([provider, weight]) => [provider, round(weight)])),
        switchRule: {
          ready: verdict.ready,
          days: verdict.days,
          wetStationDays: verdict.wetStationDays,
          outOfSample: {
            ...verdict.outOfSample,
            equal: summary(verdict.outOfSample.equal),
            weighted: summary(verdict.outOfSample.weighted),
          },
          reasons: verdict.reasons,
        },
      };
    }
    report[slot] = { stationDays: pairs.length, ...byStamp };
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await store.close();
}
