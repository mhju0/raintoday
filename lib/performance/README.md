# Local forecast performance

`lib/performance/` scores every eligible KMA ASOS station and feeds `/api/local-forecast`. It is now the only precipitation-scoring pipeline in the repository. A second one — `lib/reliability/`, which scored the single 서울 108 station with an online Hedge update and published to the `reliability-state` branch — was retired once the routes that read it were gone. Its pure day-scoring module survives here as `precipSkill.ts`, because seed evidence still depends on it.

## Two evidence classes

The pipeline holds two kinds of evidence and never lets them blur together.

| | Forecast Capture (live) | Seed Comparison (retrospective) |
| --- | --- | --- |
| Source | providers polled at a fixed KST cohort | public forecast archives |
| Frozen before outcome | yes | no — the outcome already existed |
| Scored on | probability, Brier score | amount and rain/no-rain outcome |
| Cohort | `06` or `18` | none |
| Enters the Prospective Benchmark | yes | never |
| Influence | ramps to full | capped at `SEED_INFLUENCE` |
| Table | `performance_captures` | `performance_seed_comparisons` |

Seed evidence exists for one reason: prospective evidence needs about a month per station to mature, and a first-time visitor should not be shown equal weights while it accrues.

## Mode gate

`buildRecentPerformanceProfile` resolves exactly one mode:

| Condition | Mode |
| --- | --- |
| live mature, benchmark has too few comparable captures | `suspended` |
| live mature, adaptive blend prospectively worse than equal | `suspended` |
| live immature, seed mature | `seed` |
| live mature, ramping | `ramping` |
| live mature, full influence | `learned` |
| otherwise | `equal-fallback` |

Two ordering rules are load-bearing:

- Seed **cannot rescue a suspension.** A benchmark regression is a live verdict that the adaptive blend is currently worse than equal weighting; retrospective archive evidence is not grounds to overrule it.
- Mature live evidence **supersedes the seed entirely.** Learned weights are identical whether or not seed evidence is present.

Two different bars decide those rows, and conflating them is what #89 was filed on. A provider becomes **eligible** on a cumulative count — every completed comparison it has, of any age. The **benchmark** counts only comparisons inside the operating window. A cohort completes at most one comparison a day, so the window has to be wider than the bar or the first row of the table is unreachable: pairing a 30-day window with a 30-comparison bar demanded a flawless month, and one missed run pushed `learned` out of reach for another thirty days. The window is 60 days; recency is enforced by the 14-day half-life, not by the edge of the window. See ADR 0011.

## Live cohorts

Two scheduled runs a day freeze provider forecasts at a fixed KST hour — cohort `06` and cohort `18` — and each also reads one day of ASOS ground truth. The two cohorts read different days: `18` reads yesterday, `06` reads the day before yesterday.

That offset is not symmetry for its own sake. ASOS compiles a calendar day's summary hours after midnight, so at 06 KST yesterday's rows mostly do not exist yet, and an uncompiled day answers NODATA — indistinguishable from a station with no row at all. Reading two days back keeps both cohorts on a published day, so every date is still read twice and the later read is a genuine second chance at a date the first one missed.

## Seeding

Day-ahead archived forecasts come from Open-Meteo's Previous Runs API — the `_previous_day1` variables, which are the run issued the day before. The ordinary historical-forecast endpoint returns the day-of run, which is effectively a nowcast; scoring that would flatter every provider and distort the ranking. Ground truth comes from the KMA ASOS daily service, which accepts a date range, so a month of observations costs one request.

Each provider is seeded from the model that actually drives it:

| Provider | Seed model |
| --- | --- |
| Open-Meteo | `best_match` |
| KMA | `kma_seamless` |
| Pirate Weather | `gfs_seamless` |
| WeatherAPI | *not seeded* |

WeatherAPI publishes no model lineage with a public forecast archive. It is omitted rather than given a guessed proxy, and keeps a neutral share so it is still blended. MET Norway is absent for a different reason: it is no longer compared at all, because it publishes no precipitation probability for Korea. `PrecipProviderId` still admits `met-norway` so historical capture and seed rows stay readable, but `PERFORMANCE_PROVIDERS` narrows both scoring and display to the four providers actually blended — a service's measured performance must never appear beside a forecast it had no part in.

Archives publish no probability, so seed rows carry an amount only. They are scored with `precipSkill.ts` — rain/no-rain with an asymmetric miss penalty, plus an amount term on days it actually rained — and weighted through the same bounded floor/cap projection the live path uses.

## Commands

```bash
npm run performance:capture -- --cohort=06     # one live cohort (scheduled)
npm run performance:seed -- --start=2025-06-01 --end=2025-08-31
npm run performance:observations -- --start=2026-08-21 --end=2026-08-22
npm run performance:catalog                     # regenerate the fallback station catalog
```

`performance:observations` repairs ground truth the cohorts missed. Each cohort reads one date fixed by the clock, so a date missed while the pipeline was degraded stays missed and every comparison whose target date it is stays incomplete. It writes observations only — no capture, no catalog sync — over the stations the store records as active *during the window*, retired ones included, since a catalog failure is both what retires a station and what leaves the hole. It is idempotent by `(station, date)`. It refuses an end date newer than two days back for the same reason the 06 cohort does: an uncompiled day would be recorded as an absence, writing the hole the tool exists to fill. A station whose window could not be read — or could not be stored — is a reported failure and a non-zero exit, never an absence. A run in which no station has a row anywhere exits non-zero too: a gap that wide is far likelier to be an outage than the record.

`performance:seed` is offline, idempotent by `(station, date)`, and records a failed window rather than aborting, so a re-run costs only the re-fetch. It reads the station catalog from apihub `stn_inf` when that subscription is available and from `stationCatalog.ts` otherwise.

`PERFORMANCE_DATABASE_URL` is required by both. The station catalog additionally needs `KMA_APIHUB_KEY` with the `stn_inf` subscription; observations need `KMA_OBSERVATION_API_KEY`.

## Files

| File | Responsibility |
| --- | --- |
| `performance.ts` | Scoring, evidence gates, bounded weights, benchmark, mode resolution |
| `seed.ts` | Rebuild retrospective day-ahead evidence from public archives |
| `seedScore.ts` | Pure amount-based seed scoring and capped seed weights |
| `precipSkill.ts` | Pure rain/no-rain and amount skill for one source-day; `seedScore.ts` is its only caller |
| `backfill.ts` | One-shot offline backfill orchestration |
| `stationCatalog.ts` | Generated fallback ASOS catalog — never hand-edited |
| `capture.ts` | Freeze one station/cohort prediction |
| `batch.ts` | Nationwide bounded live cohort run |
| `influence.ts` | Effective Influence and the blend it produces |
| `stations.ts` | Station Match against distance and elevation gates |
| `kma.ts` | ASOS station catalog, daily observations, and past observation windows |
| `observations.ts` | One-shot backfill of ground truth the cohorts missed |
| `store.ts` | Durable boundary and the in-memory adapter |
| `postgres.ts` | Production adapter |
| `storeContract.ts` | One executable contract both adapters must satisfy |

## Testing

The PostgreSQL adapter is only reachable with a disposable database:

```bash
PERFORMANCE_STORE_CONTRACT_URL=postgres://… npm test
```

Without it the PostgreSQL half of the store contract is skipped, and the two adapters can diverge silently — which is exactly what the contract exists to prevent. Run it against a throwaway database before trusting a store change.
