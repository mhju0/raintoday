# Repository essentials

- Resolve conflicting evidence in this order: source/tests → Git → `docs/DECISIONS.md` → `docs/ROADMAP.md` → `docs/PROJECT_HANDOFF.md` → historical Claude material.
- Use Node 24 (the CI version) and npm with `package-lock.json`.
- Install: `npm ci`. Develop: `npm run dev`. Production: `npm run build`, then `npm start`.
- Full check: `npm run verify` (lint, typecheck, tests, build). `npm run typecheck` generates Next route types first, including in fresh worktrees. Targeted tests and browser/DB verification: `docs/VERIFYING.md`.
- Library tests execute TypeScript directly in Node; relative runtime imports in test-reachable `lib/` modules need explicit `.ts` extensions.

- Construct forecast locations through `createForecastLocation` in `lib/location.ts`: service-area validation precedes grid conversion and provider requests. Weather dates use `Asia/Seoul`. Keep user coordinates out of the performance database.
- Serving and capture share `forecastProviders` and `WeatherProvider.read()` snapshots. Provider order selects the primary source and hourly ribbon; preserve it. The ribbon is one provider's series; performance weighting applies only to tomorrow's blend.
- Forecast captures are immutable. Retrospective seed comparisons stay separate from prospective captures and benchmarks. Observation read failures must remain faults, never dry days or absent observations.
- `lib/locationServiceAreaData.ts` and `lib/performance/stationCatalog.ts` are generated. Use `npm run service-area:generate -- <official-SGIS-shapefile>` and `npm run performance:catalog`; recheck island coverage after geometry regeneration. Keep the geometry server-side and raw SGIS files out of Git.
- `PERFORMANCE_STORE_CONTRACT_URL` must point only to a disposable database: its tests **TRUNCATE tables**. Capture, seed, and observation scripts write evidence; they are not ordinary validation commands.

<!-- antislop:start -->
## antislop

For UI work or visual audits, read the installed core at `/Users/michaelju/.agents/skills/antislop/SKILL.md` and UI skill at `/Users/michaelju/.agents/skills/antislop-ui/SKILL.md`.
Use `docs/adr/0009-chart-recorder-redesign.md` and `docs/adr/0010-open-at-the-answer-shelve-the-receipts.md` for the existing visual direction.
Before starting, ask whether antislop applies during implementation or as an after-work audit, unless the user has already selected a mode in the session. In after mode, report numbered findings and implement only the findings the user approves.
<!-- antislop:end -->
