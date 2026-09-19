import assert from "node:assert/strict";
import test from "node:test";
import { KMA_ASOS_TRANSPORT_URL, probeKmaTransport } from "./transportPreflight.ts";

test("any HTTP response proves the ASOS transport is reachable", async () => {
  for (const status of [200, 401, 429, 500]) {
    let cancelled = false;
    const result = await probeKmaTransport({
      fetchImpl: async (url, init) => {
        assert.equal(url, KMA_ASOS_TRANSPORT_URL);
        assert.equal(new URL(String(url)).search, "", "the transport probe must carry no credential or query");
        assert.equal(init?.redirect, "manual");
        assert.ok(init?.signal);
        return new Response(new ReadableStream({
          cancel() { cancelled = true; },
        }), { status });
      },
    });
    assert.deepEqual(result, { reachable: true, attempt: 1, status });
    assert.equal(cancelled, true, `HTTP ${status} response body was not cancelled`);
  }
});

test("every transport failure fails without exposing unsafe error text", async () => {
  let calls = 0;
  const result = await probeKmaTransport({
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls += 1;
      throw new TypeError("fetch failed https://example.invalid/?key=private", {
        cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
      });
    },
  });
  assert.equal(calls, 4);
  assert.deepEqual(result, {
    reachable: false,
    attempts: 4,
    failures: Array.from({ length: 4 }, () => "connection timed out"),
  });
  assert.doesNotMatch(JSON.stringify(result), /private|example\.invalid/);
});

test("a second probe can recover after the first transport failure", async () => {
  let calls = 0;
  const result = await probeKmaTransport({
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error("first route failed");
      return new Response(null, { status: 401 });
    },
  });
  assert.deepEqual(result, { reachable: true, attempt: 2, status: 401 });
});

test("a route that only recovers late is still proven within the probe budget", async () => {
  // Run 35444845449 discarded three runners inside 83 seconds. A flap that
  // clears after a minute must be caught by one runner, not chased with three.
  let calls = 0;
  const waits: number[] = [];
  const result = await probeKmaTransport({
    sleepImpl: async (ms) => {
      waits.push(ms);
    },
    fetchImpl: async () => {
      calls += 1;
      if (calls < 4) throw new Error("route still down");
      return new Response(null, { status: 401 });
    },
  });
  assert.deepEqual(result, { reachable: true, attempt: 4, status: 401 });
  assert.deepEqual(waits, [20_000, 20_000, 20_000], "probes were not spaced across the flap");
  const span = waits.reduce((total, ms) => total + ms, 0) + calls * 10_000;
  assert.ok(span >= 90_000, `probe budget spans only ${span}ms`);
});

test("a reachable route pays nothing for the spacing", async () => {
  let slept = false;
  const result = await probeKmaTransport({
    sleepImpl: async () => {
      slept = true;
    },
    fetchImpl: async () => new Response(null, { status: 401 }),
  });
  assert.deepEqual(result, { reachable: true, attempt: 1, status: 401 });
  assert.equal(slept, false, "a healthy runner waited before its first probe");
});

test("each probe is bounded by its own timeout signal", async () => {
  let calls = 0;
  const started = Date.now();
  const result = await probeKmaTransport({
    timeoutMs: 10,
    sleepImpl: async () => {},
    fetchImpl: async (_url, init) => {
      calls += 1;
      const signal = init?.signal;
      assert.ok(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  });
  assert.equal(calls, 4);
  assert.equal(result.reachable, false);
  assert.ok(Date.now() - started < 1_000, "test probes did not stop at their timeout");
  if (!result.reachable) {
    assert.deepEqual(result.failures, Array.from({ length: 4 }, () => "request timed out"));
  }
});
