# Roadmap

Updated 2026-10-12. The project is in maintenance mode: correctness, security,
provider compatibility and service operation. New product scope requires an owner decision.
Source/tests and Git take precedence over this document.

## Releases

2.0.0 marks 오늘비 as the successor to SeoulSky (v1.0.0). It adds no new product scope:
it follows v1.1.0 with the September 26 audit fixes, accessibility work, the type-scale pass
and the shorter README. The v1.0.0 tag remains unchanged on the SeoulSky source.

Since then every merged change ships as its own release (the rule is in `AGENTS.md`).
The current release is v2.2.12, and no further change is planned for now. The
[GitHub releases](https://github.com/mhju0/raintoday/releases) carry the full list; the
ones that changed what a visitor sees are:

- 2.0.2: a plain rain headline ("앞으로 24시간 비 예상 없음", "오후 3시부터 저녁 7시까지 비 예상").
- 2.1.0: the umbrella line answers for the rest of today (now until midnight KST).
- 2.1.4–2.1.5: interface audit fixes (Korean read time, 404 page, enlarged-text reflow).
- 2.1.6–2.1.8: the timeline's rain amount is the mean of the ensemble runs behind its
  rain chance, so a high chance no longer sits over 0 mm.
- 2.2.0: tomorrow's blend weights recent accuracy more sharply (7-day half-life,
  `exp(-24 × Brier)`).
- 2.2.1: documentation brought up to date; no behaviour change.
- 2.2.2: the evening collection is triggered early and waits for its 18:10 KST slot, and a failed Open-Meteo read is retried once. GitHub can still start it after the slot, as it did on October 13 (20:06 KST).
- 2.2.3: visits are counted with Vercel Web Analytics; the place in a shared link is not sent.
- 2.2.4: the 한눈에 보기 button is gone and the evidence below the answer always shows in full.
- 2.2.5: README screenshot retaken; no behaviour change.
- 2.2.6: the small 24H bar appears only after the timeline scrolls away, and marks the rain window in amber.
- 2.2.7: the 24H bar is removed; nothing floats over the page while scrolling. README screenshot retaken.
- 2.2.8: page speed on visitors' devices is measured with Vercel Speed Insights; the place in a shared link is not sent.
- 2.2.9: the server runs in Seoul instead of the United States, so the forecast arrives sooner.
- 2.2.10: a browser error on the live site is reported to Sentry, without the place or a session recording.
- 2.2.11: documentation corrected; no behaviour change.
- 2.2.12: when KMA's newest forecast issue comes back empty, an earlier issue (up to nine hours older) is used, so KMA stays in the forecast.

## Maintenance follow-ups

Collection and health incidents have automated issue tracking, freshness checks,
and weekly/monthly review issues. The September 6 KMA connection failure recovered on
the next scheduled cohort. The API Hub account is not approved for forecast endpoints,
so that gateway is not a fallback until a matching 활용신청 is approved.

| Work | Trigger and completion |
| --- | --- |
| Observe the ramp to full learned weights | Station 108's 06 cohort first left seed mode on September 27. On October 12 every station and cohort had at least two providers past the 30-comparison bar, so none depends on seed evidence. The ramp follows the eligible provider with the fewest comparisons: Seoul's morning group had 48 comparisons but Visual Crossing only 31, so each provider's influence was still within a point of 20%. Full learned weights arrive when the slowest eligible provider reaches 60. No forced captures or promised dates. |
| Watch provider coverage | Check scheduled capture and service-health failures; inspect provider-specific gaps even when the overall run passes. Visual Crossing quota has no verified remaining-usage endpoint. |
| Review dependencies | Dependabot opens security-fix PRs only; patch/minor fixes may auto-merge after required CI, and majors stay manual. Review routine upgrades by hand, and revisit the TypeScript and ESLint compatibility holds using current package metadata. |
| Renew credentials | The 활용기간 end dates are recorded in `CREDENTIAL_EXPIRIES` (`lib/maintenance.ts`); the maintenance workflow opens a renewal issue 30 days out and escalates at 7. It closes by hand, because a renewal happens in the portal and is not observable from CI. Keep the Actions and Vercel credential stores aligned by purpose. |
| Recovery and costs | Follow [OPERATIONS.md](OPERATIONS.md) for backup/restore, rollback, notification checks and the review schedule. |

These are ongoing operating duties, not unfinished product features. Time-dependent
and account checks are tracked in the monthly review issue the `maintenance` workflow opens;
proof of the outage breaker during a real KMA outage is tracked in
[#175](https://github.com/mhju0/raintoday/issues/175).

## Completed

- #124 closed on September 6 after nine consecutive successful scheduled cohorts.
- Visual Crossing recovery verified in stored evidence on September 6: both cohorts
  inspected contained five providers, including Visual Crossing, in all 95 saved
  captures. Two faulted stations per cohort were omitted under the existing tolerance.
- Collector recovery (#163, #167, #169, #171, #174, #177): partial-pass recovery,
  proven pre-connect database retries, five attempts spaced 0/10/25/40/55 minutes,
  and an outage breaker that stops re-proving an outage station by station.
- Dependabot opens security-fix PRs only (#165); routine upgrades are reviewed by hand.
- #135–139 merged: dependency fix, neutral shares for unmeasured providers,
  coordinate-free GPS record links, station/cohort/date evidence caching, request
  validation, shared provider/search code, UI audit and public-copy corrections.
- Expanded CI covers route behavior and a disposable PostgreSQL store contract.
- September 26 audit remediation adds pinned, fixture-backed browser checks and a
  shorter project overview; detailed methodology remains in FORECAST_CONTRACT.md.
- The v1.0.0 release description and GitHub public descriptions were edited without
  changing historical tags or pretending that old source represents the current app.

## Deferred

- Split the large forecast component or stylesheet only when a concrete change or
  measured problem warrants it.
- Revisit grouping by measured forecast lead time when there is enough evidence.
  Shared collection time does not prove the absence of provider-specific timing bias.
- Review cumulative eligibility versus recent-window scoring through an ADR.
- Weighting alternatives were replayed on stored history on October 12 (see
  `docs/DECISIONS.md`): sharpness stays at 24. Revisit only with more rainy days scored.
  The open question from that replay is that weighting helps on dry days and is slightly
  worse than equal weighting on days it rains.
- Additional providers, archive proxies, elevation data and a mature-evidence
  presentation are ideas, not commitments.
- Extend the fixture-backed browser CI only when another user journey needs regression coverage.

## Retained decisions

The product remains Korean-language, precipitation-focused and limited to South Korea.
The retired cinematic scene, radar and second scoring pipeline stay retired. The
`reliability-state` archive and its deployment guard remain. Station eligibility and
scoring policy are unchanged by the local/regional wording. The September 26 owner approval adopts a shorter README with a real
rainy-forecast screenshot and retains the detailed contract in linked documentation.

Dated audits and research preserve their observation date. They are not live task lists.
