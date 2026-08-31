import assert from "node:assert/strict";
import test from "node:test";

import { EXAMPLE_FORECAST_LOCATIONS } from "./exampleLocations.ts";
import { isInsideServiceArea } from "./locationServiceArea.ts";

/**
 * These four coordinates are the only ones in the product that no visitor
 * action produced: a search result is validated by having come back from Kakao,
 * and a device fix is validated on the way in. An example is a literal, so a
 * transposed digit would ship a chip that answers "이 위치는 대한민국 서비스
 * 지역 밖이에요" — the exact dead end #121 exists to remove.
 */
test("every worked example is inside the service area", () => {
  for (const example of EXAMPLE_FORECAST_LOCATIONS) {
    assert.equal(
      isInsideServiceArea(example.latitude, example.longitude),
      true,
      `${example.name} (${example.latitude}, ${example.longitude}) is outside the service area`,
    );
  }
});

test("the chooser has examples to offer", () => {
  assert.ok(EXAMPLE_FORECAST_LOCATIONS.length >= 3);
});

/**
 * The committed name is what the dashboard and the stored location carry, and
 * what `/behind-the-data` shows. A bare leaf cannot confirm the right place.
 */
test("each example commits a fully qualified name containing its chip label", () => {
  for (const example of EXAMPLE_FORECAST_LOCATIONS) {
    assert.ok(
      example.name.includes(example.short),
      `${example.name} does not contain its chip label ${example.short}`,
    );
  }
});

test("examples are distinct places", () => {
  const names = EXAMPLE_FORECAST_LOCATIONS.map((example) => example.name);
  const shorts = EXAMPLE_FORECAST_LOCATIONS.map((example) => example.short);
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(shorts).size, shorts.length);
});
