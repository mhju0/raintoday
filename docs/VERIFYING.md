# Verifying changes

Use Node 24.15+ in the 24.x line (`nvm use`) and `npm ci`. The lockfile is authoritative. `npm run verify`
runs lint → route type generation/TypeScript → library, component and route tests → build.
Tests use fixtures and do not load `.env.local`. No forecast credentials are required.
Leave `PERFORMANCE_STORE_CONTRACT_URL` unset for ordinary checks.

For a short feedback loop:

```sh
node --test lib/localForecast.test.ts
npm exec --no -- tsx --test --test-name-pattern="GPS" components/local/LocalForecastExperience.test.tsx
npm run test:routes
npm run typecheck
```

`typecheck` generates Next route types before invoking TypeScript, so a fresh checkout
needs neither an old `.next` directory nor a running dev server. The route tests call the
actual handlers and stub upstream HTTP, covering parsing/status codes and request concurrency.
JSDOM tests cover interaction and state; they cannot verify layout or hydration in a browser.

## Isolated worktrees

```sh
git worktree add ../raintoday-task -b fix/task origin/main
cd ../raintoday-task
nvm use
npm ci
npm run verify
npm run dev -- --port 3100
```

Each worktree needs its own dependencies, `.next` output and port. Do not run a build and
Next dev in the same worktree at the same time. Check the printed URL: Next can choose
another port if its default is occupied. Start with no `.env.local`; use worked examples
for keyless forecasts. Configure only the credentials needed for a live check and never
copy credential values into logs, fixtures or commits. `.env.example` documents their roles.

## Browser checks

Use the production build when checking hydration, security headers or shipped behavior:

```sh
npm run build
npm start -- --port 3100
```

Open `http://localhost:3100` at desktop and 390px mobile widths. Check:

- A worked example loads a forecast; location switching and Back restore the right place.
- GPS requests permission only after a click. Neither the address bar nor record links
  contain device coordinates; the record link contains only the matched public station id.
- Area record links preserve shareable coordinates. Station-only records do not claim a
  distance from the visitor. Missing station matches show no evidence, not Seoul's record.
- The ribbon responds to arrow keys, and evidence can fold/unfold without horizontal overflow.
- Browser console has no hydration or runtime errors.

An available browser automation tool can perform these checks and save screenshots outside
Git. No browser runner is currently installed in the repository. A pinned, fixture-backed
Playwright flow would be the next step if UI work resumes; avoid making paid provider access
or production database availability prerequisites for CI.

## PostgreSQL contract

CI's `store-contract` job starts a disposable PostgreSQL 17 service and runs the same
behavioral contract as the in-memory store. It needs no repository secrets. Locally, use a
disposable database only:

```sh
PERFORMANCE_STORE_CONTRACT_URL=postgres://… node --test lib/performance/storeContract.test.ts
```

This suite **TRUNCATEs tables**. Never use `PERFORMANCE_DATABASE_URL` or a shared database.
Without the test URL, the SQL contract is reported as skipped. A passing in-memory suite
alone does not establish SQL behavior.

## Live operations

`npm run service:health` reads the deployed forecast and quota headers; it consumes provider
quota. `-- --target=local` checks port 3000 and requires the same configured services.
Capture, seed and observation scripts write evidence and are not validation commands.
Never dispatch extra production cohorts to accelerate #124, or backfill frozen forecasts.

GitHub PRs get CI and Vercel previews; merging main deploys to production. There is no
separate staging promotion gate. Review the actual diff and checks before merging. Keep
schema, scoring-policy and evidence-writing changes separate from routine cleanup.
