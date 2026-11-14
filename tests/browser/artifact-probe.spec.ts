import { expect, test } from "@playwright/test";

test("intentional CI failure artifact probe", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "대한민국 지역 검색" })).toBeVisible();
  await test.info().attach("ci-artifact-probe-marker", {
    body: Buffer.from("Intentional CI artifact probe: no production change.\n"),
    contentType: "text/plain",
  });
  expect(false, "Intentional failure to exercise retained CI browser traces").toBe(true);
});
