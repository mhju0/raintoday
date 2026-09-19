import { transportFailure } from "../maintenance.ts";

export const KMA_ASOS_TRANSPORT_URL =
  "https://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList";

export type TransportPreflightResult =
  | { reachable: true; attempt: number; status: number }
  | { reachable: false; attempts: number; failures: string[] };

type TransportPreflightOptions = {
  attempts?: number;
  timeoutMs?: number;
  spacingMs?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
};

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check only whether a runner can reach the exact ASOS service. Authentication
 * is deliberately absent: every HTTP response, including 401, proves transport.
 *
 * The probes are spaced rather than consecutive. The route between GitHub's
 * egress and `apis.data.go.kr` flaps on a scale of tens of seconds: run
 * 34910557704 lost a runner at 23:49:49 and reached ASOS from a different one
 * twelve seconds later, and run 35351001382 was reachable at 13:34:33 and gone
 * by 13:37:56. Two back-to-back requests sample one moment of that route and
 * discard a runner over it; spreading the same probe budget across ~90 seconds
 * samples the flap instead. A reachable route still answers on probe 1, so a
 * healthy runner pays nothing for the spacing.
 */
export async function probeKmaTransport({
  attempts = 4,
  timeoutMs = 10_000,
  spacingMs = 20_000,
  fetchImpl = fetch,
  sleepImpl = sleep,
}: TransportPreflightOptions = {}): Promise<TransportPreflightResult> {
  const failures: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1 && spacingMs > 0) await sleepImpl(spacingMs);
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
