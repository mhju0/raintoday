# Decision ledger

Compiled 2026-09-04; audited and updated 2026-09-05. Sources are ADRs, Git history,
GitHub issues and PRs, and prior working
conversations. Chronological. The point of this file is the part git cannot reconstruct:
**why** something was decided, what it replaced, and — for the many entries where it
happened — **why it was later undone**.

**Status vocabulary**

| Status | Meaning |
| --- | --- |
| **ACTIVE** | In force today |
| **REVERSED** | Implemented, then deliberately undone |
| **SUPERSEDED** | Replaced by a later decision; the record survives as history |
| **DEFERRED** | Decided to be worth doing, deliberately not done yet |
| **EXPERIMENTAL** | Shipped but unproven — the thing it claims has not been observed |
| **ABANDONED** | Built, then removed with no successor |
| **UNKNOWN** | Evidence is incomplete or self-contradictory |

Evidence is a commit, PR, issue, ADR, or **(conversation-only)** where nothing else records
it. Numbered PR/issue references are GitHub's.

---

## 2026-06 — The product was a cinematic Seoul sky

**Status: ABANDONED**

**Decided.** Build a real-time cinematic weather scene for Seoul: a React Three Fiber sky,
AI-generated video base plates composited under transparent live 3D, a landmark video
gallery, a glass HUD, sun-phase colour grading, and an atmospheric colour field at
`/atmosphere` with a `/diagnostics` twin.

**Why.** The original project premise was visual — weather as an experience, not a number.

**What changed.** Over roughly a month it became clear the scene answered no question. The
sequence of retreats is legible in git: the canopy overlay went first (`8c38b8a`,
2026-06-16), then the video gallery gave way to a still colour field (2026-06-17), then the
glass panels went matte, then frosted, then **fully frameless** (`d39ecd3`, 2026-07-14) —
each step removing decoration rather than adding it. The 37 video plates were archived out
of the repository entirely on 2026-08-19; `/sky` was removed on 2026-08-20 (#54); and the
scene modules were deleted wholesale on 2026-08-27 (#105, ADR 0008).

**Current state.** Nothing renders behind the forecast. `/atmosphere` and `/diagnostics`
still 307-redirect to `/` — real HTTP redirects for the retired paths, kept so old links do
not 404. That redirect pair is the only surviving trace in the served surface.

**Do not revive it.** The deletion was a considered decision with an ADR behind it, not
neglect.

---

## 2026-06-18 — KMA is two independent subscriptions, not one key

**Status: ACTIVE (partly superseded by deletion)**

**Decided.** Split `KMA_API_KEY` into `KMA_SHORT_TERM_API_KEY` and `KMA_WARNING_API_KEY`,
with independent status reporting and a key-free `classifyKmaResponse` so the classifier
could be tested without a credential.

**Why.** data.go.kr subscriptions are per-service. One key that works for the short-term
forecast returns 403 for another service, and a single combined status made that
indistinguishable from an outage.

**What changed.** Weather warnings left the product with the scene. `KMA_WARNING_API_KEY`
was swept out of Vercel on 2026-08-31.

**Current state.** The principle stands and has since produced two more keys under exactly
the same logic: `KMA_OBSERVATION_API_KEY` (ASOS daily) and `KMA_APIHUB_KEY` (apihub
`stn_inf`, which needed its own **1.1.1 지상** 활용신청 — one authKey per account, so no
new key, just a new subscription). That subscription gap failed the daily action on **every
run from 2026-08-13 to 2026-08-19** before it was diagnosed.

---

## 2026-06-26 — Radar rendered server-side from KMA raw reflectivity

**Status: ABANDONED**

**Decided.** Replace the data.go.kr `RDR_CMP_WRC` composite with a server-rendered radar
built from `apihub.kma.go.kr` raw HSR reflectivity (2305×2881 at 500 m, `disp=B` int16
little-endian), cropped to Seoul, reprojected to Web Mercator over a CARTO dark basemap with
Korean city labels. New modules `lib/radar/{grid,geo,mercator,apihub}.ts`.

**Why.** The composite product was coarse and the rendering was not ours to control.

**What changed.** The radar was a *nowcast* display. Once the product became a next-day
comparison, it answered a question nobody was asking. Deleted in #105.

**Current state.** Gone, along with RainViewer (which had been the "approach signal"). Both
CARTO/OpenStreetMap and RainViewer were **removed from the attribution list** as part of the
same change: the credit list follows the served data, and crediting a basemap the reader is
not shown would describe something that no longer exists.

---

## 2026-07-11 → 2026-07-31 — An MIT license was added, then removed

**Status: REVERSED**

**Decided, then undone.** `9d2329b` added MIT (2026-07-11). `0e8f7c7` removed it —
*"Remove MIT license, reserve all rights"* (2026-07-31).

**Why the reversal.** The repository is public **for portfolio review only**, not for reuse.

**Current state.** `package.json` declares `"license": "UNLICENSED"` and there is no
`LICENSE` file. OpenSSF Scorecard raises a `LicenseID` alert about exactly this. **The alert
is correct about the fact and wrong about the intent — never "fix" it by adding a license.**

---

## 2026-08-01 — Durable pipeline state on an orphan `reliability-state` branch

**Status: SUPERSEDED (ADR 0001; the guard it justified is still ACTIVE)**

**Decided.** Persist scored precipitation state to an orphan git branch, because the
pipeline ran in GitHub Actions with no database.

**Why.** It was free, versioned, and needed no infrastructure.

**What changed.** PostgreSQL arrived. The pipeline the branch served was deleted in #105.

**Current state.** The branch still exists on the remote holding a frozen artefact — 111
scored events over 32 dates. Nothing reads or writes it. `vercel.json`'s
`deploymentEnabled: {"reliability-state": false}` guard remains **load-bearing**: the branch
exists, so anything pushed to it would otherwise produce a deployment. ADR 0008 explicitly
left deleting the branch open; the owner decided to retain it and its guard on 2026-09-05.

---

## 2026-08-13 — The pivot: local rain accuracy, nationwide

**Status: ACTIVE — this is the product**

**Decided.** Stop building a Seoul weather *experience*. Build a South Korea next-day rain
forecast that compares providers at the user's exact coordinate and weights them by recently
observed local performance.

**Why (conversation-only).** The scene had no question behind it. A rain forecast has one,
it is checkable, and being checkable is the whole point of a portfolio piece.

**Evidence.** `0aabe10`, `25201cf`, `6f50e26` (2026-08-13); everything after is downstream
of it.

---

## 2026-08-14 — Location selection through Kakao, coordinate-first

**Status: ACTIVE (ADR 0002)**

**Decided.** Three ways in — browser geolocation, Kakao administrative search, and (added
later) worked examples. The user's **exact coordinate** is the forecast target; an
administrative area contributes its representative point, never a bounding box centroid.

**Rejected at the time:** IP geolocation (wrong at city scale and silently so), automatic
geolocation prompts (the browser prompt must follow an explicit tap), and storing user
coordinates (they are never written to the database).

**Two constraints that came from Kakao's own terms, not from engineering:**
- **No caching of Local results.** A one-hour cache was implemented and then **removed** in
  `c87820f` on reading the operating policy.
- **Plain-text attribution only.** Kakao's terms forbid using its trademarks without
  consent, and Local results carry no branding requirement, so the credit is a text string.

---

## 2026-08-15 — The service area is official SGIS boundary geometry

**Status: ACTIVE (ADR 0003)**

**Decided.** Validate every coordinate against generated 시도 boundary geometry before any
grid conversion or provider call. Generate it from the official SGIS package with
`scripts/generate-service-area.ts`; keep it server-only; never commit the raw package.

**Rejected:** a bounding box (admits North Korea, the Yellow Sea and Tsushima), and a
runtime shapefile parse (a ~40 MB dependency on a request path).

**Non-obvious properties that must survive a regeneration:** ring nesting is computed
**per feature**, so 광주's hole sits inside 전남 correctly; simplification is 10 m
Douglas-Peucker with ~1.1 m quantization; the encoding is a zigzag-varint codec. **Re-verify
the island corpus after every regeneration** — islands are what a simplification silently
eats.

---

## 2026-08-16 — Two scoring pipelines were kept side by side

**Status: SUPERSEDED by ADR 0008 — but read the measurement it left behind**

**Decided.** Keep both `lib/reliability/` (fixed-point weight projection) and
`lib/performance/` (water-filling projection), because they disagreed.

**The measurement — the only surviving account of what is at stake.** Over a 200,000-case
sweep the two projections disagreed in **78%** of cases, with a maximum single-weight delta
of **0.167**, plus a worked case where they split a bounded simplex differently.

**What changed.** `lib/reliability/` was deleted in #105.

**Current state.** Water-filling survives **by inheritance, not by contest.** The other
implementation was removed for reasons unrelated to which projection is more correct.
Nobody should read its survival as a verdict. If weight projection is ever revisited, this
is the entry to start from.

---

## 2026-08-18 — SeoulSky → 오늘비 / raintoday

**Status: ACTIVE**

**Decided.** Rename the project. The name described a city and a scene that were both
leaving.

**Evidence.** `f09b59a` (#49).

**The trap it exposed (conversation-only).** **Renaming a Vercel project does not move its
`.vercel.app` domain.** `raintoday.vercel.app` had to be added manually; `seoulsky.vercel.app`
now 404s. And a URL change has a **third** surface nothing syncs: the GitHub repository's own
`homepage` field. Also: **`rain-today.vercel.app` (hyphenated) belongs to a stranger** — never
link it.

---

## 2026-08-18 — Retrospective seed evidence, in a separate class

**Status: ACTIVE**

**Decided.** Let a station borrow retrospective archive evidence so it is not stuck on equal
weights for a month, but keep it structurally incapable of contaminating live evidence: its
own table, scored on **amount** rather than probability, no cohort, no frozen blend, capped
influence, never able to rescue a benchmark suspension, superseded entirely once live
evidence matures.

**Why the separation is absolute.** A retrospective comparison is chosen after the outcome
is known. Nothing that can be selected after the fact may enter a prospective benchmark.

**Constraints discovered while building it:**
- Use Open-Meteo's **Previous Runs** API (`*_previous_day1`), **not** the plain archive — the
  plain archive is reanalysis, not what was forecast.
- **Archived probabilities do not exist**, which is why seed scoring is amount-based.
- **Never seed a provider with no honest archive proxy.** WeatherAPI has no public archive
  with model lineage; Visual Crossing's is billed per hour (24 records per station-day) and
  unreachable on the free tier. Neither is seeded, and neither is demoted for it.
- Widening the mode gate takes **three** edits, including `influence.ts` (conversation-only).

**Result.** 8,730 seed comparisons stored nationwide for 2026-05-20..08-17 (2026-08-19).
A partial-catalog bug in `--station` was found only by running against a *dirty* database
(`5c7a340`, `fab9a7a`).

---

## 2026-08-19 — Station proximity picks the wording, not eligibility

**Status: ACTIVE as a decision, DEFERRED as an implementation (ADR 0005)**

**Decided.** Keep station eligibility at the existing threshold and let distance choose the
*language*: `local` at ≤25 km, `regional` at 25–100 km.

**Why.** Measurement, not intuition: the 100 km threshold turned out to be **non-binding** —
no populated place in South Korea is more than ~30 km from an ASOS station. Tightening it
would have excluded nobody while sounding stricter.

**The near-miss worth remembering.** Area-weighted numbers nearly produced the opposite call.
**Weight by where people actually are**, not by area.

**Current state.** The `proximity` dimension is **not implemented** in the page. ADR 0005's
own amendment says so. This is the one decided-and-unbuilt item in the ledger.

---

## 2026-08-20 — The elevation gate is kept although it is non-binding

**Status: ACTIVE (ADR 0006)**

**Decided.** Keep the 400 m station-elevation gate.

**Why, precisely.** It is **structurally inert for every non-GPS visitor** — search results
hardcode `elevationM: null` — and **0 of 54** populated administrative centres exceed 400 m.
대관령, the suspect that prompted the review, is fine; 태백 and 장수 are the real outliers.
It was kept because it costs nothing and would matter for a GPS fix in the mountains.

**Rejected:** a DEM lookup to populate elevation for search results (real cost, no measured
benefit), and adding `server-only` to the module (the repository has no such dependency and
adding one for a guard the tests already provide was declined).

---

## 2026-08-20 — Redesign direction B: a horizontal time axis, no scene

**Status: ACTIVE**

**Decided.** Move the forecast to `/`, put time on the horizontal axis, and remove the scene
from every screen.

**Deliberate breakage:** `/sky` was removed **with no redirect** (#54). Old shared links,
including `?lat=` forms, are dead. This was a decision, not an oversight.

---

## 2026-08-22 — AWS observation network ruled out

**Status: ACTIVE (rejection stands)**

**Decided.** Do not adopt KMA's AWS (automatic weather station) network as ground truth,
despite the density it would add.

**Why.** Its gauge resolution is 0.5 mm. At `rainThresholdMm = 0.1` that makes the
rain/no-rain call it is being asked for. `inf=AWS` does work on the existing key, so this is
a data-quality rejection, not an access one — and the apparent coverage gain is an artefact.

---

## 2026-08-22 — Keep the second pipeline running though nothing reads it

**Status: SUPERSEDED five days later (ADR 0007 → ADR 0008)**

**Decided.** After `/api/sky` and `/api/weather` were retired, `lib/reliability/` had no
reader. It was kept anyway, on the argument that its accumulating state was valuable.

**What changed.** ADR 0008 (2026-08-27) concluded the opposite: unread code that still runs
is a liability, not an asset.

**Read ADR 0007 as history.** It is not instruction.

---

## 2026-08-24 — An unreadable observation is a fault, never an absence

**Status: ACTIVE (#87)**

**Decided.** `absent` means ASOS published no row for that station-day. **Anything else** — a
dropped connection, a throttle, a refused key, an unparseable body — is a fault that lands in
`failures` and fails the run. Throttles and drops retry with a short backoff; a **refusal is
terminal and must not be retried**, because retrying only spends quota.

**Why.** Collapsing the two is how a green run stored **10 of 97** observations and reported
nothing wrong.

**Related, same reasoning (#92):** a day ASOS has not compiled yet returns the *same* NODATA
as a station with no row. So the **06 cohort reads two days back** and only the 18 cohort
reads yesterday. `performance:observations` refuses an end date newer than D−2 for the same
reason.

**Observations keep zero fault tolerance** even after #114 loosened it for captures.

---

## 2026-08-25 — MET Norway dropped; its id deliberately retained

**Status: ACTIVE (#96)**

**Decided.** Remove MET Norway from the forecast path, but keep `"met-norway"` in
`ProviderId` and `PrecipProviderId`.

**Why dropped.** It answers `ok` for Korea and publishes an amount, but **no
`probability_of_precipitation`** — and both scoring gates require a next-day probability.

**Why the id stays.** Stored capture and seed rows carry it historically.
`PERFORMANCE_PROVIDERS` in `lib/performance/store.ts` filters it at read time. Removing the
id would not delete those rows; it would only stop the code from being able to describe them.

**The generalisable rule.** Visual Crossing later became the counter-example proving this
gate is about the **data**, not the vendor — it publishes a D+1 `precipprob` on the free tier
and was accepted.

---

## 2026-08-26 — Amount and probability are attributed separately

**Status: ACTIVE (#100)**

**Decided.** Fewer providers publish an amount than publish a probability, so a card's
provider-count tag must never stand for both numbers. `blendPrecipitation` reports
`amountProviderCount`, and the amount carries its own count whenever the two differ.

**Related, decided at the same time and equally load-bearing:** **KMA publishes no usable
daily amount.** Its `PCP` field is categorical — exact values sit beside buckets like
`30.0~50.0mm`, and the buckets appear precisely on heavy-rain days, which is exactly when a
midpoint would be most wrong. KMA's amount stays `null`. **Do not "fix" this with a bucket
midpoint.**

---

## 2026-08-27 — The great deletion

**Status: ACTIVE (ADR 0008, #105)**

**Decided.** Delete the retired scene, the radar stack, and the second scoring pipeline:
246 → 139 tracked files, −19,472 lines in one commit (`993239e`).

**Why.** Unread code that still runs is a liability. It consumes quota, generates alerts,
and — most expensively — it makes an audit lie by making the tree look like it does more than
it does.

**What was deliberately KEPT, and why (each of these looks deletable and is not):**
- `lib/performance/precipSkill.ts` — **served on every request** through `seedScore.ts` while
  evidence is in seed mode. It is not scheduled-only code.
- `met-norway` in the id unions — see above.
- The `vercel.json` deployment guard — the branch still exists.
- The `/atmosphere` and `/diagnostics` redirects — old links.

**The four traps this deletion taught (all conversation-only, all cost real time):**
1. **A directory-level grep is not an import graph.** "Nothing in `lib/reliability/` reaches
   a user" was recorded as *verified* and was **false**.
2. **A token scan cannot see a dynamic class name** — `` `is-${status}` `` made `.is-active`
   look orphaned.
3. **A cross-file scan misses same-file type usage.**
4. **Deleting a module breaks its own test**, so the test count moves for a reason unrelated
   to the change.

---

## 2026-08-27 — Watch the deployed service, and watch quota as runway

**Status: ACTIVE (#104)**

**Decided.** Add `npm run service:health`, running every six hours, checking the page, the
forecast, the administrative search, **and** Pirate Weather's remaining quota against the
pipeline's projected burn.

**Why.** **Nothing watched the served path.** Production reads Vercel's environment and the
scheduled jobs read GitHub Secrets — two separate stores. Every workflow could be green while
the site was degraded.

**Why runway, not a threshold.** Pirate Weather is the **only reachable ceiling**: 10,000 per
month against a pipeline burn of ~194/day ≈ 5,820. A fixed percentage threshold says nothing
useful; days-of-runway does.

**Security note from the same work:** the CodeQL `js/request-forgery` finding here **was**
properly cleared, with a constant target map plus a `/^[A-Za-z0-9_-]+$/` guard on the key
interpolated into the path. Do not generalise the *other* CodeQL dismissal to this one.

---

## 2026-08-28 — Bind every documented fact to code with a guard

**Status: ACTIVE (#106, later #130 and #132)**

**Decided.** Four tests now own facts that used to live only in prose:
`lib/documentedPolicy.test.ts`, `lib/dynamicClassNames.test.ts`,
`lib/environmentExample.test.ts`, and the credential-inventory guard in
`lib/performance/cli.test.ts` binding the workflow's secrets to the code that reads them.

**Why.** Four inventory drifts appeared in three days, all the same shape: **a fact copied
into prose or config with nothing binding it to code.**

**Three hard-won rules (conversation-only):**
1. **A guard that compares two things to each other cannot catch them being wrong together.**
   The first workflow guard asserted the capture and retry jobs carried the same secrets;
   both were equally short of the new one. Bind to the code.
2. **Mutation-test any guard meant to fail later** — a green guard proves nothing until you
   have seen it go red.
3. **Naming beats counting.** #132 replaced a variable *count* in `CLAUDE.md` with a set
   guard for exactly this reason. The in-repo prose survived the fifth provider because it
   names providers instead of counting them.

**Three surfaces no guard can ever reach**, because they live outside the tree: the GitHub
repository description (which said "four weather services" for a day after the fifth
shipped), the homepage URL, and the social preview image (**GitHub exposes no API for it** —
it is UI-only and can never be automated).

---

## 2026-08-29 — The chart-recorder redesign

**Status: ACTIVE (ADR 0009, #108)**

**Decided.** The page is an instrument reading, not a weather app. Colour is reserved for
**three** things and nothing else: the chance of rain (blue), the amount of rain
(water-teal), and the rain window (amber). Every separator is achromatic.

**Rejected along the way (conversation-only, from the design pass):** a decorative palette;
borders as a structuring device — recorded as a **documented failure mode**, borders make a
reading surface look like a form.

---

## 2026-08-30 — Open at the answer, shelve the receipts

**Status: ACTIVE (ADR 0010, #109)**

**Decided.** A first visit opens at **한눈에** (glance), not at the full evidence. Each
stratum carries a **claim kicker** naming whose number it holds (결론 / 오늘 · 내일 — 여러
서비스를 섞은 / 근거 / 기록). The receipts shelf — exactly what the density toggle folds —
sits one surface rung up behind a single hairline, which **amends** the flat-ground rule from
ADR 0009 rather than breaking it.

**Rejected explicitly:** numbered chapter labels (01–05) — the kickers are labels, never a
sequence; and any coach-mark or guided tour.

**The fold's honesty rules, each bought with a reasoning failure:**
- an unset preference opens at 한눈에; a **stored choice is never overridden**;
- a forecast with no timeline **never folds at all** — the toggle lives in the minibar, so a
  fold there would be a locked door;
- stubs repeat their section's **own** numbers and never compute a figure for the stub;
- the raised surface and the fold wrap **exactly** the same content, so they cannot disagree.

**The design-pass traps (conversation-only):** a long-lived dev server squatting port 3000
makes `npm run dev` silently shift to 3001, so a live check tests **old code**; and
`position: sticky` dies under **any** ancestor whose overflow is not `visible`/`clip`.

---

## 2026-08-30 — `windowDays` 30 → 60; the bar stays at 30

**Status: ACTIVE (ADR 0011, #111)**

**Decided.** Widen the scoring window to 60 days while leaving `minimumSamples` at 30.

**Why.** `windowDays == minimumSamples` had silently demanded a **flawless month**: every
scheduled cohort landing, every observation arriving, nothing refused. Any interruption reset
the clock. Recency is enforced by the **14-day half-life**, not by the window edge — so
widening the window costs nothing in freshness and stops one bad week from starving the gate
indefinitely.

---

## 2026-08-30 — Runner egress: refuse the capture, retry on a fresh runner

**Status: ACTIVE (#103, PR #111)**

**Decided.** A capture is **refused outright** when a compared provider's read faults, and a
failed cohort re-runs as a separate `retry` job on a **fresh runner**, with
`continue-on-error` output wiring so a rescued run finishes green.

**Why — the probe verdict.** An hourly probe over 2026-08-27..30 found the blackout follows
the **egress address**, not the hour: 3 of 12 rounds lost every Korean host (22:28, 08:15 and
06:29 KST) while Open-Meteo, Pirate Weather and WeatherAPI answered from the same VM in under
a second, and all 12 rounds drew a distinct address. **Moving the cron relocates the symptom.
Retrying inside the same run cannot work.**

**The trap that shaped the fix.** `saveCapture` is `on conflict do nothing`, so a naive
retry would have **skipped** the 97 already-written KMA-less rows and exited green. Refusing
the capture at write time is what makes the retry meaningful.

**Why `error` and `needs-config` are treated differently.** `error` is a fault. `needs-config`
is an honest absence — no runner will ever supply a missing key. Because captures are frozen
and immutable, one short a provider **by fault** is permanent and indistinguishable from an
honest one. This is precisely why the 18 KST cohort's KMA-less rows can never be repaired.

**Residual risk:** a double failure (both the run and its fresh-runner retry hitting a
blackout) at roughly 6%. One occurred on 2026-09-01 and reset #124's count.

---

## 2026-08-30 — A few refused captures are not a failed cohort

**Status: ACTIVE (#114)**

**Decided.** `cohortRunFailed` fails a run only past `CAPTURE_FAULT_TOLERANCE` of the cohort.

**Why.** Refusing is not the same as alerting. A refused capture stores **nothing**, so a few
of them are *missing* data rather than *wrong* data — and paging a human for missing data
that will re-accumulate in twelve hours trains the human to ignore the page.

**Observed working, 2026-09-01:** run `33455175089` inserted **93 of 97** captures, faulted 4,
and exited green with `catalogSource: "kma"`. Two surprises in that run worth carrying: the
fault was **Open-Meteo**, not KMA — egress blackouts are not the only way a read fails — and
scheduled runs pass `--cohort=""` because the cohort is derived from `--schedule`, so an empty
value in the log is correct, not a bug.

---

## 2026-08-31 — Lead time is measured and published, never filtered

**Status: ACTIVE, with the alternative DEFERRED (#118)**

**Decided.** `RecentPerformanceProfile.leadTime` reports the min/median/max whole-hour spread
inside a cohort, on the page. Captures are **not** grouped or filtered by it.

**Why the cohort label is not lead time.** The label names the **scheduled slot**, not the
hour a run actually started. GitHub schedules are best-effort and observed starts drift by
hours — the 06 cohort has spanned 06–14 KST, the 18 cohort 18–04.

**Why not filter.** Every provider inside one capture shares its lead time, so the drift is
**common-mode noise on both sides of a comparison, not bias**. And filtering the inverted rows
would have cost ~22% of the evening cohort immediately after ADR 0011 widened the window
precisely because samples were scarce.

**Deferred.** Revisit grouping once samples are plentiful.

**Operational rule that follows (conversation-only):** **never `workflow_dispatch`
`local-performance`.** The cohort comes from `--cohort`/`--schedule`, not the clock, so a
manual run stores captures labelled with a slot they were not taken in.
`manualCohortHourMismatch` now refuses the obvious case; the rule still stands.

---

## 2026-08-31 — `/behind-the-data` as a served route

**Status: ACTIVE (#112, PRs #113 / #120 / #128)**

**Decided.** Publish the scoring record as a page: what the benchmark has decided, on which
station's evidence, and the conditions under which the app stops trusting its own learning.
A server component reading the same `readDatabaseEvidence` the forecast uses. **The API
surface stays at two routes** — it does not add a third.

**Three honesty properties, each pinned by a test:**
1. Every mode the profile can hold has its **own sentence**.
2. Seed evidence is **never** reported as learned weighting.
3. The benchmark table states **the benchmark's verdict**, not what is being served.

**Process note worth keeping (conversation-only).** The spec came from a different session's
artifact and was **stale in seven ways** by the time it was built. Rendering it live caught
**three honesty defects in the copy itself** — a seed/learned conflation, a benchmark verdict
that reported the served state, and a count shown without its bar. *Build it and look at it;
do not review a spec against a spec.*

**Performance, #123 / PR #128.** Added a 10-minute process-local evidence cache
(`RECORD_EVIDENCE_TTL_MS`). **CONTRADICTORY implementation claim, corrected 2026-09-05:**
the key uses exact request coordinates + cohort, not matched station + cohort. The reported
warm-read improvement does not establish sharing between visitors matched to the same station.
Station-based sharing is approved follow-up work; cold instances still pay the database read.

**Related bug fixed in the same area:** `cachedFetch` ages on the **wall clock**. Deriving a
timestamp from `ageMs` minus an injected `now` is right only by accident; store the read time
*in the cached value*, and write the test with two clocks that disagree.

---

## 2026-08-31 — Absence of evidence is not evidence of poor performance

**Status: ACTIVE, implemented locally; zero-history correction pending merge (#122, PR #127)**

**Previous behaviour.** A provider short of `minimumSamples` was weighted at `weightFloor`
(5%) — that is, **demoted for accumulating evidence slowly** rather than for forecasting
badly.

**Why it mattered so much.** KMA lags by ~24% of captures **because it is the provider the
egress blackouts hit**. Around late September the page would have shown 기상청 at **5%
influence and called it measured performance** — and would have done so **unattended**, since
#89 had already closed the watch.

**The partial fix.** #127 uses the mean eligible raw score for ineligible providers present
in the profile metrics. **VERIFIED 2026-09-05:** a provider with zero history is absent from
those metrics; `influence.ts` still substitutes the floor for it in learned/ramping mode.
The associated test pins that demotion. The owner approved correcting this remaining path
without changing scoring thresholds or the benchmark policy.

**2026-09-05 correction (pending merge).** The shared serving/capture blend now gives a
missing weight the mean of scored weights among providers present in the forecast. This
normalizes to exactly 1/n for each zero-history provider and preserves scored-provider
weight ratios, including during outages. Regression tests cover learned/ramping profiles,
multiple missing histories, and probability/amount blending. Existing captures stay frozen.

**Why it existed at all.** The **seed** path already stated this rule for a provider with no
archive proxy. Only one of the two paths had it. A rule stated in one place and not the other
is the recurring failure shape in this codebase.

**STALE inference from the 2026-09-04 live check:** Visual Crossing's neutral 20% was observed
in seed mode. It did not verify the learned-mode fallback.

---

## 2026-08-31 — Worked-example chips in the chooser

**Status: ACTIVE (#121, PR #126)**

**Decided.** Add four worked examples to the location chooser, using **Kakao's own
representative points** (never hand-typed), with a test asserting every one falls inside the
generated service area.

**Why.** Kakao's search matches **Hangul only** — `?q=seoul` returns `[]` — and geolocation
outside the service area is refused. So a visitor with neither a Korean keyboard nor a Korean
IP got **two errors that pointed at each other**, and the live demo was unreachable for
exactly the audience the portfolio is for. Recorded as the highest-value change of that
review.

---

## 2026-08-31 — Visual Crossing as the fifth provider

**Status: ACTIVE (#110, PR #129); its quota watch is ABANDONED as impossible**

**Decided.** Append Visual Crossing. **Appended**, because provider order decides the
comparison primary and whose hourly series draws the ribbon — a new source is never inserted.

**Verified live before committing, not read off documentation:**
- a D+1 `precipprob` exists on the free tier;
- **`queryCost = 1`** for one forecast call however many days come back — the documentation's
  "cost 24" example is a *HISTORY* query, which is a different endpoint;
- days are capped at 8 so one source cannot own an outlook row.

**What could not be built.** No rate-limit headers, no usage endpoint
(`/rest/services/account`, `/account`, `/rest/services/usage` all 404). **Its ceiling is
unwatchable by that mechanism.** **CONTRADICTORY alert claim, corrected 2026-09-05:**
`service:health` requires four of five providers, so a Visual Crossing 429 alone does not
fail the check. The historical quota investigation does not establish a provider-specific alert.

**Not seedable** — history is billed per hour.

**The gap #130 partly fixed.** The secret was declared in repository settings but was not
passed to the job. #130 added the workflow reference and a static declaration test.
**VERIFIED 2026-09-05:** recent scheduled jobs still received an empty value and the
configured database contained no Visual Crossing captures. Presence of a secret entry and
passing the static test did not verify its runtime value. See the configuration decision below.

---

## 2026-08-31 — Release `v1.0.0`, and the tag defect it left

**Status: ACTIVE as a release; correcting its description and a new release are APPROVED**

**Decided.** Publish a `v1.0.0` release and a custom social preview (#125), marking the
transition to maintenance mode.

**The defect.** The release was attached to a **pre-existing** annotated tag reading *"SeoulSky
1.0.0"* on `89d3334` (2026-07-15) — the pre-rename tree with the scene and the radar, **221
commits behind `main`**. So the notes describe the August product while the source is July.
They also say "**four** weather services": the notes were published at 06:12Z and Visual
Crossing merged at 09:51Z the same day.

**Why no guard will catch this.** Tagging an old commit is invisible in-tree.

**Approved by the owner 2026-09-05.** Leave the tag, correct the notes, and cut `v1.1.0`
from verified `main` after the approved fixes and #124 acceptance. From then tag only
served-path feat/fix batches — never a Dependabot batch alone.

---

## 2026-08-31 — Credential stores swept, with one deliberate asymmetry

**Status: ACTIVE**

**Decided.** Remove dead credentials from every store: 10 from `.env.local` (which was still
the pre-rename *SeoulSky* file, documenting deleted modules — **rebuilt from `.env.example`
rather than pruned**), 4 from Vercel (`AIRKOREA_API_KEY`, `KMA_RADAR_API_KEY`,
`KMA_WARNING_API_KEY`, `MET_NO_USER_AGENT`), 0 from GitHub, which was already clean.
**Verified by redeploying**, rather than letting a future merge be the first test.

**The deliberate exception.** `KMA_APIHUB_KEY` and `KMA_OBSERVATION_API_KEY` were **left in
Vercel** even though they are not on the served path. They are read by live code, removing
them saves nothing, and the asymmetry favours leaving them. The owner agreed.

**Structural fact behind all of it:** production deployment secrets and Actions secrets are
**separate stores**. Deleting one cannot affect the other.

---

## 2026-09-05 — Clean-slate takeover and approved maintenance

**Status: ACTIVE — explicit owner approval in this conversation**

**Authority.** Current source/tests → current Git state/history → this ledger →
`docs/ROADMAP.md` → `docs/PROJECT_HANDOFF.md` → historical Claude material when needed.
The handoff and environment inventory are evidence, not inherited agent instructions.

**Configuration.** Track a minimal root `AGENTS.md` and the three corrected project docs.
Keep `CLAUDE_ENV_INVENTORY.md` local. Do not migrate Claude global instructions, skills,
MCP servers, hooks, subagents, or preferences without an explicit request. Propose persistent
configuration only for a repeated real limitation, choosing the smallest appropriate mechanism.

**Approved work.** Correct zero-history weights, station-based record caching, malformed
JSON handling, dev dependency vulnerabilities, and missing Visual Crossing captures.
For GPS visitors, link the scoring record through the matched observation station;
searched-area coordinates remain shareable. Activate ADR 0005 distance wording, require CI
on `main` before patch/minor Dependabot auto-merge, and keep majors manual. Preserve the old
release tag and publish the next release only after the fixes and #124 acceptance. Retain
`reliability-state` and its deployment guard. Defer new providers, scoring-policy changes,
and component/CSS refactoring.

**Document scope.** Update this ledger for significant decisions, ROADMAP for material
roadmap changes, and PROJECT_HANDOFF only for high-level state or architecture changes.
Routine implementation details do not belong in these documents.

### Automated capture requires all compared providers to be configured

**Why.** Two recent scheduled logs passed an empty Visual Crossing credential while reporting
successful captures. The local key returned a valid next-day forecast; the Actions secret was
repaired from it on 2026-09-05. New scheduled evidence must confirm recovery.

**Decided.** Both workflow attempts use `--require-all-providers`. The CLI checks missing
configuration through the same provider registry used for serving and capture, before database
initialization or provider requests. Missing configuration fails immediately and reports variable
names only. Local partial capture remains available without the flag, and keyless serving is
unchanged. Frozen historical captures are never repaired with later forecasts.

---

## Ongoing — Two dependency majors are held until compatibility changes

**Status: ACTIVE (recorded in `.github/dependabot.yml`)**

- **`typescript >= 7`** — `@typescript-eslint` peers `<6.1.0`.
- **`eslint >= 10`** — `eslint-config-next` bundles an `eslint-plugin-react` that calls the
  removed `context.getFilename()`, which makes `npm run lint` **abort before reporting a
  single result**.

A historical jsdom dist-tag discrepancy was conversation-only. These are compatibility holds,
not permanent bans; current package metadata and repository checks decide when they can move.

---

## Decisions taken by declining — the standing rejections

Each was proposed, considered against the actual product, and turned down. They are recorded
so they are not re-proposed as if new.

| Proposal | Why it was declined |
| --- | --- |
| **English UI / i18n** | Biggest cost, least product value — the README captions already translate the interface for an evaluator. The product is for Korean users. |
| **Shortening the README** | Its density serves the engineer who decides. |
| **Splitting `LocalForecastExperience.tsx`** | 1,801 lines, judged and **deferred**: it serves the reviewer, not the product. Do it only if the code should read as well as the docs do. |
| **Adding `server-only`** to the service-area module | A new dependency for a guard the tests already provide (ADR 0006). |
| **Reviving the radar / the cinematic scene** | Removed with an ADR behind it. |
| **Any new product scope** | `CLAUDE.md` states the rule directly; the project is in maintenance mode. |
| **Bucket-midpoint amounts for KMA** | The buckets appear precisely on heavy-rain days. |
| **AWS observation network** | 0.5 mm gauge resolution decides the 0.1 mm call it is asked for. |
| **MET Norway** | No `probability_of_precipitation` for Korea. |
| **Coach marks / guided tours / numbered chapters** | ADR 0010. |
| **Quartile or percentile wording for amount spread** | Dishonest at n ≤ 4; named min/max instead. |
| **Silencing the run-failure alert** | The failed step, its warning, and the retry job's presence are what keep a blackout visible. |
| **Adding a `LICENSE`** to clear the Scorecard alert | Deliberately all-rights-reserved; see 2026-07-31. |

---

## Open, unresolved, or unproven

| Item | Status | Note |
| --- | --- | --- |
| The seed → live handover | **EXPERIMENTAL** | Never executed on real data. Projected ~2026-09-22; #89 closed on the *fix*, not the event, so nobody is watching. |
| Provider behaviour at the handover | **UNKNOWN** | History and wet/dry coverage vary by station/cohort. Two eligible providers are sufficient; KMA is not a global gate. The zero-history fallback fix is approved. |
| Which weight projection is correct | **UNKNOWN** | Water-filling survives by inheritance. ADR 0004's 78% / 0.167 measurement is the only account of what is at stake. |
| Does the blend beat the best single provider? | **UNKNOWN** | The published position is "not yet". A live read on 2026-09-04 had adaptive **and** equal at Brier 0.197, both better than Open-Meteo alone at 0.233 — over 10 comparisons, so noise, but the opposite of what the README and release note say. |
| Grouping captures by measured lead time | **DEFERRED** | #118. |
| Eligibility counts cumulatively; the benchmark counts within the window | **UNKNOWN** | A latent asymmetry: a provider can be eligible on lifetime count while its Brier rests on very few recent comparisons. Scoring policy, so it sits behind the ADR gate. |
| `v1.1.0` and the tagging policy | **APPROVED** | Await fixes and #124 acceptance; retain the existing tag. |
| Retaining the `reliability-state` branch | **ACTIVE** | Owner approved retaining the archive and deployment guard. |
| The ADR 0005 `proximity` dimension | **APPROVED** | Wording only; implementation queued. |
| Dependabot auto-merge on patch/minor updates | **APPROVED** | Require passing CI first; major upgrades stay manual. |
| data.go.kr key 활용기간 expiry | **Human-only** | A lapse fails the daily run loudly, so it is caught — but it is the one calendar item worth setting. |
