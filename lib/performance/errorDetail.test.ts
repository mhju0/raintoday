import assert from "node:assert/strict";
import test from "node:test";
import { describeErrorTree, failureDetail } from "./errorDetail.ts";

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

test("empty AggregateError diagnostics expose safe child connection evidence", () => {
  const error = new AggregateError([
    connectionError(
      "ECONNREFUSED",
      "connect",
      "connect ECONNREFUSED postgres://collector:super-secret@db.example:5432/raintoday",
    ),
  ]);

  const diagnostic = describeErrorTree(error);

  assert.match(diagnostic, /AggregateError/);
  assert.match(diagnostic, /connect ECONNREFUSED/);
  assert.doesNotMatch(diagnostic, /super-secret/);
  assert.match(diagnostic, /postgres:\/\/<REDACTED>@db\.example/);
});

/**
 * The #170 defect: an AggregateError carries its evidence in `.errors`, never in
 * `.message`, so the collector's fatal line went out blank and three fixes were
 * aimed at the KMA route instead of the database. See `fatalCaptureMessage`.
 */
test("a reported failure is never blank, and never invents one", () => {
  const refused = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), {
    code: "ECONNREFUSED",
    syscall: "connect",
  });

  assert.notEqual(failureDetail(new AggregateError([refused])).trim(), "");
  assert.match(failureDetail(new AggregateError([refused])), /ECONNREFUSED/);
  // A causeless AggregateError still names its own shape, which beats the generic line.
  assert.match(failureDetail(new AggregateError([])), /AggregateError without causes/);
  // A blank-message plain Error falls back to its name: thin, but never empty.
  assert.notEqual(failureDetail(new Error("   ")).trim(), "");
  assert.equal(failureDetail("not an error"), "unknown error");

  // An ordinary thrown message must survive verbatim: the describer refuses to
  // echo arbitrary error text, so sending everything through it would hide this.
  assert.equal(
    failureDetail(new Error("PERFORMANCE_DATABASE_URL is required")),
    "PERFORMANCE_DATABASE_URL is required",
  );
  // The capture batch's own reasons must be untouched, or #170's fix would make
  // every per-station failure read "Error" instead of naming the provider.
  assert.equal(
    failureDetail(new Error("could not read open-meteo (Open-Meteo 서버에 연결할 수 없습니다)")),
    "could not read open-meteo (Open-Meteo 서버에 연결할 수 없습니다)",
  );

  // Credentials must not ride out on the fallback path.
  const leaky = Object.assign(
    new Error("connect ECONNREFUSED postgres://collector:hunter2@db.example:5432/raintoday"),
    { code: "ECONNREFUSED", syscall: "connect" },
  );
  assert.doesNotMatch(failureDetail(new AggregateError([leaky])), /hunter2/);
});

/**
 * The KMA services carry their credential as a query parameter, so a leaked
 * request URL would print a live key into a public Actions log. The batch now
 * shares this walker, which is why the redaction has to cover more than a
 * connection string's userinfo.
 */
test("query-parameter credentials are redacted, not just connection strings", () => {
  for (const parameter of ["serviceKey", "authKey", "apiKey", "api_key", "access_token", "key"]) {
    const error = new AggregateError([
      connectionError(
        "ECONNREFUSED",
        "connect",
        `connect ECONNREFUSED https://apihub.kma.go.kr/x?${parameter}=live-secret-value&stn=108`,
      ),
    ]);
    const detail = describeErrorTree(error);
    assert.doesNotMatch(detail, /live-secret-value/, `${parameter} leaked`);
    assert.match(detail, /<REDACTED>/);
    // Everything that is not the secret must survive, or the line stops being useful.
    assert.match(detail, /stn=108/);
  }
});

test("a cyclic cause tree terminates instead of recursing forever", () => {
  const cyclic = new AggregateError([]);
  (cyclic.errors as unknown[]).push(cyclic);

  assert.match(describeErrorTree(cyclic), /cyclic AggregateError/);
  assert.notEqual(failureDetail(cyclic).trim(), "");
});

test("a very wide or deep cause tree is bounded rather than unbounded", () => {
  const wide = new AggregateError(
    Array.from({ length: 200 }, () => connectionError("ECONNREFUSED")),
  );
  const detail = describeErrorTree(wide);

  assert.match(detail, /200 causes/);
  assert.match(detail, /omitted/);
  assert.ok(detail.length < 8_000, `bounded output, got ${detail.length} characters`);

  let deep: unknown = connectionError("ECONNREFUSED");
  for (let i = 0; i < 50; i += 1) deep = new AggregateError([deep]);
  assert.match(describeErrorTree(deep), /truncated|AggregateError/);
});
