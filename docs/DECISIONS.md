# Decision ledger

September 6 operational follow-up: require all five providers for service-health's
all-clear, superseding the earlier four-provider threshold. A missing provider can
persist while the site serves a usable fallback. Deduplicated maintenance issues
track collection/health failures and stale schedules; weekly/monthly issues retain
manual account, backup, security and evidence checks. Transport diagnostics omit
URLs and retain known error causes. No retrospective forecast repair or unapproved
alternate data source is introduced. See [OPERATIONS.md](OPERATIONS.md).

September 6, 2026 maintenance update: #124 is closed; local/regional wording is
implemented for v1.1.0. The approved copy pass supersedes the earlier README-length
rejection. Security and recovery procedures are in [OPERATIONS.md](OPERATIONS.md).
Older dated measurements below describe their observation date, not current guarantees.

Compiled 2026-09-04; audited and updated 2026-09-05; open items refreshed 2026-09-28. Sources are ADRs, Git history,
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

**Status: ACTIVE, implemented for v1.1.0 (ADR 0005)**

**Decided.** Keep station eligibility at the existing threshold and let distance choose the
*language*: `local` at ≤25 km, `regional` at >25–100 km.

**Why.** In the measured sample of 36 administrative centres, the largest distance was
30.2 km. That sample did not justify tightening eligibility; it does not establish a
nationwide bound for every populated place.

**The near-miss worth remembering.** Area-weighted numbers nearly produced the opposite call.
**Weight by where people actually are**, not by area.

**Current state.** The forecast projection and record page use the unrounded distance
to select local or regional wording. Station-only links omit visitor-distance claims.
The policy and 25 km wording boundary live in `lib/performance/stations.ts`.

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

**Status: ACTIVE in part (ADR 0010, #109); the fold was removed on 2026-10-13, see that entry**

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
failed cohort re-runs on a **fresh runner**, with `continue-on-error` output wiring so a
rescued run finishes green.

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

**2026-09-14 recovery amendment (run #64).** The two-attempt workflow spent about 19
minutes on each runner before both failed, while the following scheduled run recovered on
its retry. Collection now makes at most three sequential fresh-runner attempts. Before
`npm ci`, each runner uses Node's built-in `fetch` to make two credential-free, 10-second
requests to the exact ASOS endpoint with redirects disabled. Any HTTP response, including
401, proves transport and cancels the unused body; two transport failures discard the
runner before database or provider activity. Checkout, setup, preflight, install and
collector steps have individual timeouts below a larger job budget, leaving ordinary
failures eligible for recovery by the next runner. For a completed, non-cancelled graph,
the final verdict fails unless a collector step actually succeeded. Cancellation stops
the chain.

**Residual risk.** The preflight covers one KMA ASOS transport path only. It does not test
credentials, database access, other providers or later availability, and three runners can
still share a correlated outage. Run #64 recorded only the retry's egress address, so it
does not prove that the two failed attempts had distinct addresses. Missing cohorts remain
missing; the recovery never rewrites immutable captures. GitHub retains `cancelled` after a
hard job or runner timeout even if a later collector succeeds, so the larger job timeout is
only a last bound, not a recoverable failure path.

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

**Why not filter.** Every provider inside one capture shares its collection time, but
different provider update schedules and forecast horizons can still affect comparisons.
Filtering the inverted rows
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

**Status: ACTIVE, implemented in #127 and #136 (#122)**

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

**2026-09-05 correction (#136).** The shared serving/capture blend now gives a
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
| **Shortening the README** | Superseded by the owner-approved September 6 public-copy pass. |
| **Splitting `LocalForecastExperience.tsx`** | 1,815 lines, judged and **deferred**: it serves the reviewer, not the product. Do it only if the code should read as well as the docs do. |
| **Adding `server-only`** to the service-area module | A new dependency for a guard the tests already provide (ADR 0006). |
| **Reviving the radar / the cinematic scene** | Removed with an ADR behind it. |
| **Any new product scope** | `CLAUDE.md` states the rule directly; the project is in maintenance mode. |
| **Bucket-midpoint amounts for KMA** | The buckets appear precisely on heavy-rain days. |
| **AWS observation network** | 0.5 mm gauge resolution decides the 0.1 mm call it is asked for. |
| **MET Norway** | No `probability_of_precipitation` for Korea. |
| **Coach marks / guided tours / numbered chapters** | ADR 0010. |
| **Quartile or percentile wording for amount spread** | Dishonest at n ≤ 4; named min/max instead. |
| **Silencing the run-failure alert** | The failed step, its warning, and the retry job's presence are what keep an outage visible. |
| **Adding a `LICENSE`** to clear the Scorecard alert | Deliberately all-rights-reserved; see 2026-07-31. |

---

## Open, unresolved, or unproven

| Item | Status | Note |
| --- | --- | --- |
| The seed → live handover | **ACTIVE (observed once)** | First seen 2026-09-26 and recorded on #140 on 2026-09-28: station 108 cohort 06 is `ramping` on a passing 34-sample benchmark, adaptive = equal (0.0525). Cohort 18 was still `seed` at 28 of 30. Other stations and cohorts are unobserved. |
| Provider behaviour at the handover | **UNKNOWN** | History and wet/dry coverage vary by station/cohort. Two eligible providers are sufficient; KMA is not a global gate. The zero-history fallback fix is approved. |
| Which weight projection is correct | **UNKNOWN** | Water-filling survives by inheritance. ADR 0004's 78% / 0.167 measurement is the only account of what is at stake. |
| Does the blend beat the best single provider? | **UNKNOWN** | The published position is "not yet". Station 108 cohort 06 on 2026-09-27: adaptive = equal at Brier 0.0525 over 34 comparisons, slightly better than Open-Meteo alone (0.0548) and well ahead of KMA alone (0.109). One station, one cohort, a mostly dry month: not a claim. (2026-09-04: both 0.197 against Open-Meteo 0.233 over 10.) |
| Grouping captures by measured lead time | **DEFERRED** | #118. |
| Eligibility counts cumulatively; the benchmark counts within the window | **UNKNOWN** | A latent asymmetry: a provider can be eligible on lifetime count while its Brier rests on very few recent comparisons. Scoring policy, so it sits behind the ADR gate. |
| `v1.1.0` and the tagging policy | **DONE** | v1.1.0 released September 6. Since 2026-09-26 every merged change ships as a release; see below. v1.0.0 retained. |
| Retaining the `reliability-state` branch | **ACTIVE** | Owner approved retaining the archive and deployment guard. |
| The ADR 0005 `proximity` dimension | **ACTIVE** | Wording only; shipped in v1.1.0. |
| Dependabot auto-merge on patch/minor updates | **ACTIVE, narrowed** | Since #165 (2026-09-18) Dependabot opens security-fix PRs only; patch/minor ones may auto-merge after required CI, majors stay manual. |
| data.go.kr key 활용기간 expiry | **ACTIVE (#152)** | End dates in `CREDENTIAL_EXPIRIES`; the maintenance workflow opens a renewal issue at 30 days and escalates at 7. Renewal itself is human-only. |

---

## 2026-09-15 — Recover partial collection before discarding a reachable runner

**Status: ACTIVE**

Collection run `34910557704` proved a case the initial transport check cannot cover:
a runner passed the check, lost early requests, then successfully collected later
stations. Its 20 failed observations and 28 refused captures were never revisited.
The other two runners could not reach ASOS at all.

A batch may make one additional pass over eligible failed phases after the provider
failure-cache cooldown. Each failure requires later progress in the same phase during the first
pass. An entirely failed forecast phase does not get another nationwide pass merely
because observations worked. Retry only explicitly retryable observation transport
failures and refused provider-fault captures; never retry ambiguous database writes
or convert an error to a dry observation. Successful and absent observations and
inserted, existing or skipped captures keep their first outcomes. The retry retains
cohort, target dates, batch time, concurrency bounds and immutable store operations.
Final failure counts describe unresolved outcomes; recovered counts remain visible.

The served-health checker also confirms one semantically incomplete HTTP-200 forecast
after the same cooldown. An HTTP success is not sufficient: all five expected provider
IDs and a usable probability must be present. A persistent gap remains red. This is
bounded confirmation, not a lower health threshold or a cache bypass.

A credential-free diagnostic on three GitHub runners returned ASOS HTTP 401 from both
Node 24 and IPv4 curl in all paired probes. No IP-family or runner-platform change is
supported by those samples. These changes handle reproduced recovery gaps; they do
not establish or repair the external network's root cause, and they do not backfill
missed historical captures.

---

## 2026-09-18 — Dependabot opens security fixes only

**Status: ACTIVE (#165)**

Routine version PRs were churn for a maintenance-mode project. `open-pull-requests-limit: 0`
stops them; security updates are enabled separately and still arrive as PRs. Routine
upgrades are reviewed by hand when a fix or support deadline calls for one.

---

## 2026-09-19 → 09-23 — Space retries in time, and establish an outage once

**Status: ACTIVE (#169, #177). The breaker is EXPERIMENTAL until a real outage exercises it (#175).**

Three fresh runners inside 83 seconds were one sample of a flapping route (#169), so
attempts target 0, 10, 25, 40 and 55 minutes from the first. The September 22 reading
of ~1,140-second failures as a long egress blackout was wrong: that was the cost of
walking 97 failing stations. #177 abandons a source after 12 consecutive transport
failures with no success in the pass, reports abandoned work separately, and fails
the cohort. Captures stay immutable and missed cohorts are never backfilled.

---

## 2026-09-26 — 2.0.0, and a release for every merged change

**Status: ACTIVE (`AGENTS.md` → Releases)**

2.0.0 marks 오늘비 as SeoulSky's successor without new product scope. From then on every
merged change ships as a release: patch for fixes, copy, layout, docs and operations;
minor for a new or clearly changed capability; major only by owner decision. Tag only
after production serves the merge commit and CI on `main` passes. Git history was not
rewritten (no force-push); `.mailmap` maps both author identities to Michael Ju.

---

## 2026-09-26 — A plain headline, and an umbrella line about the rest of today

**Status: ACTIVE (2.0.2, 2.1.0)**

The headline states the rain window in plain words from the named hourly provider.
"앞으로 N시간" appears only for a fully published, contiguous series (audit 002 #12).
The umbrella line answers for now until midnight KST: today's remaining blocks decide,
and a blended day total of 10 mm or more also counts before noon, because a day total
carries no timing. The noon cutoff is a rule of thumb, not a measured threshold.

---

## 2026-10-12 — Sharper weighting on recent accuracy: half-life 14 → 7 days, sharpness 12 → 24

**Status: ACTIVE (2.2.0)**

**Decided.** `halfLifeDays` becomes 7 and `scoreSharpness` becomes 24. The window, the
30-comparison bar, the 30-to-60 ramp, the 5–60% bounds and the prospective benchmark are
unchanged.

**Why.** The owner asked for a service that has been right recently to carry more of
tomorrow's blend. Alternatives were replayed over the stored captures and observations
(all 97 stations, target dates through 2026-10-10), rebuilding weights from what was
known at each capture and scoring the blend against the observation. With a 10-comparison
bar (6,391 forecasts, 39 dates) the previous setting beat equal weighting by 1.8% in mean
Brier and this one by 2.1%; with the production 30-comparison bar (2,547 forecasts, 18
dates) the figures were 1.4% and 2.5%. Shorter memory alone changed almost nothing and
below about five days was worse. Sharpness did the work: on the longer replay 48 was no
better than 24 and 96 or more fell behind, and using only the last seven days was
unstable.

**Limits.** The differences between the good settings are within noise for this much
data, and only about 12% of the scored days were wet. The replay applied weights at full
strength: no ramp, no benchmark gate, no seed mode. The seed path shares
`scoreSharpness`, so seed weights sharpen too; that was not replayed, and every catalogued
station already has mature live evidence. The benchmark's own recency weighting now uses
the 7-day half-life. A provider at the 60% cap hands its surplus to the others, which can
lift an unmeasured provider slightly above its equal share; the three-provider test
fixture was softened so it still checks the uncapped rule.

---

## 2026-10-12 — Sharpness stays at 24 after replaying 28 to 48

**Status: ACTIVE (2.2.1, documentation only)**

**Decided.** The owner asked whether 48, or a value between 24 and 48, would be better.
It stays at 24.

**Why.** Three replays of the same stored history, differing in how many comparisons a
provider needs before it is weighted (10, 20 or 30), gave no consistent winner. Against
equal weighting, every value from 24 to 48 landed within 0.2 points of the others on the
two longer replays (39 and 28 dates). Only the 18-date replay with the production bar
rose steadily, from 2.5% at 24 to 3.1% at 48. By station, 48 beat 24 at 42 of 97 on the
longest replay and 58 of 97 on the shortest; regions flipped between replays.

**Finding worth keeping.** Weighting earns its gain on dry days. On days it rained, the
weighted blend was slightly worse than equal weighting at every setting (2.0% worse at
24 and 3.1% worse at 48 on the longest replay), and the gap widened with each step up.
Most days are dry, so a Brier-based weight favours providers that publish low numbers,
and those under-call rain. This is a replay result, not a production measurement.

**Also noted.** The ramp from equal to learned weights follows the eligible provider
with the fewest comparisons. The replay's 30-comparison variant treated a provider under
the bar as neutral and weighted the rest at full strength, so it overstates how far
production weights have moved: on October 12 Seoul's providers were all within a point
of 20%.

---

## 2026-10-12 — The evening collection fires early and waits for 18:10 KST

**Status: ACTIVE (2.2.2)**

**Decided.** The evening cron moves from 18:10 KST to 12:40 KST, and a `wait` job holds
the run until 18:10 before the first attempt. The group label, the target-day rule and
the morning cron are unchanged.

**Why.** GitHub created the evening run 4.4 to 9.2 hours after its cron on all 22 runs
from September 20 to October 11, and the delay grew over those weeks. A capture targets
the day after it is taken, so a run that began after midnight forecast a day later than
one that began before it. Twelve of the nineteen evening captures since September 22
began after midnight: the group mixed lead times near 0 and near 24 hours, and each
crossing left one target date without an evening capture. The morning run was 2.0 to 4.5
hours late and never crossed a day boundary.

**Why this and not the alternatives.** Deriving the target day from the slot instead of
the clock would store forecasts for a day that had already begun. An external trigger
would need a new credential outside the repository. Waiting inside the run needs
neither, and the repository is public, so the idle runner time is not billed.

**Limits.** The wait absorbs 5.5 hours of delay; GitHub ends a hosted job at six. How
late GitHub starts a 12:40 KST cron is not yet measured: the October 13 run is the first
evidence. A start after 18:10 captures at once, and one after midnight behaves as before.
If the wait job fails, collection proceeds early instead of being lost. Stored evening
captures are immutable, so the mixed lead times stay in the record until they leave the
60-day window in mid-December.

**Also changed.** The collection monitor measures the 18-hour limit from when the last
run finished instead of when it was created, since the evening run is now created hours
before it captures. The Open-Meteo forecast read retries once on a failed connection or
a 429 or 5xx answer, inside the same 10-second budget; all 28 station faults in the
previous 14 runs were a single failed Open-Meteo read. Whether those were fast failures
or timeouts is not recorded, and a read that times out is not retried.

## 2026-10-12 — Visits are counted with Vercel Web Analytics

**Decision (owner).** The site counts visitors and page views with Vercel Web Analytics,
so the owner can see how many people arrive and from where (for example the Instagram
profile link). It loads in production only, from the site's own origin, so the content
security policy is unchanged.

**Boundary.** A shared forecast link carries `lat`, `lon` and `name` in its query. The
reported address is reduced to the path plus any `utm_*` tags (`lib/analyticsUrl.ts`),
so a chosen place does not reach the analytics store.

**Limits.** The project is on the Hobby plan: the UTM panel is locked behind Web
Analytics Plus, so Instagram traffic is read from the Referrers panel, which misses
visits whose referrer the in-app browser drops and cannot tell the profile link from
other Instagram links. "Unique" visitors are counted per day without a cookie.

## 2026-10-13 — The density toggle and the fold are removed

**Decision (owner).** The page always shows the comparison, the outlook and the record in
full. The 한눈에 ⇄ 전체 근거 button, the first-visit folded default, the three summary
stubs and the `raintoday.view-density.v1` preference are gone.

**Why.** In the full view the button read "한눈에 보기", which names a destination without
saying that it hides three sections; it was the only amber-bordered control beside the
headline, so a view preference outranked the forecast; and a first visit hid the
comparison and the record, the parts that distinguish the site.

**What stays from ADR 0010.** The claim kickers and the single receipts shelf. The verdict,
timeline and day cards are still first, so the page still opens at the answer. The pinned
mini-ribbon keeps its label, bars and summary.

**Cost.** Every first visit is now the long page, most noticeably on a phone. A value
left under the old storage key in a returning browser is ignored and not cleaned up.

## 2026-10-13 — The mini-ribbon shows only after the timeline scrolls away

**Status: SUPERSEDED in part** by the next entry: the mini-ribbon is removed. The analytics
rule (Vercel only) stands. Owner approved audit 008 findings 1 (option A), 2 and 3.

**Decision.** The pinned mini-ribbon is hidden at the top of the page and appears once the
timeline has scrolled off the top. It hangs from a zero-height sticky anchor, so showing it
moves nothing. Its rain-window bars are amber, as in the timeline. Analytics loads only
when the build runs on Vercel (`VERCEL=1`, read in `app/layout.tsx`).

**Why.** With the toggle gone, the bar at rest only repeated the headline above it and the
timeline below it. Amber already means the rain window everywhere else (ADR 0009). Off
Vercel the analytics script does not exist, so every page load logged two console errors.

**Cost.** For the height of the phone's pinned location strip, neither the timeline nor the
bar is visible while scrolling. With enlarged text, where the two pinned bars would exceed
30% of the screen, the bar stays hidden instead of scrolling with the page. If Vercel ever
stops exposing `VERCEL`, visits stop being counted without an error; check the Analytics
tab after any change to that setting.

## 2026-10-13 — The mini-ribbon is removed

**Status: ACTIVE.** Owner decision after seeing 2.2.6 live: nothing should float over the
page while scrolling.

**Decision.** The pinned 24H mini-ribbon is deleted, with its summary sentence, the rule
that stacked it under the phone's location strip, the enlarged-text rule and the scroll
observer. ADR 0009's "the graph is the navigation" (D-09) is retired. On phones the
location strip stays pinned; on wider screens nothing is pinned.

**Why.** The bar carried the density toggle and repeated the answer during scrolling. The
toggle is gone and the page opens at the answer, so a reader in the evidence has already
read it. It was also the most conditional layout on the page.

**Cost.** Deep in the page the rain answer is no longer visible, and there is no shortcut
back to the timeline; the reader scrolls up. No back-to-top link was added.

## 2026-10-13 — Server functions run in Seoul

**Status: ACTIVE.** Owner approved after a preview measurement.

**Decision.** `vercel.json` sets `regions` to `icn1`. Until now the functions ran in
Vercel's default, `iad1` (Washington DC), while visitors entered at Seoul.

**Why.** Measured from a browser in Korea on 2026-10-13, about 21:50 KST, eight cities
each. Forecast request, repeat reads: about 0.26 s from the Seoul preview against about
1.15 s from production; first reads about 1.2 s against 5–11 s. In the same minutes
production's blend held three providers, with Open-Meteo and KMA both absent, while the
Seoul preview held four or five, always including Open-Meteo.

**Cost and limits.** One evening's sample, not a trend; whether the missing providers on
the US route were a passing fault was not established. KMA was still absent for two of
four cities from Seoul. The Hobby plan allows one region, so there is no failover region.
The database stays in Singapore.

**Follow-up, same night.** KMA's absence was not caused by the region. From about 23:00 KST
KMA's 20:00 short-term issue answered `NO_DATA` for some requests and normally for others,
grid by grid and minute by minute, while the 17:00 issue answered normally every time
(called directly, outside Vercel). The provider treats `NO_DATA` as an empty, successful
read, so KMA drops out of that forecast and the empty read is cached for five minutes. No
fallback to an earlier issue existed that night; one was added on October 14 (entry
below).

## 2026-10-13 — Browser errors are reported to Sentry

**Status: ACTIVE.** Owner request: learn about a visitor's crash without the visitor
reporting it.

**Decision.** On `raintoday.vercel.app` only, an uncaught browser error or rejected
promise is sent to the owner's Sentry project `raintoday`. The SDK loads when the page is
idle; errors thrown before that are held and sent once it arrives. The page address and
referrer lose the chosen place (`scrubErrorReport`), user fields are dropped, and cookies,
request bodies and query parameters are not collected. No session recording, tracing or
breadcrumbs. The content security policy allows that one ingest origin.

**Why not the full Next.js SDK.** It adds to every page's first script and to the server's
start time, which this release cycle was reducing.

**Cost and limits.** Server-side errors are not reported; they remain in Vercel's logs.
Stack traces are minified, since no source maps are uploaded (that needs a secret token).
An error caught by a React error boundary is not seen. Browser extensions that block
Sentry suppress the report. The DSN is in the source: it is a public, write-only address.
Sentry receives the visitor's IP address in transit; storing it is a project setting.

## 2026-10-14 — An empty KMA issue is read from an earlier issue

**Observed.** On the night of October 13 KMA's newest 단기예보 issue answered `NO_DATA` for
most requests, hours after it was published. At 23:20 KST twenty requests for Seoul's 20:00
issue returned `NO_DATA` fourteen times, with 5 rows and with 1,000 rows requested; ten
requests for the 17:00 issue returned data every time. The forecast was served from four
providers for more than three hours and `service-health` failed.

The next morning it was worse. At 09:48 KST the 08:00 issue returned data 4 times in 12,
the 05:00 issue 0 times in 12, and the 02:00 issue and three older ones 12 times in 12. The
current-conditions endpoint answered every time. A first version of this change, which
stepped back one issue only, read 서울, 부산 and 제주 three times each and got a forecast
twice in nine.

**Decision.** When an issue returns no rows, the provider reads the one three hours
earlier, newest first, up to three earlier issues (nine hours). `NO_DATA` on all four
leaves KMA out of the forecast as before. Errors (authorization, rate limit, transport) are
unchanged and are not retried against an older issue.

**Why not retry the same issue.** The answer flips between consecutive requests, but most
fail; several retries would be needed for a reliable read and each one spends a request
against the daily allowance. An older issue answers every time.

**Cost.** A forecast read during such a spell uses a KMA forecast up to nine hours older
than the newest one, and nothing on the page says so. It costs up to three extra requests
per read, made one after another; the nine live reads below took about 1.2 s each. Captures
share the provider read, so a capture taken during a spell stores the older issue's
numbers.

**Also changed.** The newest issue is now chosen 70 minutes after its issue time at every
hour. Between 00:00 and 00:09 KST the old rule chose the 23:00 issue 60–69 minutes after
it, against its own margin.

**Checked.** With the change, 서울, 부산 and 제주 read three times each against KMA at about
09:55 KST returned a 24-hour forecast nine times in nine, each from the 02:00 issue after
two empty answers.

**Limits.** Why KMA answers this way is not known, nor whether it will last. If more than
three issues in a row are empty, KMA is still absent.

---

## 2026-10-21 — A stated chance should match how often it rains

**Status: ACTIVE (owner direction; no behaviour change yet)**

**Decided.** The owner wants 오늘비 to state rain plainly, without leaning toward rain to
avoid blame for a miss. The rule: when the page says a chance, it should rain about that
often. A missed rain matters more to a reader than an unneeded umbrella, but that is the
reader's call from an honest number, not a reason to inflate it. Changes to the blend are
judged on rainy and dry days separately as well as overall, and on calibration.

**Grading moment.** People check rain the evening before and the morning of the day they go
out. Accuracy should be graded on the forecasts available at those two moments. The 18
cohort is the evening-before forecast. The 06 cohort is taken the morning of the day before,
roughly a day and a half ahead, which is not a moment the owner optimises for. Nothing
captures the morning-of forecast, and today's umbrella line is not scored.

**Evidence read.** A read-only export on 2026-10-21 (10,373 captures, 97 stations, target
dates 2026-08-20..10-19, 24% wet):

- The served adaptive and equal blends differed by 0.1% in mean Brier; only 728 captures
  had a provider more than a point above an equal share.
- Both blends over-forecast mid-range chances: 30–50% was followed by rain about 21% of
  the time; above 70%, 85%.
- Recalibrating each provider and averaging made the blend timid: on the later half of the
  dates it missed 28% of rainy days at the 40% line, against 13% today. Rejected.
- Leaving KMA out of the blend improved rainy days in every two-week period and in both
  cohorts. On dry days it was neutral after 2026-09-05 but clearly worse from 08-20 to
  09-05, when the other providers averaged 43% on dry days and KMA 32%. Over the whole
  period it is a trade, not a free gain, and one season is not enough to drop it. Not acted on.

**Limits.** One late-summer and autumn season; little of 장마 is in the data. Daily
blends only.

---

## 2026-10-21 — The forecast people see at 07:00 is captured at 07:00

**Status: ACTIVE (2.3.0)**

**Decided.** A new `morning-forecast` workflow takes a Morning Capture for every station:
each compared provider's hourly rain chances from 07:00 to midnight KST on the same day,
frozen before any of it falls, in a new `performance_morning_captures` table. It fires at
01:30 KST and waits for 07:00, the evening trigger's method. Nothing is graded or shown yet.

**Why.** The owner wants accuracy graded at the moments people check: the evening before and
the morning of. The 18 cohort covers the evening. Nothing covered the morning, and today's
umbrella line has never been scored. GitHub cannot be trusted to start at 07:00: the 06:10
cron started 110–183 minutes late on every run from October 16 to 21, and the 06 cohort's
captures landed between 08:00 and 11:32. The evening trigger's early fire and wait has
landed at 18:10 KST on six of seven days since 2.2.2 and at 18:18 on the seventh.

**Why not an outside scheduler.** It would place a GitHub token with a third party and add
an account to watch, to fix a problem the early fire already fixes. If morning captures
start landing late, `captured_at` shows it and that choice can be revisited.

**Shape.**
- A separate table, not a third cohort. The cohort `check` constraint is never altered on an
  existing database, a cohort targets tomorrow, and this window must be graded against
  hourly rainfall rather than the day's total.
- Hours, not one number. A provider's window chance is its highest hour, matching how a
  daily chance is the day's highest, and the hours are kept so the umbrella line's own rule
  can be replayed later.
- Same refusal as a cohort: a provider read fault stores nothing for that station.
- No learned blend. Only the equal blend is frozen; learned weights apply to tomorrow only.
- A manual run is refused outside 07:00–08:59 KST without `--force`; a scheduled run that
  starts late still captures and keeps its real time.

**Still open.**
- Grading needs hourly ASOS rainfall. Approved and collected from 2.3.1; see the next entry.
- Pirate Weather is left out of the Morning Slot (owner, 2026-10-21). Its free 10,000 calls
  a month would not cover 291 a day plus visitors, and a 429 faults every capture. Morning
  Captures compare four providers; re-admitting Pirate Weather needs a paid tier.
- The 18 cohort counts as "the evening before" only from target date 2026-10-15; earlier
  evening captures were taken between 00:20 and 03:23 KST.

## 2026-10-21 — Hourly ASOS rainfall is collected for the morning window (2.3.1)

**Decision.** The morning run reads 기상청_지상(종관, ASOS) 시간자료 조회서비스 after every
station's Morning Capture and stores one row per station and KMA day in
`performance_hourly_observations`: 24 hours, each with its amount and KMA's `rnQcflg`.
It reads the two newest complete days, so one failed morning is filled in by the next.
Nothing grades against it yet.

**What the service actually serves**, measured 2026-10-21 on the owner's key:
- Rows are stamped by the hour they end. Grouping hours 01:00–24:00 matched the daily
  `sumRn` on 300 of 300 station-days (10 stations, 2026-09-20 to 10-19); grouping
  00:00–23:00 mismatched 23 times. A KMA day is therefore the `01:00` row through the next
  date's `00:00` row, and the 07:00–24:00 window is hours 8 to 24 of one day.
- It serves up to yesterday only (`resultCode 99`, "전날 자료까지 제공됩니다"). With the
  closing `00:00` row, a day is complete two calendar days after it.
- A blank `rn` is a dry hour. With no flag that is plain. With flag `9`, 12% of rows, it
  is also dry: on the 85 station-days containing flag-9 hours the hours still summed to the
  daily total, and of 447 flag-9 hours in five stations 441 fell outside every rain spell in
  that day's logged weather (`iscs`); the other six touched only the edge minutes of brief
  drizzle. `0.0` is a trace below the 0.1 mm threshold.

**Shape.**
- A blank hour under any other flag, and an hour with no row at all, is stored as unknown,
  never dry. Flags are kept so the flag-9 reading can be revisited.
- Captures run before any hourly read, so a slow ASOS cannot push a capture late. There is
  no ASOS preflight for the same reason; an ASOS failure fails the run, and the next
  attempt re-reads it (captures are first-write-wins, so the retry cannot change them).
- Re-reads replace a day, as daily observations do; KMA can revise QC after publishing.
- Same key as the daily observations; the subscription expires 2028-10-21 and is in
  `CREDENTIAL_EXPIRIES`.

**Still open.** Grading (part 3): map a provider hour starting at `HH:00` to the row ending
`HH+1:00`, decide how an unknown hour affects a dry verdict, exclude late captures, and grant
`raintoday_web` SELECT on both new tables before the scoring record reads them.

## 2026-10-28 — Agent handoff moves to private memory

**Decision.** The owner moved agent memory out of every repository. `docs/PROJECT_HANDOFF.md`
and the local Claude environment inventory now live in the private, git-ignored `.memory/`
folder shared by Claude Code and Codex, and `.memory/handoff.md` carries the current state
and next step. This ledger, the ADRs and `docs/ROADMAP.md` stay the public record; older
entries that name the handoff are left as written. Agents may merge their own PRs once
checks pass, under the owner's global rules, which the Releases section already assumes.
