# Maintenance audit — 2026-09-05

Scope: served Next.js paths, provider/store boundaries, frontend state, tests, setup,
CI/deployment, open work and retained archives. Source and executable behavior take
precedence over historical explanations.

## Changes

- Corrected record caching from coordinate+cohort to matched station+cohort+Korean date.
  Catalog and history reads are single-flight and bounded by the existing cache. Distance
  and eligibility are recomputed for each request. Unavailable results are not cached for
  ten minutes; failed refreshes report unavailable evidence with a short retry cooldown.
- GPS record links now contain only the matched public station id. Missing matches stay
  unavailable instead of silently showing Seoul. Area links retain shareable coordinates.
  Station-only pages omit visitor-distance wording.
- Malformed JSON returns 400 from the actual route handler. Forecast retrieval and GPS
  reverse geocoding start together; live and seed history queries also start together.
  The recommendation reuses the day already assembled for the outlook. Both forecast and
  evidence promises are observed immediately, avoiding an unhandled early rejection.
- Removed the old coordinate cache and its misleading comments, and replaced the cache
  timestamp test (which only cached a missing-database result) with actual store behavior
  tests. Removed the redundant tomorrow-day calculation and an impossible date guard.
- Aligned Node types to Node 24 and declared the 24.15+ minimum required by JSDOM.
  Added Node 24 selection, one `verify` command, targeted suites, route-handler tests and
  route type generation before typechecking. Added a disposable PostgreSQL CI contract job.
  PR updates now trigger one CI run rather than both push and pull_request runs. Dependency
  auditing includes developer tooling. See [VERIFYING.md](VERIFYING.md).
- Removed arbitrary dashboard-mount sleeps and wrapped interactive test updates in React
  `act`, removing warning noise. All 64 component tests pass; local suite time fell from
  roughly 7.9s to 5.8s (single runs, not a controlled production benchmark).
- Enabled required, up-to-date `verify` checks on main, retaining existing linear-history,
  conversation-resolution, admin enforcement and no-force-push/no-delete protections.
- Reviewed and merged Dependabot PR #135: compatible Browserslist advisory fix, lockfile
  only, CI and Vercel preview passed. No application or database migration was involved.

## Evidence

- Deterministic store counters: two concurrent coordinates matching one station perform
  **3 reads total instead of 6** (catalog, live history, seed history); subsequent requests
  for that station/cohort perform **0 reads** during the TTL. Distances remain distinct.
- Gate-based tests prove both pairs of independent network/database operations start
  before either completes. No production latency percentage is claimed.
- Cache tests cover cohorts, station ids, store isolation, Korean dates, expiry, refresh
  faults, recovery and retired stations. Route tests exercise actual HTTP response codes
  and GPS name enrichment. Component tests assert coordinate-free GPS record links.
- Production-build browser checks passed at 1440px and 390px with a simulated device fix,
  keyless Open-Meteo and a disposable local evidence store. Root URL had no coordinates,
  record links contained only `station=108`, layouts had no horizontal overflow, and the
  browser reported no errors. `station=none` rendered unavailable evidence. Native automated
  browser geolocation was denied, so permission behavior remains covered by component tests.
- Both route regressions fail against the original handler and pass with the correction.
- Disposable local PostgreSQL 16: all 26 in-memory/SQL contract tests passed. CI uses
  PostgreSQL 17 in a separate service; no production data was read or written for these tests.

## Open work and deliberate deferrals

- **PR #136:** implementation reviewed; CI and preview green. Left for the owner's manual
  review/merge as requested. This audit branch starts from main and does not duplicate it.
- **#124:** still 7 consecutive scheduled successes, latest run `33927705186`; no scheduled
  run after credential preflight repair yet. Keep open until the eighth success and actual
  five-provider capture coverage are verified. No manual cohort was dispatched.
- No abandoned implementation branches beyond the merged capture fix, open weighting fix,
  and deliberately retained `reliability-state` archive. Do not delete the frozen archive or
  its deployment guard. The cinematic clips on local disk are ignored, deliberately retained
  source media, not tracked runtime assets; leave them alone.
- Kept scoring/geometry/property tests, bounded response reads, provider snapshot abstraction,
  and store adapters: their contracts cover faults, privacy and immutable evidence. An unused
  symbol check found only unused callback parameters in test fixtures, not dead runtime code.
- Kept the large dashboard/CSS and one-time location-key migration. No observed rendering
  defect or measured bundle bottleneck justifies a broad rewrite. Production dependencies
  remain four; no new runtime or test dependency was introduced.
- Existing duplicate observation/seed indexes may warrant a measured database review, but
  no schema or production indexes were changed. Capture and observation writes, scoring
  policy and seed/live handover semantics were left intact.
- Vercel previews exist, but main deploys directly to production; there is no separate
  staging promotion. A fixture-backed browser CI flow remains a useful next investment.
  Required `verify` protection is now active. Dependabot auto-merge remains disabled until
  the expanded CI is merged and proven; major dependency updates remain manual. ADR 0005 proximity wording is still approved work.
