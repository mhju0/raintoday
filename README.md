# 오늘비 · raintoday

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Local performance](https://github.com/mhju0/raintoday/actions/workflows/local-performance.yml/badge.svg)](https://github.com/mhju0/raintoday/actions/workflows/local-performance.yml)

오늘비 shows rain forecasts for a chosen location in South Korea. Compare the next 24 hours, today's forecast, and tomorrow's forecast from five weather services. Tomorrow's blend can use nearby-station evidence when the relevant checks pass.

[Open 오늘비](https://raintoday.vercel.app). The interface is in Korean.

Maintenance mode: security fixes, correctness and provider compatibility. See the
[roadmap](docs/ROADMAP.md) for deferred ideas and [operations guide](docs/OPERATIONS.md)
for monitoring, recovery and release procedures.

Screenshots below show the September 6, 2026 local production build with live forecast responses and the performance database disabled.

![Choose a device location, search a Korean administrative area, or open an example](public/screenshots/landing.webp)

Choose a location to load its forecast. Device location requires a button press; Korean area search and four example locations are also available.

![Rain forecast above the 24-hour timeline](public/screenshots/forecast.webp)

The timeline shows eight three-hour blocks from one named provider, with rain probability above and rainfall amount below. The heading summarizes the expected rain window.

![Today and tomorrow, followed by provider comparisons](public/screenshots/outlook.webp)

Today uses equal weights. Tomorrow's card names the method in use, and the comparison below shows each provider's probability and share of the blend.

<img src="public/screenshots/mobile.webp" alt="The forecast on a phone" width="320">

The timeline scrolls horizontally on a phone. Its pinned miniature carries a control for expanding or folding the supporting evidence.

![Scoring page when the performance database is unavailable](public/screenshots/scoring.webp)

The scoring record shows the current weighting mode, sample counts, provider scores and benchmark results. Evidence can be shared for up to ten minutes; the page shows when it was read.

## Product contract

- Requests use the submitted coordinate, validated against the supported South Korea service area. Search results use an administrative area's representative point.
- Browser geolocation requires an explicit button press. The app does not infer location from an IP address.
- Coordinates are sent to the server and weather providers for the forecast. They are not written to the performance database. The device remembers the last selection at reduced precision; coordinate-based forecasts may be cached temporarily in server memory.
- Performance evidence comes from a KMA ASOS Station Match: local at up to 25 km, regional beyond 25 km within the existing 100 km eligibility limit. Conditions there can differ from those at the selected location.
- Probability accuracy and rain-amount error are scored separately.
- Tomorrow uses recent-performance weights only when evidence and benchmark checks pass. While recent evidence is immature, eligible archive evidence can provide a limited adjustment. Otherwise the responding providers receive equal influence.
- An unavailable provider is omitted. An unavailable evidence store causes equal weighting; a forecast that cannot be loaded displays an error and retry control.

## How recent performance works

The [`local-performance`](.github/workflows/local-performance.yml) workflow is scheduled at 06:10 and 18:10 KST. For each active KMA ASOS station it can read, a run:

1. stores completed daily observations, using yesterday for the 18 KST group and two days back for the 06 KST group;
2. captures provider forecasts for the next day;
3. computes the adaptive and equal-weight forecasts before the outcome exists;
4. stores the immutable forecasts and station-day observations in PostgreSQL.

Morning and evening capture groups are scored separately. A group identifies the scheduled slot; collection may start late. The scoring record reports the measured time between collection and the target day. Providers within a capture share the collection time, but their different update schedules and forecast horizons can still affect the comparison. [Issue 118](https://github.com/mhju0/raintoday/issues/118) records the investigation and decision.

The morning group reads an older observation date because the previous day's ASOS summary may not yet be published. Observation request failures are faults, never missing observations or dry days. Transient failures receive bounded retries; rejected credentials are not retried.

The station catalog is the collector's only KMA apihub request. If catalog retries fail, collection can continue using stored stations without activating or retiring any. Forecast providers and the data.go.kr observation API are read separately.

A compared provider's read fault prevents that capture from being stored. A retry cannot fill in an immutable capture later. The run tolerates a limited share of failed captures and retries a failed cohort on a fresh runner; a second failure fails the workflow.

Probability scores use completed days, including dry days, within a 60-day operating window and a 14-day half-life. The page reports Brier scores, misses, false alarms, rainy-day amount MAE, and a separate seven-day Brier slice.

Learned influence requires at least 30 comparable captures per provider, with both wet and dry evidence. It increases gradually through 60 captures and uses provider floors and caps. A provider without sufficient history keeps a neutral share. Serving renormalizes influence across providers that supplied the requested value.

The Prospective Benchmark compares adaptive and equal forecasts stored before the outcome. It passes when enough comparable samples exist and the adaptive Brier score is no worse than the equal score, including ties. Insufficient samples or regression suspend learned weighting. The condition is checked when evidence is read.

Learned influence applies only to tomorrow. Today and days 2–7 use equal-provider averages. These records do not yet establish that 오늘비 is more accurate overall across locations and seasons.

### Archive evidence while recent records accumulate

A station can be seeded with retrospective evidence: an underlying model's day-ahead forecast from a public archive, paired with the KMA ASOS observation. This stays separate from prospective Forecast Captures:

- Seed scores use rainfall amount and rain/no-rain outcomes. They never enter the probability Brier score or Prospective Benchmark.
- Seed comparisons have their own table, without a capture group or frozen blend.
- Seed influence moves halfway from equal weights toward the weights calculated from archive scores.
- Mature recent evidence replaces the seed. Seed evidence cannot override a benchmark suspension.
- Providers without a suitable archive proxy keep a neutral share. WeatherAPI has no published model lineage with a public archive. Visual Crossing's hourly archive cost exceeds this project's backfill budget.

The forecast identifies archive-based weighting and shows provider sample counts, missed wet days and false alarms. The separate prospective comparison has its own count and verdict.

Backfill is an offline operation that writes evidence:

```bash
npm run performance:seed -- --start=2025-06-01 --end=2025-08-31
```

## User flow

1. Choose device location, search for a Korean area, or select an example.
2. Read the expected rain window and next 24 hours from the named hourly provider. The rain-window threshold is 40% or higher. Lower values do not mean rain is impossible; unpublished values remain labelled as missing.
3. Compare today and tomorrow, each labelled with its calculation method. Rainfall amount has its own provider count.
4. Expand the provider comparison, longer outlook and scoring evidence if needed.
5. Open the evidence-status link to the station's [`/behind-the-data`](https://raintoday.vercel.app/behind-the-data) record. Device-location links carry only the public station ID; area links carry the area's representative coordinate.

A first visit opens the supporting evidence folded under 한눈에. A summary row or the pinned control expands it, and the device remembers the choice. Pointer movement or arrow keys inspect individual timeline blocks.

## Architecture

```mermaid
flowchart TB
  Browser["Browser /"] --> Search["/api/locations/search"]
  Browser --> Local["/api/local-forecast"]
  Browser --> Behind["/behind-the-data"]
  Behind --> Database
  Search --> Geocoding["Kakao Map administrative search · KR only"]
  Local --> Providers["Forecast provider snapshots at user coordinates"]
  Local --> Match["ASOS Station Match"]
  Match --> Database["PostgreSQL performance evidence"]
  Providers --> Blend["Equal or evidence-based influence"]
  Database --> Profile["Capture-group Brier profile and benchmark"]
  Profile --> Blend
  Blend --> Browser
  Schedule["06:10 and 18:10 KST workflow"] --> Catalog["KMA ASOS station catalog"]
  Schedule --> Captures["Immutable next-day provider captures"]
  Schedule --> Observations["Completed KMA ASOS observations"]
  Catalog --> Database
  Captures --> Database
  Observations --> Database
```

| Module | Responsibility |
| --- | --- |
| `lib/location.ts` | Service-area admission before KMA grid conversion or provider requests |
| `lib/exampleLocations.ts` | Tested examples using Kakao representative points |
| `lib/providers/` | Provider snapshots and the ordered registry shared by capture and serving |
| `lib/performance/performance.ts` | Scores, evidence requirements, weights and the Prospective Benchmark |
| `lib/performance/store.ts`, `postgres.ts` | Persistence contract and production adapter |
| `lib/performance/capture.ts`, `batch.ts` | Immutable captures and nationwide collection |
| `lib/performance/influence.ts` | Shared blend calculation for capture and serving |
| `lib/performance/seed.ts`, `seedScore.ts`, `precipSkill.ts`, `backfill.ts` | Archive reconstruction, scoring and offline backfill |
| `lib/localForecast.ts` | Coordinate forecasts, nearby-station evidence and shared record reads |
| `lib/localForecastView.ts` | Public forecast response and display fields |
| `lib/forecast/` | Three-hour blocks and threshold-based rain windows |
| `app/api/` | Rate-limited forecast and location-search HTTP adapters |
| `app/behind-the-data`, `lib/behindTheData.ts` | Per-request scoring page and its view model |
| `lib/quotaRunway.ts` | Provider quota runway used by the service-health check |

The served surface is `/`, `/behind-the-data`, `/api/local-forecast`, `/api/locations/search`, `/icon.svg`, `/opengraph-image`, and a Korean 404 page. Retired `/atmosphere` and `/diagnostics` URLs redirect to `/`.

## Documents

| Document | Contents |
| --- | --- |
| [`CONTEXT.md`](CONTEXT.md) | Domain glossary |
| [`docs/weather-sources.md`](docs/weather-sources.md) | Provider contracts, configuration, caching, failures and attribution |
| [`docs/adr/`](docs/adr/) | Architecture, coverage and visual-design decisions |
| [`docs/research/`](docs/research/) | Location and observation-network evidence |
| [`lib/performance/README.md`](lib/performance/README.md) | Live capture and retrospective seed pipeline |
| [`docs/VERIFYING.md`](docs/VERIFYING.md) | Tests, fresh worktrees and browser checks |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Maintenance, credentials, backup/restore and releases |
| [`docs/audits/security-2026-09-06.md`](docs/audits/security-2026-09-06.md) | Security review, fixes and limits |

## Stack

| Area | Technology |
| --- | --- |
| App | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS 4 and custom responsive CSS |
| Forecasts, in provider order | Open-Meteo, KMA, Pirate Weather, WeatherAPI, Visual Crossing |
| Observations | KMA ASOS daily precipitation |
| Persistence | PostgreSQL via Postgres.js |
| Scheduling | GitHub Actions: two KST evidence groups and a six-hourly service check |
| Production dependencies | `next`, `react`, `react-dom`, `postgres` |

## Run locally

Use Node.js 24.15 or later in the 24.x line, matching CI. `nvm use` reads `.nvmrc`.

```bash
npm ci
install -m 600 .env.example .env.local
npm run dev
```

Open [localhost:3000](http://localhost:3000). Open-Meteo provides a keyless baseline. Configure `KAKAO_REST_API_KEY` for area search and device-coordinate naming. Optional weather providers activate when configured.

For regional collection, configure `PERFORMANCE_DATABASE_URL`, `KMA_APIHUB_KEY` (station-catalog subscription), `KMA_OBSERVATION_API_KEY` (ASOS daily subscription), and every compared-provider credential in [`.env.example`](.env.example).

The scheduled collector requires complete provider configuration, although serving can work with fewer providers. Its GitHub Actions secrets need the same values. Capture, seed and observation commands write evidence; they are not verification commands. Do not manually dispatch a production cohort to accelerate acceptance or backfill forecasts.

### Service health

The service check verifies the served page, a forecast with at least four usable provider probabilities, and administrative search. It also checks whether Pirate Weather's remaining quota covers scheduled collection plus a visitor reserve for the rest of the billing period.

```bash
npm run service:health
npm run service:health -- --target=local
```

It runs every six hours through `.github/workflows/service-health.yml`, using named targets with fixed URLs. It reads live services and consumes provider quota.

## Verification

```bash
npm run verify
```

This runs lint, route-type generation, TypeScript, tests and a production build. Suites are also available as `test:lib`, `test:ui` and `test:routes`. For focused checks:

```bash
node --test lib/localForecast.test.ts
npm exec --no -- tsx --test --test-name-pattern="GPS" components/local/LocalForecastExperience.test.tsx
```

The PostgreSQL adapter uses the same contract suite as the in-memory store. Run it only against a disposable database:

```bash
PERFORMANCE_STORE_CONTRACT_URL=postgres://… npm test
```

The suite truncates tables. CI supplies disposable PostgreSQL; without a test URL, the local SQL contract is reported as skipped. See [the verification guide](docs/VERIFYING.md) for browser and database checks.

## Limits

- South Korea and precipitation only.
- Service-area admission uses official SGIS 시도 geometry simplified to a 10 m tolerance. Decisions within roughly 25 m of the coastline may differ from the unsimplified geometry. Manual search is country-filtered to Korea.
- ASOS is the observation network. AWS adoption remains outside the current scope.
- Scoring policy defaults are: rain at 0.1 mm; miss/false-alarm decisions at 50%; at least 30 comparable captures with both wet and dry evidence; influence ramping through 60 captures; provider influence bounded to 5–60%; and an `exp(-12 × Brier)` score transform. A test checks these documented values against the policy object.
- Station eligibility requires distance at most 100 km and elevation difference at most 400 m. The coverage study's 36 administrative centres had a maximum nearest-station distance of 30.2 km; this is not a measurement of every inhabited location. See [ADR 0005](docs/adr/0005-station-proximity-is-language-not-eligibility.md), [ADR 0006](docs/adr/0006-the-elevation-gate-is-non-binding.md), and the [coverage study](docs/research/nationwide-verification-coverage.md).
- A location can have forecasts but no eligible observation station.
- Provider availability and horizon vary. Missing values are omitted, never treated as zero.
- Prospective evidence takes time to accumulate. A station uses eligible archive evidence while recent evidence is immature, and equal influence otherwise.
- Seed evidence uses underlying models, such as GFS for Pirate Weather and KMA's model for KMA, as proxies for the provider's published product.
- Offline backfill falls back to the committed station catalog when KMA apihub `stn_inf` is unavailable. Regenerate it with `npm run performance:catalog` before nationwide seeding.
- Weather information is not suitable for safety-critical decisions.

## License

Copyright (c) 2026 Michael Ju. All rights reserved.
No license is granted for use, copying, modification, or distribution of this code as of 2026-07-30. This repository is public for portfolio review purposes only.
