# 0011 — Widen the operating window past the sample bar

- Status: accepted
- Date: 2026-08-30
- Supersedes: nothing. Amends the `windowDays` value set with the pipeline.

## Context

`DEFAULT_PERFORMANCE_POLICY` paired `windowDays: 30` with `minimumSamples: 30`. Two
different gates read those numbers:

- a provider becomes **eligible** on a cumulative count of completed comparisons,
  with no age filter;
- the **prospective benchmark** counts only comparisons inside `windowDays`, and
  suspends the adaptive blend when it has fewer than `minimumSamples`.

A cohort completes at most one comparison per station per day. So the benchmark's
bar, as configured, was not "30 comparisons" — it was "30 of the last 30 days",
a flawless month. Any single missed day put it out of reach for another thirty:
a KMA outage, a day ASOS never compiled, or a runner that could not reach Korea
at all (#103, whose blackouts ran at roughly one run in four).

Measured on the live database on 2026-08-30, station 108 was seven comparisons
into cohort 06 and would cross the cumulative bar around 2026-09-22. Running
`buildRecentPerformanceProfile` against synthetic histories showed what would
happen on that day:

| history | cumulative | in-window | mode |
| --- | --- | --- | --- |
| 30 of the last 30 days | 30 | 30 | `ramping` |
| 34 spread over 45 days | 34 | 23 | `suspended` |
| 30 spread over 60 days | 30 | 15 | `suspended` |

The middle row is the finding: *more* total evidence than the perfect month, and
still suspended. Crossing the cumulative bar with a gappy history moves a station
out of `seed` — where seed evidence is influencing the blend — into `suspended`,
where nothing is. The handover's only observable effect would have been to remove
influence the page already had.

## Decision

`windowDays` becomes **60**. `minimumSamples` stays **30**.

## Why this does not weaken the benchmark

Recency is enforced by `halfLifeDays: 14`, and the benchmark applies that weight
to every comparison it scores. A 60-day-old comparison carries `2^(-60/14)` ≈ **5%**
of a fresh one's weight, so widening the window barely moves a Brier score; what
it moves is whether the benchmark can be computed at all. The guard itself is
unchanged in strength: still 30 comparisons, still a suspension when the adaptive
blend scores worse than equal weighting.

The alternative — lowering `minimumSamples` — was rejected. That number is the
benchmark's statistical footing, and there is no evidence the footing is wrong.
The window was the part doing work it was never meant to do.

## Consequences

- The two numbers now differ, which is itself the fix for the ambiguity that
  produced #89: while both were 30, no reader could tell the count from the span.
  A test keeps them unequal.
- Published prose moves with the policy: the operating window is stated as 60 days
  in `README.md` and `docs/weather-sources.md`, and the served page's evidence card
  and score table now read 최근 60일 and 60일 Brier. A pin in `documentedPolicy.test.ts`
  fails the suite if the code and the prose drift apart again.
- Provider metrics computed over the window — Brier, misses, false alarms, rainy-day
  amount MAE — now draw on up to twice as many days. The seven-day slice is untouched.
- This does not make the handover happen; it makes it possible. #103's blackout rate
  still governs how quickly comparisons accumulate.
