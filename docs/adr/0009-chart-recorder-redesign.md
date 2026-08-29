---
status: accepted
---

# Redesign the page around the chart-recorder timeline

The 2026-08 design pass began from the owner's brief: the shipped time-slot probability
graph is the page's foundation and must not be displaced; the look stays graph/data/grid;
and the amount of rain must be visible beside the probability, because 90% × 1mm and
50% × 20mm are different mornings. A two-round exploration (five shell directions and 29
component options in round one; five probability×amount timeline renderings, a two-day
honesty test, and three full composites in round two) ended in an approved composite the
pass called **차트 리코더** — the chart recorder. The owner's decisions are recorded
decision-by-decision, with the rejected alternatives and their reasons, in a private
design ledger; this ADR records what shipped and the rules that outlive the pass.

## Decision

The four screens are rebuilt around the existing ribbon rather than around any new hero:

- **The dual-band timeline.** The probability bars stay as shipped; a second lane docks
  under the shared time axis carrying each block's own precipitation amount — the same
  provider's hourly amounts summed per block, on the lane's own mm scale. A block whose
  hours publish no amount is a hatched gap, never 0; a published 0 keeps a real tick.
- **The verdict sentence carries the window's own total** ("— 모두 7.7mm"): the run's sum
  from the ribbon's provider, shown only when the series saw the rain stop and every block
  in the run published an amount. An open run or a partial sum would claim a total the
  data never stated.
- **The graph is the navigation.** A sparkline miniature of the ribbon pins to the top
  while the page scrolls — same data, same hatched gaps — with the run's numbers beside it
  and the **한눈에 ⇄ 전체 근거** density toggle riding in the bar. 한눈에 folds the
  influence card, the outlook, and the evidence section to a one-screen read; the choice
  persists per device in `localStorage`.
- **The day cards make the amount co-equal.** The mm figure sits beside the probability at
  matching weight, carrying its own provider count. Tomorrow's card attributes its spread
  to the members that said it — 많으면/적으면 with provider names.
- **Two motions, no more.** Arrival: the timeline prints left→right once, in block steps,
  by clip-path — no value ever tweens through a number the data never stated. Reading: a
  scrub lens (pointer or arrow keys) reads out one block's range, wet state, probability
  and amount — every figure already printed in the column beneath it. Both respect
  `prefers-reduced-motion`.
- **A third meaning-colour.** The palette's rule grows from two colours to three: blue is
  the chance of rain, water-teal is the amount, amber is the rain window. Nothing else on
  the four screens carries colour.
- **The chooser and the wait wear the empty instrument** — the timeline's frame drawn with
  gridlines and no data, pulsing as one whole while loading. The response arrives once, so
  the frame waiting is the only honest animation; per-provider progress remains banned.

## Standing design rules this pass adds

- Probability and amount may share the **time** axis, never a **value** axis. No quantity
  is ever rescaled onto another's scale.
- Three-hour data renders as steps and blocks, never smoothed splines.
- Amount spreads are attributed member min/max. No quartiles, no percentile wording, at
  the n ≤ 4 this product compares.

## Considered options

The pass evaluated and set aside, with reasons kept in the ledger: a big-type billboard
hero (owner rejected: the graph leads); a light editorial front page; verdict-coloured
staged grounds (would reverse the meaning-colour discipline); scrollytelling (punishes the
daily check); a dot-matrix rendering of the probability band (parked as a swappable
alternate — only the band's rendering differs); a four-provider quilt timeline (parked:
requires reading all providers' hourly series per block, a separate pipeline decision);
a 48-hour meteogram (a candidate for the 전체 근거 expanded view); and a jittering gauge
(rejected on the uncertainty-visualization literature: wobble reads as volatility, zone
edges manufacture cliff effects).

## Consequences

Open-Meteo's hourly request adds the `precipitation` field, and `HourlyForecast` carries
an optional per-hour amount that other providers may omit — the lane simply does not
render where none is published. The view model exposes the per-block sums, the run total,
and the attributed tomorrow amount range. The page gains its first persistent preference
(`raintoday.view-density.v1`) and its first non-navigation controls beyond 위치 바꾸기:
the density toggle and the scrub lens. The repository guidance and the README's screen
captions change with the page, and the screenshots are regenerated.
