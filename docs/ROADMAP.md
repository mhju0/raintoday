# Roadmap

Updated 2026-09-05 after the independent takeover audit and owner approval. This is the
**current** roadmap, not an accumulation of past
brainstorming. Items that were once discussed and are no longer intended appear only under
"Considered but not committed" or "Explicitly rejected", so that nothing here reads as
planned work when it is not.

**The project is in maintenance mode.** The owner approved the audit's correctness,
security, privacy, and operational fixes, plus the already-decided proximity wording.
New providers, scoring-policy changes, and component/CSS refactors remain deferred.

Current source/tests and Git take precedence over this document; see the authority order
in `docs/DECISIONS.md`.

---

## NOW

### #124 — Confirm the capture pipeline runs unattended

This remains the only open GitHub issue. The audit found additional actionable work below.

The bar: **8 consecutive green scheduled `local-performance` cohorts** (~4 days). It counts
scheduled runs only.

**VERIFIED 2026-09-05: 7 of 8**, through scheduled run `33927705186`
(2026-09-04T22:58Z), after the 2026-09-01T14:07Z failure reset the count.
The next scheduled success can meet the existing run-count criterion. Provider coverage
also needs verification: a green run previously hid an empty Visual Crossing credential.

What to check on each run, and what each means:
- an `observation:` failure — **zero tolerance by design** (#87); investigate immediately;
- a **double failure**, where both the run and its fresh-runner retry hit an egress blackout —
  expected at roughly 6%, which is what happened on 09-01. Reopen #103 only if it repeats;
- `catalogSource: "store"` — routine degradation, not a failure;
- a partial cohort that still exits green (e.g. 93/97) — that is `CAPTURE_FAULT_TOLERANCE`
  working as designed (#114), not a problem.

**Do not `workflow_dispatch` this workflow to hurry the count.** The cohort comes from
`--cohort`/`--schedule` rather than the clock, so a manual run stores captures labelled with a
slot they were not taken in.

### Restore Visual Crossing capture coverage — first actionable item

**VERIFIED:** the two latest scheduled logs passed an empty `VISUAL_CROSSING_API_KEY`;
the configured database has no Visual Crossing captures. #130 fixed the workflow declaration,
but did not establish that the secret contained a usable value.

The Actions secret was repaired from the locally verified working key on 2026-09-05.
The collector now has a strict configuration preflight, enabled in both workflow attempts,
that stops before any evidence write when a compared provider lacks configuration.
Await the next scheduled run to confirm a nonempty secret and five-provider new captures.
Historical captures stay frozen; do not backfill the missing forecasts.

### Complete the approved audit fixes

- **Implemented locally, pending merge:** keep a provider with zero historical samples at a
  neutral share in learned/ramping modes. The shared blend now assigns missing weights the
  mean of available scored weights, preserving an equal share after normalization.
- Link GPS visitors to their matched observation station's scoring record without putting
  device coordinates in the URL. Searched-area coordinates remain shareable.
- Key scoring-record evidence by matched station + cohort; #128 currently keys exact
  request coordinates. Preserve request-specific station-distance details.
- Return 400 for malformed forecast-request JSON; the current parser produces 503.
- Update the dev-only Browserslist dependency to a patched version; a compatible fix is
  available, so this is actionable rather than blocked on upstream.

---

## NEXT

### Cut `v1.1.0` from `main`

**Approved** — see `docs/DECISIONS.md`. The `v1.0.0` tag points at
`89d3334` (2026-07-15), the pre-rename tree, 221 commits behind `main`; the release notes
describe the August product and say "four weather services", ~3.5 hours before the fifth
merged.

Leave the existing tag alone, correct the v1.0.0 notes, and cut `v1.1.0` from verified
`main` after the approved fixes and #124 acceptance. From then tag only served-path feat/fix
batches — never a Dependabot batch alone.

### Require CI before enabling Dependabot auto-merge

Approved: require passing CI on `main`, then automate passing patch/minor Dependabot
merges. Major upgrades remain manual. Required status checks were unset at the audit.

### Implement the ADR 0005 proximity wording

Approved: distinguish `local` (≤25 km) from `regional` (25–100 km) evidence in the wording.
Keep the existing distance/elevation eligibility gates and scoring policy.

### Watch the seed → live handover

The transition is unit-tested but **UNKNOWN on production evidence**. #89 fixed its
reachability (ADR 0011), not the event. The earlier ~2026-09-22 estimate is **INFERRED**,
not a date guaranteed for every station/cohort. KMA is not a global gate: source requires
two eligible providers, and missing-provider history and wet/dry coverage vary by cohort.

### Put the data.go.kr key expiry on a calendar

Human-only. data.go.kr keys carry a 활용기간 and **will** expire. A lapse fails the daily run
loudly, so it is caught rather than silent — but it is the one calendar item worth setting.

---

## LATER

- **Split `components/local/LocalForecastExperience.tsx`** (1,801 lines). Judged and
  deliberately deferred: it serves the reviewer, not the product. The docs already name
  chooser / loading / failure / dashboard as four surfaces; the code does not. Do it only if
  the code should read as well as the docs do.
- **Revisit grouping captures by measured lead time** (#118), once samples are plentiful.
  Deliberately not done now: providers inside one capture share its lead time, so the drift is
  common-mode noise, and filtering would have cost ~22% of the evening cohort at a moment when
  samples were scarce.
- **Revisit the eligibility/benchmark counting asymmetry.** Eligibility counts cumulatively with
  no age filter while the benchmark counts only inside `windowDays`, so a provider can be
  eligible on lifetime samples while its Brier rests on very few recent ones. Not biting yet;
  it is scoring policy, so it belongs behind an ADR.

---

## BLOCKED

- **#124** still needs its next scheduled result; restored provider coverage also awaits that run.
- **The seed → live handover** is blocked on evidence accumulating. It cannot be hurried:
  captures are frozen and cannot be backfilled, and forcing extra runs would corrupt the cohort
  labels.
- **Visual Crossing quota runway:** no usage endpoint or rate-limit headers were found in
  the historical investigation. A 429 becomes a provider fault, but `service:health` allows
  one of five providers to be unavailable; it does not alert on Visual Crossing alone.
- **Social preview:** GitHub has no API for this setting; the existing image needs no change.

---

## CONSIDERED BUT NOT COMMITTED

Ideas with real reasoning behind them that are **not** currently planned. Do not treat any of
these as intended work.

- **Tomorrow.io as a sixth provider.** Ranked #2 behind Visual Crossing in the provider scouting
  pass. Visual Crossing shipped; Tomorrow.io was never started. Adding it would mean another
  credential and another quota ceiling for marginal accuracy — the same argument that was made
  *against* the fifth provider before it shipped. If it ever happens it must be **appended**,
  never inserted.
- **Publishing the mature-evidence view.** Once a station reaches `learned`, `/behind-the-data`
  will say something it has never yet been able to say. Nothing is designed for that moment.
- **Seeding WeatherAPI or Visual Crossing.** Blocked on honest archive proxies, not on effort.
  Never seed a provider without one.
- **A DEM lookup to populate `elevationM` for search results.** Would make the elevation gate
  non-inert for non-GPS visitors. Real cost, no measured benefit (ADR 0006).
- **A `ForecastLocation` branded type** so an unvalidated coordinate cannot be constructed by
  mistake. Currently enforced by there being exactly one construction site, `lib/location.ts`,
  plus tests.
- **Reducing the size of `app/globals.css`** (2,638 lines). Same argument as the component split
  and lower value.

---

## EXPLICITLY REJECTED

Proposed, considered against the actual product, and turned down. Recorded so they are not
re-proposed as if new. Reasons in full are in `docs/DECISIONS.md`.

| Rejected | Why |
| --- | --- |
| English UI / i18n | Largest cost, least product value; the README captions already translate for an evaluator. |
| Shortening the README | Its density serves the engineer who decides. |
| Reviving the cinematic scene, the video plates, or the radar | Removed with ADR 0008 behind it; they answered no question the product asks. |
| Restoring RainViewer / CARTO / OSM attribution | The credit list follows the served data; those sources are no longer shown. |
| MET Norway as a provider | No `probability_of_precipitation` for Korea, and both scoring gates need a next-day probability. |
| Removing `met-norway` from the id unions | Stored rows carry it; removing the id would not delete them, only stop the code describing them. |
| The AWS observation network | 0.5 mm gauge resolution decides the 0.1 mm call it is being asked for. |
| A `LICENSE` file to clear `LicenseID` | Deliberately all-rights-reserved (`0e8f7c7`, 2026-07-31). |
| Bucket-midpoint amounts for KMA | Its `PCP` buckets appear precisely on heavy-rain days. |
| Quartile or percentile wording for amount spread | Dishonest at n ≤ 4; named min/max instead. |
| Caching Kakao Local results | Their operating policy forbids it; a cache was implemented and removed (`c87820f`). |
| Coach marks, guided tours, numbered chapter labels | ADR 0010 — the kickers are labels, never a sequence. |
| A decorative palette, or borders as structure | ADR 0009; borders are a documented failure mode on a reading surface. |
| Adding `server-only` to the service-area module | A new dependency for a guard the tests already provide. |
| Silencing the run-failure alert | The failed step, its warning, and the retry job's presence are what keep a blackout visible. |
| `workflow_dispatch` on `local-performance` | Stores captures under a slot they were not taken in. |
| A third API route | The surface stays at two; `/behind-the-data` reads the store from its server component. |
| Any new product scope | Maintenance mode. |
| Deleting `reliability-state` or its deployment guard | Owner approved retaining the frozen archive on 2026-09-05. |

---

## COMPLETED RECENTLY

Everything below is done and merged. Listed because a fresh reader will otherwise mistake
several of these for open work.

**2026-09**
- #133 — dependency refresh (`007b517`)
- Docs stop referring to removed code (`c03492e`)

**2026-08-31 — the closing sweep**
- **#110 / PR #129** — Visual Crossing shipped as the fifth provider
- **#130** — declared the Visual Crossing workflow secret; empty-value gap found on 2026-09-05
- **#131** — `lib/performance/README.md` still said four providers
- **#132** — `CLAUDE.md`'s variable *count* replaced with a set guard
- **#121 / PR #126** — worked-example chips; the front door for anyone without a Hangul keyboard
- **#122 / PR #127** — neutral weighting partly fixed; zero-history learned fallback remains in NOW
- **#123 / PR #128** — record caching added per coordinate+cohort; station sharing remains in NOW
- **#112 / PRs #113, #120** — `/behind-the-data` served, and given a coordinate
- **#118 / PR #119** — lead time measured and published
- **#125** — `v1.0.0` released and a custom social preview uploaded
- Credential stores swept across `.env.local`, Vercel and GitHub, verified by redeploying

**2026-08-30**
- **#103 / PR #111** — runner egress: refuse fault-degraded captures, retry on a fresh runner
- **#89 / ADR 0011** — `windowDays` 30 → 60; the flawless-month trap removed
- **#114** — a few refused captures are no longer a failed cohort
- **#107 / PR #109 / ADR 0010** — the D-11 structure pass: open at the answer, shelve the receipts

**2026-08-27..29**
- **#105 / ADR 0008** — the great deletion, 246 → 139 files
- **#104** — service health and the quota runway
- **#106** — drift guards
- **PR #108 / ADR 0009** — the chart-recorder redesign

**Earlier in 2026-08**
- **#87** — observation faults are never scored as absences
- **#92** — the 06 cohort reads D−2
- **#96** — MET Norway dropped
- **#100** — amount attributed separately from probability
- **#59** — the evidence-disposition question closed
- **#51 / ADR 0006** — the elevation gate reviewed and kept
- **#29 / ADR 0005** — station proximity decided (the wording dimension is still unbuilt)
- **#54** — the forecast moved to `/`; `/sky` removed with no redirect
- **#49** — renamed SeoulSky → 오늘비 / raintoday
- The nationwide seed backfill: 8,730 comparisons for 2026-05-20..08-17
