# Roadmap

Updated 2026-09-06. The project is in maintenance mode: correctness, security,
provider compatibility and service operation. New product scope requires an owner decision.
Source/tests and Git take precedence over this document.

## Release 1.1.0

The maintenance release includes the approved audit fixes, local versus regional
observation wording, shared agent instructions, and the security/recovery review.
The release tag must point at verified main after its production deployment is checked.
The old v1.0.0 tag remains unchanged; it contains the earlier SeoulSky application.

## Maintenance follow-ups

Collection and health incidents now have automated issue tracking, freshness checks,
and weekly/monthly review issues. The September 6 KMA connection failure remains an
upstream incident until scheduled collection recovers; alternate API Hub forecast
access currently rejects the configured key.

| Work | Trigger and completion |
| --- | --- |
| Observe the seed-to-live transition | Review a real station/cohort after two providers and the benchmark meet the sample conditions. Record the mode, provider sample counts and effective weights. No forced captures or promised transition date. |
| Watch provider coverage | Check scheduled capture and service-health failures; inspect provider-specific gaps even when the overall run passes. Visual Crossing quota has no verified remaining-usage endpoint. |
| Review dependencies | Patch/minor Dependabot PRs may merge after required CI; major versions stay manual. Revisit the TypeScript and ESLint compatibility holds using current package metadata. |
| Renew credentials | Use the provider account's actual expiry date and renewal reminders. Keep the Actions and Vercel credential stores aligned by purpose. |
| Recovery and costs | Follow [OPERATIONS.md](OPERATIONS.md) for backup/restore, rollback, notification checks and the review schedule. |

These are ongoing operating duties, not unfinished product features. Time-dependent
and account checks are tracked in [#140](https://github.com/mhju0/raintoday/issues/140).

## Completed

- #124 closed on September 6 after nine consecutive successful scheduled cohorts.
- Visual Crossing recovery verified in stored evidence: both recent cohorts contain
  five providers, including Visual Crossing, in all 95 saved captures. Two faulted
  stations per cohort were omitted under the existing tolerance.
- #135–139 merged: dependency fix, neutral shares for unmeasured providers,
  coordinate-free GPS record links, station/cohort/date evidence caching, request
  validation, shared provider/search code, UI audit and public-copy corrections.
- Expanded CI covers route behavior and a disposable PostgreSQL store contract.
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
- Browser CI with controlled provider fixtures is useful if substantial UI work resumes.

## Retained decisions

The product remains Korean-language, precipitation-focused and limited to South Korea.
The retired cinematic scene, radar and second scoring pipeline stay retired. The
`reliability-state` archive and its deployment guard remain. Station eligibility and
scoring policy are unchanged by the local/regional wording. Current README length is
an editorial choice; the September 6 copy approval supersedes the earlier rejection
of shortening it.

Dated audits and research preserve their observation date. They are not live task lists.
