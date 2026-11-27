import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildHourlyComparison } from "../../lib/forecast/hourlyComparison.ts";
import { seoulCaptureTime, seoulHourlySnapshots } from "./fixtures/seoul-hourly.ts";

const baseline = JSON.parse(readFileSync(new URL("./fixtures/rain-forecast.json", import.meta.url), "utf8"));
const forecast = { ...baseline, locationName: "서울", hourlyComparison: buildHourlyComparison(seoulHourlySnapshots, seoulCaptureTime) };
const seoulUrl = "/?lat=37.5714&lon=126.9658&name=서울&area=h";

function controls(page: Page) {
  const panel = page.getByRole("region", { name: "시간대별 강수 예보" });
  return {
    panel,
    mode: panel.getByRole("combobox", { name: "시간별 예보 보기" }),
    date: panel.getByRole("combobox", { name: "예보 날짜" }),
    hour: panel.getByRole("combobox", { name: "정확한 한 시간" }),
    exact: panel.locator(".local-hourly-exact"),
    tiles: panel.getByRole("list", { name: "하루 여덟 구간" }).getByRole("listitem"),
  };
}

for (const width of [320, 768, 1440]) {
  test(`eight periods reflow at ${width}px and 200% text, with exact scope and no requests on controls`, async ({ page }) => {
    await page.clock.setFixedTime(seoulCaptureTime);
    let requests = 0;
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/local-forecast", (route) => {
      requests += 1;
      return route.fulfill({ json: forecast });
    });
    await page.goto(seoulUrl);
    const { panel, mode, date, hour, exact, tiles } = controls(page);
    await expect(mode).toHaveValue("primary");
    await expect(panel.getByRole("heading", { name: /단독 예보/ })).toBeVisible();
    await mode.focus();
    await expect(mode).toBeFocused();
    await mode.selectOption("average");
    await expect(mode).toHaveValue("average");
    await expect(tiles).toHaveCount(8);
    await expect(tiles.first()).toContainText("지난 구간");
    await expect(tiles.last()).toContainText("21:00–24:00");
    await date.selectOption("2026-11-23");
    await expect(panel.locator(".local-hourly-date")).toHaveText("2026-11-23 KST");
    await expect(tiles.nth(4).locator(".local-hourly-period")).toHaveText("12:00–15:00");
    await expect(tiles.nth(5)).toContainText("양 2–3곳");
    const { dateX, timeX, trackX } = await panel.evaluate((el) => {
      const contentX = (selector: string) => {
        const child = el.querySelector(selector)!;
        return child.getBoundingClientRect().left + parseFloat(getComputedStyle(child).paddingLeft);
      };
      return { dateX: contentX(".local-hourly-date"), timeX: contentX(".local-hourly-period"), trackX: contentX(".local-hourly-track") };
    });
    expect(dateX).toBeCloseTo(timeX, 0);
    expect(trackX).toBeCloseTo(timeX, 0);
    await hour.selectOption("14");
    await expect(exact).toContainText("강수확률 · 2곳");
    await expect(exact).toContainText("80%");
    await expect(exact).toContainText("강수량 · 3곳");
    await expect(exact).toContainText("1.66 mm");
    await hour.selectOption("23");
    await expect(exact).toContainText("2026-11-23 23:00–2026-11-24 00:00 KST");
    await expect(exact).toContainText("0.0033333 mm");
    await mode.selectOption("compare");
    await hour.selectOption("14");
    const percentWidth = (row: ReturnType<Page["getByRole"]>) => row.locator(".local-hourly-track").evaluate((track) => {
      return track.querySelector("i")!.getBoundingClientRect().width / track.getBoundingClientRect().width;
    });
    const kma = exact.getByRole("row", { name: /기상청/ });
    expect(await percentWidth(kma)).toBeCloseTo(0.6, 3);
    expect(await percentWidth(exact.getByRole("row", { name: /Open-Meteo/ }))).toBeCloseTo(1, 3);
    await hour.selectOption("17");
    await expect(kma).toContainText("1 mm 미만");
    await expect(exact).toContainText("강수량 차이 · 2곳");
    await mode.selectOption("kma");
    await panel.getByText("시간별 수치 표", { exact: true }).press("Enter");
    const dayKma = panel.getByRole("row", { name: /^14:00–15:00/ });
    await expect(dayKma).toBeVisible();
    expect(await percentWidth(dayKma)).toBeCloseTo(0.6, 3);
    await dayKma.getByRole("button").click();
    await expect(hour).toBeFocused();
    await expect(hour).toHaveValue("14");
    await mode.selectOption("weather-api");
    await panel.getByRole("combobox", { name: "정확한 제공사 시각" }).selectOption("15");
    await expect(exact).toContainText("2026-11-23 15:00 KST");
    await expect(exact).toContainText("71%");
    await expect(exact).toContainText("0.85 mm");
    await expect(panel).toContainText("확률과 양의 적용 구간 미확인");
    await mode.selectOption("visual-crossing");
    await panel.getByRole("combobox", { name: "정확한 제공사 시각" }).selectOption("15");
    await expect(exact).toContainText("양 유효 구간 2026-11-23 14:00–2026-11-23 15:00 KST");
    await expect(mode.locator('option[value="pirate-weather"]')).toHaveCount(0);
    await date.selectOption("2026-11-22");
    await expect(mode).toHaveValue("compare");
    await expect(panel.locator(".local-hourly-date")).toHaveText("2026-11-22 KST");
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await expect(tiles).toHaveCount(8);
    const widths = await panel.evaluate((el) => ({
      scroll: document.documentElement.scrollWidth, viewport: window.innerWidth,
      panel: el.clientWidth, content: el.scrollWidth,
    }));
    expect(widths.content).toBeLessThanOrEqual(widths.panel + 1);
    expect(widths.scroll).toBeLessThanOrEqual(widths.viewport + 1);
    await mode.selectOption("primary");
    await expect(panel.getByRole("heading", { name: /단독 예보/ })).toBeVisible();
    expect(requests).toBe(1);
  });
}

test("a delayed previous location cannot restore its hourly values or local comparison choices", async ({ page }) => {
  await page.clock.setFixedTime(seoulCaptureTime);
  let respond!: () => void;
  const paused = new Promise<void>((resolve) => { respond = resolve; });
  await page.route("**/api/local-forecast", async (route) => {
    const { latitude } = route.request().postDataJSON();
    if (latitude === 37.5714) {
      await paused;
      await route.fulfill({ json: forecast });
    } else {
      await route.fulfill({ json: { ...forecast, locationName: "제주", hourlyComparison: {
        ...forecast.hourlyComparison, sources: [],
      } } });
    }
  });
  await page.goto(seoulUrl);
  await expect(page.locator(".local-loading")).toBeVisible();
  await page.evaluate(() => {
    history.pushState(null, "", "/?lat=33.513&lon=126.529&name=제주&area=h");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.locator(".local-strip-place b")).toHaveText("제주");
  const { mode, date, exact, panel, tiles } = controls(page);
  await mode.selectOption("average");
  await date.selectOption("2026-11-23");
  await expect(tiles).toHaveCount(8);
  const previous = page.waitForResponse((response) => response.url().endsWith("/api/local-forecast") && response.request().postDataJSON()?.latitude === 37.5714);
  respond();
  await (await previous).finished();
  await expect(page.locator(".local-strip-place b")).toHaveText("제주");
  await expect(panel.locator(".local-hourly-date")).toHaveText("2026-11-23 KST");
  await expect(exact).toContainText("강수확률 · 0곳");
  await expect(mode.locator('option[value="open-meteo"]')).toHaveCount(0);

  await page.evaluate((url) => {
    history.pushState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, seoulUrl);
  await expect(page.locator(".local-strip-place b")).toHaveText("서울");
  await expect(mode).toHaveValue("primary");
  await mode.selectOption("average");
  await expect(date).toHaveValue("2026-11-22");
});

test("viewing time expires hours and relabels KST dates without requesting a forecast", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-22T22:59:55+09:00") });
  await page.clock.pauseAt(new Date("2026-11-22T22:59:56+09:00"));
  let requests = 0;
  await page.route("**/api/local-forecast", (route) => {
    requests += 1;
    expect(route.request().postDataJSON().latitude).toBe(37.5714);
    const payload = requests === 1 ? forecast : {
      ...forecast,
      hourlyComparison: buildHourlyComparison([], new Date("2026-11-24T00:00:00+09:00")),
    };
    return route.fulfill({ json: payload });
  });
  await page.goto(seoulUrl);
  const { panel, mode, date, hour, exact } = controls(page);
  await mode.selectOption("average");
  await date.selectOption("2026-11-23");
  await date.selectOption("2026-11-22");
  await expect(date.locator("option:checked")).toHaveText("오늘");
  await hour.selectOption("22");
  await expect(exact.locator(".local-hourly-reading")).toContainText("미발표");
  await page.clock.runFor(4_000);
  await expect(exact.getByText("지난 시간", { exact: true })).toBeVisible();
  await hour.selectOption("23");
  await expect(exact.locator(".local-hourly-reading")).toContainText("0%");
  await expect(panel.locator(".local-hourly-valid")).toHaveText("2026-11-22 23:00–2026-11-23 00:00 KST");

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(3_600_000);
  await expect(date.locator("option:checked")).toHaveText("오늘");
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "visibilityState");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(date.locator("option:checked")).toHaveText("2026-11-22");
  await expect(date.locator('option[value="2026-11-23"]')).toHaveText("오늘");
  await expect(exact.getByText("지난 시간", { exact: true })).toBeVisible();
  await expect(panel.locator(".local-hourly-valid")).toHaveText("2026-11-22 23:00–2026-11-23 00:00 KST");
  await date.selectOption("2026-11-23");
  await hour.selectOption("0");
  await expect(exact.locator(".local-hourly-reading")).toContainText("0%");
  await page.clock.fastForward(24 * 3_600_000);
  await expect(date.locator("option:checked")).toHaveText("2026-11-23");
  const refresh = panel.getByRole("button", { name: "예보 다시 불러오기" });
  await expect(refresh).toBeVisible();
  expect(requests).toBe(1);

  await refresh.click();
  await expect(mode).toHaveValue("primary");
  await mode.selectOption("average");
  await expect(date).toHaveValue("2026-11-24");
  await expect(date.locator("option:checked")).toHaveText("오늘");
  await expect(refresh).toHaveCount(0);
  await expect(exact.locator(".local-hourly-reading")).toContainText("미발표");
  expect(requests).toBe(2);
});
