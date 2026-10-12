# 오늘비 project handoff

Updated September 28, 2026 for v2.1.1. The project is in maintenance mode.
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

v2.1.1 is live and tagged. Every merged change ships as a release (`AGENTS.md` → Releases).
Scheduled collection has been green since #177; 97 stations, 6,565 captures and 3,860
observations as of September 28. Station 108 cohort 06 made the first observed
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

## 2026-10-11 — Probability ribbon baseline audit

- Report only, per owner request: [audit 006](audits/ui/audit-006-2026-10-11.md), with live production screenshots and Chromium/WebKit controlled-response measurements.
- Confirmed independently sized column auto rows let wrapped captions shift probability bars and the 40% line above 900px. Normal phone/portrait-tablet checks did not reproduce the symptom; device-specific state remains unknown.
- Recommendation: shared chart rows, preferably row subgrid, so captions cannot move plot origins. No application changes, commit, release or deployment. Next: owner reviews the report; implementation awaits an explicit request.

## 2026-10-11 — Shared chart baseline and responsive layout fixes

- Owner authorized implementation, then expanded the scope to service-wide wrapping, spacing and alignment fixes delivered to main. Kept the chart-recorder direction and forecast semantics; no provider, probability, amount or scoring rules changed.
- Shared ribbon rows keep bar origins and the 40% line aligned despite varying captions. Narrow/enlarged-text layouts now reflow rainfall attribution, provider and evidence rows, outlook, search controls, metadata, footer links and fallback text. WebKit checks also caught an implicit minimum width in the scoring record's numbered rules. Intentional chart/raw-table scrolling remains.
- Verification covers Chromium and WebKit, phone/tablet/desktop widths from 320–1440px, normal and 200% root text, long location names, 0/100% and missing values, large rainfall ranges, provider gaps, mature evidence, loading/error and fallback pages. Full lint/type/unit/route/build checks and browser regressions gate release; controlled responses are layout evidence, not live-weather validation.
- Patched compatible Next/sharp/tooling dependencies for the release. The remaining development-only braces advisory has a narrowly pinned, independently reviewed audit exception expiring 2026-10-25 00:00 UTC; all other high/critical findings still block CI. See OPERATIONS for removal conditions.
- Release candidate: 2.1.3. Next: merge after required checks, confirm main CI and the production merge SHA, exercise live forecast/record pages, then publish the annotated tag and GitHub release. Existing owner-only operations issues above remain open.

## 2026-10-11 — Service-wide layout and typography audit (report only)

- Owner asked for an independent second pass after 2.1.3: [audit 007](audits/ui/audit-007-2026-10-11.md). Chromium and WebKit, 16 widths from 320–1920px, 100/130/200% text, 20 controlled forecast states plus chooser, loading, error, record and 404 screens.
- The 2.1.3 baseline fix holds in every state. Twelve numbered findings remain; two are HIGH (phone sticky bars overlap; chart readout clipped at the edges). Three are the same family as the original bug at smaller scale (caption row offset under `미발표`, provider meters on different scales in narrow cards, today/tomorrow rows not shared).
- No application changes, commit, release or deployment. The report and its evidence folder are uncommitted in the working tree.
- Next: owner approves finding numbers; fixes ship as 2.1.4 through a PR.

## 2026-10-11 — Audit 007 findings 1–7 fixed

- Owner approved findings 1–7. Phone sticky bars stack; the chart readout stays inside the chart and follows the keyboard; search messages no longer cover the shortcut chips; caption row, provider tracks, outlook columns and the two day cards each share one line or scale. CSS and one component only; no forecast, provider or scoring rules changed.
- Decision: search messages moved into the flow, against the earlier "everything out of flow" rule, because they point the reader at the chips they were covering. The room is held while the field has text, so the iOS keyboard-walk bug stays fixed (browser test covers it).
- Decision: when the two pinned bars would exceed 30% of the screen height, only the location strip stays pinned.
- Port 3101 was held by another project's server on this machine, so the browser suite ran through an ignored `.scratch` config on 3111. CI is unaffected.
- Release candidate: 2.1.4. Open: findings 8–12 of audit 007. Next: merge after checks, confirm main CI and the production merge SHA, then tag and publish the release.

## 2026-10-12 — 2.1.4 released; audit 007 findings 8–12 fixed

- 2.1.4 (PR #197, `c2f815e`): main CI passed, production serves the merge commit, annotated tag and GitHub release published.
- Owner approved findings 8–12 in full. Read time built explicitly in Korean; 404 page on the site ground; small alignment and touch-height items; Hangul in mono labels now Noto Sans KR; separators and units bound to their words; ribbon and record heading reflow with enlarged text. No forecast, provider or scoring rules changed.
- Decision: the ribbon's minimum width is in rem, so at enlarged text it scrolls sideways at any viewport instead of overlapping its labels. At normal text size its layout is unchanged.
- Decision: the 200% mid-word break at 320px and short last lines in long record paragraphs at 130% stay as they are; reasons in the audit follow-up.
- Release candidate: 2.1.5. Audit 007 has no open findings. Next: merge after checks, confirm main CI and the production merge SHA, then tag and publish the release.

## 2026-10-12 — 2.1.5 released; timeline amounts use the probability's model

- 2.1.5 (PR #198, `a9c2a8f`): main CI passed, production serves the merge commit, annotated tag and GitHub release published.
- Owner reported timeline blocks reading 75% over 0 mm. Cause is in the source: Open-Meteo's default hourly probability for Korea equals its ECMWF IFS 0.25° series (checked at six locations), while its default hourly amount comes from another model. Block arithmetic was correct.
- Decision (owner chose "timeline only"): hourly amounts are a second Open-Meteo request with `models=ecmwf_ifs025`. Daily probability and amount, the blend and stored captures are unchanged. If the second request fails, hourly amounts stay missing; no fallback to the mismatched default.
- Open-Meteo requests per forecast read double (serving and capture share `read()`); it has no key or metered quota here.
- Release candidate: 2.1.6. Next: merge after checks, confirm main CI and the production merge SHA, tag and publish; then retake the README screenshot and refresh its dated figures as 2.1.7 (work stashed as `readme-refresh-216`). Open, owner-only: the repository's GitHub social preview image lists four providers; the portfolio's Raintoday screenshot awaits owner approval.

## 2026-10-12 — 2.1.6 released; README screenshot and dated figures refreshed

- 2.1.6 (PR #199, `ec590fb`): main CI passed, production serves the merge commit, annotated tag and GitHub release published. Live Seoul read after deploy: every block above 40% carries a non-zero amount.
- Owner asked for current screenshots and an accurate README. The README screenshot is a new production capture taken after 2.1.6 (Seoul, 2026-10-12 about 02:26 KST, full view, dark). Dated figures re-read from the performance database read-only: 9,141 captures, 5,121 station-day observations, 97 stations. The Seoul sentence states what the live record showed that day (39 comparisons, weighted and equal blends both at mean Brier 0.074) instead of the unverified "first to move" claim.
- Open, owner-only: the repository's GitHub social preview image lists four providers (no Visual Crossing); it is uploaded in repository settings and cannot be changed from the tree.
- Release candidate: 2.1.7. Next: merge after checks, confirm main CI and the production merge SHA, then tag and publish the release.

## 2026-10-12 — 2.1.7 released; timeline amounts are the ensemble mean

- 2.1.7 (PR #200, `5b69fb2`): main CI passed, production serves the merge commit, annotated tag and GitHub release published. Portfolio site screenshot replaced with owner approval (mhju0.github.io PR #1). Owner had `origin/reliability-state` deleted (last commit `96c45b1`).
- Owner still saw a high chance over 0 mm after 2.1.6. Cause: the chance is the share of ECMWF's 51 ensemble runs that are wet; 2.1.6 paired it with one run's amount, and one run can be dry. Measured at Jeju 19:00: published 66%, 31 of 51 runs wet, run mean 0.17 mm/h, single run 0.0.
- Decision (owner): the timeline amount is the mean across those runs, from `ensemble-api.open-meteo.com`. A failed read leaves amounts missing. Daily values, blend and captures unchanged. Known cost: small non-zero amounts in mostly dry hours, flattened bursts, and a dependency on a second Open-Meteo host.
- Release candidate: 2.1.8. Next: merge after checks, confirm main CI and the production merge SHA, tag and publish; then retake the README screenshot (it shows 2.1.6 amounts). Open, owner-only: upload the new social preview image in repository settings.

## 2026-10-12 — 2.1.8 released; README screenshot and figures refreshed again

- 2.1.8 (PR #201, `c1a97c6`): main CI passed, production serves the merge commit, annotated tag and GitHub release published. Live read of the four example cities after deploy: no block at 40% or more shows 0 mm.
- README screenshot retaken from production after 2.1.8 (Seoul, 2026-10-12 10:20 KST). Counts re-read read-only after the morning collection: 9,236 captures, 5,218 station-day observations, 97 stations.
- Correction: the 2.1.7 README quoted only the evening capture group for Seoul (39 comparisons, 0.074 each), because the record page serves the group for the hour it is read. It now states both groups (morning: 48 comparisons, 0.067 weighted against 0.068 equal).
- Release candidate: 2.1.9. Next: merge after checks, confirm main CI and the production merge SHA, tag and publish. Open: portfolio screenshot shows 2.1.6 amounts and awaits owner approval for replacement; owner to upload the new social preview image.

## 2026-10-12 — 2.1.9 released; weighting made sharper on recent accuracy

- 2.1.9 (PR #202, `f66c30b`): main CI passed, production serves the merge commit, tag and release published. The portfolio screenshot (mhju0.github.io PR #2) and the five-provider social preview are both done; nothing is open from the earlier entries above.
- Owner asked for a more aggressive, more recent-weighted formula. Replayed alternatives on stored history, then the owner chose the moderate one: `halfLifeDays` 14 → 7, `scoreSharpness` 12 → 24. Evidence and limits are in `docs/DECISIONS.md` (2026-10-12). Gates, bounds and benchmark unchanged.
- `lib/documentedPolicy.test.ts` now pins the documented half-life as well. The three-provider fixture in `performance.test.ts` was softened because at sharpness 24 the stronger provider reached the 60% cap.
- Release candidate: 2.2.0. Next: merge after checks, confirm main CI and the production merge SHA, tag and publish. Watch: the benchmark verdict per station over the following weeks; a regression suspends the weights on its own. The file is near 200 lines; condense the oldest entries next session.

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

## 2026-10-12 — Vercel Web Analytics added (2.2.3 candidate)

- Owner asked to count visitors and see Instagram profile-link traffic. Web Analytics was already enabled for the project in the Vercel dashboard (Hobby plan); the code side adds `@vercel/analytics` through `components/SiteAnalytics.tsx`, production only.
- Decision: the reported address drops everything in the query except `utm_*`, because shared links carry coordinates and a place name. Reasons and limits: `docs/DECISIONS.md`, fourth 2026-10-12 entry.
- Limit: the UTM panel needs Web Analytics Plus (paid). On Hobby, Instagram shows only in the Referrers panel.
- Release candidate: 2.2.3. Next: merge, confirm main CI and the production merge SHA, tag and publish; then load the site once and confirm the Analytics tab shows the visit. Still open from the entry above: the October 13 evening-run check. This file is near 200 lines; condense the oldest entries next session.

## 2026-10-13 — 2.2.3 released; density toggle removed (2.2.4 candidate)

- 2.2.3 (PR #208, `6801678`): main CI passed, production serves the merge commit, tag and release published; the Analytics tab showed the first visit. Owner is leaving Instagram-specific tracking for later.
- Owner asked to remove the 한눈에 보기 button and always show everything. Removed the toggle, the fold, the stubs and the stored preference; reasons and cost: `docs/DECISIONS.md`, 2026-10-13. ADR 0009 and 0010 carry amendment notes.
- Release candidate: 2.2.4. Next: merge, confirm, tag; then the owner-requested antislop audit of the result (report findings, implement only what is approved). Open: the README screenshot still shows the button. This file is at about 200 lines; condense the oldest entries next session.
