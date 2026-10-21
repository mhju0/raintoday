# 오늘비 project handoff

Updated October 15, 2026 for v2.2.13. The project is in maintenance mode.
The previous archaeology report remains in Git history.

## Start here

- [README](../README.md): product, setup and public claims.
- [CONTEXT](../CONTEXT.md): domain vocabulary.
- [DECISIONS](DECISIONS.md) and [ADRs](adr/): policy and its history.
- [ROADMAP](ROADMAP.md): ongoing duties and explicitly deferred ideas.
- [OPERATIONS](OPERATIONS.md): credentials, monitoring, recovery and releases.
- [VERIFYING](VERIFYING.md): local, browser and disposable-database checks.

Resolve conflicts using source/tests, Git, DECISIONS, ROADMAP, this handoff, then
historical Claude material. `AGENTS.md` holds shared repository instructions,
including the release rule; `CLAUDE.md` only imports it.
Keep personal instructions in ignored `CLAUDE.local.md` and scratch work in `.scratch/`.
Reviewed Antislop reports belong in [audits/ui](audits/ui/).

## Boundaries to preserve

The Korean interface serves forecasts for a user-selected South Korea coordinate.
Validate service-area admission before grid conversion and provider requests. GPS
requires a click; its record link contains a public station ID, never device coordinates.
Coordinates do not enter the performance database.

Serving and capture share the ordered provider registry. One provider owns the hourly
ribbon. Today uses equal weights; only tomorrow can use performance-based influence.
The station record distinguishes local evidence (at most 25 km) from regional evidence
(over 25 km within the existing eligibility policy). Wording does not alter scoring.

Captures are immutable forecasts saved before their outcomes. Retrospective seed rows
stay separate from prospective comparisons and benchmarks. Observation faults are
errors, never dry days. Insufficient evidence or a failing benchmark can retain equal
weighting; a broad accuracy advantage has not been established.

## Current state

v2.2.11 was live and tagged on October 13; the newest dated entry below is the current
state. Every merged change ships as a release (`AGENTS.md` → Releases).
Scheduled collection has been green since #177; 97 stations, 9,236 captures and 5,218
observations as of October 12. Station 108 cohort 06 made the first observed
seed-to-live switch (ramping, passing 34-sample benchmark, adaptive = equal).
New providers, a mature-evidence redesign, component splitting and alternate weighting
policies are deferred. There is no outstanding approved product feature.

The website has a SELECT-only database role; scheduled collection uses separate write
credentials. CI runs fixture-based tests, pinned Playwright checks and a disposable
PostgreSQL contract. Deployment verification must check the actual Git SHA because a
prior Vercel webhook did not deploy the merged revision. The old v1.0.0 tag intentionally
remains on the earlier application.

## Session log

### 2026-09-19 → 09-26 — Condensed September 28

Detailed entries remain in Git history and PRs #169–#187.

- Collector: #169 spaced attempts, #171/#174 database retry and reporting fixes, #177
  outage breaker with five attempts at 0/10/25/40/55 minutes. The September 22
  "egress blackout" reading was wrong: ~1,140-second failures were the cost of a full
  failing station walk. A green capture job is not proof of a good cohort
  (`continue-on-error`); read the counts and the verdict.
- UI (#178–#181, audits 003–005): iPhone and tablet layout, 16px inputs (no iOS focus
  zoom, confirmed in Simulator Safari), balanced Korean line breaks, "0.1mm 미만" for a
  near-zero window total, and table/chooser accessibility.
  Owner rules: Korean headings carry no line-end punctuation; no word, quote or
  bracket is left alone at a line end; a block's last line fills at least half the
  widest line; checked from 320px up in Chromium and WebKit.
- #182 audit remediation: shared ASOS row validation and error redaction.
- Releases: 2.0.0 (successor to SeoulSky, `.mailmap`, no history rewrite), 2.0.1
  (range line, 제주시 screenshot, release rule), 2.0.2 (plain headline), 2.1.0
  (umbrella line covers the rest of today; before noon a ≥10 mm day total also
  counts), 2.1.1 (search fields mark focus with their own border).

## 2026-09-28 — Issue evidence pass and documentation refresh

Changed:
- Private backup taken and restored into isolated PostgreSQL 18; counts and checksums
  match (#146). Trap recorded in OPERATIONS: restore with `--locale=C`, or Hangul
  station rows render differently and the checksum falsely differs.
- #140: the seed-to-live item is checked off (station 108, cohort 06). Cohort 18 was
  at 28 of 30. Which cohort a visitor sees depends on the KST hour.
- Docs brought to the current state: README counts, ROADMAP releases and completed
  work, DECISIONS open items plus four new entries, forecast contract (headline and
  umbrella rule), VERIFYING, OPERATIONS, triage labels.
- Scratch drafts in `.scratch/2026-09-26-dropped/` deleted at the owner's request.

Open (owner access only):
- #175: the breaker needs a real KMA outage to prove it.
- #146, #154, #140: the Vercel firewall and usage review, Neon compute usage, and
  failure-email delivery. GitHub mail goes to the Outlook address, and no failure
  email reached Gmail. The Vercel dashboard shows a 2FA setup prompt.
- The Actions registry still lists `network-diagnostic` and nine `recovery-replay-*`
  workflows as active, although their files are gone from `main` and they cannot fire.

Next: the owner checks the Outlook inbox and the Vercel and Neon dashboards, then closes #146 and #154.

## 2026-10-11 — Summary: chart baseline, responsive fixes and audit 007 (2.1.3–2.1.4 candidates)

- [Audit 006](audits/ui/audit-006-2026-10-11.md) confirmed wrapped captions shifted probability bars above 900px. 2.1.3 fixed it with shared ribbon rows and service-wide reflow fixes; a development-only braces advisory has a pinned audit exception expiring 2026-10-25 00:00 UTC (removal conditions in OPERATIONS).
- [Audit 007](audits/ui/audit-007-2026-10-11.md) found twelve further items; findings 1–7 shipped as 2.1.4. Decisions kept: search messages sit in the flow with their room held while the field has text; when the two pinned bars would exceed 30% of the screen height, only the location strip stays pinned.
- Port 3101 can be held by another project's server on this machine; the browser suite then runs through an ignored `.scratch` config on 3111. CI is unaffected.

## 2026-10-12 — Summary: releases 2.1.4–2.1.9

- 2.1.4–2.1.5 (PRs #197, #198): audit 007 findings 8–12 fixed; audit 007 has no open findings. Kept by decision: the ribbon's minimum width is in rem, so at enlarged text it scrolls sideways instead of overlapping its labels; the 200% mid-word break at 320px stays (reasons in the audit follow-up).
- 2.1.5–2.1.7 (PRs #198–#200): timeline amounts. Open-Meteo's hourly chance is the share of ECMWF's 51 ensemble runs that are wet, so the amount is now the mean of those runs from `ensemble-api.open-meteo.com`. A failed read leaves amounts missing, with no fallback. Daily values, blend and captures unchanged. Cost: small non-zero amounts in mostly dry hours, and a second Open-Meteo host.
- 2.1.6, 2.1.8 (PRs #199, #201): README screenshot and dated counts refreshed. The record page serves the capture group for the hour it is read, so a quoted Seoul figure must name its group.
- 2.1.9 (PR #202): `halfLifeDays` 14 → 7, `scoreSharpness` 12 → 24, chosen by the owner after a replay on stored history (`docs/DECISIONS.md`, 2026-10-12). `lib/documentedPolicy.test.ts` pins the documented half-life. Watch the per-station benchmark verdict; a regression suspends the weights on its own.
- Portfolio screenshot and five-provider social preview are done; nothing is open from these releases.

## 2026-10-12 — 2.2.0 released; sharpness stays at 24; documentation pass for a stable version

- 2.2.0 (PR #203, `a0933a5`): main CI passed, production serves the merge commit, tag and release published.
- Owner asked about 48 and values in between; replays showed no reliable gain and worse rainy-day scores, so it stays at 24 (`docs/DECISIONS.md`, second 2026-10-12 entry). Weighting being slightly worse than equal on rainy days is the open question if scoring is revisited.
- Owner asked for a full accuracy pass before leaving the project alone for a while. Checked the live `/behind-the-data` page, README, contract, sources, glossary, operations, app metadata, repository description, portfolio and the six Instagram posts against code and the database. Fixed in the repository: ROADMAP (said v2.1.1), and the wording about sharper settings. Instagram figures are dated "as of Sep 28, 2026" and match the database for that date (6,565 captures).
- Open, owner approval needed: the portfolio's Raintoday entry says "up to three fresh-runner attempts"; the collector has made five since PR #177.
- Release candidate: 2.2.1. Next: merge, confirm, tag. Then nothing planned.

## 2026-10-12 — 2.2.1 released; issues cleared; evening collection timing fixed

- 2.2.1 (PR #204, `2e68372`): main CI passed, production serves the merge commit, tag and release published. The portfolio's "three attempts" line was corrected to five in both languages (mhju0.github.io PR #3).
- Issues #154, #146, #140 and #205 closed with evidence. Open on purpose: #175 (needs a real KMA outage) and monthly review #206 (owner-only items). Backup taken and restore-verified on 2026-10-12.
- Observations for 2026-09-13 were 77 of 97; `npm run performance:observations` stored all 97, and both groups' 95 captures for that date now have an outcome.
- Owner asked for the evening lateness to be fixed now. The evening cron fires at 12:40 KST and waits for 18:10; the monitor ages a collection from its finish; Open-Meteo retries one failed read. Reasons and limits: `docs/DECISIONS.md`, third 2026-10-12 entry.
- Release candidate: 2.2.2. Next: merge, confirm, tag. Then check the October 13 evening run: when GitHub created it, how long `wait` slept, that captures began near 18:10 KST and target October 14, and whether Open-Meteo faults dropped.

## 2026-10-13 — Summary: releases 2.2.3–2.2.7

- 2.2.3 (PR #208, `6801678`): Vercel Web Analytics through `components/SiteAnalytics.tsx`; the reported address keeps only `utm_*` from the query. The UTM panel needs the paid plan; Instagram-specific tracking is deferred by the owner.
- 2.2.4 (PR #209, `5d72ecd`): the 한눈에 보기 button and the fold removed. GitHub's deployments list missed this deployment during a Vercel incident; the Vercel dashboard is the reliable check.
- 2.2.5 (PR #210, `1564dce`): README screenshot retaken. [Audit 008](audits/ui/audit-008-2026-10-13.md) and its layout sweep found nothing that overflows or misaligns.
- 2.2.6 (PR #211, `042bb39`): audit 008 findings 1–3 fixed; analytics loads only on Vercel.
- 2.2.7 (PR #213, `42689e5`): the 24H mini-ribbon removed entirely; README screenshot is a production capture of Jeju. Audit 008 has no open findings.
- No evening collection ran on 2026-10-12: the 2.2.2 merge removed the 18:10 cron after that day's 12:40 cron had passed. The evening group has no captures targeting 2026-10-13; not recoverable.
- Decisions and costs for all five: `docs/DECISIONS.md`, 2026-10-12 and 2026-10-13 entries.

## 2026-10-13 — Summary: releases 2.2.8–2.2.10

- 2.2.8 (PR #215, `05c3de8`): Speed Insights on Vercel only; UptimeRobot monitor 804257727 checks the home page every 5 minutes (a provider or database failure behind a 200 is left to `service:health`).
- 2.2.9 (PR #216, `edf9ba2`): functions moved to `icn1` via `vercel.json`; forecast reads 0.35–0.76 s and Open-Meteo back in the blend (`docs/DECISIONS.md`, fourth 2026-10-13 entry).
- 2.2.10 (PR #217, `2eeb91c`): browser-only errors to Sentry project `raintoday`; a live test event arrived with the place stripped. The owner's own Chrome blocks Sentry.
- Firewall: 429 needs the Pro plan (declined); the Dynamic request volume rule still logs; Deny (403) is the owner's to save.
- The evening run on 2026-10-13 started at 20:06 KST, 1 h 56 min late, despite the early start. KMA's absence that night was its 20:00 issue answering `NO_DATA` (fixed in 2.2.12).
- Deferred by the owner: font count (about 25 font files per visit) and the home button's label.

## 2026-10-14 — 2.2.11 released; KMA falls back to the previous issue (2.2.12 candidate)

- 2.2.11 (PR #218, `f67a86d`): main CI passed, production serves the merge commit, tag and release published.
- KMA was still absent from the live forecast at 23:20 KST on October 13 and `service-health` failed at 22:53 KST (#214). Twenty direct requests for Seoul's 20:00 issue returned `NO_DATA` fourteen times; ten for the 17:00 issue returned data every time.
- Owner approved a fix. `lib/providers/kma.ts` steps back up to three issues (nine hours) when an issue is empty; by 09:48 KST on October 14 the two newest issues were mostly empty, so one step back was not enough. Decision, cost and limits: `docs/DECISIONS.md`, 2026-10-14.
- Firewall: the Rules page still showed Log at 23:20 KST. The owner intends to save Deny; `docs/OPERATIONS.md` needs one sentence corrected once it is saved.
- Release candidate: 2.2.12. Next: merge, confirm, tag; read the live forecast for KMA and watch the next `service-health` run close #214. Open: evening slot punctuality (owner decision); the owner's five-person test. Deferred by the owner: font count and the home button's label.

## 2026-10-15 — KMA recovery verified

- v2.2.12 is released (PR #219, `371086d`); main CI `38492638080` passed. The earlier KMA failure notifications predate this fallback fix. Incident #214 is closed.
- Fresh production `service:health` passed 4/4: HTTP 200, all five forecast providers, 강남 search and Pirate Weather quota runway (7,105/10,000 remaining). Hosted health `38640365533` and subsequent maintenance runs also passed.
- Scheduled collection `38539352976`, cohort 18, stored 97 observations and 97 captures: zero failed/faulted/abandoned records, two captures recovered. No extra production collection was dispatched for verification.
- The reviewed Sentry email was deliberate diagnostic noise; the three diagnostic issues were resolved earlier in this session.
- GitHub records a successful production deployment at `371086d`. A fresh Vercel metadata read was denied with HTTP 403 for the connected account; no deployment or credentials were changed.
- No new code fix is needed for the reviewed Raintoday alerts. Open: #175's real-outage recovery proof, monthly review #206, evening slot punctuality (owner decision), and the owner's five-person test. Font count and the home button's label remain deferred.

## 2026-10-15 — Recovery handoff publication (v2.2.13)

- Owner requested push, merge and local/remote main synchronization. Publish the verified recovery record as a documentation-only patch; forecast behavior, providers, capture logic and dependencies are unchanged.
- Before publication, the signed-in Vercel dashboard confirmed the production alias was Ready on `371086d`; this readback was available despite the connector's HTTP 403.
- Remaining owner decisions and real-outage verification above stay open. No production evidence collection is part of this publication.

## 2026-10-15 — Approved Raintoday public claims publication (v2.2.14)

- Owner scoped the factual refresh to Raintoday across the repository README, portfolio and GitHub profile. README now dates the read-only production snapshot (9,712 captures, 5,529 observations, 97 stations), distinguishes scheduled from completed collection, and describes up to eight timeline blocks.
- The dated Seoul morning benchmark displays Brier 0.088 for both blends over 52 comparisons; this is rounded local evidence, not an overall accuracy claim. Analytics privacy wording is narrowed to the supported cookie-free Web Analytics claim.
- Owner approved the prepared updates and requested publication plus local/remote synchronization. The repository patch contains documentation and version metadata only; portfolio/profile publication is handled separately. The release procedure requires main CI and an exact production Git SHA readback before tagging. No new production collection is part of this work. Existing recovery/owner issues above remain open.

## 2026-10-21 — Morning Capture at 07:00 KST (2.3.0 candidate, branch `feat/morning-of-capture`)

- Read-only breakdown of 10,373 captures (08-20..10-19): the served adaptive and equal blends differ by 0.1% Brier; KMA is the weakest provider on wet days; both blends over-forecast 30–50% (verified about 21%). Dropping KMA trades dry-day for wet-day quality over the full period; not acted on.
- Owner rules recorded in `docs/DECISIONS.md` (2026-10-21): a stated chance should match how often it rains, never inflated to be safe; grade the evening-before and the morning-of forecasts, because those are when people check.
- Built: `morning-forecast.yml` fires at 01:30 KST and waits to 07:00 (GitHub's morning cron ran 110–183 min late), then freezes each station's hourly chances from 07:00 to midnight in `performance_morning_captures`. Not graded yet. Verify, the real-Postgres contract (31/31) and a live five-provider dry run passed.
- Owner decision: Pirate Weather is left out of the Morning Slot. A third daily run would exceed its 10,000/month free tier, and a 429 faults every capture. Morning Captures compare four providers.
- Next: Part 2, hourly ASOS rainfall. It needs the owner's 활용신청 for 기상청_지상(종관, ASOS) 시간자료 조회서비스; the current key answers `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`. Part 3: grade by moment, exclude late captures, show calibration on /behind-the-data, and grant `raintoday_web` SELECT on the new table.

## 2026-10-21 — 2.3.0 released; hourly ASOS rainfall (2.3.1 candidate, branch `feat/hourly-observations`)

- 2.3.0 (PR #223, `067b343`): main CI passed, production serves the merge commit, tag and release published. First scheduled Morning Capture is 2026-10-22, unverified.
- The owner's 시간자료 활용신청 was approved (expires 2028-10-21). The morning run now reads hourly rainfall for the two newest complete days after all captures. Evidence for the hour convention, the one-day publication lag and flag 9: `docs/DECISIONS.md`, third 2026-10-21 entry.
- Firewall: shown the owner where the Dynamic request volume rule is (Firewall → Rules → Project rules); still Log until the owner saves Deny.
- Next: merge and release 2.3.1; verify the 10-22 morning run (captures at 07:00, hourly rows for 10-19..10-20); part 3 grading.
