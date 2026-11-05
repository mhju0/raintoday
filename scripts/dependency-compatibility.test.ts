import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { Linter } from "eslint";

const require = createRequire(import.meta.url);
const nextConfigRequire = createRequire(require.resolve("eslint-config-next"));

for (const consumer of ["eslint-plugin-import", "eslint-plugin-react", "eslint-plugin-jsx-a11y"]) {
  test(`${consumer} resolves the callable minimatch API its rules use`, () => {
    const consumerRequire = createRequire(nextConfigRequire.resolve(consumer));
    const minimatch = consumerRequire("minimatch");
    assert.equal(typeof minimatch, "function");
    assert.equal(minimatch("components/Card.tsx", "components/*.tsx"), true);
    assert.equal(minimatch("components/Card.ts", "components/*.tsx"), false);
    assert.equal(minimatch.makeRe("components/*.tsx").test("components/Card.tsx"), true);
  });
}

test("typescript-estree resolves the named minimatch API with dot-file support", () => {
  const typescriptEslintRequire = createRequire(nextConfigRequire.resolve("typescript-eslint"));
  const consumerRequire = createRequire(typescriptEslintRequire.resolve("@typescript-eslint/typescript-estree"));
  const { minimatch } = consumerRequire("minimatch");
  assert.equal(typeof minimatch, "function");
  assert.equal(minimatch("src/.private.ts", "src/*.ts", { dot: true }), true);
  assert.equal(minimatch("src/.private.ts", "src/*.ts"), false);
  assert.equal(minimatch("src/private.js", "src/*.ts", { dot: true }), false);
});

test("import/no-internal-modules compiles and applies makeRe allow and forbid patterns", () => {
  const linter = new Linter();
  const plugin = nextConfigRequire("eslint-plugin-import");
  const code = "import runtime from 'react/jsx-runtime';";
  const allowed = linter.verify(code, {
    plugins: { import: plugin },
    rules: { "import/no-internal-modules": ["error", { allow: ["react/**"] }] },
  });
  assert.deepEqual(allowed, []);
  const forbidden = linter.verify(code, {
    plugins: { import: plugin },
    rules: { "import/no-internal-modules": ["error", { forbid: ["react/**"] }] },
  });
  assert.equal(forbidden.length, 1);
  assert.equal(forbidden[0].ruleId, "import/no-internal-modules");
  assert.equal(forbidden[0].message, 'Reaching to "react/jsx-runtime" is not allowed.');
});

test("jsx-a11y label checks call minimatch for custom control patterns", () => {
  const linter = new Linter();
  const plugin = nextConfigRequire("eslint-plugin-jsx-a11y");
  const check = (pattern: string) => linter.verify("const control = <button><CustomControl /></button>;", {
    files: ["**/*.jsx"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { "jsx-a11y": plugin },
    rules: { "jsx-a11y/control-has-associated-label": ["error", { controlComponents: [pattern] }] },
  }, "fixture.jsx");
  const matching = check("Custom*");
  assert.equal(matching.length, 1);
  assert.equal(matching[0].ruleId, "jsx-a11y/control-has-associated-label");
  assert.equal(matching[0].message, "A control must be associated with a text label.");
  assert.deepEqual(check("Other*"), []);
});
