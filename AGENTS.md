# Repository essentials

- Resolve conflicting evidence in this order: source/tests → Git → `docs/DECISIONS.md` → `docs/ROADMAP.md` → `docs/PROJECT_HANDOFF.md` → historical Claude material.
- Use Node 24 (the CI version) and npm with `package-lock.json`.
- Install: `npm ci`. Develop: `npm run dev`. Production: `npm run build`, then `npm start`.
- Checks: `npm run lint`, `npm exec --no -- tsc --noEmit`, `npm test`, `npm run build`.
- Library tests execute TypeScript directly in Node; relative runtime imports in test-reachable `lib/` modules need explicit `.ts` extensions.

- Construct forecast locations through `createForecastLocation` in `lib/location.ts`: service-area validation precedes grid conversion and provider requests. Weather dates use `Asia/Seoul`. Keep user coordinates out of the performance database.
- Serving and capture share `forecastProviders` and `WeatherProvider.read()` snapshots. Provider order selects the primary source and hourly ribbon; preserve it. The ribbon is one provider's series; performance weighting applies only to tomorrow's blend.
- Forecast captures are immutable. Retrospective seed comparisons stay separate from prospective captures and benchmarks. Observation read failures must remain faults, never dry days or absent observations.
- `lib/locationServiceAreaData.ts` and `lib/performance/stationCatalog.ts` are generated. Use `npm run service-area:generate -- <official-SGIS-shapefile>` and `npm run performance:catalog`; recheck island coverage after geometry regeneration. Keep the geometry server-side and raw SGIS files out of Git.
- `PERFORMANCE_STORE_CONTRACT_URL` must point only to a disposable database: its tests **TRUNCATE tables**. Capture, seed, and observation scripts write evidence; they are not ordinary validation commands.
