import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildHourlyComparison } from "../../lib/forecast/hourlyComparison.ts";
import { seoulCaptureTime, seoulHourlySnapshots } from "./fixtures/seoul-hourly.ts";

const response = JSON.parse(readFileSync(new URL("./fixtures/rain-forecast.json", import.meta.url), "utf8"));
const comparison = buildHourlyComparison(seoulHourlySnapshots, seoulCaptureTime);

async function setup(page: Page, holdBusan = false) {
  await page.clock.setFixedTime(new Date("2026-11-22T22:38:00+09:00"));
  const requests: string[] = [];
  let release = () => {};
  let finish = () => {};
  const busanFinished = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("**/api/local-forecast", async (route) => {
    const { name } = route.request().postDataJSON();
    requests.push(name);
    if (holdBusan && name === "부산광역시") await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: { ...response, locationName: name, hourlyComparison: comparison } }).catch(() => {});
    if (name === "부산광역시") finish();
  });
  await page.goto("/");
  const initial = page.url();
  await page.getByRole("button", { name: "서울", exact: true }).click();
  const place = page.locator(".local-strip-place b");
  const switchPlace = page.locator("#forecast-switch");
  await expect(place).toHaveText("서울특별시");
  const seoulUrl = page.url();
  const seoulId = await page.evaluate(() => history.state.forecastEntry);
  const slot = page.locator(".local-hourly-hit").nth(3);
  await slot.click();
  const period = await page.locator("#forecast-compare").getAttribute("href");
  return { requests, release: () => release(), busanFinished, initial, place, switchPlace, seoulUrl, seoulId, slot, period };
}

for (const cancel of [true, false]) {
  test(`pending ordinary switch via ${cancel ? "Cancel" : "browser Back"} keeps the original history stack`, async ({ page }) => {
    const journey = await setup(page, true);
    await journey.switchPlace.click();
    await page.getByRole("button", { name: "부산", exact: true }).click();
    await expect.poll(() => journey.requests).toEqual(["서울특별시", "부산광역시"]);
    if (cancel) await page.locator("#forecast-cancel").click();
    else await page.goBack();
    await expect(journey.place).toHaveText("서울특별시");
    await expect(page).toHaveURL(journey.seoulUrl);
    await expect(journey.slot).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#forecast-compare")).toHaveAttribute("href", journey.period!);
    await expect(journey.switchPlace).toBeFocused();
    journey.release();
    await journey.busanFinished;
    await expect(journey.place).toHaveText("서울특별시");
    expect(await page.evaluate(() => history.state.forecastReturn)).toBeUndefined();

    await page.goBack();
    await expect(page.locator("#location-heading")).toBeVisible();
    await expect(page).toHaveURL(journey.initial);
    await expect(page.getByRole("combobox", { name: "대한민국 지역 검색" })).toBeFocused();
    await page.goForward();
    await expect(journey.place).toHaveText("서울특별시");
    await expect(page).toHaveURL(journey.seoulUrl);
    await expect(journey.slot).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#forecast-compare")).toHaveAttribute("href", journey.period!);
    await expect(journey.switchPlace).toBeFocused();
    expect(await page.evaluate(() => history.state.forecastEntry)).toBe(journey.seoulId);
    expect(journey.requests).toEqual(["서울특별시", "부산광역시"]);
  });
}

test("completed ordinary switch traverses the chooser and its two distinct cities", async ({ page }) => {
  const journey = await setup(page);
  await journey.switchPlace.click();
  const chooserUrl = page.url();
  expect(await page.evaluate(() => ({
    view: history.state.raintodayView,
    entry: history.state.forecastEntry,
    origin: history.state.forecastReturn,
    detail: history.state.forecastDetail,
    coordinates: history.state.location,
  }))).toEqual({ view: "chooser", entry: undefined, origin: journey.seoulId, detail: undefined, coordinates: undefined });
  await page.getByRole("button", { name: "부산", exact: true }).click();
  await expect(journey.place).toHaveText("부산광역시");
  const busanUrl = page.url();
  const busanId = await page.evaluate(() => history.state.forecastEntry);
  expect(busanId).not.toBe(journey.seoulId);
  const busanSlot = page.locator(".local-hourly-hit").nth(4);
  await busanSlot.click();
  const busanPeriod = await page.locator("#forecast-compare").getAttribute("href");

  await page.goBack();
  const chooserTitle = page.locator("#location-heading");
  await expect(chooserTitle).toBeVisible();
  await expect(page).toHaveURL(chooserUrl);
  await page.goBack();
  await expect(journey.place).toHaveText("서울특별시");
  await expect(page).toHaveURL(journey.seoulUrl);
  await expect(journey.slot).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#forecast-compare")).toHaveAttribute("href", journey.period!);
  await expect(journey.switchPlace).toBeFocused();
  await page.goForward();
  await expect(chooserTitle).toBeVisible();
  await expect(page).toHaveURL(chooserUrl);
  await page.goForward();
  await expect(journey.place).toHaveText("부산광역시");
  await expect(page).toHaveURL(busanUrl);
  await expect(busanSlot).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#forecast-compare")).toHaveAttribute("href", busanPeriod!);
  await expect(page.locator("#forecast-compare")).toBeFocused();
  expect(await page.evaluate(() => ({
    entry: history.state.forecastEntry,
    origin: history.state.forecastReturn,
    location: history.state.location,
  }))).toEqual({ entry: busanId, origin: undefined, location: undefined });
  expect(journey.requests).toEqual(["서울특별시", "부산광역시"]);
  await page.reload();
  await expect(journey.place).toHaveText("부산광역시");
  await expect(page).toHaveURL(busanUrl);
  expect(journey.requests).toEqual(["서울특별시", "부산광역시", "부산광역시"]);
});
