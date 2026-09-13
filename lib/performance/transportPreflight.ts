import { transportFailure } from "../maintenance.ts";

export const KMA_ASOS_TRANSPORT_URL =
  "https://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList";

export type TransportPreflightResult =
  | { reachable: true; attempt: number; status: number }
  | { reachable: false; attempts: number; failures: string[] };

type TransportPreflightOptions = {
  attempts?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel();
}

/**
 * Check only whether a runner can reach the exact ASOS service. Authentication
 * is deliberately absent: every HTTP response, including 401, proves transport.
 */
export async function probeKmaTransport({
  attempts = 2,
  timeoutMs = 10_000,
  fetchImpl = fetch,
}: TransportPreflightOptions = {}): Promise<TransportPreflightResult> {
  const failures: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(KMA_ASOS_TRANSPORT_URL, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      try {
        await cancelResponseBody(response);
      } catch {
        // The headers already proved reachability; body cleanup cannot revoke it.
      }
      return { reachable: true, attempt, status: response.status };
    } catch (error) {
      failures.push(transportFailure(error));
    }
  }
  return { reachable: false, attempts, failures };
}
