import { probeKmaTransport } from "../lib/performance/transportPreflight.ts";

const result = await probeKmaTransport();
if (result.reachable) {
  console.log(`ASOS transport reachable on probe ${result.attempt} (HTTP ${result.status}).`);
} else {
  console.error(`ASOS transport unreachable after ${result.attempts} probes: ${result.failures.join(", ")}.`);
  process.exitCode = 1;
}
