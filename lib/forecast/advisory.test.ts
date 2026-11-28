import assert from "node:assert/strict";
import test from "node:test";
import { readUmbrellaEvidence } from "./advisory.ts";
import { hourlyRibbon, type HourlyComparison } from "./hourlyComparison.ts";

const at = (time: string) => Date.parse(`2026-11-${time}:00+09:00`);

function fixture(primary: number, second: number, stamp = at("23T15:00")): HourlyComparison {
  return {
    asOf: at("23T10:20"), dates: ["2026-11-23", "2026-11-24"],
    sources: [
      { id: "open-meteo", name: "Open-Meteo", status: "fresh", hours: { [stamp]: { chance: primary, amount: 0 } } },
      { id: "kma", name: "기상청", status: "fresh", hours: { [stamp]: { chance: second, amount: 1.34 } } },
    ],
  };
}

function read(data: HourlyComparison, viewedAt: number, dailyAmount: number | null = 2) {
  return readUmbrellaEvidence(data, hourlyRibbon(data, viewedAt), viewedAt, "Open-Meteo", dailyAmount, 40);
}

test("same-hour disagreement uses unrounded comparisons and its own hourly amount", () => {
  for (const [pair, expected] of [
    [[0, 79.9998], null],
    [[0, 80], 40],
    [[0, 80.0002], 40.0001],
    [[60, 0], 30],
    [[80, 0], null],
  ] as const) {
    const data = fixture(pair[0], pair[1]);
    const evidence = read(data, data.asOf);
    assert.equal(evidence.disagreement?.chance ?? null, expected);
    assert.equal(evidence.primaryWet, pair[0] >= 40);
    if (evidence.first) assert.equal(evidence.first.amount, 0.67);
  }
});

test("unknown primary, incomplete coverage and tomorrow-only evidence do not infer a dry agreement", () => {
  const data = fixture(0, 80, at("24T02:00"));
  const today = read(data, data.asOf);
  assert.equal(today.disagreement, undefined);
  assert.equal(today.dry, false);
  assert.equal(today.first?.start, at("24T01:00"));
  const tomorrow = read(data, at("24T00:00"));
  assert.equal(tomorrow.current, false);
  data.sources[0].status = "stale";
  const stale = read(data, at("24T00:00"));
  assert.equal(stale.disagreement, undefined);
  assert.equal(stale.first, undefined);
  const partial = read(fixture(0, 80, at("23T00:00")), at("23T23:30"));
  assert.equal(partial.remainingHours, 0);
  assert.equal(partial.dry, false);
});

test("the daily 10 mm safeguard is exact and expires at KST noon", () => {
  const data = fixture(0, 0);
  const justBefore = at("23T12:00") - 1;
  assert.equal(read(data, justBefore, 9.999).morning, false);
  assert.equal(read(data, justBefore, null).morning, false);
  assert.equal(read(data, justBefore, 10).morning, true);
  assert.equal(read(data, at("23T12:00"), 10).morning, false);
});
