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
