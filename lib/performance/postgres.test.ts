import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompletedComparisonsQuery,
  describePostgresError,
  isRetryablePreconnectFailure,
  PostgresPerformanceStore,
  runPostgresStatementWithRecovery,
} from "./postgres.ts";
import { COMPARED_PROVIDER_IDS } from "../providers/selection.ts";

/**
 * Behaviour lives in `storeContract.test.ts`, which runs the same suite against
 * every adapter. What remains here is the one thing a contract run cannot check
 * without a database: that placeholders and bound parameters line up, so a
 * reordered parameter list cannot silently query the wrong provider.
 */
test("PostgreSQL comparison query binds every placeholder it declares", () => {
  const query = buildCompletedComparisonsQuery("108", "06", 60);
  const placeholders = new Set(query.text.match(/\$\d+/g) ?? []);

  assert.deepEqual(query.parameters, ["108", "06", 60, ...COMPARED_PROVIDER_IDS]);
  assert.equal(placeholders.size, query.parameters.length);
  for (let index = 1; index <= query.parameters.length; index += 1) {
    assert.ok(placeholders.has(`$${index}`), `query never binds $${index}`);
  }
});

function connectionError(
  code: string,
  syscall: string = "connect",
  message = `${syscall} ${code} 127.0.0.1:5432`,
): NodeJS.ErrnoException {
  return Object.assign(new Error(message), {
    code,
    syscall,
    address: "127.0.0.1",
    port: 5432,
  });
}

test("pre-connect classifier requires positive evidence from every AggregateError leaf", () => {
  assert.equal(isRetryablePreconnectFailure(connectionError("ECONNREFUSED")), true);
  assert.equal(isRetryablePreconnectFailure(connectionError("ETIMEDOUT")), true);
  assert.equal(isRetryablePreconnectFailure(connectionError("EHOSTUNREACH")), true);
  assert.equal(isRetryablePreconnectFailure(connectionError("ENETUNREACH")), true);
  assert.equal(
    isRetryablePreconnectFailure(new AggregateError([
      connectionError("ECONNREFUSED"),
      connectionError("ENETUNREACH"),
    ])),
    true,
  );

  assert.equal(isRetryablePreconnectFailure(new AggregateError([])), false);
  assert.equal(isRetryablePreconnectFailure(connectionError("ECONNRESET")), false);
  assert.equal(isRetryablePreconnectFailure(connectionError("EPIPE", "write")), false);
  assert.equal(isRetryablePreconnectFailure(Object.assign(new Error("auth failed"), {
    code: "28P01",
  })), false);
  assert.equal(isRetryablePreconnectFailure(Object.assign(new Error("refused"), {
    code: "ECONNREFUSED",
  })), false);
  assert.equal(
    isRetryablePreconnectFailure(new AggregateError([
      connectionError("ECONNREFUSED"),
      Object.assign(new Error("ambiguous"), { code: "CONNECTION_CLOSED" }),
    ])),
    false,
  );

  const cyclic = new AggregateError([]);
  (cyclic.errors as unknown[]).push(cyclic);
  assert.equal(isRetryablePreconnectFailure(cyclic), false);
  assert.match(describePostgresError(cyclic), /cyclic AggregateError/);
});

test("empty AggregateError diagnostics expose safe child connection evidence", () => {
  const error = new AggregateError([
    connectionError(
      "ECONNREFUSED",
      "connect",
      "connect ECONNREFUSED postgres://collector:super-secret@db.example:5432/raintoday",
    ),
  ]);

  const diagnostic = describePostgresError(error);

  assert.match(diagnostic, /AggregateError/);
  assert.match(diagnostic, /connect ECONNREFUSED/);
  assert.doesNotMatch(diagnostic, /super-secret/);
  assert.match(diagnostic, /postgres:\/\/<REDACTED>@db\.example/);
});

test("statement recovery retries one proven pre-connect failure with the same payload", async () => {
  const payload = Object.freeze({ stationId: "108", observedMm: 2.5 });
  const attempts: unknown[] = [];
  let delays = 0;

  const result = await runPostgresStatementWithRecovery(
    "saveObservation",
    async () => {
      attempts.push(payload);
      if (attempts.length === 1) throw connectionError("ECONNREFUSED");
      return "stored";
    },
    {
      enabled: true,
      delayMs: 0,
      sleep: async () => { delays += 1; },
    },
  );

  assert.equal(result, "stored");
  assert.deepEqual(attempts, [payload, payload]);
  assert.equal(attempts[0], attempts[1]);
  assert.equal(delays, 1);
});

test("statement recovery keeps ambiguous failures terminal", async () => {
  let attempts = 0;
  await assert.rejects(
    () => runPostgresStatementWithRecovery(
      "saveCapture",
      async () => {
        attempts += 1;
        throw connectionError("ECONNRESET");
      },
      { enabled: true, delayMs: 0, sleep: async () => {} },
    ),
    /PostgreSQL saveCapture failed:.*ECONNRESET/,
  );
  assert.equal(attempts, 1);
});

test("statement recovery stops after two proven pre-connect failures", async () => {
  let attempts = 0;
  let delays = 0;
  await assert.rejects(
    () => runPostgresStatementWithRecovery(
      "loadCompletedComparisons",
      async () => {
        attempts += 1;
        throw connectionError("ETIMEDOUT");
      },
      {
        enabled: true,
        delayMs: 0,
        sleep: async () => { delays += 1; },
      },
    ),
    /PostgreSQL loadCompletedComparisons failed after connection retry:.*ETIMEDOUT/,
  );
  assert.equal(attempts, 2);
  assert.equal(delays, 1);
});

test("statement recovery preserves original errors when the caller did not opt in", async () => {
  const original = Object.assign(new Error("read-only transaction"), { code: "25006" });

  await assert.rejects(
    () => runPostgresStatementWithRecovery(
      "saveObservation",
      async () => { throw original; },
      { enabled: false },
    ),
    (error) => error === original && (error as NodeJS.ErrnoException).code === "25006",
  );
});

test("terminal database diagnostics do not repeat arbitrary error text", async () => {
  await assert.rejects(
    () => runPostgresStatementWithRecovery(
      "loadCompletedComparisons",
      async () => {
        throw Object.assign(new Error("password super-secret failed"), { code: "28P01" });
      },
      { enabled: true },
    ),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /PostgreSQL loadCompletedComparisons failed: 28P01/);
      assert.doesNotMatch(error.message, /super-secret/);
      return true;
    },
  );
});

/**
 * The cohort's first database statement is `initialize()`, and until #170 it was
 * the one statement with no recovery and no diagnostic. Run 35621896930 lost all
 * three attempts here in about 1.3 s each: two of them had already cleared the
 * KMA preflight, so the only evidence left was a blank line and exit 1, which
 * read as the #103/#168 route flap and sent three fixes at the wrong target.
 * A refused connection is proof nothing ran, so replaying it is safe.
 */
test("the first statement of a cohort is retried and described, never blank", async () => {
  // Port 1 is refused locally and immediately: no external network, no timeout.
  const store = new PostgresPerformanceStore("postgresql://collector@127.0.0.1:1/raintoday", {
    retryConnectionFailures: true,
  });

  const error = await store.initialize().then(
    () => null,
    (reason: unknown) => reason,
  );
  await store.close().catch(() => {});

  assert.ok(error instanceof Error, "initialize() must reject with an Error");
  assert.notEqual(error.message.trim(), "", "a blank diagnostic is the #170 defect itself");
  assert.match(error.message, /PostgreSQL initialize failed after connection retry/);
  assert.match(error.message, /ECONNREFUSED/);
});
