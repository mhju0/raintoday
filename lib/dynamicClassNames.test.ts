import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * A dead-CSS sweep flagged `.local-status-pill.is-active` as orphaned, because no
 * literal `"is-active"` exists anywhere in the tree — the component builds it as
 * `is-${status}`. Deleting it would have silently unstyled the one pill that
 * says performance weighting is live.
 *
 * This test is the thing a token scan is not: it knows which classes are
 * assembled at runtime. Registering a template here is what makes its classes
 * defensible, and the registry is checked against the source, so a producer that
 * is removed stops vouching for CSS that has become dead.
 */
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Class names no literal string produces. Each entry names the template that does. */
const DYNAMIC_PRODUCERS: { source: string; template: string; produces: string[] }[] = [
  {
    source: "components/local/LocalForecastExperience.tsx",
    // Evidence status, per STATUS_LABELS in lib/localForecastView.ts.
    template: "`local-status-pill is-${status}`",
    produces: ["is-active", "is-collecting", "is-unavailable"],
  },
];

function collectSources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSources(relative, found);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(relative);
  }
  return found;
}

const read = (relative: string): string => readFileSync(path.join(ROOT, relative), "utf8");

test("every is-* rule in the stylesheet has a producer, including the templated ones", () => {
  const css = read("app/globals.css");
  const styled = new Set(
    [...css.matchAll(/\.(is-[a-z][a-z0-9-]*)/g)].map((match) => match[1]),
  );

  const literal = new Set<string>();
  for (const file of [...collectSources("app"), ...collectSources("components")]) {
    for (const match of read(file).matchAll(/["'` ](is-[a-z][a-z0-9-]*)/g)) {
      literal.add(match[1]);
    }
  }
  for (const producer of DYNAMIC_PRODUCERS) {
    for (const name of producer.produces) literal.add(name);
  }

  const orphans = [...styled].filter((name) => !literal.has(name)).sort();
  assert.deepEqual(
    orphans,
    [],
    `styled but never produced — either dead CSS, or a template missing from DYNAMIC_PRODUCERS: ${orphans.join(", ")}`,
  );
});

test("each registered template is still in the source that vouches for it", () => {
  for (const producer of DYNAMIC_PRODUCERS) {
    assert.ok(
      read(producer.source).includes(producer.template),
      `${producer.source} no longer contains ${producer.template}; the CSS it vouches for may now be dead`,
    );
  }
});
