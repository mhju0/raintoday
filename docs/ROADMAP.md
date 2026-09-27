# Roadmap

Updated 2026-09-28. The project is in maintenance mode: correctness, security,
provider compatibility and service operation. New product scope requires an owner decision.
Source/tests and Git take precedence over this document.

## Releases

2.0.0 marks 오늘비 as the successor to SeoulSky (v1.0.0). It adds no new product scope:
it follows v1.1.0 with the September 26 audit fixes, accessibility work, the type-scale pass
and the shorter README. The v1.0.0 tag remains unchanged on the SeoulSky source.

Since then every merged change ships as its own release (the rule is in `AGENTS.md`).
The current release is v2.1.1:

- 2.0.1: provider names kept whole in the range line; new README screenshot.
- 2.0.2: a plain rain headline ("앞으로 24시간 비 예상 없음", "오후 3시부터 저녁 7시까지 비 예상").
- 2.1.0: the umbrella line answers for the rest of today (now until midnight KST).
- 2.1.1: the search fields mark focus with their own border instead of a second ring.

## Maintenance follow-ups

Collection and health incidents have automated issue tracking, freshness checks,
and weekly/monthly review issues. The September 6 KMA connection failure recovered on
the next scheduled cohort. The API Hub account is not approved for forecast endpoints,
so that gateway is not a fallback until a matching 활용신청 is approved.

| Work | Trigger and completion |
| --- | --- |
| Observe the seed-to-live transition | First observed September 27: station 108's 06 cohort is ramping on a passing 34-sample benchmark, with adaptive equal to equal weighting. Keep recording further stations and cohorts as they mature. No forced captures or promised dates. |
| Watch provider coverage | Check scheduled capture and service-health failures; inspect provider-specific gaps even when the overall run passes. Visual Crossing quota has no verified remaining-usage endpoint. |
| Review dependencies | Dependabot opens security-fix PRs only; patch/minor fixes may auto-merge after required CI, and majors stay manual. Review routine upgrades by hand, and revisit the TypeScript and ESLint compatibility holds using current package metadata. |
| Renew credentials | The 활용기간 end dates are recorded in `CREDENTIAL_EXPIRIES` (`lib/maintenance.ts`); the maintenance workflow opens a renewal issue 30 days out and escalates at 7. It closes by hand, because a renewal happens in the portal and is not observable from CI. Keep the Actions and Vercel credential stores aligned by purpose. |
| Recovery and costs | Follow [OPERATIONS.md](OPERATIONS.md) for backup/restore, rollback, notification checks and the review schedule. |

These are ongoing operating duties, not unfinished product features. Time-dependent
and account checks are tracked in [#140](https://github.com/mhju0/raintoday/issues/140);
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
- Revisit weight-projection alternatives only with a defined evaluation.
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
