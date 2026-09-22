/**
 * Turning an arbitrary error into one safe, non-empty line.
 *
 * This exists because `Error.message` is empty on an `AggregateError`, which is
 * exactly what Node raises when every address of a host refuses a connection.
 * Reporting `error.message` therefore prints nothing in precisely the cases
 * worth reading. It cost this project three misdirected fixes: run 35621896930
 * exited after one blank line, and run 35351001382 failed a 93-of-97 cohort
 * reporting `4 x observation: ` with no reason at all. See #170.
 *
 * Kept free of the database driver on purpose, so the capture batch can share
 * the walker without importing `postgres`.
 */

const MAX_ERROR_TREE_DEPTH = 8;
const MAX_ERROR_TREE_NODES = 32;
const MAX_ERROR_MESSAGE_LENGTH = 300;

export function aggregateCauses(error: AggregateError): unknown[] {
  return Array.from(error.errors as Iterable<unknown>);
}

/**
 * Credentials this project puts on a wire, in the two shapes an error can carry
 * them: a connection URL's userinfo, and a query parameter. The KMA services
 * pass their key as `serviceKey`/`authKey` in the query string, so a leaked
 * request URL would otherwise print a live key into a public Actions log.
 */
function redactSecrets(message: string): string {
  const redacted = message
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/giu, "$1<REDACTED>@")
    .replace(
      /([?&](?:password|pass|pwd|servicekey|authkey|api_?key|access_?token|key)=)[^&\s]+/giu,
      "$1<REDACTED>",
    );
  return redacted.length <= MAX_ERROR_MESSAGE_LENGTH
    ? redacted
    : `${redacted.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`;
}

function describeErrorLeaf(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const candidate = error as NodeJS.ErrnoException;
  const facts = [candidate.syscall, candidate.code]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
  if (candidate.syscall && typeof candidate.code === "string" && /^E[A-Z]+$/u.test(candidate.code)) {
    const safeMessage = redactSecrets(error.message.trim());
    if (safeMessage) return safeMessage;
  }
  if (facts) return facts;
  return error.name || "Error";
}

/**
 * A non-empty, credential-redacted diagnostic for any error tree.
 *
 * Deliberately refuses to echo arbitrary error text: only a leaf carrying a
 * syscall and an `E...` code is quoted, because those are the ones whose text
 * is a known shape rather than whatever a remote service chose to say.
 */
export function describeErrorTree(error: unknown): string {
  return describeErrorTreeNode(error, new Set<AggregateError>(), { remaining: MAX_ERROR_TREE_NODES }, 0);
}

function describeErrorTreeNode(
  error: unknown,
  ancestors: Set<AggregateError>,
  budget: { remaining: number },
  depth: number,
): string {
  if (depth > MAX_ERROR_TREE_DEPTH || budget.remaining <= 0) return "error details truncated";
  budget.remaining -= 1;
  if (error instanceof AggregateError) {
    if (ancestors.has(error)) return "cyclic AggregateError";
    const causes = aggregateCauses(error);
    if (causes.length === 0) return "AggregateError without causes";
    const nextAncestors = new Set(ancestors).add(error);
    const includedCauses = causes.slice(0, budget.remaining);
    const details = includedCauses.map((cause) =>
      describeErrorTreeNode(cause, nextAncestors, budget, depth + 1)).join("; ");
    const omitted = causes.length - includedCauses.length;
    return `AggregateError (${causes.length} causes: ${details}${omitted > 0 ? `; ${omitted} omitted` : ""})`;
  }
  return describeErrorLeaf(error);
}

/**
 * The line a failure is reported by.
 *
 * Keep the thrower's own words whenever there are any: `describeErrorTree`
 * refuses to echo arbitrary text, so routing everything through it would turn
 * "could not read open-meteo" into "Error" and trade one unreadable report for
 * another. Fall back to the cause tree only when there is no message at all.
 */
export function failureDetail(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const message = error.message.trim();
  if (message) return message;
  return describeErrorTree(error).trim() || "unknown error";
}
