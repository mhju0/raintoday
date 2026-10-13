import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { ERROR_REPORT_ORIGIN } from "../../lib/errorReport.ts";

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
      if (width <= 640) {
        const extraHeight = await page.locator(".local-footer > p").first().evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
          return element.getBoundingClientRect().height - range.getBoundingClientRect().height - lineHeight;
        });
        expect(extraHeight, "footer paragraphs should not reserve empty vertical space").toBeLessThanOrEqual(1);
      }
      await expectContentWithinViewport(page);
      await expect(page.locator(".local-evidence-section")).toBeVisible();
      await expect(page.locator(".local-amount-provider")).toHaveText(["(Visual Crossing)", "(WeatherAPI)"]);
      await expect(page.locator(".local-day-value")).toHaveText(["100%", "100%"]);
      await expectContentWithinViewport(page);
      await page.getByText("채점 원자료 자세히 보기", { exact: true }).click();
      await expect(page.locator(".local-score-table.is-raw")).toBeVisible();
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
    await expect(page.locator(".local-evidence-section")).toBeVisible();
    const ribbon = page.locator(".local-ribbon-grid");
    await ribbon.focus();
    await expect(ribbon).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".local-ribbon-readout")).toContainText("지금 9–12시");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".local-ribbon-readout")).toContainText("오후 12–15시");
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

// Audit 007. Each of these is one text or one bar moving off a line its
// neighbours share, or one layer covering another.
const longPlace = `/?lat=33.25&lon=126.26&name=${encodeURIComponent("제주특별자치도 서귀포시 대정읍")}&area=h`;

async function openForecast(page: import("@playwright/test").Page, width: number, forecast: unknown, height = 900) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/local-forecast", (route) => route.fulfill({ json: forecast }));
  await page.goto(longPlace);
  await expect(page.locator(".local-dashboard")).toBeVisible();
}

const tops = (locator: import("@playwright/test").Locator) =>
  locator.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
const spreadOf = (values: number[]) => Math.max(...values) - Math.min(...values);

for (const width of [390, 1440]) {
  test(`nothing but the phone's location strip stays pinned while scrolling at ${width}px`, async ({ page }) => {
    await openForecast(page, width, expandedForecast(), 800);
    await expect(page.locator(".local-minibar")).toHaveCount(0);
    await page.evaluate(() => window.scrollTo({ top: 1400, behavior: "instant" }));
    const pinned = await page.evaluate(() => [...document.querySelectorAll(".local-dashboard *")]
      .filter((element) => ["sticky", "fixed"].includes(getComputedStyle(element).position))
      .map((element) => element.className));
    expect(pinned).toEqual(width <= 640 ? ["local-strip"] : []);
  });
}

test("a build served off Vercel does not ask for the analytics script", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/_vercel/")) asked.push(request.url()); });
  await openForecast(page, 1024, expandedForecast());
  await page.waitForLoadState("networkidle");
  expect(asked).toEqual([]);
});

test("an error on a build served off the production host is reported nowhere", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).origin === ERROR_REPORT_ORIGIN) asked.push(request.url()); });
  await openForecast(page, 1024, expandedForecast());
  await page.evaluate(() => { setTimeout(() => { throw new Error("browser test error"); }); });
  await page.waitForTimeout(3000);
  expect(asked).toEqual([]);
});

for (const width of [390, 768, 1440]) {
  test(`the scrub readout stays inside the chart at ${width}px`, async ({ page }) => {
    await openForecast(page, width, mixedRibbonForecast(true));
    await page.locator(".local-ribbon-grid").focus();
    for (let column = 1; column <= 8; column += 1) {
      await page.keyboard.press("ArrowRight");
      const bounds = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const [readout, scroller, selected] = [box(".local-ribbon-readout"), box(".local-ribbon-scroll"), box(".local-ribbon-col.is-scrubbed")];
        return { readout: [readout.left, readout.right], scroller: [scroller.left, scroller.right], selected: [selected.left, selected.right] };
      });
      expect(bounds.readout[0], `column ${column} readout left`).toBeGreaterThanOrEqual(bounds.scroller[0] - 1);
      expect(bounds.readout[1], `column ${column} readout right`).toBeLessThanOrEqual(bounds.scroller[1] + 1);
      expect(bounds.selected[0], `column ${column} in view`).toBeGreaterThanOrEqual(bounds.scroller[0] - 1);
      expect(bounds.selected[1], `column ${column} in view`).toBeLessThanOrEqual(bounds.scroller[1] + 1);
    }
  });
}

for (const width of [320, 390, 1440]) {
  test(`a search message leaves the shortcut chips uncovered at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/locations/search**", (route) => route.fulfill({ json: { results: [] } }));
    await page.goto("/");
    await page.getByRole("combobox", { name: "대한민국 지역 검색" }).fill("없는곳");
    const message = page.getByText("일치하는 행정구역을 찾지 못했어요", { exact: false });
    await expect(message).toBeVisible();
    const messageBottom = await message.evaluate((element) => element.getBoundingClientRect().bottom);
    const examplesTop = await page.locator(".local-examples").evaluate((element) => element.getBoundingClientRect().top);
    expect(examplesTop).toBeGreaterThanOrEqual(messageBottom);
  });
}

test("a search message does not resize the page on every keystroke", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/locations/search**", (route) => route.fulfill({ json: { results: [] } }));
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "대한민국 지역 검색" });
  await search.fill("없는곳");
  await expect(page.getByText("일치하는 행정구역을 찾지 못했어요", { exact: false })).toBeVisible();
  const height = () => page.evaluate(() => document.documentElement.scrollHeight);
  const settled = await height();
  await search.pressSequentially("에");
  expect(await height(), "while the next search is pending").toBe(settled);
  await expect(page.getByText("일치하는 행정구역을 찾지 못했어요", { exact: false })).toBeVisible();
  expect(await height()).toBe(settled);
});

test("a column with no published value keeps its caption on the shared line", async ({ page }) => {
  const forecast = mixedRibbonForecast(true);
  await openForecast(page, 1440, forecast);
  const captions = await tops(page.locator(".local-ribbon-hint"));
  expect(captions).toHaveLength(8);
  expect(spreadOf(captions)).toBeLessThanOrEqual(0.5);
});

for (const width of [320, 641]) {
  test(`provider bars share one scale and the outlook leaves no day alone at ${width}px`, async ({ page }) => {
    await openForecast(page, width, expandedForecast());
    const tracks = await page.locator(".local-meter").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
    expect(tracks).toHaveLength(5);
    expect(spreadOf(tracks)).toBeLessThanOrEqual(0.5);
    const days = await tops(page.locator(".local-wd"));
    const lastRow = days.filter((top) => Math.abs(top - Math.max(...days)) < 1);
    expect(lastRow.length, "days on the last outlook row").toBeGreaterThan(1);
    await expectContentWithinViewport(page);
  });
}

for (const width of [641, 768, 1024, 1440]) {
  test(`today and tomorrow share their rows at ${width}px`, async ({ page }) => {
    const forecast = { ...expandedForecast(), tomorrowAmountRange: { minMm: 0, minName: "기상청", maxMm: 2.4, maxName: "Open-Meteo" } };
    await openForecast(page, width, forecast);
    for (const row of [".local-day-nums", ".local-day-row", ".local-day-why"]) {
      const rowTops = await tops(page.locator(row));
      expect(rowTops).toHaveLength(2);
      expect(spreadOf(rowTops), row).toBeLessThanOrEqual(0.5);
    }
  });
}

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`no line of the amount note starts with a separator at ${width}px`, async ({ page }) => {
    const forecast = { ...expandedForecast(), tomorrowAmountRange: { minMm: 0, minName: "기상청", maxMm: 2.4, maxName: "Open-Meteo" } };
    await openForecast(page, width, forecast);
    const leading = await page.locator(".local-day-mm small").last().evaluate((note) => {
      const walker = document.createTreeWalker(note, NodeFilter.SHOW_TEXT);
      const lines = new Map<number, { left: number; character: string }>();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? "";
        for (let index = 0; index < text.length; index += 1) {
          if (!text[index].trim()) continue;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          const bounds = range.getBoundingClientRect();
          const line = Math.round(bounds.top / 4);
          const first = lines.get(line);
          if (!first || bounds.left < first.left) lines.set(line, { left: bounds.left, character: text[index] });
        }
      }
      return [...lines.values()].map((line) => line.character);
    });
    expect(leading.length).toBeGreaterThan(0);
    expect(leading).not.toContain("·");
  });
}

async function enlargeText(page: import("@playwright/test").Page, percent: number) {
  await page.addInitScript((size) => {
    document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.fontSize = `${size}%`; });
  }, percent);
}

for (const width of [390, 768, 1024]) {
  test(`ribbon captions stay inside their own columns with text at 200% at ${width}px`, async ({ page }) => {
    await enlargeText(page, 200);
    await openForecast(page, width, expandedForecast());
    const overhang = await page.locator(".local-ribbon-col").evaluateAll((columns) => columns.map((column) => {
      const right = column.getBoundingClientRect().right;
      return Math.max(...[...column.querySelectorAll(".local-ribbon-rng, .local-ribbon-hint")].map((label) => {
        const range = document.createRange();
        range.selectNodeContents(label);
        return range.getBoundingClientRect().right - right;
      }));
    }));
    expect(overhang.length).toBeGreaterThan(0);
    expect(Math.max(...overhang)).toBeLessThanOrEqual(0.5);
  });
}

test("the record heading keeps whole words with text at 200%", async ({ page }) => {
  await enlargeText(page, 200);
  await openForecast(page, 768, expandedForecast());
  const heading = await page.locator("#evidence-heading").evaluate((element) => {
    const size = Number.parseFloat(getComputedStyle(element).fontSize);
    return { ems: element.getBoundingClientRect().width / size, lines: element.getBoundingClientRect().height / size };
  });
  expect(heading.ems, "room for a whole word").toBeGreaterThanOrEqual(6);
  expect(heading.lines).toBeLessThanOrEqual(4);
});

test("amount values in the mm lane start on the same edge as the percentages above them", async ({ page }) => {
  await openForecast(page, 1440, expandedForecast());
  const edges = await page.locator(".local-ribbon-col").first().evaluate((column) => {
    const left = (selector: string) => {
      const range = document.createRange();
      range.selectNodeContents(column.querySelector(selector)!);
      return range.getBoundingClientRect().left;
    };
    return { value: left(".local-ribbon-val"), amount: left(".local-ribbon-mmval") };
  });
  expect(Math.abs(edges.value - edges.amount)).toBeLessThanOrEqual(0.5);
});

test("the ribbon's source chip and block count share a baseline", async ({ page }) => {
  await openForecast(page, 1440, expandedForecast());
  const bottoms = await page.locator(".local-ribbon-head").evaluate((head) => [".local-ribbon-src", ".local-ribbon-note"].map((selector) => {
    const element = head.querySelector(selector)!;
    const probe = document.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0";
    element.append(probe);
    const bottom = probe.getBoundingClientRect().bottom;
    probe.remove();
    return bottom;
  }));
  expect(Math.abs(bottoms[0] - bottoms[1])).toBeLessThanOrEqual(0.5);
});

test("the retry control is tall enough to tap", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/locations/search**", (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  await page.goto("/");
  await page.getByRole("combobox", { name: "대한민국 지역 검색" }).fill("서울");
  const retry = page.getByRole("button", { name: "다시 시도" });
  await expect(retry).toBeVisible();
  expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test("the 404 page sits on the site ground and its way back is a tappable link", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/no-such-page");
  const link = page.getByRole("link", { name: "예보로 돌아가기" });
  await expect(link).toBeVisible();
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const ground = await page.evaluate(() => {
    const paint = (element: Element | null) => {
      for (let node = element; node; node = node.parentElement) {
        const colour = getComputedStyle(node).backgroundColor;
        if (colour !== "rgba(0, 0, 0, 0)") return colour;
      }
      return "";
    };
    return paint(document.elementFromPoint(5, 400));
  });
  expect(ground).toBe("rgb(11, 15, 20)");
});

test("the record summary keeps its labels level and its date whole", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/behind-the-data?station=none");
  const meta = page.locator(".btd-meta").first();
  await expect(meta).toBeVisible();
  expect(spreadOf(await tops(meta.locator("dt")))).toBeLessThanOrEqual(0.5);
  const stamp = await meta.locator("dd").last().evaluate((element) => ({
    text: element.textContent ?? "",
    wholeParts: [...element.querySelectorAll("span")].every((part) => part.getClientRects().length === 1),
  }));
  expect(stamp.text).toMatch(/^\d{4}년 \d{1,2}월 \d{1,2}일 오[전후] \d{1,2}:\d{2}$/);
  expect(stamp.wholeParts).toBe(true);
});

for (const width of [320, 390]) {
  test(`the unavailable-search message keeps its quoted term whole with text at 130% at ${width}px`, async ({ page }) => {
    await enlargeText(page, 130);
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/locations/search**", (route) => route.fulfill({ status: 503, json: { error: "search_not_configured" } }));
    await page.goto("/");
    await page.getByRole("combobox", { name: "대한민국 지역 검색" }).fill("서울");
    const quoted = page.locator(".local-form-message .local-keep");
    await expect(quoted).toBeVisible();
    expect(await quoted.evaluate((element) => element.getClientRects().length)).toBe(1);
  });
}
