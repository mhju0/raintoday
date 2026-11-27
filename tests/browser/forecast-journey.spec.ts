import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildHourlyComparison } from "../../lib/forecast/hourlyComparison.ts";
import { seoulCaptureTime, seoulHourlySnapshots } from "./fixtures/seoul-hourly.ts";

const response = JSON.parse(readFileSync(new URL("./fixtures/rain-forecast.json", import.meta.url), "utf8"));
const comparison = buildHourlyComparison(seoulHourlySnapshots, seoulCaptureTime);
const replayAt = new Date("2026-11-22T22:38:00+09:00");
const area = "/?lat=37.50123&lon=127.03765&name=서울특별시+강남구+역삼1동&area=b";

test("Back and Cancel restore the retained location with no extra POST and no stale commit", async ({ page }) => {
  await page.clock.setFixedTime(replayAt);
  const requests: string[] = [];
  const releases: (() => void)[] = [];
  await page.route("**/api/local-forecast", async (route) => {
    const { name } = route.request().postDataJSON();
    requests.push(name);
    if (name === "부산광역시") await new Promise<void>((release) => releases.push(release));
    await route.fulfill({ json: { ...response, locationName: name, hourlyComparison: comparison } }).catch(() => undefined);
  });
  await page.goto("/");
  await page.getByRole("button", { name: "서울", exact: true }).click();
  await expect(page.locator(".local-strip-place b")).toHaveText("서울특별시");
  const third = page.locator(".local-hourly-hit").nth(3);
  await third.click();
  const selection = await third.getAttribute("aria-label");
  const switchPlace = page.getByRole("button", { name: "위치 바꾸기", exact: true });
  for (const cancel of [false, true]) {
    await switchPlace.click();
    await page.getByRole("button", { name: "부산", exact: true }).click();
    await expect.poll(() => releases.length).toBe(1);
    if (cancel) await page.getByRole("button", { name: "취소하고 이전 예보 보기" }).click();
    else await page.goBack();
    await expect(page.locator(".local-strip-place b")).toHaveText("서울특별시");
    await expect(third).toHaveAttribute("aria-label", selection!);
    await expect(third).toHaveAttribute("aria-pressed", "true");
    await expect(switchPlace).toBeFocused();
    releases.shift()!();
  }
  expect(requests).toEqual(["서울특별시", "부산광역시", "부산광역시"]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("raintoday.last-location.v1")!).name)).toBe("서울특별시");
});

test("a successful retry commits the selected area once and survives reload", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/local-forecast", async (route) => {
    const { name } = route.request().postDataJSON();
    requests.push(name);
    if (requests.length === 1) return route.fulfill({ status: 503, json: { error: "forecast_unavailable" } });
    return route.fulfill({ json: { ...response, locationName: name, hourlyComparison: comparison } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "제주", exact: true }).click();
  const retry = page.getByRole("button", { name: "다시 시도", exact: true });
  await expect(retry).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("raintoday.last-location.v1"))).toBeNull();
  await retry.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.locator(".local-strip-place b")).toHaveText("제주특별자치도 제주시");
  await expect(page).toHaveURL(/area=h/);
  expect(requests).toHaveLength(2);
  await page.reload();
  await expect(page.locator(".local-strip-place b")).toHaveText("제주특별자치도 제주시");
  expect(requests).toHaveLength(3);
});

test("station picker changes evidence while the original legal area and tile survive return", async ({ page }) => {
  await page.clock.setFixedTime(replayAt);
  let requests = 0;
  await page.route("**/api/local-forecast", (route) => {
    requests += 1;
    return route.fulfill({ json: { ...response, locationName: route.request().postDataJSON().name, hourlyComparison: comparison } });
  });
  await page.route("**/api/locations/search?*", (route) => route.fulfill({ json: { results: [{
    id: "2623000000", name: "부산진구", label: "부산광역시 부산진구", latitude: 35.1628, longitude: 129.0531,
    kind: "administrative-area", districtName: "부산진구", elevationM: null,
  }] } }));
  await page.goto(area);
  await expect(page.locator(".local-strip-place")).toContainText("법정구역 대표 위치");
  await page.locator(".local-hourly-hit").nth(2).click();
  await page.getByRole("link", { name: "이 시간대의 예보 비교" }).click();
  await expect(page.getByRole("heading", { name: "시간대별 예보 비교" })).toBeVisible();
  await page.goBack();
  const record = page.getByRole("link", { name: "관측소 채점 기록", exact: true });
  await record.scrollIntoViewIfNeeded();
  const readingOffset = await page.evaluate(() => window.scrollY);
  await record.click();
  await expect(page.getByRole("heading", { name: "시간대 예보는 서비스 평균부터 보여요" })).toBeVisible();
  await page.getByRole("button", { name: /다른 지역의 기록 보기/ }).click();
  await page.getByRole("searchbox").fill("부산진구");
  await page.getByRole("button", { name: /부산진구/ }).click();
  await expect(page).toHaveURL(/origin=/);
  await page.getByRole("link", { name: "← 선택한 위치의 예보로" }).click();
  await expect(page.locator(".local-strip-place")).toContainText("역삼1동");
  await expect(page.locator(".local-strip-place")).toContainText("법정구역 대표 위치");
  await expect(page.locator(".local-hourly-hit").nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(record).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(readingOffset, 0);
  expect(requests).toBe(1);
});

test("comparison conflict stays sourced when the 10 mm safeguard ends at noon", async ({ page }) => {
  const at = (stamp: string) => new Date(`2026-11-23T${stamp}+09:00`);
  const start = at("11:59:56");
  await page.clock.install({ time: at("11:59:54") });
  await page.clock.pauseAt(start);
  const hourlyComparison = buildHourlyComparison(seoulHourlySnapshots.slice(0, 2), start);
  const stamp = at("15:00:00").getTime();
  hourlyComparison.sources[0].hours = { [stamp]: { chance: 0, amount: 0 } };
  hourlyComparison.sources[1].hours = { [stamp]: { chance: 80, amount: 1.34 } };
  const today = { ...response.today, date: "2026-11-23", precipitationAmountMm: 10 };
  let requests = 0;
  await page.route("**/api/local-forecast", (route) => {
    requests += 1;
    return route.fulfill({ json: { ...response, today, hourlyComparison } });
  });
  await page.goto(area);
  await expect(page.locator("#forecast-heading")).toHaveText("오늘 우산을 꼭 챙기세요");
  await expect(page.locator(".local-answer-action")).toContainText("오늘 하루 예상 강수량 10 mm");
  await expect(page.locator(".local-answer-action")).toContainText("14:00–15:00에 비 가능성 · 평균 강수량 0.67 mm");
  await page.clock.runFor(4_002);
  await expect(page.locator("#forecast-heading")).toHaveText("오늘 비 예보가 엇갈려요");
  await expect(page.locator(".local-answer-action")).toContainText("Open-Meteo 0%, 서비스 평균 40%");
  await expect(page.locator(".local-answer-action")).not.toContainText("오늘 하루 예상 강수량");
  expect(requests).toBe(1);
});

test("a failed refresh keeps the aged forecast and a deliberate retry replaces it", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-23T03:30:00+09:00"));
  const fresh = buildHourlyComparison(seoulHourlySnapshots, new Date("2026-11-23T03:30:00+09:00"));
  let requests = 0;
  await page.route("**/api/local-forecast", (route) => {
    requests += 1;
    if (requests === 2) return route.fulfill({ status: 503, json: { error: "forecast_unavailable" } });
    return route.fulfill({ json: { ...response, locationName: "역삼1동", hourlyComparison: requests === 1 ? comparison : fresh } });
  });
  await page.goto(area);
  await expect(page.locator("#forecast-heading")).toHaveText("오늘 우산 안내를 새로 확인하세요");
  await page.getByRole("button", { name: "예보 다시 불러오기" }).click();
  await expect(page.getByText("새 예보를 불러오지 못해 이전 예보를 표시합니다.")).toBeVisible();
  await expect(page.locator(".local-strip-place b")).toHaveText("역삼1동");
  await expect(page.locator(".local-hourly-hit")).toHaveCount(8);
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.locator("#forecast-heading")).not.toHaveText("오늘 우산 안내를 새로 확인하세요");
  await expect(page.locator(".local-answer")).toContainText("2026-11-23 03:30 KST");
  expect(requests).toBe(3);
});

test("a cold station-only return chooses a place explicitly even with a saved city", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("raintoday.last-location.v1", JSON.stringify({
    name: "제주", latitude: 33.513, longitude: 126.529, elevationM: null,
    selection: { kind: "area", areaKind: "administrative-area" },
  })));
  let requests = 0;
  await page.route("**/api/local-forecast", (route) => { requests += 1; return route.fulfill({ json: response }); });
  await page.goto("/behind-the-data?station=108");
  await page.getByRole("link", { name: "← 예보 위치 고르기" }).click();
  await expect(page.locator("#location-heading")).toBeVisible();
  expect(requests).toBe(0);

  await page.goto("/#compare=1795435200000");
  await expect(page.getByText("링크의 예보 위치를 확인할 수 없어요. 이 화면에서 위치를 골라 주세요.")).toBeVisible();
  expect(requests).toBe(0);
});

test("Korean composition searches once after committing and Enter selects the result once", async ({ page }) => {
  const searched: string[] = [];
  let forecasts = 0;
  await page.route("**/api/locations/search?*", (route) => {
    searched.push(new URL(route.request().url()).searchParams.get("q")!);
    return route.fulfill({ json: { results: [{
      id: "1168010100", name: "역삼동", label: "서울특별시 강남구 역삼동", latitude: 37.50123, longitude: 127.03765,
      kind: "legal-area", elevationM: null,
    }] } });
  });
  await page.route("**/api/local-forecast", (route) => {
    forecasts += 1;
    return route.fulfill({ json: { ...response, locationName: "서울특별시 강남구 역삼동" } });
  });
  await page.goto("/");
  const input = page.getByRole("combobox", { name: "대한민국 지역 검색" });
  await expect(input).not.toBeFocused();
  await input.focus();
  await input.dispatchEvent("compositionstart");
  await input.fill("역사");
  await input.press("Enter");
  await page.waitForTimeout(350);
  expect(searched).toEqual([]);
  await input.fill("역삼동");
  await input.dispatchEvent("compositionend", { data: "역삼동" });
  await expect(page.getByRole("option", { name: /역삼동/ })).toBeVisible();
  await input.press("Enter");
  await expect(page.locator(".local-strip-place")).toContainText("법정구역 대표 위치");
  expect(searched).toEqual(["역삼동"]);
  expect(forecasts).toBe(1);
});

test("a late device fix cannot replace a selected area or write coordinates to history", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", { value: {
      getCurrentPosition(success: PositionCallback) {
        Object.assign(window, { completeTestFix: () => success({
          coords: { latitude: 37.56654123, longitude: 126.97814123, altitude: null, accuracy: 40 },
        } as GeolocationPosition) });
      },
    } });
  });
  const requested: string[] = [];
  await page.route("**/api/local-forecast", (route) => {
    const { name } = route.request().postDataJSON();
    requested.push(name);
    return route.fulfill({ json: { ...response, locationName: name } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "내 위치로 보기" }).click();
  await page.getByRole("button", { name: "서울", exact: true }).click();
  await expect(page.locator(".local-strip-place b")).toHaveText("서울특별시");
  const serialized = await page.evaluate(() => {
    (window as Window & { completeTestFix?: () => void }).completeTestFix!();
    return JSON.stringify({ history: history.state, query: location.search, session: {...sessionStorage} });
  });
  expect(serialized).not.toMatch(/37\.56654123|126\.97814123/);
  expect(requested).toEqual(["서울특별시"]);
});
