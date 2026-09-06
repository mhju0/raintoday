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
