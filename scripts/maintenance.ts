import { assessExpiries, assessRuns, CREDENTIAL_EXPIRIES, type MaintenanceRun } from "../lib/maintenance.ts";

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !token) {
  throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required");
}
const dryRun = process.argv.includes("--dry-run");
const base = `https://api.github.com/repos/${repository}`;
async function api<T>(path: string, method = "GET", body?: object): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub ${method} ${path.split("?")[0]}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
type Issue = { number: number; title: string; body: string; state: string; user: { login: string }; pull_request?: object };
const issues: Issue[] = [];
for (let page = 1; ; page += 1) {
  const batch = await api<Issue[]>(`/issues?state=open&per_page=100&page=${page}`);
  issues.push(...batch.filter((issue) => !issue.pull_request));
  if (batch.length < 100) break;
}
async function syncIssue(key: string, title: string, body: string | null) {
  const marker = `<!-- raintoday-maintenance:${key} -->`;
  const existing = issues.find((issue) => issue.user.login === "github-actions[bot]" && issue.body?.includes(marker));
  console.log(`${key}: ${body ? "attention needed" : "healthy"}${dryRun ? " (dry run)" : ""}`);
  if (dryRun) return;
  if (body) {
    const next = `${marker}\n${body}`;
    if (existing) {
      if (existing.body !== next) await api(`/issues/${existing.number}`, "PATCH", { body: next });
    } else await api("/issues", "POST", { title, body: next });
  } else if (existing) {
    await api(`/issues/${existing.number}/comments`, "POST", { body: "The latest completed monitored run is successful and within the freshness limit. Closing this incident; missed forecast captures remain missing. See the workflow history for evidence." });
    await api(`/issues/${existing.number}`, "PATCH", { state: "closed", state_reason: "completed" });
  }
}

const now = Date.now();
for (const [workflow, hours] of [["local-performance", 18], ["service-health", 10]] as const) {
  const config = await api<{ state: string }>(`/actions/workflows/${workflow}.yml`);
  // A manual health check is a valid fresh probe. A manual collection must not
  // conceal a missed scheduled cohort.
  const event = workflow === "local-performance" ? "&event=schedule" : "";
  const { workflow_runs: runs } = await api<{ workflow_runs: MaintenanceRun[] }>(`/actions/workflows/${workflow}.yml/runs?branch=main${event}&per_page=20`);
  const finding = assessRuns(runs, now, hours);
  const detail = config.state !== "active" ? `Workflow is ${config.state}. Re-enable it after reviewing the cause.` : finding?.detail;
  await syncIssue(workflow, `Operations: ${workflow} needs attention`, detail ?
    `${detail}\n\n${finding?.url ? `[Latest completed run](${finding.url})` : `[Workflow](https://github.com/${repository}/actions/workflows/${workflow}.yml)`}\n\nFollow [the incident procedure](https://github.com/${repository}/blob/main/docs/OPERATIONS.md#incident-response). Do not rerun missed forecast cohorts or weaken required-provider checks. This issue updates in place while the problem persists and closes after a fresh successful monitored run.` : null);
}

// Renewal needs a person signed in to the portal, so the reminder has to exist
// well before the date and stay open until someone acts. Unlike the run-freshness
// incidents this cannot self-close: only a renewed 활용기간 clears it, and that is
// visible in the portal, not from here.
// Never pass a healthy result to syncIssue: its close path narrates a successful
// monitored run, which is not what clears a renewal, and it would auto-close the
// reminder the moment someone edited a date without actually renewing.
const expiries = assessExpiries(CREDENTIAL_EXPIRIES, now);
console.log(`credentials: ${expiries ? "renewal due" : "no subscription within 30 days"}${dryRun ? " (dry run)" : ""}`);
if (expiries) await syncIssue("credentials", `Operations: renew KMA API subscriptions${expiries.urgent ? " (urgent)" : ""}`,
  `${expiries.detail}\n\nRenew the 활용신청 in the portal, then update the key in every store that consumes it (Vercel for serving, GitHub Secrets for scheduled collection) and update the date in \`CREDENTIAL_EXPIRIES\` (lib/maintenance.ts). A renewal is not visible from CI, so **close this issue by hand** once the portal shows the new 활용기간.\n\nSee [credentials and request limits](https://github.com/${repository}/blob/main/docs/OPERATIONS.md#credentials-and-request-limits). Do not paste keys into this issue.`);

// One outstanding checklist per cadence. Overdue work stays visible instead of
// producing another copy every week. Closing it permits the next period's issue.
const kst = new Date(now + 9 * 3_600_000);
const weekStart = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
weekStart.setUTCDate(weekStart.getUTCDate() - (weekStart.getUTCDay() + 6) % 7);
const periods = [
  { key: "weekly", period: weekStart.toISOString().slice(0, 10), tasks: "- [ ] Review operational incidents and collection coverage, including partial station failures.\n- [ ] Review Dependabot PRs and security alerts; investigate failed checks before merging.\n- [ ] Check Vercel/Neon usage and provider quota/expiry notices.\n- [ ] Open a forecast and its scoring record; note missing providers or stale observations." },
  { key: "monthly", period: kst.toISOString().slice(0, 7), tasks: "- [ ] Take a private database backup and verify an isolated restore with counts/checksums.\n- [ ] Reconcile the portal's 활용기간 dates against `CREDENTIAL_EXPIRIES` (lib/maintenance.ts).\n- [ ] Review firewall logs and unexpected traffic; test changes in preview.\n- [ ] Check GitHub scheduled workflows remain enabled and failure notifications arrive.\n- [ ] Review one station/cohort's sample counts, benchmark and weights.\n- [ ] Review roadmap and operating instructions for stale claims." },
];
for (const { key, period, tasks } of periods) {
  const marker = `<!-- raintoday-maintenance:${key} -->`;
  if (issues.some((issue) => issue.user.login === "github-actions[bot]" && issue.body?.includes(marker))) continue;
  const closed = await api<Issue[]>(`/issues?state=closed&creator=github-actions%5Bbot%5D&sort=updated&direction=desc&per_page=100`);
  if (closed.some((issue) => issue.body?.includes(`${marker}\nPeriod: ${period}`))) continue;
  await syncIssue(key, `Maintenance: ${key} review (${period})`, `Period: ${period}\n\n${tasks}\n\nRecord evidence before closing. [Operating procedure](https://github.com/${repository}/blob/main/docs/OPERATIONS.md).`);
}
