import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildHourlyComparison } from "../../lib/forecast/hourlyComparison.ts";
import { seoulCaptureTime, seoulHourlySnapshots } from "./fixtures/seoul-hourly.ts";

const response = JSON.parse(readFileSync(new URL("./fixtures/rain-forecast.json", import.meta.url), "utf8"));
const comparison = buildHourlyComparison(seoulHourlySnapshots, seoulCaptureTime);
const area = "/?lat=37.50123&lon=127.03765&name=서울특별시+강남구+역삼1동&area=b";
const recordArea = "/behind-the-data" + area.slice(1);

for (const link of [".btd-crumb a", ".btd-foot-meta a"]) {
  test(`cold record return via ${link} honors public area or opens an explicit chooser`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("raintoday.last-location.v1", JSON.stringify({
        name: "제주",
        latitude: 33.5,
        longitude: 126.5,
        elevationM: null,
        selection: { kind: "area", areaKind: "administrative-area" },
      }));
    });
    const requests: string[] = [];
    await page.route("**/api/local-forecast", (route) => {
      const { name } = route.request().postDataJSON();
      requests.push(name);
      return route.fulfill({ json: { ...response, locationName: name } });
    });

    await page.goto(recordArea);
    await page.locator(link).click();
    await expect(page.locator(".local-strip-place")).toContainText("역삼1동");
    await expect(page.locator(".local-strip-place")).toContainText("법정구역 대표 위치");
    await expect(page).toHaveURL(/area=b/);
    expect(requests).toEqual(["서울특별시 강남구 역삼1동"]);

    for (const query of [
      "station=108", "station=invalid",
      "lat=100&lon=0&name=invalid&area=b",
      "station=108&entry=11111111-1111-4111-8111-111111111111",
    ]) {
      await page.goto("/behind-the-data?" + query);
      await page.locator(link).click();
      await expect(page.locator("#location-heading")).toBeVisible();
      await expect(page).toHaveURL(/choose=1/);
    }
    expect(requests).toEqual(["서울특별시 강남구 역삼1동"]);
  });

  test(`retained record return via ${link} restores selected interval and owns focus under page load`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.setFixedTime(new Date("2026-11-22T22:38:00+09:00"));
    let requests = 0;
    await page.route("**/api/local-forecast", (route) => {
      requests += 1;
      return route.fulfill({ json: { ...response, locationName: route.request().postDataJSON().name, hourlyComparison: comparison } });
    });
    await page.goto(area);
    const slot = page.locator(".local-hourly-hit").nth(2);
    await slot.click();
    const period = await page.locator("#forecast-compare").getAttribute("href");
    const recordTrigger = page.locator("#forecast-station");
    for (let i = 0; i < 3; i++) {
      await recordTrigger.scrollIntoViewIfNeeded();
      const scroll = await page.evaluate(() => scrollY);
      await recordTrigger.click();
      await expect(page.locator(".btd")).toBeVisible();
      await page.evaluate(() => {
        const ids: string[] = [];
        Object.assign(window, { forecastReturnFocus: ids });
        document.addEventListener("focusin", (event) => {
          if (event.target instanceof HTMLElement) ids.push(event.target.id);
        });
      });
      await page.locator(link).click();
      await expect(recordTrigger).toBeFocused();
      await expect(slot).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#forecast-compare")).toHaveAttribute("href", period!);
      await expect(page.locator(".local-strip-place")).toContainText("법정구역 대표 위치");
      const focus = await page.evaluate(() => ({
        ids: (window as Window & { forecastReturnFocus?: string[] }).forecastReturnFocus,
        top: scrollY,
      }));
      expect(focus.ids).toContain("forecast-station");
      expect(focus.ids).not.toContain("forecast-heading");
      expect(focus.top).toBeCloseTo(scroll, 0);
    }
    expect(requests).toBe(1);
  });
}

test("hourly wording distinguishes amount evidence and the displayed comparison window", async ({ page }) => {
  const from = new Date("2026-11-22T23:30:00+09:00");
  await page.clock.setFixedTime(from);
  const hourlyComparison = buildHourlyComparison(seoulHourlySnapshots, from);
  for (const source of hourlyComparison.sources) source.hours = {};
  const one = hourlyComparison.sources.find(({ id }) => id === "open-meteo")!;
  one.hours[Date.parse("2026-11-23T01:00:00+09:00")] = { chance: 0, amount: 1 };
  let requests = 0;
  await page.route("**/api/local-forecast", (route) => {
    requests++;
    return route.fulfill({ json: { ...response, hourlyComparison, today: null, targetDate: "2026-11-23" } });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(area);
  await expect(page.locator("#forecast-heading")).toHaveText("자정까지 온전히 남은 예보 시간이 없어요");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
  const tiles = page.locator(".local-hourly-hit");
  await expect(tiles.nth(0)).toHaveAccessibleName(/합계 없음 · 온전한 3시간 필요/);
  await expect(tiles.nth(1)).toHaveAccessibleName(/한 곳만 발표한 시간 포함/);
  await expect(tiles.nth(2)).toHaveAccessibleName(/강수량 미발표/);
  await tiles.nth(1).click();
  await expect(page.locator(".local-hourly-readout")).toContainText("한 곳만 발표한 시간 포함");

  const outside = Date.parse("2026-11-23T21:00:00+09:00");
  await page.goto(area + "#compare=" + outside);
  await expect(page.getByRole("status").filter({ hasText: "현재 리본 범위 밖" })).toBeVisible();
  await expect(page.getByText("현재 응답에서 이 시간대의 예보를 확인할 수 없어요.")).toHaveCount(0);
  expect(requests).toBe(2);
});
