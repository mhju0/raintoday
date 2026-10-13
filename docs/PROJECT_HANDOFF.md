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

## 2026-10-12 — Vercel Web Analytics added (2.2.3 candidate)

- Owner asked to count visitors and see Instagram profile-link traffic. Web Analytics was already enabled for the project in the Vercel dashboard (Hobby plan); the code side adds `@vercel/analytics` through `components/SiteAnalytics.tsx`, production only.
- Decision: the reported address drops everything in the query except `utm_*`, because shared links carry coordinates and a place name. Reasons and limits: `docs/DECISIONS.md`, fourth 2026-10-12 entry.
- Limit: the UTM panel needs Web Analytics Plus (paid). On Hobby, Instagram shows only in the Referrers panel.
- Release candidate: 2.2.3. Next: merge, confirm main CI and the production merge SHA, tag and publish; then load the site once and confirm the Analytics tab shows the visit. Still open from the entry above: the October 13 evening-run check. This file is near 200 lines; condense the oldest entries next session.

## 2026-10-13 — 2.2.3 released; density toggle removed (2.2.4 candidate)

- 2.2.3 (PR #208, `6801678`): main CI passed, production serves the merge commit, tag and release published; the Analytics tab showed the first visit. Owner is leaving Instagram-specific tracking for later.
- Owner asked to remove the 한눈에 보기 button and always show everything. Removed the toggle, the fold, the stubs and the stored preference; reasons and cost: `docs/DECISIONS.md`, 2026-10-13. ADR 0009 and 0010 carry amendment notes.
- Release candidate: 2.2.4. Next: merge, confirm, tag; then the owner-requested antislop audit of the result (report findings, implement only what is approved). Open: the README screenshot still shows the button. This file is at about 200 lines; condense the oldest entries next session.

## 2026-10-13 — 2.2.4 released; layout sweep after the removal; README screenshot retaken (2.2.5 candidate)

- 2.2.4 (PR #209, `5d72ecd`): main CI passed, production serves the merge commit, tag and release published. During the Vercel incident that night GitHub's deployments list did not record this deployment; the Vercel dashboard is the reliable check.
- [Audit 008](audits/ui/audit-008-2026-10-13.md): three findings, none approved yet. Its follow-up records the sweep the owner asked for: eight forecast states, 16 widths, 100/130/200% text, Chromium and WebKit, at rest and pinned. Nothing overflows or misaligns in the mini-ribbon; at 200% text its sentence takes its own row at 641–901px. No code change was needed.
- README screenshot retaken from production after 2.2.4 (Seoul, 2026-10-13 about 01:25 KST); it no longer shows the button.
- Release candidate: 2.2.5. Next: merge, confirm, tag. Open: audit 008 findings 1–3 await the owner; the October 13 evening-run check (2.2.2 entry); Instagram-specific tracking deferred by the owner.

## 2026-10-13 — 2.2.5 released; audit 008 findings 1–3 fixed (2.2.6 candidate)

- 2.2.5 (PR #210, `1564dce`): main CI passed, production serves the merge commit (Vercel dashboard), tag and release published.
- Owner approved all three audit 008 findings: the mini-ribbon appears only after the timeline scrolls away, its rain-window bars are amber, analytics loads only on Vercel. Reasons and costs: `docs/DECISIONS.md`, second 2026-10-13 entry.
- Found while checking the schedule: no evening collection ran on 2026-10-12. The 2.2.2 merge (15:45 KST) removed the 18:10 cron after that day's new 12:40 cron had already passed. The evening group has no captures targeting 2026-10-13; not recoverable, and no manual run was made.
- Release candidate: 2.2.6. Next: merge, confirm, tag; load the live site and confirm the Analytics tab still records the visit; retake the README screenshot only if the owner asks (the bar was not in the top-of-page capture's subject, but the capture shows it). Open: the October 13 evening-run check (2.2.2 entry).

## 2026-10-13 — 2.2.6 released; mini-ribbon removed and README screenshot retaken (2.2.7 candidate)

- 2.2.6 (PR #211, `042bb39`): main CI passed, production serves the merge commit, tag and release published; the live site still sent its analytics script and page view.
- Owner then chose to remove the 24H bar entirely. Deleted with its stacking, enlarged-text and scroll rules; `docs/DECISIONS.md`, third 2026-10-13 entry. Audit 008 has no open findings.
- README screenshot is a production capture of Jeju (2026-10-13 about 15:13 KST), because Seoul was dry at the time. The top of the page is the same before and after this change.
- Release candidate: 2.2.7. Next: merge, confirm, tag. Open: the October 13 evening-run check (2.2.2 entry); the skipped October 12 evening collection stays recorded above. This file is near 200 lines; condense the oldest entries next session.

## 2026-10-13 — 2.2.7 released; outage alerts and Speed Insights (2.2.8 candidate)

- 2.2.7 (PR #213, `42689e5`): main CI passed, production serves the merge commit, tag and release published.
- Owner asked for four launch gaps to be closed: error reporting, outage alerts, measured speed, abuse protection.
- Outage alerts: UptimeRobot monitor 804257727 checks `https://raintoday.vercel.app/` every 5 minutes and emails the owner's Outlook address. It checks the home page only, so a provider or database failure behind a 200 response is still left to `service:health`.
- Measured speed: `@vercel/speed-insights` renders beside Analytics on Vercel only, with the same address stripping. It was already enabled in the Vercel project. One Lighthouse lab run on 2.2.7 (Seoul): desktop 100, simulated phone 65 (LCP 3.0 s, blocking time about 1 s); cause not diagnosed yet.
- Abuse protection: nothing changed. The firewall's Dynamic request volume rule (`/api/`, 150 requests per IP per 60 s) still only logs, and logged nothing in the past day. Switching it to answer 429 awaits the owner.
- Error reporting: not started. The owner's Sentry organisation has one project, `javascript-nextjs`; whether raintoday may use it is unanswered.
- Release candidate: 2.2.8. Next: merge, confirm, tag; after real visits, read the Speed Insights tab; diagnose the phone score as a read-only audit. Open: the October 13 evening-run check (2.2.2 entry).

## 2026-10-13 — 2.2.8 released; functions moved to Seoul (2.2.9 candidate)

- 2.2.8 (PR #215, `05c3de8`): main CI passed, production serves the merge commit, tag and release published; the Speed Insights script loads on the live site.
- Functions ran in `iad1` while visitors enter at `icn1`. `vercel.json` now sets `regions: ["icn1"]`; measurements and limits are in `docs/DECISIONS.md` (fourth 2026-10-13 entry). Production at the time blended three providers (no Open-Meteo, no KMA); the Seoul preview blended four or five.
- Evening collection on 2026-10-13: GitHub started the 12:40 KST schedule at 20:06 KST, so the wait step held nothing and the capture is 1 h 56 min late; 95 of 97 stations stored, two Open-Meteo connection faults. The morning run started at 11:31 KST. The 2.2.2 early-start did not hold the slot that day; nothing changed yet.
- Firewall: the owner approved switching the Dynamic request volume rule from Log to 429, but the agent's browser session was not permitted to change it. The owner does it in the dashboard.
- Sentry: project `raintoday` created in the owner's organisation `michael-ju-46`; no code yet. Plan: browser errors only, loaded after the page is idle, address stripped of the place, no session recording.
- Release candidate: 2.2.9. Next: merge, confirm `x-vercel-id` shows `icn1::icn1` on production and the provider count, tag; then Sentry as its own release. Open: phone-speed items not yet addressed (about 25 font files per visit; the home button's label mismatch).

## 2026-10-13 — 2.2.9 released; browser error reporting (2.2.10 candidate)

- 2.2.9 (PR #216, `edf9ba2`): main CI passed, production serves the merge commit and answers `icn1::icn1`; five forecast reads took 0.35–0.76 s after a 2.2 s first read; Open-Meteo is back in the blend. KMA was absent from the three cities read after deploy; cause not established.
- Browser errors on the production host go to Sentry project `raintoday` (`instrumentation-client.ts`, `lib/errorReport.ts`). Scope, privacy treatment and limits: `docs/DECISIONS.md`, fifth 2026-10-13 entry.
- While proving the browser test fails with the host check opened, one event ("browser test error", from 127.0.0.1) reached the Sentry project. It is test noise.
- Release candidate: 2.2.10. Next: merge, confirm, tag; throw one error on the live site and read the stored event for the address and IP fields. Open: owner switches the firewall rule to 429; KMA absence after the region move; font count and the home button's label.

