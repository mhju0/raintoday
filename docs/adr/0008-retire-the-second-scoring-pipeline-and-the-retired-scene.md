---
status: accepted
---

# Delete the retired scene, the radar stack, and the second scoring pipeline

오늘비 carried three subsystems that no served route reached, each retained by its own
deliberate decision.

- **The retired cinematic scene.** `components/atmosphere/`, `components/three/`,
  `lib/atmosphere/`, `lib/cinematic/` and the panels and helpers that fed them. The
  redesign unrouted the scene, retiring `/api/sky` and `/api/weather` (#71) took away its
  data, and archiving the 37 still plates took away its images. What was left fetched
  paths that 404 and read a manifest that is not in the repository.
- **The radar stack.** `lib/radar/` and `app/api/radar/*`. #69 weighed deleting these
  against keeping them unrouted and chose to keep them: the radar was the one piece of the
  retired stack with arguable standalone value, and it was expected back in the product.
  Its only caller was `RadarSection`, inside the unrouted tree above.
- **The scheduled reliability pipeline.** `lib/reliability/`, its two CLI entry points and
  its daily workflow. It scored one station with an online Hedge update and published to
  the public `reliability-state` branch.
  [ADR 0007](./0007-keep-the-unread-reliability-pipeline.md) kept it running because it
  had just converged, and set a revisit date rather than deleting a live experiment.

Each decision was defensible on its own. Their sum was a repository of 246 tracked files in
which a reader met two precipitation-scoring pipelines, two weight-projection policies, a
WebGL weather scene and a radar renderer, with no way to tell from the source which of them
a visitor sees. None of them. Deleting the three, together with the code and configuration
only they reached, removes 109 of those files.

## Decision

**Delete all three.** The tree keeps only what a served route, a scheduled capture, or a
maintenance script reaches. This supersedes ADR 0007 and the operative half of
[ADR 0004](./0004-two-precipitation-scoring-pipelines.md), and reverses the disposition
#69 recorded for the radar.

## Considered options

- **Keep everything and document harder.** This is what ADR 0007 chose, and its reasoning
  was right at the time: the comprehension cost of an unread module is answered with prose,
  and Actions minutes on a public repo are free. It stops working once three subsystems are
  each individually justified and collectively the majority of the source.
- **Delete the scene and the radar, keep the pipeline until 2026-10-01.** The narrowest
  change consistent with the existing records. Rejected because the pipeline is the piece
  whose retention is hardest for a reader to hold, not the easiest: an unrouted scene is
  obviously inert, whereas a second scoring pipeline running daily on the same cron reads
  as a system the product depends on.
- **Delete all three.** Chosen.

## Why now, and not at the revisit ADR 0007 set

ADR 0007 named two questions for the revisit: whether the served pipeline had left seed
mode, and whether the two pipelines' learned orderings agreed. **Neither has been
answered, and this record does not pretend otherwise.** The served pipeline is still on
seed evidence, so it still has no learned ordering to compare.

Three things changed the shape of the question instead of answering it.

- **The comparison was always a single shot, and its two branches were not symmetric.**
  ADR 0007 wrote that agreement would mean the experiment "has told us what it can and can
  retire," while disagreement would be evidence about the projection policy. Deleting now
  takes the agreement branch by default and forfeits the other. That is a real cost and it
  is recorded below, not argued away.
- **ADR 0007's own amendment found the revisit lands on a moving target.** The flip that
  would give the served pipeline a learned ordering is the same flip that supersedes seed
  influence entirely. The revisit was scheduled for the moment the "unread" question
  changes shape, not for a moment after it settles.
- **The two pipelines were never comparable at the top of their orderings.** ADR 0007's
  headline result — MET Norway pinned at the 0.6 cap — was reachable only because
  `lib/reliability/forecastLog.ts` logged a probability that could be null and `score.ts`
  skipped a day only when both probability and amount were absent, so a provider that
  publishes an amount and no probability was scored on the amount alone.
  `lib/performance/capture.ts` requires a next-day probability and dropped every MET Norway
  forecast it ever saw, and #96 then removed the provider from the forecast path outright
  because of it. The served pipeline could not have learned the weight the experiment
  learned first, so the ordering comparison would have started by discarding its most
  separated term.

## What this costs

**A converged experiment is discarded mid-flight.** ADR 0007 recorded 111 scored events
over 32 dates with weights separated to both bounds. That was the first learned signal
either pipeline produced, and it is now the last that one will produce. The published
state stays on `reliability-state`, so those numbers remain readable; the accumulation
does not resume.

**The projection-policy comparison can now never be run.** ADR 0004 measured the two
`normalizeClamped` implementations disagreeing on about 78% of a 200,000-case sweep, with
a maximum single-weight difference of 0.167 — a policy difference, not floating-point
noise — and deliberately refused to pick between them on synthetic inputs. It wanted the
choice made on real outcomes. With one implementation gone there is nothing left to
compare, and no sweep can substitute, because the question was never whether both satisfy
the bounded simplex. Both did.

**So water-filling is the served projection policy by inheritance, not by contest.** It is
the only one left because the other pipeline was deleted for reasons that have nothing to
do with which policy is better. Nobody should later read its survival as a verdict. If the
question is ever reopened, ADR 0004's measurement — including the worked case where
water-filling returns `{0.6, 0.3, 0.05, 0.05}` and the fixed-point iteration returns
`{0.6, 0.133, 0.133, 0.133}`, levelling unscored sources up to a source that scored badly
— is the record of what is actually at stake, and it is still valid.

## What was kept, and why

- **`lib/reliability/score.ts` survives as `lib/performance/precipSkill.ts`**, with the
  three types it needs inlined. It is not kept for sentiment: it is served on every
  request. `lib/performance/seedScore.ts` imports `scoreSourceDay` from it, and while
  evidence is in seed mode that path is live rather than latent. ADR 0007 established this
  by walking imports after a directory-level grep had produced the opposite answer; the
  finding outlives the record that made it.
- **`PrecipProviderId` still includes `"met-norway"`.** Stored captures and seed rows carry
  it historically. Removing it from the union would make existing rows fail to parse to buy
  nothing, and `PERFORMANCE_PROVIDERS` already filters it at read time.
- **The `reliability-state` branch is not deleted.** See below.

## Consequences

- **Issue #88 is answered by this record.** It asked whether the unread pipeline keeps
  running. It does not.
- **ADR 0007 is superseded in full.** ADR 0004 is superseded in its operative half — the
  instruction to keep both implementations and gate consolidation. Its measurement section
  is not superseded and is the only surviving account of the difference between the two
  policies.
- **`lib/precipWeightContract.test.ts` is deleted.** ADR 0004 predicted exactly this: the
  test "would only become pointless if one implementation were deleted." Its subject was
  the divergence, and the divergence is gone from the tree. Nothing remains for it to pin.
- **Nothing writes to the public `reliability-state` branch any more.** Since #71 nothing
  read it; now nothing publishes to it either. The branch and its history stay on the
  remote so the converged state remains recoverable, but it is a frozen artefact rather
  than live storage. [ADR 0001](./0001-separate-reliability-state-from-release-history.md)
  is therefore inert rather than wrong: its separation still holds, and no cycle exercises
  it. Deleting the branch is a separate decision and is not taken here.
- **`lib/providers/registry.ts` exports one list.** The two-list split existed so
  `lib/reliability/` could score MET Norway on its own terms while the forecast path
  excluded it. With the second reader gone, nothing consumed the wider list, and the MET
  Norway provider module and its `MET_NO_USER_AGENT` credential lose their last reader with
  it.
- **`KMA_APIHUB_KEY` narrows to one purpose.** It served the raw radar reflectivity grids
  and the ASOS station catalog. Only the catalog is left, so a key that used to carry two
  unrelated responsibilities now carries one.
- **The radar does not come back for free.** #69 kept the stack because the radar was
  expected back in the product. Returning it is now a rebuild from git history rather than a
  re-route, and #69 already noted that re-routing it was the one option that adds product
  scope — which needs an explicit request, not a foregone conclusion.
