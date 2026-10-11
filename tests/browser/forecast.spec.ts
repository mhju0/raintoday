import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const rainForecast = JSON.parse(readFileSync(new URL("./fixtures/rain-forecast.json", import.meta.url), "utf8"));

const candidate = {
  id: "1168064000",
  name: "역삼1동",
  label: "서울특별시 강남구 역삼1동",
  latitude: 37.499,
  longitude: 127.037,
  elevationM: null,
  kind: "administrative-area",
  administrativeCode: "1168064000",
  source: "kakao",
};

function mixedRibbonForecast(withAmounts: boolean) {
  const probabilities = [10, 60, 75, 60, 0, null, 10, 60];
  const labels = ["지금", "오후", "오후", "저녁", "밤", "새벽", "새벽", "아침"];
  const amounts = [null, 0.1, 0.2, null, 0, 0.5, null, 0.7];
  return {
    ...rainForecast,
    timeline: {
      ...rainForecast.timeline,
      blocks: probabilities.map((probability, index) => {
        const startHour = (9 + index * 3) % 24;
        const endHour = (startHour + 3) % 24;
        return {
          label: labels[index],
          rangeLabel: `${startHour}–${endHour}시`,
          startHour,
          endHour,
          precipMax: probability,
          precipSumMm: withAmounts ? amounts[index] : null,
          condition: "rain",
          wet: probability !== null && probability >= 40,
          dayTag: startHour === 0 ? "8. 18. (화)" : null,
        };
      }),
      reading: {
        firstRun: {
          startIndex: 1, endIndex: 3, startHour: 12, endHour: 21,
          startLabel: "오후", startsTomorrow: false, durationHours: 9,
          endsWithinWindow: true, peakProbability: 75,
        },
        laterRun: null,
        peak: { probability: 75, rangeLabel: "15–18시", startsTomorrow: false },
      },
    },
  };
}

function expandedForecast() {
  const forecast = mixedRibbonForecast(true);
  const providers = ["Open-Meteo", "기상청", "Pirate Weather", "WeatherAPI", "Visual Crossing"];
  return {
    ...forecast,
    locationName: "제주특별자치도 서귀포시 대정읍",
    comparedProviderCount: 5,
    blendMode: "learned",
    today: { ...forecast.today, precipitationProbability: 100, precipitationAmountMm: 250, amountProviderCount: 5 },
    recommendation: { ...forecast.recommendation, precipitationProbability: 100, precipitationAmountMm: 250, amountProviderCount: 5 },
    tomorrowAmountRange: { minMm: 1, minName: "WeatherAPI", maxMm: 500, maxName: "Visual Crossing" },
    influence: providers.map((name, index) => ({ id: String(index), name, probability: index === 4 ? null : 100 - index * 20, influence: 0.2 })),
    outlook: Array.from({ length: 6 }, (_, index) => ({ ...forecast.recommendation, date: `2026-08-${19 + index}`, precipitationProbability: index === 3 ? null : 100 - index * 15 })),
    evidence: {
      status: "active", statusLabel: "최근 관측 성능 반영", proximity: "regional",
      station: { id: "119", name: "수원", distanceKm: 30.2 }, comparisonSampleCount: 47,
      emptyMessage: null, emptyDetail: null, seedScores: [],
      scores: providers.map((name, index) => ({
        id: String(index), name, last7DaysBrier: index === 4 ? null : 0.084 + index * 0.01,
        windowBrier: 0.1, windowSampleCount: 47, misses: 3, falseAlarms: 4,
        rainyAmountMae: index === 4 ? null : 2.5, rainyAmountSampleCount: 10,
      })),
      benchmark: { adaptiveBrier: 0.08, equalBrier: 0.09, sampleCount: 47, status: "passing" },
    },
  };
}

async function expectContentWithinViewport(page: import("@playwright/test").Page) {
  const outside = await page.locator(".local-chooser *, .local-loading *, .local-state-card *, .local-dashboard *, .btd *").evaluateAll((elements) => {
    const width = document.documentElement.clientWidth;
    return elements.filter((element) => {
      if (element.closest(".local-ribbon-scroll, .local-score-scroll, .btd-table-scroll")) return false;
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 && (bounds.left < -1 || bounds.right > width + 1);
    }).map((element) => ({ class: element.className, text: element.textContent?.slice(0, 60) }));
  });
  expect(outside, "content must fit even where the page clips horizontal overflow").toEqual([]);
}

for (const width of [320, 390]) {
  for (const probability of [100, null]) {
    test(`no-hourly headline keeps its value whole at ${width}px, probability ${probability}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.route("**/api/local-forecast", (route) => route.fulfill({ json: {
        ...rainForecast, timeline: null, today: null, current: null,
        recommendation: { ...rainForecast.recommendation, precipitationProbability: probability },
      } }));
      await page.goto("/?lat=33.25&lon=126.26&name=제주시&area=h");
      await expect(page.locator(".local-dashboard")).toBeVisible();
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      await expect(page.locator("#forecast-heading b")).toHaveText(probability === null ? "미발표" : "100%");
      const lines = await page.locator("#forecast-heading b").evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return [...new Set([...range.getClientRects()].map((bounds) => Math.round(bounds.top)))];
      });
      expect(lines).toHaveLength(1);
      await expectContentWithinViewport(page);
    });
  }
}

for (const width of [320, 390, 768, 900, 901, 1024, 1440]) {
  for (const fontSize of ["100%", "200%"]) {
    test(`forecast controls and attributed values fit at ${width}px, text ${fontSize}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.route("**/api/local-forecast", (route) => route.fulfill({ json: expandedForecast() }));
      await page.goto(`/?lat=33.25&lon=126.26&name=${encodeURIComponent("제주특별자치도 서귀포시 대정읍")}&area=h`);
      await expect(page.locator(".local-dashboard")).toBeVisible();
      await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, fontSize);
      await expectContentWithinViewport(page);
      await page.getByRole("button", { name: /전체 근거 보기/ }).click();
      await expect(page.locator(".local-evidence-section")).toBeVisible();
      await expect(page.locator(".local-amount-provider")).toHaveText(["(Visual Crossing)", "(WeatherAPI)"]);
      await expect(page.locator(".local-day-value")).toHaveText(["100%", "100%"]);
      await expectContentWithinViewport(page);
      await page.getByText("채점 원자료 자세히 보기", { exact: true }).click();
      await expect(page.locator(".local-score-table.is-raw")).toBeVisible();
      await expectContentWithinViewport(page);
      await page.getByRole("button", { name: "한눈에 보기" }).click();
      await expect(page.locator(".local-stubs")).toBeVisible();
      await expectContentWithinViewport(page);
      await page.goto("/behind-the-data?station=none");
      await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, fontSize);
      await expect(page.locator(".btd-meta")).toBeVisible();
      await expectContentWithinViewport(page);
      await page.evaluate(() => window.localStorage.clear());
      await page.goto("/");
      await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, fontSize);
      await expect(page.locator(".local-chooser")).toBeVisible();
      await expectContentWithinViewport(page);
      await page.getByRole("button", { name: "제주", exact: true }).click();
      await expect(page.locator(".local-dashboard")).toBeVisible();
      await expectContentWithinViewport(page);
      expect(errors).toEqual([]);
    });
  }
}

for (const width of [390, 768, 901, 1024, 1440]) {
  for (const fontSize of ["100%", "200%"]) {
    for (const withAmounts of [false, true]) {
      test(`ribbon shares plot rows at ${width}px, text ${fontSize}, mm ${withAmounts}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.route("**/api/locations/search**", (route) => route.fulfill({ json: { results: [candidate] } }));
        await page.route("**/api/local-forecast", (route) => route.fulfill({ json: mixedRibbonForecast(withAmounts) }));
        await page.goto("/");
        await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, fontSize);
        const search = page.getByRole("combobox", { name: "대한민국 지역 검색" });
        await search.fill("역삼동");
        await expect(page.getByRole("option", { name: /서울특별시 강남구 역삼1동/ })).toBeVisible();
        await search.press("Enter");

        const columns = page.locator(".local-ribbon-col");
        await expect(columns).toHaveCount(8);
        await expect(page.locator(".local-ribbon-mm")).toHaveCount(withAmounts ? 8 : 0);
        await expect(page.locator(".local-ribbon-daytag")).toHaveText("8. 18. (화)");
        await expect(page.locator(".local-ribbon-hint")).toHaveText([
          "기준 아래입니다.", "비가 예상되는 구간의 시작입니다.", "가장 높은 시간대입니다.",
          "비가 예상되는 시간대입니다.", "비 예보 없음.", "강수확률이 발표되지 않았습니다.",
          "기준 아래입니다.", "비가 예상되는 시간대입니다.",
        ]);
        const geometry = await columns.evaluateAll((elements) => elements.map((column) => {
          const track = column.querySelector<HTMLElement>(".local-ribbon-track")!;
          const bounds = track.getBoundingClientRect();
          const threshold = getComputedStyle(track, "::before");
          const bar = column.querySelector<HTMLElement>(".local-ribbon-bar");
          const barBounds = bar?.getBoundingClientRect();
          const hint = column.querySelector<HTMLElement>(".local-ribbon-hint")!;
          return {
            top: bounds.top,
            bottom: bounds.bottom,
            plotHeight: track.clientHeight,
            thresholdBottom: parseFloat(threshold.bottom),
            thresholdY: bounds.top + track.clientHeight - parseFloat(threshold.bottom),
            barBottom: barBounds?.bottom ?? null,
            barHeight: barBounds?.height ?? null,
            probability: bar ? parseFloat(bar.style.getPropertyValue("--h")) : null,
            missing: track.classList.contains("is-na"),
            hatch: getComputedStyle(track).backgroundImage,
            hintHeight: hint.getBoundingClientRect().height,
            hintDisplay: getComputedStyle(hint).display,
          };
        }));
        const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
        for (const dimension of ["top", "bottom", "thresholdY"] as const) {
          expect(spread(geometry.map((column) => column[dimension])), dimension).toBeLessThanOrEqual(1);
        }
        expect(spread(geometry.flatMap((column) => column.barBottom === null ? [] : [column.barBottom])), "bar bottoms").toBeLessThanOrEqual(1);
        for (const column of geometry) {
          expect(Math.abs(column.thresholdBottom - column.plotHeight * 0.4), "40% threshold").toBeLessThanOrEqual(1);
          if (column.probability !== null) {
            expect(Math.abs(column.barHeight! - Math.max(3, column.plotHeight * column.probability / 100)), "proportional probability height").toBeLessThanOrEqual(1);
          }
          expect(column.hintDisplay === "none").toBe(width <= 900);
        }
        expect(geometry[4].barHeight, "published zero tick").toBe(3);
        expect(geometry[5].missing).toBe(true);
        expect(geometry[5].barHeight).toBeNull();
        expect(geometry[5].hatch).toContain("repeating-linear-gradient");
        expect(geometry[1].barHeight, "equal values with onset and wet captions").toBe(geometry[3].barHeight);
        if (width > 900) {
          expect(spread(geometry.map((column) => column.hintHeight)), "mixed caption wrapping exercised").toBeGreaterThan(1);
        }
        if (width === 390) {
          const scroll = await page.locator(".local-ribbon-scroll").evaluate((element) => ({ width: element.clientWidth, contentWidth: element.scrollWidth }));
          expect(scroll.contentWidth).toBeGreaterThan(scroll.width);
        }
      });
    }
  }
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`keyboard location and evidence fold at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/locations/search**", async (route) => {
      await route.fulfill({ json: { results: [candidate] } });
    });
    await page.route("**/api/local-forecast", async (route) => {
      await route.fulfill({ json: rainForecast });
    });
    await page.goto("/");

    await expect(page.getByRole("main")).toHaveCount(1);
    const search = page.getByRole("combobox", { name: "대한민국 지역 검색" });
    await search.fill("역삼동");
    await expect(page.getByRole("option", { name: /서울특별시 강남구 역삼1동/ })).toBeVisible();
    await search.press("Enter");

    await expect(page.getByRole("heading", { name: /오후 12시부터 밤 9시까지 비 예상/ })).toBeVisible();
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.locator(".local-stubs")).toBeVisible();
    const ribbon = page.locator(".local-ribbon-grid");
    await ribbon.focus();
    await expect(ribbon).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".local-ribbon-readout")).toContainText("지금 9–12시");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".local-ribbon-readout")).toContainText("오후 12–15시");
    const toggle = page.getByRole("button", { name: /전체 근거 보기/ });
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".local-evidence-section")).toBeVisible();
    await expect(page.getByRole("button", { name: "한눈에 보기" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator(".local-stubs")).toBeVisible();
    await expect(page.locator(".local-evidence-section")).toHaveCount(0);
  });
}

test("search fields mark focus with their own border, not a second ring", async ({ page }) => {
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "대한민국 지역 검색" });
  await search.click();
  await expect(search).toBeFocused();
  await expect(search).toHaveCSS("outline-style", "none");
  await expect(page.locator(".local-search-form")).toHaveCSS("border-top-color", "rgb(46, 110, 146)");

  await page.keyboard.press("Shift+Tab");
  const locate = page.getByRole("button", { name: "내 위치로 보기" });
  await expect(locate).toBeFocused();
  await expect(locate).toHaveCSS("outline-style", "solid");
});
