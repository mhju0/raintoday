# Operating 오늘비

The project is maintained for correctness, security and provider compatibility.
New features need an explicit scope decision. Security support covers current `main`;
see the [reporting policy](../.github/SECURITY.md).

## Routine review

The `maintenance` workflow runs after collection/health runs and every six hours.
It opens or updates one incident per failing workflow and closes it after a fresh
successful scheduled run. It flags a missing completed collection after 18 hours
and a missing health check after 10 hours, including disabled workflows. It also
creates weekly and monthly review issues; an unfinished checklist remains open
instead of being duplicated. Check off each task with evidence before closing it.

Service health now flags even one missing provider. The site can remain usable
while this check is red. A collection failure still refuses faulted forecast captures.

- Weekly: inspect failed `local-performance` and `service-health` runs, provider gaps,
  Dependabot PRs and Vercel/Neon usage. A green capture can still omit faulted stations.
- Monthly and before significant data changes: take a private backup and restore it to
  an isolated database. Check provider accounts' credential expiry dates and quotas.
- After deployment: open a forecast and its scoring record, check headers and errors,
  then confirm the next scheduled service-health result. Never collect extra production
  evidence as a deployment test.
- When recent samples mature: inspect one real station/cohort's mode, benchmark,
  sample counts and effective weights. Record the seed-to-live transition without
  forcing it or promising a date. The benchmark can legitimately retain equal weighting.

GitHub Actions notifications depend on the owner's account settings. Watch this repository
for workflow failures and verify delivery in GitHub notification settings. These are
best-effort checks, not an on-call service or an uptime guarantee.

GitHub can disable scheduled workflows in public repositories after 60 days without
repository activity. A monitor on GitHub cannot report a platform-wide outage or its
own disabled schedule. Keep an independent monthly calendar reminder to visit Actions,
check `maintenance` itself and re-enable schedules when necessary. See
[GitHub's schedule limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Incident response

1. Open the linked run and distinguish configuration, transport, quota, database and
   code failures. A timeout before connection is not proof that an API key expired.
   Observation logs retain safe transport causes without request URLs or keys.
2. For an upstream outage, retain the incident and inspect the next scheduled cohort.
   The collector has one fresh-runner retry, also after setup or timeout failures.
   Do not dispatch missed cohorts, substitute dry observations, overwrite captures,
   or drop required providers to make a run pass.
3. For credentials, renew access in the provider account, update every consuming
   secret store, redeploy if needed and perform read-only health checks. API Hub
   station access does not imply permission for its forecast APIs.
4. For a code regression, reproduce it with a focused test, fix it in a PR, pass the
   required checks and confirm deployment. Dependency failures go through the same
   review; the maintenance workflow never generates or merges arbitrary fixes.
5. For database trouble, check Neon availability and connection/role settings first.
   Restore only after backing up the current state and rehearsing in isolation.
6. Record recovery and any permanent evidence gaps. Closing the automated incident
   means the workflow recovered, not that every missed station or date was restored.

September 6 incident: `apis.data.go.kr` connections timed out from the local probe,
and scheduled collection and the served KMA forecast failed as well. A separate
HTTPS probe reached `apihub.kma.go.kr`. Its documented forecast endpoints rejected
the current API Hub key with HTTP 403, so no gateway switch was made. KMA must restore
the original route or approve equivalent API access before that fallback is usable.
This identifies the failing connection boundary, not the provider's internal root cause.

## Credentials and request limits

Vercel production and preview use `raintoday_web`, a SELECT-only PostgreSQL role with
access to the four performance tables. The serving adapter also requests read-only
sessions, a 15-second statement timeout and a 10-second idle transaction timeout.
GitHub Actions retains the separate collector credential. Only scheduled collection needs
`KMA_APIHUB_KEY` and `KMA_OBSERVATION_API_KEY`; they do not belong in Vercel.

Rotate a key in every store that consumes it, then deploy and inspect the relevant
scheduled health result. Do not paste credentials into issues, logs or command arguments.
Use the actual data.go.kr application expiry date for reminders 30 and 7 days before
expiry. No date can be inferred from the key itself.

Application limits are process-local. The Vercel firewall's **Dynamic request volume**
rule observes `/api/` traffic above 150 requests per IP per 60 seconds; it initially
logs rather than blocks. Inspect the [firewall traffic](https://vercel.com/mhju0s-projects/raintoday/firewall)
before changing enforcement. Test a restrictive rule in preview before production.
Vercel counters are regional; neither these rules nor caches guarantee a provider budget.

## Backup and restore

Use PostgreSQL client tools matching the server major version (18 at this review).
Keep credentials in a protected environment or password file and backups outside Git.
For Neon, verify the public TLS connection (`PGSSLMODE=verify-full` and a trusted root
store, such as `PGSSLROOTCERT=system`). The compute's `show ssl` value describes its
internal side of Neon's proxy and does not establish the client's wire encryption.

```sh
umask 077
# PGHOST, PGDATABASE, PGUSER and authentication come from the private environment.
pg_dump --format=custom --no-owner --no-acl --file="$BACKUP_FILE"
# Restore only into a NEW, isolated database; change the connection environment first.
pg_restore --exit-on-error --no-owner --no-acl --dbname="$RESTORE_DATABASE" "$BACKUP_FILE"
```

Verify station, capture, observation and seed row counts and deterministic row checksums.
Set both sessions to UTC before comparing timestamp representations. On September 6,
2026, a private backup restored successfully into local PostgreSQL 18: 97 stations,
3,077 captures, 1,746 observations and 8,822 seed comparisons matched the source.
This proves that backup's recovery, not a future backup or a managed retention policy.
The Neon dashboard showed a six-hour history retention window on September 6, 2026.
This is short-term recovery, not a substitute for private backups. With monthly manual
backups, an older incident could lose up to a month of evidence; take backups more often
if that loss is unacceptable. Recheck retention after plan or project-setting changes.

`PERFORMANCE_STORE_CONTRACT_URL` is only for a separate disposable test database.
Its suite truncates tables. Never use the production or recovery database for that suite.

## Deployment and rollback

PRs require `verify`, `store-contract` and `Dependency review`. Patch/minor Dependabot
updates with one verified Dependabot commit can enable auto-merge after those checks;
majors and additional commits require manual review. The privileged automation never
checks out PR code and disables auto-merge when additional commits appear.
The repository action allowlist permits the exact reviewed `fetch-metadata` SHA.
Review a helper update before adding its new SHA to that allowlist.

Keep `.vercelignore` aligned with private/local exclusions in `.gitignore`; the CLI
upload must not include local archives or agent state. Prefer the Git integration.

After merging, verify Vercel's deployed Git SHA matches `main`; a successful merge is
not proof that the deployment webhook ran. If necessary, deploy the verified commit
through Vercel and check the production alias before publishing a release.

For a frontend regression, use Vercel's previous known-good deployment or redeploy its
Git commit with current environment variables. Prefer redeployment after credential
changes: older deployments retain older environment values. A frontend rollback does
not call for restoring or editing immutable forecast evidence. Database recovery is a
separate incident decision, with a fresh backup and an isolated restore rehearsal first.

## Releases

Use annotated `vMAJOR.MINOR.PATCH` tags for tested product milestones. For this hosted
application, these are release identifiers, not a promise of a public API compatibility
contract. Describe user-visible changes, validation and limitations in the GitHub release.
Retain `v1.0.0` at its original SeoulSky commit. `v1.1.0` records the current rain product
and maintenance/security work. Future compatible fixes normally increment the patch.
Do not archive the repository while the hosted service and scheduled collectors operate.
