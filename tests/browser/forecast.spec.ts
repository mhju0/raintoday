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
