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
