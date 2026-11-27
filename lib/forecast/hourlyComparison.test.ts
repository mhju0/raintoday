import assert from "node:assert/strict";
import test from "node:test";
import { buildHourlyComparison, hourlyComparisonEnd, hourlyExtremes, hourlyMean, hourlyRibbon, hourlySourceReading, kstStamp } from "./hourlyComparison.ts";
import { seoulCaptureTime, seoulHourlySnapshots } from "../../tests/browser/fixtures/seoul-hourly.ts";

const at = (stamp: string) => Date.parse(`${stamp}:00+09:00`);

test("the Seoul replay aligns interval ends and retains independent numeric members and native timestamps", () => {
  const comparison = buildHourlyComparison(seoulHourlySnapshots, seoulCaptureTime);
  assert.deepEqual(comparison.dates, ["2026-11-22", "2026-11-23"]);
  const blocks = hourlyRibbon(comparison, at("2026-11-22T22:38"));
  assert.deepEqual(blocks.map((block) => kstStamp(block.start)), [
    "2026-11-22T21:00", "2026-11-23T00:00", "2026-11-23T03:00", "2026-11-23T06:00",
    "2026-11-23T09:00", "2026-11-23T12:00", "2026-11-23T15:00", "2026-11-23T18:00",
  ]);
  assert.deepEqual(blocks[0].hours.map((row) => row.state), ["elapsed", "in-progress", "complete"]);
  assert.equal(blocks[0].peak, 0);
  assert.equal(blocks[0].chanceHours, 1);
  assert.equal(blocks[0].sum, null);
  assert.equal(blocks[1].peak, 0);
  assert.equal(blocks[1].sum, 0);

  const [, kma, weatherApi, visual] = comparison.sources;
  const wet = blocks[5].hours[2];
  const values = (members: typeof wet.chance) => members.map(({ source, value }) => [source.id, value]);
  assert.deepEqual(values(wet.chance), [["open-meteo", 100], ["kma", 60]]);
  assert.deepEqual(values(wet.amount), [["open-meteo", 1.28], ["kma", 3], ["visual-crossing", 0.7]]);
  assert.equal(hourlyMean(wet.chance), 80);
  assert.deepEqual(hourlyExtremes(wet.chance), { low: 60, high: 100 });
  assert.ok(Math.abs(hourlyMean(wet.amount)! - 1.66) < 1e-12);
  const range = blocks[6].hours[2];
  assert.ok(Math.abs(hourlyMean(range.amount)! - 0.68) < 1e-12);
  assert.deepEqual(hourlySourceReading(kma, range.start, "amount"), {
    aligned: true, stamp: range.end, value: { lowMm: 0, highMm: 1 },
  });
  assert.deepEqual(hourlySourceReading(weatherApi, wet.end, "chance"), {
    aligned: false, stamp: wet.end, value: 71,
  });
  assert.deepEqual(hourlySourceReading(visual, wet.start, "amount"), {
    aligned: true, stamp: wet.end, value: 0.7,
  });
  assert.deepEqual(hourlySourceReading(visual, wet.start, "chance"), {
    aligned: false, stamp: wet.start, value: 100,
  });
});

test("the current clock controls elapsed and partial hours and keeps eight slots past the snapshot tail", () => {
  const data = buildHourlyComparison(seoulHourlySnapshots, seoulCaptureTime);
  const blocks = hourlyRibbon(data, at("2026-11-23T10:20"));
  assert.equal(kstStamp(blocks[0].start), "2026-11-23T09:00");
  assert.equal(kstStamp(blocks[0].end), "2026-11-23T12:00");
  assert.equal(blocks[0].chanceHours, 1);
  assert.equal(blocks[0].sum, null);
  assert.equal(kstStamp(blocks[7].end), "2026-11-24T09:00");
  assert.ok(blocks.slice(5).every(({ peak, sum, completeHours }) => peak === null && sum === null && completeHours === 3));
  const last = blocks[4].hours[2];
  assert.equal(kstStamp(last.end), "2026-11-24T00:00");
  assert.equal(hourlyComparisonEnd(data), last.end);
  assert.equal(hourlyMean(last.chance), 0);
  assert.equal(hourlyMean(last.amount), 0.01 / 3);

  const [before] = hourlyRibbon(data, at("2026-11-22T23:00") - 1);
  const [boundary] = hourlyRibbon(data, at("2026-11-22T23:00"));
  const [after] = hourlyRibbon(data, at("2026-11-22T23:00") + 1);
  assert.deepEqual(before.hours.map(({ state }) => state), ["elapsed", "in-progress", "complete"]);
  assert.deepEqual(boundary.hours.map(({ state }) => state), ["elapsed", "elapsed", "complete"]);
  assert.deepEqual(after.hours.map(({ state }) => state), ["elapsed", "elapsed", "in-progress"]);
  assert.equal(after.peak, null);
  assert.equal(after.sum, null);
  const [midnight] = hourlyRibbon(data, at("2026-11-23T00:00") + 1);
  assert.equal(kstStamp(midnight.start), "2026-11-23T00:00");
  assert.equal(midnight.sum, null);
  assert.equal(hourlyRibbon(data, at("2026-11-23T00:00"))[0].sum, 0);
});

test("stale, range, invalid and missing hours cannot fill numeric averages or a partial amount total", () => {
  const snapshots = structuredClone(seoulHourlySnapshots);
  const [open, kma, , visual] = snapshots;
  visual.status.stale = true;
  open.hourly[15].precipitationAmountUnrounded = 0.0025;
  kma.hourly[15].precipitationAmount = 0;
  kma.hourly[16].precipitationProbability = 101;
  kma.hourly.push({ ...kma.hourly[17] });
  open.hourly = open.hourly.filter((hour) => !hour.time.includes("T19:00:00"));
  const asOf = new Date("2026-11-23T14:30:00+09:00");
  const data = buildHourlyComparison(snapshots, asOf);
  const [, , , stale] = data.sources;
  const blocks = hourlyRibbon(data, at("2026-11-23T13:20"));
  assert.equal(hourlyMean(blocks[0].hours[2].amount), 0.00125);
  assert.equal(hourlySourceReading(stale, blocks[0].hours[2].start, "amount").value, 0.7);
  assert.equal(hourlySourceReading(data.sources[1], blocks[1].hours[0].start, "chance").value, "invalid");
  assert.equal(hourlyMean(blocks[1].hours[0].chance), null);
  assert.equal(hourlySourceReading(data.sources[1], blocks[1].hours[1].start, "amount").value, "invalid");
  assert.equal(blocks[1].sum, null);
  assert.equal(blocks[2].sum, null);
  assert.equal(hourlySourceReading(data.sources[0], blocks[2].hours[0].start, "amount").value, null);
  assert.equal(hourlyMean(blocks[2].hours[0].amount), null);
  for (const sources of [[], [data.sources[0]], [data.sources[0], stale]]) {
    assert.ok(hourlyRibbon({ ...data, sources }, asOf.getTime()).every(({ peak, sum }) => peak === null && sum === null));
  }
});

test("snapshot expiration follows the last supplied value on a partial day", () => {
  const asOf = new Date("2026-11-23T14:30:00+09:00");
  const [open, , weatherApi] = structuredClone(seoulHourlySnapshots);
  open.hourly = open.hourly.slice(15, 16);
  weatherApi.hourly = weatherApi.hourly.slice(15, 16);
  assert.equal(hourlyComparisonEnd(buildHourlyComparison([], asOf)), null);
  const aligned = buildHourlyComparison([open], asOf);
  const native = buildHourlyComparison([weatherApi], asOf);
  assert.equal(hourlyComparisonEnd(aligned), at("2026-11-23T15:00"));
  assert.equal(hourlyComparisonEnd(native), at("2026-11-23T16:00"));
});
