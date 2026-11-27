import assert from "node:assert/strict";
import test from "node:test";
import { buildHourlyComparison, hourlyBlocks, hourlyComparisonEnd, hourlyMean, hourlyRows, kstStamp } from "./hourlyComparison.ts";
import { seoulCaptureTime, seoulHourlySnapshots } from "../../tests/browser/fixtures/seoul-hourly.ts";

test("the same Seoul capture aligns interval ends, separates native metrics and retains numeric members", () => {
  const comparison = buildHourlyComparison(seoulHourlySnapshots, seoulCaptureTime);
  assert.deepEqual(comparison.dates, ["2026-11-22", "2026-11-23"]);
  const rows = hourlyRows(comparison, comparison.dates[1]);
  assert.equal(rows.length, 24);
  assert.ok(rows.every((row) => row.chance.length === 2 && row.amount.length >= 2));
  const wet = rows[14];
  assert.deepEqual(wet.chance, [{ id: "open-meteo", value: 100 }, { id: "kma", value: 60 }]);
  assert.deepEqual(wet.amount, [
    { id: "open-meteo", value: 1.28 }, { id: "kma", value: 3 }, { id: "visual-crossing", value: 0.7 },
  ]);
  assert.equal(hourlyMean(wet.chance), 80);
  assert.ok(Math.abs(hourlyMean(wet.amount)! - 1.66) < 1e-12);
  assert.ok(Math.abs(hourlyMean(rows[17].amount)! - 0.68) < 1e-12);
  assert.deepEqual(rows[17].details.find(({ source }) => source.id === "kma")?.amount, { lowMm: 0, highMm: 1 });
  assert.equal(kstStamp(rows[23].end), "2026-11-24T00:00");
  assert.equal(hourlyComparisonEnd(comparison), rows[23].end);
  assert.equal(hourlyRows(comparison, comparison.dates[1], undefined, rows[23].end)[23].elapsed, true);
  assert.equal(hourlyMean(rows[23].chance), 0);
  assert.equal(hourlyMean(rows[23].amount), 0.01 / 3);

  const weatherApi = comparison.sources.find(({ id }) => id === "weather-api")!;
  const visualCrossing = comparison.sources.find(({ id }) => id === "visual-crossing")!;
  const nativeWeather = hourlyRows(comparison, comparison.dates[1], weatherApi)[15];
  assert.equal(kstStamp(nativeWeather.start), "2026-11-23T15:00");
  assert.deepEqual(nativeWeather.reading, { chance: 71, amount: 0.85 });
  const nativeVisual = hourlyRows(comparison, comparison.dates[1], visualCrossing)[15];
  assert.deepEqual(nativeVisual.reading, { chance: 100, amount: 0.7 });
  assert.equal(wet.details.find(({ source }) => source.id === "visual-crossing")?.chance, null);

  const blocks = hourlyBlocks(rows, "average");
  assert.equal(blocks.length, 8);
  assert.equal(kstStamp(blocks[4].hours[0].start), "2026-11-23T12:00");
  assert.equal(blocks[4].peak?.value, Math.max(...rows.slice(12, 15).map((row) => hourlyMean(row.chance)!)));
  const compare = hourlyBlocks(rows, "compare");
  assert.deepEqual(compare[4].peak?.range, { low: 60, high: 100 });
});

test("elapsed, missing, duplicate, invalid, stale, and unrounded values keep distinct meanings", () => {
  const snapshots = structuredClone(seoulHourlySnapshots);
  const [open, kma, , visual] = snapshots;
  visual.status.stale = true;
  open.hourly[15].precipitationAmountUnrounded = 0.0025;
  kma.hourly[15].precipitationAmount = 0;
  kma.hourly[16].precipitationProbability = 101;
  kma.hourly.push({ ...kma.hourly[17] });
  open.hourly = open.hourly.filter((hour) => !hour.time.includes("T19:00:00"));
  const comparison = buildHourlyComparison(snapshots, new Date("2026-11-23T14:30:00+09:00"));
  const rows = hourlyRows(comparison, comparison.dates[0]);
  assert.equal(rows[13].elapsed, true);
  assert.equal(rows[13].chance.length, 0);
  assert.equal(hourlyMean(rows[14].amount), 0.00125);
  assert.equal(rows[14].amount.length, 2);
  assert.equal(rows[14].details[3].amount, 0.7);
  assert.equal(rows[15].details[1].chance, "invalid");
  assert.equal(hourlyMean(rows[15].chance), null);
  assert.equal(rows[16].details[1].amount, "invalid");
  assert.equal(rows[18].details[0].chance, null);
  const partial = hourlyBlocks(rows, "average")[4];
  assert.equal(partial.chanceHours, 1);
  assert.equal(partial.amountHours, 1);
  assert.equal(partial.sum, null);
  assert.equal(hourlyRows(comparison, comparison.dates[1]).filter((row) => row.chance.length >= 2).length, 0);
});


test("snapshot expiration follows the last supplied value on a partial day", () => {
  const asOf = new Date("2026-11-23T14:30:00+09:00");
  const [open, , weatherApi] = structuredClone(seoulHourlySnapshots);
  open.hourly = open.hourly.slice(15, 16);
  weatherApi.hourly = weatherApi.hourly.slice(15, 16);
  assert.equal(hourlyComparisonEnd(buildHourlyComparison([], asOf)), null);
  const aligned = buildHourlyComparison([open], asOf);
  const native = buildHourlyComparison([weatherApi], asOf);
  assert.equal(hourlyComparisonEnd(aligned), Date.parse("2026-11-23T15:00:00+09:00"));
  assert.equal(hourlyComparisonEnd(native), Date.parse("2026-11-23T16:00:00+09:00"));
});
