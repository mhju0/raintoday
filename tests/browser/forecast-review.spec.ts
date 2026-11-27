import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildHourlyComparison } from "../../lib/forecast/hourlyComparison.ts";
import { seoulCaptureTime, seoulHourlySnapshots } from "./fixtures/seoul-hourly.ts";

const response = JSON.parse(readFileSync(new URL("./fixtures/rain-forecast.json", import.meta.url), "utf8"));
const comparison = buildHourlyComparison(seoulHourlySnapshots, seoulCaptureTime);
const area = "/?lat=37.50123&lon=127.03765&name=서울특별시+강남구+역삼1동&area=b";
const initialName = "서울특별시 강남구 역삼1동";

for (const fail of [false, true]) {
  test(`Back to an evicted area, then ${fail ? "failed restore and previous result" : "Cancel"} restores location and address`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-22T22:38:00+09:00"));
    const requests: string[] = [];
    let release = () => {};
    let completeLate = () => {};
    const lateFinished = new Promise<void>((resolve) => { completeLate = resolve; });
    await page.route("**/api/local-forecast", async (route) => {
      const { name } = route.request().postDataJSON();
      requests.push(name);
      if (name === initialName && requests.length > 1) {
        if (fail) return route.fulfill({ status: 503, json: { error: "forecast_unavailable" } });
        await new Promise<void>((resolve) => { release = resolve; });
      }
      await route.fulfill({ json: { ...response, locationName: name, hourlyComparison: comparison } }).catch(() => {});
      if (name === initialName && requests.length === 10) completeLate();
    });
    await page.goto(area);
    const place = page.locator(".local-strip-place b");
    const switchLocation = page.locator("#forecast-switch");
    const firstId = await switchLocation.evaluate(() => history.state.forecastEntry);
    for (let i = 0; i < 8; i++) {
      const name = i % 2 === 0 ? "부산" : "제주";
      await switchLocation.click();
      await page.getByRole("button", { name, exact: true }).click();
      await expect(place).toContainText(name);
    }
    const tile = page.locator(".local-hourly-hit").nth(2);
    await tile.click();
    const retainedUrl = page.url();
    const retainedId = await page.evaluate(() => history.state.forecastEntry);
    await page.evaluate(() => history.go(-15));
    await expect(page.locator("#location-heading")).toBeVisible();
    await page.goBack();
    await expect.poll(() => requests.length).toBe(10);
    expect(await page.evaluate(() => history.state.forecastEntry)).toBe(firstId);
    if (fail) await page.getByRole("button", { name: "이전 예보로 돌아가기", exact: true }).click();
    else await page.locator("#forecast-cancel").click();
    await expect(place).toContainText("제주");
    await expect(tile).toHaveAttribute("aria-pressed", "true");
    expect(page.url()).toBe(retainedUrl);
    expect(await page.evaluate(() => history.state.forecastEntry)).toBe(retainedId);
    release();
    if (!fail) await lateFinished;
    await expect(place).toContainText("제주");
    expect(requests).toHaveLength(10);
    await page.reload();
    await expect(place).toContainText("제주");
    expect(requests).toHaveLength(11);
    expect(requests[10]).toContain("제주");
  });
}

for (const resume of [false, true]) {
  test(`legacy daily 10 mm safeguard stops at actual KST noon ${resume ? "after resume" : "in an open tab"}`, async ({ page }) => {
    const start = new Date("2026-11-23T11:59:58+09:00");
    await page.clock.install({ time: new Date(start.getTime() - 2_000) });
    await page.clock.pauseAt(start);
    const legacy = {
      ...response,
      today: { ...response.today, date: "2026-11-23", precipitationAmountMm: 10 },
      timeline: { ...response.timeline, reading: { firstRun: null, laterRun: null, peak: null },
        blocks: response.timeline.blocks.map((block: object, index: number) => ({
          ...block, ...(index === 0 && { startHour: 11 }), precipMax: 0, precipSumMm: 0, wet: false,
        })) },
    };
    let requests = 0;
    await page.route("**/api/local-forecast", (route) => {
      requests++;
      return route.fulfill({ json: legacy });
    });
    await page.goto(area);
    const advice = page.locator(".local-answer-action");
    await expect(advice).toContainText("10mm");
    if (resume) {
      await page.clock.setSystemTime(new Date("2026-11-23T12:05:00+09:00"));
      await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    } else {
      await page.clock.runFor(2_001);
    }
    await expect(advice).toHaveText("우산 없이 나서도 괜찮아 보여요.");
    expect(requests).toBe(1);
  });
}

test("midnight announces dated older data and identifies a selected period that expired", async ({ page }) => {
  const start = new Date("2026-11-22T23:59:58+09:00");
  await page.clock.install({ time: new Date(start.getTime() - 2_000) });
  await page.clock.pauseAt(start);
  let requests = 0;
  await page.route("**/api/local-forecast", (route) => {
    requests++;
    return route.fulfill({ json: { ...response, hourlyComparison: comparison, targetDate: "2026-11-23",
      today: { ...response.today, date: "2026-11-22" } } });
  });
  await page.goto(area);
  await page.locator(".local-hourly-hit").first().click();
  const action = page.getByRole("link", { name: "이 시간대의 예보 비교" });
  await expect(action).toHaveAttribute("href", `#compare=${Date.parse("2026-11-22T21:00:00+09:00")}`);
  await page.clock.runFor(2_001);
  const status = page.getByRole("status").filter({ hasText: "이전 응답입니다." });
  await expect(status).toContainText(/11월 22일.*11월 23일/);
  await expect(page.getByRole("status").filter({ hasText: "선택했던 시간대는 현재 범위를 벗어났어요." })).toContainText("11월 23일 00:00–03:00");
  await expect(action).toHaveAttribute("href", `#compare=${Date.parse("2026-11-23T00:00:00+09:00")}`);
  expect(requests).toBe(1);
});
