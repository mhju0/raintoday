import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildHourlyComparison } from "../../lib/forecast/hourlyComparison.ts";
import { seoulCaptureTime, seoulHourlySnapshots } from "./fixtures/seoul-hourly.ts";

const baseline = JSON.parse(readFileSync(new URL("./fixtures/rain-forecast.json", import.meta.url), "utf8"));
const forecast = { ...baseline, locationName: "서울", hourlyComparison: buildHourlyComparison(seoulHourlySnapshots, seoulCaptureTime) };
const seoulUrl = "/?lat=37.5714&lon=126.9658&name=서울&area=h";
const at = (stamp: string) => new Date(`${stamp}+09:00`);

function controls(page: Page) {
  const panel = page.getByRole("region", { name: "시간대별 강수 예보" });
  return {
    panel,
    mode: page.getByRole("combobox", { name: "서비스별 예보 보기" }),
    reveal: panel.getByRole("link", { name: "이 시간대의 예보 비교" }),
    back: page.getByRole("link", { name: "← 예보로 돌아가기" }),
    tiles: panel.getByRole("list", { name: "연속된 3시간 구간 8개" }).getByRole("listitem"),
    table: page.getByRole("region", { name: "같은 시간대의 서비스 비교" }).getByRole("table"),
    raw: page.getByRole("region", { name: "서비스 원값" }).getByRole("table"),
  };
}

for (const width of [320, 390, 768, 1440]) {
  test(`the average opens in one navigable row at ${width}px and 200% text`, async ({ page }) => {
    await page.clock.setFixedTime(at("2026-11-22T22:38:00"));
    await page.setViewportSize({ width, height: 900 });
    let requests = 0;
    await page.route("**/api/local-forecast", (route) => {
      requests += 1;
      return route.fulfill({ json: forecast });
    });
    await page.goto(seoulUrl);
    const { panel, mode, reveal, table, raw, back, tiles } = controls(page);
    await expect(panel).toContainText("서비스 평균 · 11월 22일 KST");
    await expect(panel.getByRole("combobox")).toHaveCount(0);
    await expect(tiles).toHaveCount(8);
    await expect(tiles.first()).toHaveAttribute("aria-current", "time");
    await expect(tiles.first().getByRole("button")).toHaveAccessibleName(/지금, 11월 22일 21:00–00:00, 최고 확률 0%, 강수량 합계 없음 · 온전한 3시간 필요, 남은 1시간 반영/);
    await expect(tiles.first().getByText("남은 1시간 반영")).toBeVisible();
    await expect(tiles.first().locator(".local-ribbon-bar")).toHaveCount(0);
    await expect(tiles.nth(1)).toHaveClass(/is-daybreak/);
    await expect(tiles.nth(1).getByRole("button")).toHaveAccessibleName(/11월 23일 00:00–03:00, 최고 확률 0%, 강수량 0 mm/);
    await expect(tiles.last().getByRole("button")).toHaveAccessibleName(/18:00–21:00/);
    const scroller = panel.locator(".local-ribbon-scroll");
    if (width < 1000) {
      await expect(panel.getByText("옆으로 넘겨 다음 시간 보기")).toBeVisible();
      expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    } else {
      await expect(panel.getByText("옆으로 넘겨 다음 시간 보기")).toBeHidden();
      expect(await scroller.evaluate((el) => el.scrollWidth === el.clientWidth)).toBe(true);
    }

    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await tiles.first().getByRole("button").focus();
    await page.keyboard.press("End");
    await expect(tiles.last().getByRole("button")).toBeFocused();
    expect(await scroller.evaluate((el) => Math.abs(el.scrollWidth - el.clientWidth - el.scrollLeft))).toBeLessThanOrEqual(2);
    await expect(panel.getByText("앞 시간 보기")).toBeVisible();
    await expect(panel.getByRole("status")).toContainText("최고 확률 72.5%");
    await page.keyboard.press("Home");
    await expect(tiles.first().getByRole("button")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(tiles.nth(1).getByRole("button")).toBeFocused();
    await tiles.nth(5).getByRole("button").click();
    await reveal.press("Enter");
    await expect(mode).toHaveValue("");
    await expect(table.getByRole("row", { name: /14:00–15:00/ })).toContainText("60%–100%평균 80%2곳 · Open-Meteo, 기상청");
    await expect(table.getByRole("row", { name: /14:00–15:00/ })).toContainText("1.66 mm3곳");
    await back.click();
    await expect(reveal).toBeFocused();
    await tiles.nth(6).getByRole("button").click();
    await reveal.click();
    await mode.selectOption("kma");
    await expect(raw.getByRole("row", { name: /17:00–18:00/ })).toContainText("1 mm 미만");
    await mode.selectOption("weather-api");
    await expect(raw.getByRole("row", { name: /15:00–16:00/ })).toContainText("71%15:00 제공사 시각");
    await expect(raw.getByRole("row", { name: /15:00–16:00/ })).toContainText("0.85 mm15:00 제공사 시각");
    await mode.selectOption("visual-crossing");
    await expect(raw.getByRole("row", { name: /15:00–16:00/ })).toContainText("0.7 mm16:00 종료");
    await expect(raw.getByRole("row", { name: /15:00–16:00/ })).toContainText("100%15:00 제공사 시각");
    await expect(mode.locator('option[value="pirate-weather"]')).toHaveCount(0);
    expect(await raw.locator('th[scope="row"] span').evaluateAll((times) =>
      times.every((time) => time.getClientRects().length === 1))).toBe(true);

    await back.click();
    await expect(reveal).toBeFocused();
    const layout = await tiles.evaluateAll((elements) => ({
      tops: new Set(elements.map((el) => el.getBoundingClientRect().top)).size,
      page: document.documentElement.scrollWidth, viewport: window.innerWidth,
      labelsFit: elements.every((el) => el.querySelector(".local-ribbon-rng")!.scrollWidth <= el.clientWidth),
    }));
    expect(layout.tops).toBe(1);
    expect(layout.labelsFit).toBe(true);
    expect(layout.page).toBeLessThanOrEqual(layout.viewport + 1);
    await expect(mode).toBeHidden();
    expect(requests).toBe(1);
  });
}

test("a mobile swipe reaches later blocks and tapping reads the selected range", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    await page.clock.setFixedTime(at("2026-11-22T22:38:00"));
    await page.route("**/api/local-forecast", (route) => route.fulfill({ json: forecast }));
    await page.goto(seoulUrl);
    const { panel, tiles } = controls(page);
    const scroller = panel.locator(".local-ribbon-scroll");
    await scroller.scrollIntoViewIfNeeded();
    const box = (await scroller.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const y = Math.round(box.y + box.height / 2);
    const right = Math.floor(box.x + box.width - 25);
    const dispatch = (type: "touchStart" | "touchMove" | "touchEnd", x: number) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await dispatch("touchStart", right);
    for (let step = 1; step <= 8; step += 1) await dispatch("touchMove", right - 35 * step);
    await dispatch("touchEnd", 0);
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
    await tiles.nth(3).getByRole("button").tap();
    await expect(panel.getByRole("status")).toContainText("11월 23일 06:00–09:00");
  } finally {
    await page.close();
  }
});

test("threshold uses full precision and zero percent can still carry a tiny positive amount", async ({ page }) => {
  const now = at("2026-11-23T10:20:00");
  await page.clock.setFixedTime(now);
  const comparison = buildHourlyComparison(seoulHourlySnapshots.slice(0, 2), now);
  for (const source of comparison.sources) source.hours = {};
  const values = [0, 39, 40, 41, 39.9999, 0];
  for (const [index, chance] of values.entries()) {
    const start = at("2026-11-23T09:00:00").getTime() + index * 3 * 3_600_000;
    for (const source of comparison.sources) {
      for (let hour = 1; hour <= 3; hour += 1) {
        source.hours[start + hour * 3_600_000] = { chance, amount: index === 5 ? 0.001 : 0 };
      }
    }
  }
  await page.route("**/api/local-forecast", (route) => route.fulfill({ json: { ...forecast, hourlyComparison: comparison } }));
  await page.goto(seoulUrl);
  const { panel, tiles } = controls(page);
  await expect(tiles.first().getByRole("button")).toHaveAccessibleName(/지금, 11월 23일 09:00–12:00, 최고 확률 0%, 강수량 합계 없음/);
  await expect(tiles.nth(1).getByRole("button")).toHaveAccessibleName(/39%/);
  await expect(tiles.nth(1)).not.toHaveClass(/is-wet/);
  await expect(tiles.nth(2).getByRole("button")).toHaveAccessibleName(/40%.*비 가능성/);
  await expect(tiles.nth(2)).toHaveClass(/is-wet/);
  await expect(tiles.nth(3).getByRole("button")).toHaveAccessibleName(/41%.*비 가능성/);
  await expect(tiles.nth(3)).toHaveClass(/is-wet/);
  await expect(tiles.nth(4).getByRole("button")).toHaveAccessibleName(/<40%/);
  await expect(tiles.nth(4)).not.toHaveClass(/is-wet/);
  await expect(tiles.nth(5).getByRole("button")).toHaveAccessibleName(/최고 확률 0%, 강수량 <0.01 mm/);
  await expect(tiles.nth(5).locator(".local-ribbon-track")).not.toHaveClass(/is-na/);
  await expect(tiles.nth(5).locator(".local-ribbon-bar")).toHaveCount(0);
  await expect(tiles.last().locator(".local-ribbon-track")).toHaveClass(/is-na/);
  await expect(tiles.last().getByRole("button")).toHaveAccessibleName(/최고 확률 미발표, 강수량 미발표/);
  await expect(panel.getByText("10:20", { exact: true })).toHaveCount(0);
});

test("a partially published wet block and later wet hours stay separate in the hourly summary", async ({ page }) => {
  const now = at("2026-11-23T10:20:00");
  await page.clock.setFixedTime(now);
  const comparison = buildHourlyComparison(seoulHourlySnapshots.slice(0, 2), now);
  const intervals: [string, number][] = [
    ["12:00", 0], ["15:00", 80], ["16:00", 0], ["17:00", 0], ["18:00", 0], ["20:00", 90],
  ];
  for (const source of comparison.sources) {
    source.hours = Object.fromEntries(intervals.map(
      ([time, chance]) => [at(`2026-11-23T${time}:00`).getTime(), { chance, amount: 0 }],
    ));
  }
  let requests = 0;
  await page.route("**/api/local-forecast", (route) => {
    requests += 1;
    return route.fulfill({ json: { ...forecast, hourlyComparison: comparison } });
  });
  await page.goto(seoulUrl);
  const { tiles, reveal, table } = controls(page);
  await expect(page.locator(".local-answer-action")).toContainText("14:00–15:00");
  await expect(page.locator(".local-answer-action")).not.toContainText("12:00부터");
  await expect(tiles.nth(1).getByRole("button")).toHaveAccessibleName(/최고 확률 80%.*확률 1\/3시간/);
  await tiles.nth(1).getByRole("button").click();
  await reveal.click();
  await expect(table.getByRole("row", { name: /12:00–13:00/ })).toContainText("미발표");
  await expect(table.getByRole("row", { name: /13:00–14:00/ })).toContainText("미발표");
  await expect(table.getByRole("row", { name: /14:00–15:00/ })).toContainText("80%");
  expect(requests).toBe(1);
});

test("the response tail keeps the midnight-ending amount and hides third-date native chance", async ({ page }) => {
  await page.clock.setFixedTime(at("2026-11-23T10:20:00"));
  let requests = 0;
  await page.route("**/api/local-forecast", (route) => {
    requests += 1;
    return route.fulfill({ json: forecast });
  });
  await page.goto(seoulUrl);
  const { tiles, reveal, mode, raw, back } = controls(page);
  await tiles.nth(4).getByRole("button").click();
  await reveal.click();
  await mode.selectOption("visual-crossing");
  const preceding = raw.getByRole("row", { name: /23:00–00:00/ });
  await expect(preceding.getByRole("cell").last()).toHaveText("0 mm00:00 종료");
  await back.click();
  await tiles.nth(5).getByRole("button").click();
  await expect(tiles.nth(5).getByRole("button")).toHaveAccessibleName(/최고 확률 미발표, 강수량 미발표/);
  await reveal.click();
  await mode.selectOption("visual-crossing");
  const beyond = raw.getByRole("row", { name: /00:00–01:00/ });
  await expect(beyond.getByRole("cell").first()).toHaveText("응답 범위 밖");
  await expect(beyond.getByRole("cell").last()).toHaveText("응답 범위 밖");
  expect(requests).toBe(1);
});

test("one source stays available for inspection and a delayed location cannot restore its hourly values", async ({ page }) => {
  await page.clock.setFixedTime(at("2026-11-22T22:38:00"));
  let respond!: () => void;
  const paused = new Promise<void>((resolve) => { respond = resolve; });
  let seoulRequests = 0;
  await page.route("**/api/local-forecast", async (route) => {
    const { latitude } = route.request().postDataJSON();
    if (latitude === 37.5714) {
      if (++seoulRequests === 1) await paused;
      await route.fulfill({ json: forecast });
    } else {
      await route.fulfill({ json: { ...forecast, locationName: "제주", hourlyComparison: {
        ...forecast.hourlyComparison, sources: forecast.hourlyComparison.sources.slice(0, 1),
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
  const { mode, panel, reveal, tiles, table, raw } = controls(page);
  await expect(panel).toContainText("평균 자료 부족");
  await expect(tiles).toHaveCount(8);
  await expect(tiles.nth(1).getByRole("button")).toHaveAccessibleName(/최고 확률 미발표/);
  await reveal.click();
  await expect(table).toContainText("1곳 · Open-Meteo");
  await mode.selectOption("open-meteo");
  await expect(raw.getByRole("row", { name: /23:00–00:00/ })).toContainText("0%");
  respond();
  await expect(page.getByText(/제주 ·/)).toBeVisible();
  await expect(mode).toHaveValue("open-meteo");

  await page.evaluate((url) => {
    history.pushState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, seoulUrl);
  await expect(page.locator(".local-strip-place b")).toHaveText("서울");
  await expect(mode).toBeHidden();
  await expect(panel).toContainText("서비스 평균");
  await reveal.click();
  await expect(mode).toHaveValue("");
});

test("elapsed hours and KST boundaries update in an open and resumed tab with manual-only recovery", async ({ page }) => {
  await page.clock.install({ time: at("2026-11-22T22:59:54") });
  await page.clock.pauseAt(at("2026-11-22T22:59:56"));
  let requests = 0;
  await page.route("**/api/local-forecast", (route) => {
    requests += 1;
    expect(route.request().postDataJSON().latitude).toBe(37.5714);
    const payload = requests === 1 ? forecast : {
      ...forecast,
      hourlyComparison: buildHourlyComparison([], at("2026-11-24T00:00:00")),
    };
    return route.fulfill({ json: payload });
  });
  await page.goto(seoulUrl);
  const { panel, reveal, table, back, tiles } = controls(page);
  await expect(tiles.first().getByRole("button")).toHaveAccessibleName(/21:00–00:00, 최고 확률 0%/);
  await reveal.click();
  await expect(table.getByRole("row", { name: /22:00–23:00/ })).toContainText("진행 중인 시간");
  await page.clock.runFor(4_002);
  await expect(table.getByRole("row", { name: /22:00–23:00/ })).toContainText("지난 시간");
  await expect(table.getByRole("row", { name: /23:00–00:00/ })).toContainText("진행 중인 시간");
  await back.click();
  await expect(tiles.first().getByRole("button")).toHaveAccessibleName(/21:00–00:00, 최고 확률 미발표/);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(3_600_000);
  await expect(tiles.first().getByRole("button")).toHaveAccessibleName(/21:00–00:00/);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "visibilityState");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(tiles.first().getByRole("button")).toHaveAccessibleName(/지금, 11월 23일 00:00–03:00.*합계 없음/);
  await expect(page.locator("#forecast-heading")).toContainText("새로 확인");
  await page.clock.fastForward(3 * 3_600_000);
  await expect(tiles.first().getByRole("button")).toHaveAccessibleName(/지금, 11월 23일 03:00–06:00/);
  await expect(tiles.last().getByRole("button")).toHaveAccessibleName(/11월 24일 00:00–03:00, 최고 확률 미발표/);
  await page.clock.fastForward(21 * 3_600_000);
  const refresh = page.getByRole("button", { name: "예보 다시 불러오기" });
  await expect(refresh).toBeVisible();
  expect(requests).toBe(1);

  await refresh.click();
  await expect(tiles).toHaveCount(8);
  await expect(panel).toContainText("평균 자료 부족 · 11월 24일 KST");
  await expect(reveal).toHaveCount(1);
  await expect(refresh).toHaveCount(0);
  expect(requests).toBe(2);
});

test("an aged empty average can refresh before the last native hour expires", async ({ page }) => {
  const now = at("2026-11-23T03:59:56");
  const lostAverage = at("2026-11-23T05:00:02");
  await page.clock.install({ time: at("2026-11-23T03:59:54") });
  await page.clock.pauseAt(now);
  const response = buildHourlyComparison(seoulHourlySnapshots, at("2026-11-23T00:30:00"));
  const [open, kma, weather, visual] = response.sources;
  const comparableEnd = at("2026-11-23T05:00:00").getTime();
  open.hours = { [comparableEnd]: { chance: 25, amount: 0 } };
  kma.hours = { [comparableEnd]: { chance: 35, amount: 0 } };
  weather.hours = { [at("2026-11-23T06:00:00").getTime()]: { chance: 10, amount: 0 } };
  visual.hours = {};
  let requests = 0;
  await page.route("**/api/local-forecast", (route) => {
    requests += 1;
    const hourlyComparison = requests === 1 ? response : {
      ...response,
      dates: ["2026-11-23", "2026-11-24"],
      asOf: lostAverage.getTime(),
      sources: [{ ...open, hours: {
        [at("2026-11-23T07:00:00").getTime()]: { chance: null, amount: 0.2 },
      } }],
    };
    return route.fulfill({ json: { ...forecast, hourlyComparison } });
  });
  await page.goto(seoulUrl);
  const { panel, tiles, reveal, mode, table, raw, back } = controls(page);
  const refresh = page.getByRole("button", { name: "예보 다시 불러오기" });
  await expect(panel).toContainText("서비스 평균");
  await expect(refresh).toHaveCount(0);
  await page.clock.fastForward(lostAverage.getTime() - now.getTime());
  await expect(panel).toContainText("평균 자료 부족");
  await expect(refresh).toBeVisible();
  await tiles.nth(1).getByRole("button").click();
  await reveal.click();
  await mode.selectOption("weather-api");
  await expect(raw.getByRole("row", { name: /06:00–07:00/ })).toContainText("10%06:00 제공사 시각");
  expect(requests).toBe(1);

  await back.click();
  await refresh.click();
  await expect(mode).toBeHidden();
  await expect(panel).toContainText("평균 자료 부족");
  await expect(refresh).toHaveCount(0);
  await tiles.nth(1).getByRole("button").click();
  await reveal.click();
  await expect(table.getByRole("row", { name: /06:00–07:00/ }).getByRole("cell").last()).toHaveText("두 곳 미만1곳 · Open-Meteo");
  await expect(table.getByRole("row", { name: /07:00–08:00/ }).getByRole("cell").last()).toHaveText("미발표0곳");
  expect(requests).toBe(2);
});
