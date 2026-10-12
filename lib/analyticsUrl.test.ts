import assert from "node:assert/strict";
import test from "node:test";

import { analyticsUrl } from "./analyticsUrl.ts";

test("a shared forecast link is reported without its coordinates or place name", () => {
  assert.equal(
    analyticsUrl(
      "https://raintoday.vercel.app/?lat=37.56650&lon=126.97800&name=%EC%84%9C%EC%9A%B8&area=h",
    ),
    "https://raintoday.vercel.app/",
  );
});

test("campaign parameters survive, so a tagged link can still be attributed", () => {
  assert.equal(
    analyticsUrl(
      "https://raintoday.vercel.app/?lat=37.5&utm_source=instagram&lon=127&utm_medium=bio",
    ),
    "https://raintoday.vercel.app/?utm_source=instagram&utm_medium=bio",
  );
});

test("the path is kept and the fragment is dropped", () => {
  assert.equal(
    analyticsUrl("https://raintoday.vercel.app/behind-the-data?station=108#top"),
    "https://raintoday.vercel.app/behind-the-data",
  );
});
