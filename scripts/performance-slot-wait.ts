import { secondsUntilSlotOpens } from "../lib/performance/cli.ts";

// Prints only the number: the workflow passes it straight to `sleep`.
console.log(secondsUntilSlotOpens(process.argv.slice(2), new Date()));
