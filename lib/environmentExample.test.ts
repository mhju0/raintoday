import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * `.env.example` is the only inventory of what this project can be configured
 * with, and CLAUDE.md makes a promise about it: it declares what the code reads
 * and nothing else, "because a stale example is how a dead key survives a
 * cleanup". That promise was made in prose carrying a literal count, and the
 * count went stale the moment a fifth provider was added — the sentence warning
 * about stale documentation being itself stale.
 *
 * So pin the set rather than the number. A count drifts silently; a set cannot.
 */
const ROOT = join(import.meta.dirname, "..");

/**
 * Supplied by the runtime, not by a person. `NODE_ENV` comes from Node, and
 * Vercel injects its own — putting them in an example file would invite someone
 * to set them by hand, which is worse than omitting them.
 */
const PLATFORM_PROVIDED = /^(NODE_ENV|VERCEL_|NEXT_RUNTIME)/;

/**
 * Declared on purpose without being read by shipped code: it turns on the
 * PostgreSQL store-contract suite, and documenting it is the only way anyone
 * learns the suite exists.
 */
const TEST_ONLY = new Set(["PERFORMANCE_STORE_CONTRACT_URL"]);

function declared(): Set<string> {
  const text = readFileSync(join(ROOT, ".env.example"), "utf8");
  return new Set(Array.from(text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm), (m) => m[1]));
}

function readByShippedCode(): Set<string> {
  // Tracked files only, so an untracked scratch file cannot fail the suite.
  const files = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((name) => name && !name.includes(".test."));
  const found = new Set<string>();
  for (const file of files) {
    const source = readFileSync(join(ROOT, file), "utf8");
    for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      if (!PLATFORM_PROVIDED.test(match[1])) found.add(match[1]);
    }
  }
  return found;
}

test("every variable .env.example declares is one the code reads", () => {
  const read = readByShippedCode();
  const dead = [...declared()].filter((name) => !read.has(name) && !TEST_ONLY.has(name)).sort();
  assert.deepEqual(
    dead,
    [],
    `.env.example declares ${dead.join(", ")}, which nothing reads any more`,
  );
});

test("every variable the code reads is declared in .env.example", () => {
  const known = declared();
  const undeclared = [...readByShippedCode()].filter((name) => !known.has(name)).sort();
  assert.deepEqual(
    undeclared,
    [],
    `the code reads ${undeclared.join(", ")}, which .env.example never mentions`,
  );
});
