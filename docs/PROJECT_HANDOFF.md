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
Reviewed Antislop reports belong in [audits/antislop](audits/antislop/).

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

### 2026-09-19 — collector retry spacing (#168, PR #169)

Changed: attempts 2 and 3 of `local-performance` now wait until 10 and 25 minutes
after collection began before probing, measured from attempt 1's published start so
a slow first failure cannot collapse the spacing. Each retry's job budget covers its
own wait (35 → 47 / 62 min). The transport preflight spreads up to four probes over
~90 s instead of two inside 20 s.

Why: run 35444845449 lost all three runners to the credential-free ASOS preflight
from three distinct egress addresses inside 83 seconds, while the endpoint answered
a local probe in ~50 ms. The recovery design assumed a blackout follows the egress
address (#103), so it varied the machine but not the moment. Runs 34910557704 and
35351001382 show the route flapping on a scale of tens of seconds, which no number
of back-to-back runners can survive. The #103 premise is qualified, not discarded:
it still holds for a sustained outage.

Deliberately unchanged: no missed cohort is rerun or relabelled, and no required-
provider or observation-failure rule is relaxed. A scheduled cohort is never refused
on the hour, so a later capture is still evidence for its slot, and a run whose route
is down for the whole spread still fails.

Open issues: #168 closes itself on the next successful monitored run — if it does not,
the flap is longer than 25 minutes and the offsets are the thing to revisit, not the
provider rules. #154 has an evidence pass recorded; its Vercel/Neon usage items need
account access. #146 and #140 stay open on their access- and time-blocked items.

Observed in passing: the Actions registry lists `network-diagnostic` and nine
`recovery-replay-*` workflows as active, but none of those files exist on `main`.
They are leftovers from deleted investigation branches and cannot fire. A future
audit counting live workflows should not be misled by them.

Next step: watch the 2026-09-19 21:10Z and 2026-09-20 09:10Z cohorts. The spacing
only proves itself on a run that actually meets a flap.

### 2026-09-22 — the collector's failures are three modes, not one (#170, PRs #171, #172)

Changed: `initialize`, `listStations` and `syncStations` now run inside the #167
connection-retry wrapper, and a fatal capture line is never blank. The
local-performance incident issue now records the stage each capture attempt died
at, written while the incident is open.

Why: run 35621896930 lost all three attempts in ~1.3 s each, printing one blank
line. Attempts 1 and 3 had cleared the KMA preflight — they died on `initialize()`,
the cohort's first database statement and the only one outside the #167 wrapper.
`Error.message` is `""` on an `AggregateError`, which is what Node raises when
every address refuses, so the log held no evidence but the preflight. That is how
#103, #168 and #169 were all aimed at the route while the database was failing.

Classifying 29 failures gives three modes, and they need different answers:

1. Preflight route flap — fast fail. #169's spacing is the response.
2. **Broad runner egress blackout — the preflight PASSES, then Open-Meteo, KMA
   and Visual Crossing all fail for ~19 min and 97/97 stations fault** (runs
   34034376096, 34724129443, 33517589359). Not a KMA problem. UNADDRESSED.
3. Silent cold-start database failure — fixed in #171.

Two traps for whoever reads a run next. Job conclusions are meaningless here:
`continue-on-error` makes a capture job report `success` when its capture failed,
and it masks the *step* conclusion too. Only `skipped` marks where a job stopped.

Open issues: mode 2 has no owner and no decision. The user asked for measurement
before any code: how often it hits, how long it lasts, whether it tracks the
runner's Azure region or egress address. Runs 34910557704 (332 s, 28/97 faulted)
and 35351001382 (a 93/97 cohort) suggest partial blackouts exist, so it is a
spectrum rather than a binary.

Also unfixed and now proven, not latent: `failureMessage` (lib/performance/batch.ts:89)
carries the same empty-AggregateError-message defect as the CLI did. Run
35351001382 failed a 93/97 cohort reporting `4 x observation: ` with no reason at
all. Fixing it properly means sharing `describePostgresError`'s guarded tree
walker — it redacts credentials, and observation URLs carry a KMA authKey — which
is a three-module change and was left for an explicit decision.

Next step: measure mode 2 before changing anything. The incident issue now
carries its own classification, so the next failure should not need re-derivation.

### 2026-09-22 — the batch's blank reasons, and the blackout measured (#174, #175)

Changed: the guarded error-tree walker moved to `lib/performance/errorDetail.ts`,
driver-free so the capture batch can share it. `failureMessage` in the batch was
still `error.message` and so still blank on an `AggregateError`: run 35351001382
stored 93 of 97 observations, inserted 93 captures, then failed the cohort on
`4 x observation: ` with no reason. Observations have zero fault tolerance.
Redaction now also covers query-parameter credentials, because KMA passes its key
in the query string and the walker is no longer reachable only from the adapter.

Measured the egress blackout across all 80 scheduled runs; recorded in #175.
The cause table there supersedes any earlier count. Two corrections worth keeping:

- The August cluster of ~1s failures was a missing `PERFORMANCE_DATABASE_URL`
  secret, **not** the #171 cold-start defect, despite an identical shape. Date
  proximity is not a cause.
- A capture taking ~1140 s is not by itself a blackout: successful cohorts also
  run that long when many provider reads retry. The blackout signature is
  97/97 faulted with every provider failing at once.

Blackout duration is bimodal. It either clears inside one capture budget — the
next attempt then succeeds in ~110 s, 4 for 4 — or it is still running at 37–38
minutes and the next attempt burns its budget too, 3 for 3. #169's spacing tops
out at +25 min, so it would not have rescued any of the three sustained cases.
No blackout since 09-13, so the spacing is untested against this mode, not proven.

Open issues: #175 needs a decision between accepting the blackout and combining
a fast abandon with a fourth attempt past 40 minutes. #146 and #140 stay blocked.

Next step: #175 is a decision, not an implementation task. Do not add retries to
`local-performance` before it is answered.

## 2026-09-23 — the collector's own cost was the recurring failure

Changed: `lib/performance/batch.ts` gains an outage breaker
(`OUTAGE_EVIDENCE_THRESHOLD = 12`). Once a source has failed that many
consecutive stations on transport with nothing having succeeded anywhere in the
pass, it stops being called; the remaining stations are counted as
`observationsAbandoned` / `capturesAbandoned` and `abandonedReason` is set.
`cohortRunFailed` fails on `abandonedReason` directly, because unattempted
stations are deliberately in neither the fault counts nor `failures` and a
stopped pass would otherwise read as a small green one.
`local-performance.yml` goes from three attempts to five, at 0/10/25/40/55
minutes.

Why: #175's measurement was read wrongly and the four options in it were all
built on that misreading. Five separate failed runs spent 1139, 1141, 1141,
1139 and 1141 seconds in their capture step. An outage does not land within two
seconds of itself five times — that number is ours. During a KMA outage a
station costs about 47s (three 15s ASOS attempts with backoff, then a 10s
provider timeout), and the batch walks all 97 at concurrency 4, so a failing
attempt costs ~1140s whatever the route is doing.

Three things follow, and each contradicts something recorded earlier:

- The "37–38 minute blackout" was two full walks, not a 38-minute outage.
  Nothing measured says the route was down past the first walk.
- #169's spacing never ran. It aims attempts at +0/+10/+25 min, but attempt 1
  does not *return* until +19, so the samples actually landed at 0/19/38.
- It was never an egress blackout. `pirate-weather` and `weather-api` never
  appear in those runs' failure lines — they succeeded for all 97 stations.
  Only `kma` (97/97) and `open-meteo` (~50%) failed.

Safety: the threshold is held above the cohort's fault tolerance
(`OUTAGE_SAFE_COHORT_LIMIT`, bound to `FALLBACK_STATION_CATALOG` in
`cli.test.ts`), so tripping is only possible in a run already destined to fail,
and one success anywhere clears the counter. The next attempt re-walks every
station, so a false trip costs one cheap attempt, never evidence. Measured at
the real 97-station shape and concurrency 4: 165s against 1334s.

Note the ordering trap: the breaker *alone* would have narrowed the sampling
window from the accidental 0/19/38 to 0/10/25. The extra attempts are not a
separate improvement, they are what keeps the reach.

Open: five attempts and the breaker are untested against a live outage — the
last one was 2026-09-13. #175 needs its analysis corrected; its four options are
superseded. Scorecard alert #28 (`LicenseID`) is still open on purpose and still
emails; it can be dismissed as "won't fix" whenever you want.

Next: watch the first red `local-performance` run for the new `OUTAGE:` line. If
it appears, the breaker worked and the question becomes whether 55 minutes is
far enough. If a run goes red *without* it, the cause is not the KMA route.
