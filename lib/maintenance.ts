export type MaintenanceRun = {
  status: string;
  conclusion: string | null;
  created_at: string;
  html_url: string;
};

export function assessRuns(runs: MaintenanceRun[], now: number, maxAgeHours: number) {
  const completed = runs.filter((run) => run.status === "completed")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!completed || !Number.isFinite(Date.parse(completed.created_at)) ||
      now - Date.parse(completed.created_at) > maxAgeHours * 3_600_000) {
    return { kind: "stale", detail: `No completed monitored run within ${maxAgeHours} hours.`, url: completed?.html_url };
  }
  if (completed.conclusion !== "success") {
    return { kind: "failed", detail: `Latest completed monitored run: ${completed.conclusion ?? "unknown"}.`, url: completed.html_url };
  }
  return null;
}

export function parseQuotaHeader(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function transportFailure(error: unknown): string {
  if (!(error instanceof Error)) return "network request failed";
  if (error.name === "TimeoutError" || error.name === "AbortError") return "request timed out";
  const cause = error.cause as { code?: string } | undefined;
  switch (cause?.code) {
    case "UND_ERR_CONNECT_TIMEOUT": case "ETIMEDOUT": return "connection timed out";
    case "ENOTFOUND": case "EAI_AGAIN": return "DNS lookup failed";
    case "ECONNRESET": return "connection reset";
    case "ECONNREFUSED": return "connection refused";
    default: return "network request failed";
  }
}

export type CredentialExpiry = {
  variable: string;
  service: string;
  portal: string;
  /** 만료예정일 as shown in the portal, KST calendar date. */
  expiresOn: string;
};

/**
 * The 활용기간 end dates, read from the portals on 2026-09-07. Nothing in a key
 * reveals its own expiry, and a data.go.kr subscription simply stops answering
 * on the date, so the only alternative to recording them here is logging in to
 * find out — which is what the monthly checklist used to ask for, and why that
 * checkbox was unactionable.
 *
 * Only the three subscriptions the code actually calls are listed. The account
 * also holds approved-but-unused ones (기상특보, 레이더영상, 에어코리아 대기오염,
 * apihub 레이더 HSR); they are deliberately absent so that nobody renews a
 * subscription this project retired. See docs/OPERATIONS.md.
 */
export const CREDENTIAL_EXPIRIES: CredentialExpiry[] = [
  {
    variable: "KMA_SHORT_TERM_API_KEY",
    service: "기상청_단기예보 조회서비스",
    portal: "https://www.data.go.kr/iim/api/selectAcountList.do",
    expiresOn: "2028-03-27",
  },
  {
    variable: "KMA_OBSERVATION_API_KEY",
    service: "기상청_지상(종관, ASOS) 일자료 조회서비스",
    portal: "https://www.data.go.kr/iim/api/selectAcountList.do",
    expiresOn: "2028-06-18",
  },
  {
    variable: "KMA_APIHUB_KEY",
    service: "지상관측 지점정보 조회 (stn_inf)",
    portal: "https://apihub.kma.go.kr/",
    expiresOn: "2028-08-19",
  },
];

/**
 * A subscription stops answering at the start of its 만료예정일, so measure to
 * 00:00 KST on that date rather than to the end of it. Renewal needs a person
 * signed in to the portal, so warn at 30 days and again at 7 — the cadence
 * docs/OPERATIONS.md already commits to.
 */
export function assessExpiries(expiries: CredentialExpiry[], now: number) {
  const due = expiries
    .map((entry) => {
      const deadline = Date.parse(`${entry.expiresOn}T00:00:00+09:00`);
      if (!Number.isFinite(deadline)) {
        throw new Error(`${entry.variable}: unparseable expiry ${entry.expiresOn}`);
      }
      // Truncate, not floor: floor turns "expired 3.4 days ago" into 4, overstating
      // an outage. Truncation is conservative in both directions — it rounds a
      // countdown down and elapsed time down.
      return { ...entry, days: Math.trunc((deadline - now) / 86_400_000) };
    })
    .filter((entry) => entry.days <= 30)
    .sort((a, b) => a.days - b.days);
  if (due.length === 0) return null;
  const urgent = due.some((entry) => entry.days <= 7);
  return {
    urgent,
    rows: due,
    detail: due
      .map((entry) => entry.days < 0
        ? `- **${entry.variable}** — ${entry.service} — **expired ${-entry.days} day(s) ago** (${entry.expiresOn}). [Portal](${entry.portal})`
        : `- **${entry.variable}** — ${entry.service} — expires in **${entry.days} day(s)** (${entry.expiresOn}). [Portal](${entry.portal})`)
      .join("\n"),
  };
}
