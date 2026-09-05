# 오늘비 · raintoday — project handoff

Written 2026-09-04 as a one-time archaeology pass; corrected after the independent
2026-09-05 takeover audit. Dated live measurements below are historical snapshots.

`README.md` remains the canonical public overview and `CONTEXT.md` the domain glossary;
this file is engineering orientation. The owner-approved authority order is current
source/tests → current Git state/history → `docs/DECISIONS.md` → `docs/ROADMAP.md` → this
handoff → historical Claude material when additional context is necessary. Historical
workflow advice here does not become standing agent instructions. `AGENTS.md` is deliberately
minimal; the Claude environment inventory stays local and nothing from it is migrated.

**Evidence conventions.** `[Verified]` = read in the tree or measured during this pass.
`[Inferred]` = reasoning from what was read. `[Unknown]` = not established. Claims that
come only from prior working conversations, with no artefact in git or GitHub, are marked
**(conversation-only)** — treat those as the most perishable statements here.

---

## 1. Purpose

오늘비 ("rain today") is a South Korea local rain forecast. It answers **when rain starts
and stops** at a coordinate the visitor chooses, compares five weather providers at that
exact point, and — where enough evidence has accumulated at the nearest KMA ASOS station —
adjusts how much each provider influences the **next-day** figure.

The interface is Korean. The audience is deliberately two audiences at once: Korean users
who want to know whether to carry an umbrella, and portfolio reviewers who want to see the
method. Every presentation decision has had to serve both (conversation-only; recorded in
the closed wayfinder map, issue #59).

The project's distinguishing claim is not accuracy. It is **honesty about accuracy**:

- the forecast is *weighted by recently observed local performance*, and the weighting is
  held to the alternative it replaces (equal weighting), prospectively;
- it does **not** claim to be more accurate overall — that would need accumulated
  prospective results it does not yet have;
- `/behind-the-data` publishes the current verdict including comparisons the blend has
  **not** won.

### Product contract (from `README.md`, all [Verified] in code)

- The forecast target is the user's exact submitted coordinate inside the supported South
  Korea service area, validated against official administrative boundaries.
- The user explicitly taps for browser geolocation, searches for a Korean place, or takes
  a worked example. The app never prompts automatically and never infers location from IP.
- User coordinates are used for the request and are **not** written to the performance
  database.
- Local performance is evidence from the KMA Station Match, not a claim the station is the
  user's location.
- Rain probability is the accuracy target. Rain-amount error is reported separately and
  never substituted for it.
- Until evidence passes every gate, the forecast uses equal influence.

---

## 2. Architecture

### The served surface is small and closed [Verified `next.config.ts`, `app/`]

| Path | Kind |
| --- | --- |
| `/` | Page — `app/page.tsx` → `components/local/LocalForecastExperience.tsx` |
| `/behind-the-data` | Server component — `app/behind-the-data/page.tsx` |
| `/api/local-forecast` | POST, rate-limited (30/min) |
| `/api/locations/search` | GET, rate-limited (20/min) |
| `/icon.svg` | Static |
| `/opengraph-image` | Rendered |
| `/atmosphere`, `/diagnostics` | 307 redirect to `/` (real HTTP, JS-independent) |

Everything else 404s. `/sky` was removed **with no redirect** in PR #54 — old shared links
including `?lat=` query forms are dead, by decision.

The API surface is deliberately fixed at **two** routes. `/behind-the-data` reads the
performance store directly from its server component rather than adding a third.

### Request flow — `/api/local-forecast`

```
POST /api/local-forecast
  └ lib/rateLimit.ts               (30/min per client)
  └ lib/localForecastRequest.ts    (bounded body parse; RangeError/TypeError → 400)
  └ lib/locationSearch.ts          (reverse-geocode a device fix to a 시·구·동 name; enrichment only)
  └ lib/localForecast.ts
      ├ lib/location.ts            → service-area containment, then KMA grid conversion
      ├ lib/providers/registry.ts  → forecastProviders, read in order
      │   └ lib/providers/read.ts  → one Provider Snapshot per provider (status + cache + weather)
      │       └ lib/cache.ts       → process-local single-flight TTL (5 min, lib/providerCache.ts)
      ├ lib/performance/stations.ts → Station Match (distance ≤100 km, elevation ≤400 m)
      ├ lib/performance/performance.ts → Recent Performance Profile from PostgreSQL
      ├ lib/performance/influence.ts   → Effective Influence + the blend
      └ lib/forecast/blocks.ts, rainWindow.ts → eight 3-hour blocks, the rain window
  └ lib/localForecastView.ts       → flat wire contract the page consumes
```

The page never reads the domain model directly; `lib/localForecastView.ts` is the seam.

### Scheduled flow — `local-performance.yml`

```
cron 21:10 UTC (06:10 KST) and 09:10 UTC (18:10 KST)
  └ scripts/local-performance.ts → lib/performance/cli.ts → lib/performance/batch.ts
      ├ lib/performance/kma.ts        → ASOS station catalog (apihub stn_inf)
      ├ lib/performance/observations  → one completed station-day observation
      │                                  (18 cohort reads D−1, 06 cohort reads D−2)
      ├ lib/performance/capture.ts    → freeze each provider's next-day probability + amount
      │                                  and the adaptive/equal blend, before the outcome exists
      └ lib/performance/postgres.ts   → immutable write
  └ retry job on a fresh runner if the first attempt failed
```

### The dashboard, top to bottom [Verified `LocalForecastExperience.tsx`, ADR 0009/0010]

One vertical read, no ambient scene:

1. the rain window as a sentence, carrying the window's own mm total when the data supports one;
2. a pinned sparkline miniature of the ribbon — the graph is the navigation — carrying the
   **한눈에 ⇄ 전체 근거** density toggle;
3. the horizontal 24-hour ribbon: eight 3-hour blocks, probability bars on a plain 0–100%
   scale, with an mm lane beneath on its own scale;
4. 오늘 / 내일 cards, probability and amount co-equal, each with its own method tag;
5. the **receipts shelf** — one raised surface holding the two evidence cards and the
   scored per-provider table, which is exactly what the density toggle folds.

Interactive controls, and there are no others: 위치 바꾸기, the density toggle (persisted
as `raintoday.view-density.v1` in `localStorage`), the timeline scrub lens (pointer or
arrow keys), and — only while folded — the summary stubs that unfold their own sections.

---

## 3. Major components and important files

| Path | Responsibility |
| --- | --- |
| `components/local/LocalForecastExperience.tsx` | **1,801 lines.** Chooser, loading, failure, and dashboard — four surfaces in one client component. See §15. |
| `components/local/RecordStationPicker.tsx` | Re-points `/behind-the-data` at another station via `/api/locations/search` |
| `app/globals.css` | **2,638 lines.** Design tokens under `.local-forecast-page, .btd-page`; every runtime-built `is-*` class is pinned by a test |
| `lib/localForecast.ts` | Assembles the exact-coordinate forecast with nearby-station evidence; owns `STATION_POLICY` and `RECORD_EVIDENCE_TTL_MS` (10 min) |
| `lib/localForecastView.ts` | The flat contract `/api/local-forecast` returns |
| `lib/location.ts` | Coordinate validation and KMA grid conversion — the **one** construction site for a `ForecastLocation` |
| `lib/locationServiceArea.ts` + `lib/locationServiceAreaData.ts` | Generated SGIS 시도 geometry, server-only, ~0.9 MB encoded |
| `lib/locationSearch.ts` | Kakao Local administrative search and reverse geocoding |
| `lib/exampleLocations.ts` | The chooser's four worked examples — Kakao's own representative points |
| `lib/providers/registry.ts` | The **single** ordered provider list |
| `lib/providers/read.ts`, `base.ts` | Provider Snapshot boundary |
| `lib/performance/performance.ts` | Scoring, evidence gates, bounded weights, benchmark, mode resolution; `DEFAULT_PERFORMANCE_POLICY` |
| `lib/performance/influence.ts` | Effective Influence, shared by the capture and serving paths |
| `lib/performance/batch.ts`, `capture.ts` | The nationwide cohort run and one frozen capture |
| `lib/performance/store.ts`, `postgres.ts`, `storeContract.ts` | Durable boundary, production adapter, one executable contract both must satisfy |
| `lib/performance/seed.ts`, `seedScore.ts`, `precipSkill.ts` | Retrospective seed evidence and its scoring |
| `lib/performance/stationCatalog.ts` | **993 lines, generated.** Never hand-edit — `npm run performance:catalog` |
| `lib/behindTheData.ts` | Derives the scoring-record view |
| `lib/quotaRunway.ts` | Turns remaining monthly quota into a runway |
| `lib/forecast/blocks.ts`, `rainWindow.ts` | The ribbon's blocks and the rain window read off them |
| `scripts/*` | Seven offline/scheduled entry points, none on a request path |

---

## 4. Data flow — the four paths

1. **Serving.** Provider Snapshots at the user's coordinate + Recent Performance Profile
   from the nearest ASOS station → Effective Influence → the blended day figures. The
   ribbon is **one** provider's hourly series, never the blend.
2. **Capture (scheduled).** All active ASOS stations, twice daily, next-day forecasts and
   both blend outputs frozen before the outcome exists.
3. **Observation (scheduled + repair).** One completed station-day `sumRn` per date.
4. **Seed (offline, one-shot).** Day-ahead archived forecasts from Open-Meteo's *Previous
   Runs* API, joined to the ASOS observation for the same date.

### Two evidence classes that must never blur

| | Forecast Capture (live) | Seed Comparison (retrospective) |
| --- | --- | --- |
| Frozen before outcome | yes | no |
| Scored on | probability, Brier | amount and rain/no-rain |
| Cohort | `06` or `18` | none |
| Enters the Prospective Benchmark | yes | **never** |
| Influence | ramps to full | capped at half the distance from equal |
| Table | `performance_captures` | `performance_seed_comparisons` |

---

## 5. External services

| Service | Used for | Credential | Failure behavior |
| --- | --- | --- | --- |
| Open-Meteo Forecast | Keyless baseline: current, hourly (the ribbon), daily | none | Stale cache, then omitted |
| Open-Meteo Previous Runs | Seed archive (`*_previous_day1`) | none | Offline job only |
| KMA short-term (data.go.kr) | Forecast comparison at the KMA grid | `KMA_SHORT_TERM_API_KEY` | Omitted from the blend |
| Pirate Weather | Comparison; **the only reachable quota ceiling** (10k/month vs ~194/day pipeline burn) | `PIRATE_WEATHER_API_KEY` | Omitted |
| WeatherAPI | Comparison | `WEATHERAPI_KEY` | Omitted |
| Visual Crossing Timeline | Comparison (fifth provider, since 2026-08-31) | `VISUAL_CROSSING_API_KEY` | Omitted |
| Kakao Map Local REST | Administrative search + reverse geocoding | `KAKAO_REST_API_KEY` | 503 `search_not_configured`, no retry offered |
| KMA ASOS station catalog (apihub `stn_inf`) | Active station metadata | `KMA_APIHUB_KEY` | Falls back to recorded stations, reports `catalogSource: "store"`, skips `syncStations` entirely |
| KMA ASOS daily (data.go.kr `AsosDalyInfoService`) | Ground truth `sumRn` | `KMA_OBSERVATION_API_KEY` (falls back to the short-term key) | A failed read is a **fault**, never an absence |
| Neon PostgreSQL | Evidence store | `PERFORMANCE_DATABASE_URL` | Forecast still serves, with an explicit equal-weight/no-evidence state |

**Provider order is load-bearing:** Open-Meteo, KMA, Pirate Weather, WeatherAPI, Visual
Crossing. The first available current snapshot is the comparison primary, and the first
with an hourly series draws the ribbon. A new source is **appended**, never inserted.

**Attribution is not optional and follows the served data:** Kakao Map, Open-Meteo, 기상청
(both short-term and ASOS), Pirate Weather, WeatherAPI, Visual Crossing. CARTO/OSM,
RainViewer and MET Norway are deliberately *not* credited any more — they credited things
the reader is no longer shown. Kakao is credited in **plain text only**: Kakao's site terms
forbid using its trademarks without consent, and Local results require no branding.
Kakao search is **live call only** — caching its results, even for an hour, breaches their
operating policy (this is why `c87820f` removed a cache that had been added).

---

## 6. Database / state architecture

Neon PostgreSQL 18, AWS `ap-southeast-1` (Singapore), database `neondb`. Four tables,
created idempotently by `lib/performance/postgres.ts`:

- `performance_stations` — official ASOS metadata, `network` checked `= 'ASOS'`
- `performance_captures` — PK `(station_id, target_date, cohort)`, `providers` and
  `frozen_blend` as `jsonb`, GIN-indexed. Writes are `on conflict do nothing`: **a capture
  is immutable and can never be backfilled or repaired.**
- `performance_observations` — PK `(station_id, date)`, correctable
- `performance_seed_comparisons` — PK `(station_id, target_date)`, its own table so it can
  never be read as a capture

No user query, browser identifier, or user coordinate is ever stored.

`PERFORMANCE_DATABASE_URL` must exist in **three** stores with **two different endpoints**
(conversation-only, but load-bearing): the GitHub Actions secret uses the Neon **direct**
endpoint (the batch job runs DDL), Vercel uses the **pooled** endpoint (many short-lived
functions), `.env.local` uses direct. Missing it on Vercel yields `database-not-configured`
for visitors while captures accumulate fine.

Size: about 12 MB growing ~58 MB/yr against Neon's 500 MB free tier — roughly eight years
of headroom (conversation-only measurement, 2026-08-31).

Client-side state is two `localStorage` keys: `raintoday.view-density.v1` and
`raintoday.last-location.v1`.

---

## 7. Environment and setup

Node **22+** (CI runs 24; this pass ran 24.14.0). npm with the committed `package-lock.json`.

```bash
npm ci
install -m 600 .env.example .env.local     # then fill in what you need
npm run dev                                # http://localhost:3000
```

**The app works with no environment variables at all.** Open-Meteo is keyless and supplies
a complete forecast. Everything else degrades explicitly.

`.env.example` declares exactly what the code reads and nothing else, in both directions —
`lib/environmentExample.test.ts` fails if a dead variable survives or an undocumented one
is read. Nine variables today. **Never expose a provider key through `NEXT_PUBLIC_*`,
logs, errors, fixtures, or responses.**

Every npm script that needs a credential already loads `.env.local` via
`--env-file-if-exists`, so **no `KEY=… ` prefix is ever needed**. (`scripts/generate-station-catalog.ts`
still documents such a prefix in its header comment — that comment is stale, not a second
convention.)

The three credential stores are separate and nothing syncs them: **GitHub Actions secrets**
(scheduled jobs), **Vercel environment** (production), **`.env.local`** (local). A key
rotated in one and not the others leaves every workflow green while the site degrades —
which is what `npm run service:health` exists to catch.

---

## 8. Build / run / test / lint

```bash
npm run dev            # local server
npm run lint           # ESLint
npx tsc --noEmit       # strict typecheck
npm test               # node --test over lib/**/*.test.ts, then the TSX/JSDOM suite
npm run build          # production build (next/font needs network for Geist + Noto Sans KR)
npm run service:health # checks the DEPLOYED service and Pirate Weather's quota runway
```

Offline / scheduled, none on a request path:

```bash
npm run performance:capture -- --cohort=06        # one live cohort
npm run performance:observations -- --start=… --end=…   # repair ground truth
npm run performance:seed -- --start=… --end=…     # retrospective backfill
npm run performance:catalog                       # regenerate the fallback station catalog
npm run service-area:generate                     # regenerate SGIS geometry (takes no env)
npm run location:matrix                           # credentialed location matrix
```

**Measured 2026-09-04 on a clean tree** [Verified]: lint clean, `tsc --noEmit` clean,
library suite **332 tests — 331 pass, 1 skipped**, component suite **63 pass**. The single
skip is the PostgreSQL half of the store contract, which is silently skipped unless a
disposable database is supplied:

```bash
PERFORMANCE_STORE_CONTRACT_URL=postgres://… npm test
```

**That suite truncates the target database's tables. Never point it at production.**
Skipping it silently is how four capture tests once sat broken against real SQL
indefinitely — run it after any SQL change.

---

## 9. Deployment

- **Host:** Vercel, project `raintoday`, production `https://raintoday.vercel.app`.
- `vercel.json` keeps `deploymentEnabled: {"reliability-state": false}`. Nothing writes to
  that branch any more, but it still exists on the remote and anything pushed there would
  otherwise deploy. **Keep the guard.**
- `app/layout.tsx` derives the site URL from `VERCEL_PROJECT_PRODUCTION_URL` rather than
  hardcoding it, so a project rename cannot break the Open Graph image.
- **Renaming a Vercel project does not move its `.vercel.app` domain** — the domain has to
  be added manually under Settings → Domains. `rain-today.vercel.app` (hyphenated) belongs
  to an unrelated service; never link it.
- A URL change has **three** surfaces and nothing syncs them: the Vercel domain, every link
  inside the repo, and the GitHub repo's own `homepage` field (`gh repo edit --homepage`).
- Vercel **preview** URLs 302 to SSO, so they cannot be curl-tested. Test locally instead.

### CI / scheduled workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | push + PR | gitleaks history scan → `npm ci` → `npm audit --omit=dev --audit-level=high` → lint → tsc → test → build |
| `local-performance.yml` | 21:10 and 09:10 UTC + dispatch | the evidence cohorts, with a fresh-runner retry |
| `service-health.yml` | every 6 h | the deployed page, forecast, search, and Pirate Weather's runway |
| `dependency-review.yml` | PR | rejects high-severity runtime dependency changes |
| `scorecard.yml` | weekly + push to main | OpenSSF Scorecard → SARIF |

All action versions are SHA-pinned.

`main` branch protection [Verified via the API, 2026-09-04]: `enforce_admins`,
`required_linear_history`, `required_conversation_resolution`, no force pushes, no
deletions. **No required reviews and no required status checks** — red CI does not block a
merge, so verify locally. PRs are **squash**-merged with branch auto-delete, which makes
`git merge-base --is-ancestor` and `git cherry` report merged branches as unmerged; check
the PR's `mergeCommit.oid` instead and use `git branch -D`.

---

## 10. What currently works

Verified live at 2026-09-04 ~19:03 KST by fetching production:

- `/` answers 200 in ~0.33 s.
- `/behind-the-data` answers 200 in ~5.9 s **cold** (Neon autosuspend + a fresh lambda
  instance — see §12).
- The scoring record renders real data for 서울 station 108 at 1.2 km: mode **seed**
  ("과거 기록으로 임시 가중 중"), **10 / 30** comparisons against the bar, evidence read
  timestamped by when the read happened rather than by the request clock.
- Five providers appear with their own rows: 기상청 6 samples (6 wet / **0 dry** →
  ineligible, labelled "안 온 날 없음"), Open-Meteo 9, Pirate Weather 10, WeatherAPI 10,
  **Visual Crossing 0 samples at a 20% neutral share** in seed mode. This does not verify
  the learned/ramping fallback, which the takeover audit found still demotes zero-history providers.
- Influence sums to 100% across all five.
- The benchmark table reports its own verdict (판정 전 / insufficient) rather than what is
  being served.
- Lead-time spread is published: earliest 22 h, median 5 h, latest 1 h, over 10 captures.
- `service-health.yml` has been green on every run for at least the last three days.
- `ci.yml` green on every recent run, including `main`.

The takeover audit found correctness gaps despite passing checks; current fixes are in ROADMAP.

---

## 11. Partially implemented

- **The seed→live handover is unverified on production evidence.** The transition is
  unit-tested; the earlier **2026-09-22** estimate is an inference, not a guaranteed date
  for every station/cohort. #89 closed on reachability, not the event.
- **KMA's missing cohort-18 captures remain missing.** Frozen rows cannot be repaired.
  It is not a global eligibility gate: current source requires two eligible providers,
  with counts and wet/dry coverage evaluated per provider and station/cohort.
- **The `proximity` dimension from ADR 0005 is decided but not implemented.** The record
  calls for `local` (≤25 km) / `regional` (25–100 km) wording; the page does not carry it.
  ADR 0005's own amendment says so explicitly.
- **Visual Crossing quota runway is not monitored.** The historical investigation found
  no rate-limit headers or usage endpoint. `service:health` tolerates one of five providers
  being unavailable, so a Visual Crossing 429 alone does not fail it.
- **Visual Crossing is not seeded**, and neither is WeatherAPI. Different reasons:
  WeatherAPI publishes no model lineage with a public archive; Visual Crossing's archive is
  billed per hour (24 records a station-day) and is unreachable on the free tier. Both keep
  a neutral share in seed mode; the zero-history learned fallback still needs its approved fix.

---

## 12. What is broken or degraded

- **The `v1.0.0` tag points at the wrong code.** [Verified] The tag is an annotated tag
  reading *"SeoulSky 1.0.0"* on `89d3334` (2026-07-15) — the pre-rename tree with the
  cinematic scene and radar, **221 commits behind `main`**. The GitHub *release* was
  published 2026-08-31 against that pre-existing tag, so its notes describe the August
  product while its source is July. No guard can catch this class of mistake: tagging an
  old commit is invisible in-tree. The owner approved retaining the tag, correcting the notes,
  and cutting `v1.1.0` from verified `main` after the audit fixes and #124 acceptance.
- **The v1.0.0 release note says "four weather services".** [Verified] It was published
  2026-08-31T06:12Z; Visual Crossing merged the same day at 09:51Z (PR #129). The note is
  ~3.5 hours older than the fifth provider.
- **`/behind-the-data` cold reads are still slow.** #128 caches by request coordinate+cohort
  for 10 minutes; the historical claim of sharing by matched station was incorrect. The
  reported warm path improved from ~1.15 s to ~0.25–0.48 s, but
  `cachedFetch` is **process-local** and Vercel runs many lambda instances, so the first
  request to each new instance still pays the Neon cold start. Measured 5.9 s today.
- **Runner egress to Korean hosts fails intermittently.** The blackouts follow the GitHub
  runner's **egress address**, not the hour — an hourly probe over 2026-08-27..30 lost every
  Korean host on 3 of 12 rounds while Open-Meteo, Pirate Weather and WeatherAPI answered
  from the same VM in under a second, and all 12 rounds drew a distinct address. Moving the
  cron relocates the symptom; retrying inside the run cannot work. The remedy is the
  fresh-runner retry job, which puts a double failure at roughly 6%. One such double
  failure occurred on 2026-09-01 and reset #124's count.
- **Two OpenSSF Scorecard alerts are open**, both created 2026-07-30 [Verified via the API,
  2026-09-04]:
  - `LicenseID` (low) — flags the absent `LICENSE` file. **Deliberate.** Never "fix" it.
  - `VulnerabilitiesID` (high) — "score is 8: 2 existing vulnerabilities detected", naming
    `GHSA-c83g-rgw3-j3cx` and `GHSA-73wf-gq98-2v4g`. The first is `browserslist` ≤4.28.6,
    which reaches this tree only as `eslint-config-next → eslint-plugin-react-hooks →
    @babel/core → @babel/helper-compilation-targets → browserslist`, i.e. **dev-only**
    [Verified in `package-lock.json` and `npm ls`]. The takeover audit traced both IDs to
    Browserslist and verified a compatible patched version is available. The production-only
    audit passes; updating this dev dependency is approved and actionable.
    Note this contradicts an earlier working note that said `LicenseID` was the only open
    alert; there are two.

The takeover audit additionally found the zero-history weight fallback, malformed-JSON 503s,
device coordinates in record URLs, and missing Visual Crossing captures. See ROADMAP for
current repair state. There are **zero** `TODO`, `FIXME`, `HACK`, `XXX` or `TBD` markers
anywhere in the tracked source [Verified by `git grep`].

---

## 13. Current git state

```
branch:   main (clean, in sync with origin/main)
HEAD:     c03492e  docs: state current architecture without references to removed code  (2026-09-02)
commits:  327
tracked:  153 files
remote:   https://github.com/mhju0/raintoday  (public)
branches: main, reliability-state  (nothing else, local or remote)
tags:     v1.0.0 → 89d3334 (see §12)
open PRs: none
```

`reliability-state` is a **frozen artefact**, not live storage. It holds the converged
state of the deleted second scoring pipeline — 111 scored events over 32 dates. Nothing
has read it since `/api/sky` was retired (2026-08-22) and nothing has written to it since
the pipeline was deleted (2026-08-27). Deleting the branch would be a separate decision and
has not been taken. The `vercel.json` guard exists because the branch still exists.

**Open issues: exactly one.** #124, and it is elapsed time rather than work — see
`docs/ROADMAP.md`.

---

## 14. Recent major development

Roughly reverse-chronological, with the commit that landed each:

| Date | What | Evidence |
| --- | --- | --- |
| 2026-09-02 | Docs stop referring to removed code | `c03492e` |
| 2026-09-01 | Dependency refresh sweep | `007b517` (#133) |
| 2026-08-31 | `.env.example` set pinned in both directions; CLAUDE.md stops carrying a variable *count* | `7c8c29e` (#132) |
| 2026-08-31 | Visual Crossing wired into the workflow's secrets, and a guard binding workflow to code | `0533789` (#130) |
| 2026-08-31 | **Visual Crossing added as the fifth compared provider** | `a30771e` (#129) |
| 2026-08-31 | `/behind-the-data` shares one evidence read per station | `1a0d881` (#128) |
| 2026-08-31 | **A provider short of samples is unmeasured, not bad** — held at its equal share | `a50962a` (#127) |
| 2026-08-31 | Worked-example chips for visitors who cannot type Hangul | `25543df` (#126) |
| 2026-08-31 | The record takes a coordinate; the evidence chip is the way in | `863903a` (#120) |
| 2026-08-31 | Lead time measured and published | `4a161ca` (#119) |
| 2026-08-31 | `/behind-the-data` served as a route | `4303dfe` (#113) |
| 2026-08-30 | A few refused captures are not a failed cohort | `6f4b175` (#114) |
| 2026-08-30 | Egress blackouts stop corrupting captures; the evidence gate unstarved (ADR 0011) | `75d4cf4` (#111) |
| 2026-08-30 | **D-11 structure pass**: open at 한눈에, claim kickers, receipts shelf (ADR 0010) | `bfe2fac` (#109) |
| 2026-08-29 | **The chart-recorder redesign** (ADR 0009) | `23b1c53` (#108) |
| 2026-08-28 | Drift guards: docs, runtime class names | `40e90c8` (#106) |
| 2026-08-27 | **The great deletion** — 246 → 139 tracked files, −19,472 lines (ADR 0008) | `993239e` (#105) |
| 2026-08-27 | Service health and quota runway | `20ab99c` (#104) |
| 2026-08-25 | MET Norway dropped from the forecast path | `8878327` (#96) |
| 2026-08-24 | ASOS observation faults reported, not scored as absences | `71202b7` (#87) |
| 2026-08-20 | Forecast served at `/`; `/sky` removed | `3d94982` (#54) |
| 2026-08-18 | **Renamed SeoulSky → 오늘비 / raintoday** | `f09b59a` (#49) |
| 2026-08-13 | **Pivot: redesign around local rain accuracy, Korea-wide** | `0aabe10`, `25201cf`, `6f50e26` |

---

## 15. Technical debt

- **`components/local/LocalForecastExperience.tsx` is 1,801 lines** — about 15% of all
  source, in the first file a reviewer opens. The docs name chooser / loading / failure /
  dashboard as four distinct surfaces; the code does not separate them. `app/globals.css`
  is 2,638 lines beside it. This was **judged and deliberately deferred**: splitting it
  serves the reviewer, not the product (conversation-only, 2026-08-31). It is the only real
  "solo project" tell in an otherwise disciplined tree.
- **`met-norway` is still a member of `ProviderId` and `PrecipProviderId`** with no provider
  module. This is deliberate: stored capture and seed rows carry the id historically, and
  `PERFORMANCE_PROVIDERS` (in `lib/performance/store.ts`) is the filter that drops it at
  read time. Removing the id would not delete the rows — it would only stop the code from
  being able to describe them.
- **Eligibility and the benchmark count different things**, and the split is a latent
  oddity: a provider becomes eligible on a *cumulative* count with no age filter, while the
  benchmark counts only comparisons inside `windowDays`. So a provider can be eligible on 30
  lifetime comparisons while its Brier is computed over very few recent ones. Not biting
  yet. It is scoring policy, so it sits behind the ADR gate — flag it, do not change it.
- **Two dependency majors are held for compatibility** (recorded in
  `.github/dependabot.yml`): `typescript >= 7` (`@typescript-eslint` peers `<6.1.0`) and
  `eslint >= 10` (`eslint-config-next` bundles an `eslint-plugin-react` that calls the
  removed `context.getFilename()`, which makes `npm run lint` abort before reporting a
  single result). A third looks like an update and is not: **jsdom's registry `latest` tag
  was behind the installed version** in an earlier check (conversation-only). Current
  metadata and passing repository checks govern any future upgrade.
- **`npm install <pkg>@<version>` rewrites an exact pin into a caret range.** This tree pins
  `next`, `eslint-config-next`, `react`, `react-dom`, `eslint` and `fast-check` exactly and
  carets the rest — always `git diff package.json` after a manual bump (conversation-only).
- **data.go.kr keys carry a 활용기간 and will expire.** A lapse fails the daily run loudly,
  so it is caught rather than silent — but it is the one calendar item worth setting
  (conversation-only).

### Temporary hacks

There are effectively none. The two things that look like hacks are documented decisions:
the `met-norway` id above, and the `vercel.json` deployment guard for a branch nothing
writes to.

---

## 16. Invariants — what a change must not break

These are product-honesty rules, not style preferences. Most are pinned by a test; several
were bought with a real defect. Full text lives in `CLAUDE.md`; this is the load-bearing
subset.

1. **Seoul time.** Every weather and sun-phase decision is pinned to `Asia/Seoul`. Never the
   browser timezone.
2. **Service-area validation precedes everything.** Containment is checked before KMA grid
   conversion or any provider request, for every entry path. The geometry stays server-only
   and the raw SGIS package is never committed.
3. **The Provider Snapshot boundary.** Status, cache freshness and weather come from one
   provider read. A non-OK or target-date-missing source is *omitted*, never fabricated.
4. **Absence of evidence is never evidence of poor performance.** A provider short of
   `minimumSamples` sits at its **equal share**; `weightFloor` is reserved for a provider
   that has been measured and scored badly. (#122 — without it, KMA would have been shown at
   5% influence for lagging on captures, and called it measured performance.)
5. **The seed evidence boundary.** Seed rows are scored on amount, live in their own table,
   carry no cohort and no frozen blend, are capped, never rescue a suspension, and are
   superseded entirely by mature live evidence. Never seed a provider with no honest archive
   proxy.
6. **A capture is refused outright when a compared provider's read *faults*.** `error` is a
   fault; `needs-config` is an honest absence (no runner will ever supply a missing key).
   Because captures are frozen and `saveCapture` is `on conflict do nothing`, one short a
   provider is permanent and indistinguishable from an honest one. Refusing is not the same
   as alerting — `cohortRunFailed` fails a run only past `CAPTURE_FAULT_TOLERANCE`.
7. **Observations keep zero tolerance.** `absent` means ASOS published no row. Anything else
   — a dropped connection, a throttle, a refused key, an unparseable body — is a fault that
   must land in `failures` and fail the run. Collapsing the two is how a green run stored 10
   of 97 observations and reported nothing wrong. Throttles retry with backoff; a refusal is
   terminal and must not be retried.
8. **Never read a day ASOS cannot have compiled.** An uncompiled day answers the same NODATA
   as a station with no row. The 06 cohort reads D−2; only the 18 cohort reads D−1.
9. **Only a catalog the run actually read may retire or activate a station.** On an
   unreachable catalog the cohort falls back to recorded stations, skips `syncStations`
   entirely — including the drop guard — and reports `catalogSource: "store"`.
10. **A credential the capture path reads must be passed by `local-performance.yml`,** and a
    test binds the two. A secret that exists in repository settings but never reaches the
    job is invisible from both ends and the run stays green.
11. **Provider order is fixed and appended to, never inserted into.** One list,
    `lib/providers/registry.ts`. Do not restore a second one.
12. **The ribbon is a plain 0–100% scale** with the umbrella threshold drawn at its own
    value. An unpublished block is hatched, never 0%; a published 0% keeps a real thin bar.
    An unpublished block **ends** a run rather than extending it.
13. **Probability and amount share the time axis, never a value axis.** The mm lane keeps its
    own scale. The window total appears only when the run ends within the series *and* every
    run block published an amount. Amount spreads are attributed member min/max — no
    quartiles or percentile wording at n ≤ 4.
14. **The ribbon is one provider; the day numbers are a blend.** Keep them attributed apart.
    Performance weighting applies to **tomorrow only**.
15. **A card's provider count must not stand for both its numbers** — fewer providers publish
    an amount than a probability, so the amount carries its own count when they differ.
16. **The density fold is honest in both directions.** An unset preference opens at 한눈에; a
    stored choice is never overridden; a forecast with no timeline never folds (the toggle
    lives in the minibar, so a fold would be a locked door). Stubs repeat their section's own
    numbers and never compute a figure for the stub. The receipts shelf wraps exactly what
    the toggle governs.
17. **`retry` is null exactly when the same request can never succeed,** and that failure card
    offers no retry. The loading screen may name providers but must never claim per-provider
    progress — `/api/local-forecast` answers once.
18. **The chooser needs all three ways in.** Kakao matches Hangul only and geolocation outside
    the service area is refused, so without the worked examples a visitor with neither got two
    errors that pointed at each other (#121).
19. **KMA publishes no usable daily amount.** Its `PCP` is categorical — exact values sit
    beside buckets like `30.0~50.0mm`, and the buckets appear precisely on heavy-rain days.
    KMA's amount stays `null`. **Do not "fix" it with a bucket midpoint.**
20. **Colour is reserved for three things:** probability (blue), amount (water-teal), rain
    window (amber). Every separator is achromatic. `/behind-the-data` adds no status palette —
    its verdicts are told apart by their words.

---

## 17. Important unresolved questions

1. **Will the seed→live handover actually work?** It has never run. #89 closed on the fix
   that made it *possible* (ADR 0011), not on the event. Nobody is watching the flip.
2. **What happens to KMA at the handover?** Eligibility is per-provider and cumulative, and
   KMA's cohort-18 history is permanently short. Provider crossing order remains unverified;
   Visual Crossing also has a capture gap. #127 left a zero-history demotion path to fix.
3. **Should captures be grouped by measured lead time?** #118 measured the drift, published
   it, and deliberately did not filter — every provider inside one capture shares its lead
   time, so the drift is common-mode noise rather than bias, and filtering the inverted rows
   would have cost 22% of the evening cohort right after ADR 0011 widened the window because
   samples were scarce. Revisit once samples are plentiful.
4. **Which weight-projection policy is right?** Water-filling survives **by inheritance, not
   by contest** — the alternative (fixed-point iteration) was deleted for reasons unrelated
   to which is better. ADR 0004's measurement (78% disagreement over a 200,000-case sweep,
   max single-weight delta 0.167, and the worked case where the two split a bounded simplex
   differently) is the only surviving account of what is at stake. **Nobody should read
   water-filling's survival as a verdict.**
5. **Does the blend beat the best single provider?** The published position is that it has
   not yet. The live reading on 2026-09-04 showed the adaptive blend and equal weighting
   tied at Brier 0.197, both **better** than Open-Meteo alone at 0.233 — which is the
   opposite of what the README caption and the release note describe. This is a live number
   over 10 comparisons and it moves; treat it as noise until the sample is real, but do not
   assume the published sentence is currently accurate.
The owner resolved the release and archive questions on 2026-09-05: retain the old tag,
release verified code after fixes and #124 acceptance, and retain `reliability-state` with
its deployment guard. See DECISIONS for the approved maintenance scope.

---

## 18. Current development focus

**Maintenance mode, with the independent audit fixes approved.** Restore complete provider
capture configuration first, then address the weighting, privacy, caching, request-validation,
and dependency gaps. CI-gated Dependabot automation and the already-decided distance wording
are also approved; new providers, scoring-policy changes, and large refactors remain deferred.

#124 still requires eight consecutive green scheduled cohorts. A green result had concealed
an empty Visual Crossing secret, so actual provider coverage must also be checked. Current
run progress and implementation status belong in `docs/ROADMAP.md`.

Do **not** `workflow_dispatch` `local-performance` to hurry it. The cohort comes from
`--cohort`/`--schedule`, not the clock, so a manual run stores captures labelled with a slot
they were not taken in. (`manualCohortHourMismatch` now refuses the obvious case, but the
rule stands.)

---

## 19. Traps worth knowing before you touch anything

Each of these cost real time. All are conversation-only unless marked.

- **A directory-level grep is not an import graph.** "Nothing in `lib/reliability/` reaches
  a user" was recorded as *verified* and was **false** — `score.ts` was live on every request
  through `seedScore.ts`. Follow imports.
- **A token scan cannot see a dynamic class.** `.is-active` looked orphaned; it is applied as
  `` `local-status-pill is-${status}` ``. `lib/dynamicClassNames.test.ts` exists because of
  this.
- **A guard that compares two things to each other cannot catch them being wrong together.**
  The old workflow guard asserted the capture and retry jobs carried the *same* secrets;
  both were equally short of the new one. Bind guards to the **code**.
- **Mutation-test any guard whose purpose is to fail later.** A green guard proves nothing
  until you have seen it go red.
- **Naming beats counting.** The in-repo prose survived the fifth provider because it names
  providers instead of counting them. Every drift found in three days was a *count* copied
  into prose or config with nothing binding it to code.
- **Three repository surfaces live outside the tree and no guard can reach them:** the GitHub
  description, the homepage URL, and the social preview. The description said "four
  providers" for a day after the fifth shipped. The social preview is UI-only — GitHub
  exposes no API for it.
- **Captures can never be backfilled.** Observations can (`performance:observations`), and it
  refuses an end date newer than D−2 for the same reason the 06 cohort does.
- **Run the seed/backfill CLI against a *dirty* database at least once.** A clean database
  hides the partial-catalog bug fixed in `fab9a7a`.
- **A long-lived dev server squatting port 3000 makes `npm run dev` silently shift to 3001,**
  so a live check against 3000 tests old code. Check `lsof -iTCP:3000` first.
- **`position: sticky` dies under any ancestor whose overflow is not `visible`/`clip`.** Probe
  computed styles by walking ancestors; do not reason from the spec.
- **JSDOM has no layout**, so anything about reflow, sticky, or breakpoints can only be
  measured in a real headless browser. The mobile strip breakpoint is **640px**, not 900px.
- **Prod deployment secrets and Actions secrets are separate stores.** Deleting an Actions
  secret cannot affect production, and vice versa. `KMA_APIHUB_KEY` and
  `KMA_OBSERVATION_API_KEY` are deliberately still present in Vercel even though the served
  path does not read them.
- **CodeQL `js/path-injection` on `scripts/generate-service-area.ts` is a known-benign false
  positive** and validation does **not** clear it — dismiss it. Do not generalise that to
  every query: `js/request-forgery` on `scripts/service-health.ts` **was** cleared properly,
  with a constant target map plus a `/^[A-Za-z0-9_-]+$/` guard on the key interpolated into
  the path.

---

## 20. Where the rest of the knowledge lives

| Document | Contents |
| --- | --- |
| `README.md` | Public overview, screenshots, product contract, limits |
| `CONTEXT.md` | Domain glossary — the authoritative vocabulary |
| `docs/adr/0001`–`0011` | Decision records, including the superseded ones (read them as history, not instruction) |
| `docs/research/` | The measurements the decisions rest on: SGIS provenance, nationwide coverage, why AWS is not adopted, the elevation gate |
| `docs/weather-sources.md` | Provider contracts, cache behaviour, fusion rules, attribution and its legal basis |
| `lib/performance/README.md` | The pipeline: two evidence classes, the mode gate, the cohorts, what happens when a run fails |
| `docs/DECISIONS.md` | Chronological decision ledger, including what was reversed and abandoned |
| `docs/ROADMAP.md` | What is next, what is deferred, and what is explicitly rejected |
| `docs/CLAUDE_ENV_INVENTORY.md` | Archive of the Claude tooling this project was built under — **not** a migration target |

The design pass that produced ADRs 0009 and 0010 kept a decision-by-decision ledger with
the rejected alternatives, in a **private Claude-hosted artifact** rather than in this
repository — deliberately, so no private URL enters a public repo. Those artifacts are not
reachable from another tool. ADRs 0009 and 0010 are the durable record of what shipped and
which alternatives were set aside; treat the ledger as lost unless the owner re-exports it.
