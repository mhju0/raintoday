# 오늘비 project handoff

Updated September 6, 2026 for v1.1.0. The project is in maintenance mode.
The previous archaeology report remains in Git history.

## Start here

- [README](../README.md): product, setup and public claims.
- [CONTEXT](../CONTEXT.md): domain vocabulary.
- [DECISIONS](DECISIONS.md) and [ADRs](adr/): policy and its history.
- [ROADMAP](ROADMAP.md): ongoing duties and explicitly deferred ideas.
- [OPERATIONS](OPERATIONS.md): credentials, monitoring, recovery and releases.
- [VERIFYING](VERIFYING.md): local, browser and disposable-database checks.

Resolve conflicts using source/tests, Git, DECISIONS, ROADMAP, this handoff, then
historical Claude material. `AGENTS.md` holds shared repository instructions;
`CLAUDE.md` imports it and adds only the installed Next.js documentation reminder.
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

Issue #124 closed after nine consecutive successful scheduled cohorts. The two latest
cohorts inspected on September 6 contained all five providers, including Visual Crossing,
in all 95 saved captures each. Two faulted stations in each cohort were omitted. This is
a dated observation, not a coverage guarantee.

The remaining seed-to-live transition is an observation task. New providers, a mature
evidence redesign, component splitting and alternate weighting policies are deferred.
There is no outstanding approved product feature after the proximity wording ships.

The website has a SELECT-only database role; scheduled collection uses separate write
credentials. CI runs fixture-based tests and a disposable PostgreSQL contract. Deployment
verification must check the actual Git SHA because a prior Vercel webhook did not deploy
the merged revision. See the [security audit](audits/security-2026-09-06.md) for scope
and residual risks. The old v1.0.0 tag intentionally remains on the earlier application.

## Session log

### 2026-09-19–23 — Collector recovery and corrected incident interpretation

Condensed September 26. Detailed dated evidence remains in Git history, PRs
#169/#171/#172/#174/#177, and issue #175.

- #169 spaced fresh-runner attempts at 0/10/25 minutes and spread ASOS transport
  probes across about 90 seconds. Any HTTP response proves route reachability,
  not credentials, other providers or the database.
- #171 extended narrowly proven pre-connect PostgreSQL retries to initialization,
  station listing and catalog synchronization. #172 records the stage where an
  attempt fails. Blank AggregateError messages had obscured diagnosis; #174 moved
  the guarded error walker into driver-free `errorDetail.ts` for batch reporting.
- The August ~1-second failures were a missing database secret, not the later
  cold-start database defect. `continue-on-error` means a green capture job/step
  is not proof of a successful cohort; inspect counts and the authoritative verdict.
- The September 22 all-provider-egress-blackout and 37–38-minute-duration diagnosis
  was corrected September 23. Pirate Weather and WeatherAPI succeeded; KMA and
  some Open-Meteo reads failed. Repeated ~1,140-second attempts measured the cost
  of a full failing station walk, not outage duration, and delayed retry offsets.
- #177 added an outage breaker after 12 consecutive station transport failures
  for a source with no success in the pass. It reports abandoned work separately,
  and abandonment fails the cohort. The threshold is above the catalog's allowed
  fault tolerance. Five attempts at 0/10/25/40/55 minutes preserve recovery reach.
  A 97-station fixture measured 165 seconds versus 1,334 seconds; this is not live
  outage validation. Successful immutable captures are never overwritten.

Still open: prove the breaker on a real outage; #175's body was corrected September 26;
#146 and #154 require private backup/dashboard work. The live evidence transition
in #140 needed a current station/cohort read. LicenseID alert #28 is intentional.
Deleted diagnostic/recovery workflow registrations may still appear active in
GitHub's inventory without corresponding files on main; they cannot fire there.

## 2026-09-25 — iPhone layout pass and Korean line breaks (#178, #179)

Changed:
- The 오늘비 wordmark is `nowrap` (#178, merged).
- The chooser now reads intro → location panel → details, so the location controls land on a phone's first screen.
- Every view swap scrolls to the top.
- Both search inputs are 16px, to stop iOS focus zoom.
- Audit 003's five findings are fixed:
  - the headline is set as clauses with no commas
  - the `/behind-the-data` rule headings have no periods
  - `.local-keep` binds quoted terms, brackets and 오늘·내일

Rule from the owner: Korean headings carry no line-end punctuation, and no word, quote or bracket is left alone at a line end, from the SE 1st gen (320px) through Pro Max (440px), in Safari and Chrome.

Open:
- The zoom fix is unconfirmed on a device (reported on a 13 mini).
- A rain window can read "모두 0mm".

Next: after #179 merges, the owner checks the 13 mini for the zoom.

## 2026-09-26 — Tablet, laptop and split-screen audit (audit 004)

Changed:
- The header rule now keeps ~16px each side (3.45rem header, 0.65rem chooser top), matching the facts list.
- Every page root balances its text (`text-wrap-style`, the longhand, so `nowrap` survives).
- Percent particles and 비 온 날·안 온 날 are bound.
- The stub rows stack below 24rem instead of stranding a colon.
- Separator dots are tied to the preceding word.

Audit 004 covers 43 named sizes plus a 1920→320 live resize in WebKit and Chromium, and the final pass is 0.

Rule from the owner: a multi-line block's last line fills at least half the widest line.

Open:
- The 13 mini zoom check is still pending.
- "모두 0mm" is unaddressed.

Next: the owner reviews the PR.

## 2026-09-26 — Device check on the iOS Simulator

Changed: the header subtitle "전국 로컬 예보" no longer wraps. iPad Safari had squeezed it onto two lines (audit 004, finding 6).

Checked in real Safari (iOS 26.5): 13 mini, SE 3, 16e, 17 Pro Max and iPad mini.
- 0 findings on all of them.
- No focus zoom: page scale stays 1 and inputs are 16px.
- The rule has 18px above it.

Open issues reviewed, none closed:
- #175: no KMA outage since #177, so the breaker has not been exercised. The 09-23 retry was a DB preflight timeout, which the spaced attempts recovered.
- #140: production Seoul is still `blendMode: seed`, with the benchmark at 26 of 30 samples.
- #146 and #154: still need the private backup and dashboard access.

Open: "모두 0mm".

## 2026-09-26 — "모두 0mm" resolved

A rain window whose total rounds to 0 now reads "모두 0.1mm 미만". "비 예상 … 모두 0mm" contradicted itself; the published amount is kept as a bound rather than hidden. It fits on one line from 320px up, in both engines. This closes the open item carried by the last three entries.

## 2026-09-26 — Repository, security and accessibility audit

Recorded the evidence in `docs/audits/2026-09-26/evidence.md` and the accessibility
findings in audit 005. Source reviewed: `be4120f`.
No app fixes, GitHub metadata changes, publication, deployment or evidence writes.

Verified: full local check passes; current-head CI SQL contract passes. Live Seoul
now reports recent-evidence weighting (ramping), 32 benchmark samples, and five
responding providers. This supersedes the earlier seed/26 snapshot only for this
dated station/cohort read, not a nationwide accuracy claim.

Open: validate malformed/mismatched KMA observation rows; redact populated error
messages; fix audit 005's table keyboard access and chooser semantics; reconcile
README/OPERATIONS/performance README with five collector attempts and current DB
retry coverage. Findings are reproduced or explicitly labelled recommendations;
production data corruption or credential leakage was not observed.

Next: owner reviews numbered findings. Preserve existing
chart-recorder design and immutable evidence; use independent data-integrity review
for any parser/persistence correction. Outage-breaker live-outage proof and existing
private backup/dashboard follow-ups remain open.

## 2026-09-26 — Approved audit remediation and README overview

The owner approved all findings and requested a rainy screenshot. Implemented
shared ASOS row validation, ordinary-error redaction, chooser/table accessibility,
and modest readability changes. Optional omitted rainfall is unusable for scoring;
explicit documented blank rainfall stays a dry observation. Historical evidence,
scoring thresholds and provider order are unchanged.

The concise README links FORECAST_CONTRACT.md for methodology. Its real production
Busan screenshot shows a 91% peak rain chance. GitHub description was updated and
re-fetched; #175 now marks the old diagnosis superseded and stays open for live
outage proof. Condensed the oldest handoff entries while retaining unresolved work.

Verification: full Node 24 check passed (485 tests; disposable SQL test skipped
locally). CI on `9aa6327` passed, including SQL contract, both pinned browser tests,
dependency review and CodeQL. An independent review approved this exact source
revision after authentic read-only KMA and adversarial parser/redaction checks.
Preview Chromium confirmed mobile table keyboard scrolling and chooser semantics.
PR #182 tracks final merge/deployment verification. Private backup, hosting-account
follow-ups and live outage-breaker proof remain open.

## 2026-09-26 — Release 2.0.0 polish

Changed:
- The tomorrow card cites the benchmark count the scoring record shows. It had cited the weakest provider's count, which was 15 against 32.
- Header and hero use one rainfall format (`0.4mm`) and Korean labels.
- Every label below `--t-label` (0.78rem) was raised to it.
- `/behind-the-data` has a back link at the top.
- Provider names, the footer arrow and the empty-instrument labels no longer split across lines.
- The README has CI and collection badges and dated counts from a read-only production query.
- Orphaned screenshots and recruiting drafts were removed. `docs/audits/antislop/` was renamed to `docs/audits/ui/`.
- `.mailmap` maps both author identities to Michael Ju.
- The version is 2.0.0.
- On GitHub: the v1.0.0 release was retitled "SeoulSky (predecessor)" with a note that its tag holds the old source, and four unused default labels were deleted.

Decisions:
- Git history was not rewritten, because it would need a force-push and would break PR and tag links. The cinematic media stays in history, by owner decision.
- 2.0.0 marks the SeoulSky → 오늘비 succession; it adds no new product scope.

Checked: layout at 320–1440px in Chromium and WebKit against production.

Next: after the PR merges and production shows the merged SHA, tag `v2.0.0` on main and publish the release.

## 2026-09-26 — v2.0.0 tagged; release rule; 2.0.1

- v2.0.0 was tagged on `361802f` after production served it and main CI passed. The release is published.
- AGENTS.md now has a **Releases** rule: every merged change ships as a release (patch for fixes, docs and operations; minor for new capability; major only by owner decision). The version bump goes in the change's own PR, and the tag follows verified production.
- 2.0.1:
  - Tomorrow's range line keeps "많으면 3.8mm (Visual Crossing)" whole. Production had split the name across lines at desktop width.
  - The README screenshot is now 제주시 with the current labels. It shows real production forecast data rendered by this branch.
- Branches: the seven merged local branches were deleted. `reliability-state` stays by design.
- Tracked-file audit: nothing tracked is gitignored, there are no stray untracked files, `.env.example` has empty values, and every ignored path has a stated reason in `.gitignore`.

## 2026-09-26 — Plain rain headline (2.0.2)

The owner asked for a simpler conclusion and approved the recommended set:
- The label above the headline is now "비 예보", replacing "결론 : 앞으로 24시간, 한 문장으로".
- Dry: "앞으로 24시간 비 예상 없음". The number is the series' own length, and it only appears when every block is published and the blocks are back to back. Otherwise the headline falls back to "발표된 시간대에 비 예상 없음" (the audit 002 #12 bound).
- Rain window: "오후 3시부터 저녁 7시까지 비 예상". The window total moved to the line below as "구간 합계".
- Open run: "내일 자정부터 비 예상". Whole series wet: "앞으로 24시간 내내 비 예상".
- No probabilities: "시간대별 강수확률 미발표".
- No hourly timeline: "오늘 강수확률 82%", replacing the question "오늘 비가 올까요?".
- The later-run note uses the 12-hour clock ("저녁 6시"), matching the headline.

Checked in Chromium and WebKit at 320–1440px across all eight cases: the last line is never shorter than half the widest line, and nothing overflows.

Open: when the blended day amount is at least 10mm, the umbrella line can say "우산을 꼭 챙기세요" under a dry hourly headline. This predates the change and needs an owner decision.
