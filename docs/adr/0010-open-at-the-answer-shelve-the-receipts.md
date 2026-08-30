---
status: accepted
---

# Open at the answer, shelve the receipts

The chart-recorder redesign (ADR 0009) shipped and the owner's next review named its cost:
the page is dense, its seven strata share one ground, one spacing, one type scale, and a
first-time visitor cannot parse it in one pass. The owner's instinct was "more borders
perhaps". A two-track research pass answered that the diagnosis is right but the
prescription is the documented failure mode for dense pages — bordering every section
manufactures false floors and line noise — and that first-visit legibility comes from
answering three questions instead: what to read first, where stopping is allowed, and
whose number each element is. Five structure candidates and a final composite were built
on a live mock; the owner delegated the judgment, then approved the composite as **D-11**
in the design ledger. This ADR records what shipped and the rules that outlive it.

## Decision

- **A first visit opens at 한눈에.** An unset density preference resolves to the folded
  read — verdict, minibar, timeline, day cards — because that answers the question the
  page exists for. A stored choice, either way, is never overridden, and a forecast with
  no timeline never folds at all: the toggle lives in the minibar, the minibar needs a
  timeline, and a fold with no unfold control would be a locked door.
- **The fold leaves honest stubs, never nothing.** Each folded section keeps a one-line
  summary row carrying that section's own numbers — the influence card's header spread,
  the outlook's standing rule, the evidence status label — and tapping a stub unfolds the
  real section and remembers the choice exactly as the toggle would. A stub never carries
  a figure computed for the stub.
- **Every stratum opens with a claim kicker** — a hairline rule and a mono label naming
  whose number it carries: 결론, 오늘 · 내일 — 여러 서비스를 섞은 하루 숫자, 근거, 기록.
  This moves the ribbon-vs-blend attribution invariant to the reader's first contact with
  each element instead of a footer sentence. The kickers carry no numerals: numbering a
  dashboard reads as a mandatory sequence.
- **The receipts sit on one quiet shelf.** The evidence cards and the record section — 
  exactly what the density toggle governs, nothing more — share one raised surface with a
  single hairline frame. Cards inside trade their own borders for the next rung of the
  surface ladder, so macro-distinction rises while total line count falls. Every
  separator introduced by this pass is achromatic: blue, teal, and amber keep their
  monopoly on meaning.
- **The folded toggle names its cargo** ("전체 근거 보기 · 비교 + 기록") so the invitation
  says what it hides; a phone shows the invitation alone.

## What the approved mock proposed that the page already had

Two pieces of the approved composite were audited out at implementation, recorded here so
the deviation is deliberate rather than drift. The mock's legend line existed to decode
the hatch and the blue; the shipped page already direct-labels both ("미발표" and a dash
in the empty blocks themselves, the ribbon heading naming 강수확률) and direct labels beat
legends — adding one would have been the redundancy this pass exists to remove. The
mock's weight gradient was likewise already present in the shipped type scale (display
verdict, 1.45rem record heading).

## Considered options

- **Bezels around every section** (the border instinct, built as candidate B1): rejected —
  boxes-in-boxes read as noise and closed frames invite the first scroll to stop early.
- **Numbered chapters** (B2): rejected for the numerals, kept for the labels.
- **A first-run tour or coach marks**: rejected on the research record — instructional
  overlays are dismissed blindly and make the same page feel harder.
- **Tinting the day cards into the receipts zone**: rejected — the day cards are part of
  the answer (한눈에 keeps them), and the shelf must equal the fold or the two teach
  different boundaries.

## Consequences

- The one-flat-ground rule is amended, not repealed: the answer keeps the flat ground,
  and the receipts shelf is the single sanctioned surface change.
- The first-visit default is a behavior change; returning visitors with a stored density
  choice see exactly what they chose.
- The stubs join 위치 바꾸기, the density toggle, and the scrub lens as the page's only
  interactive controls, and their honesty rule is load-bearing: a stub that invents its
  own figure would be a new claim wearing a summary's clothes.
