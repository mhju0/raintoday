import { test } from "@playwright/test";

test.describe("intentional pre-test artifact probe", () => {
  throw new Error("Intentional CI failure during discovery before trace creation");
});
