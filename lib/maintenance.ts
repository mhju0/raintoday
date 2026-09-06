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
