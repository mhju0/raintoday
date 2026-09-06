import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("rendered copy and metadata use the approved punctuation, including missing-data branches", () => {
  const files = [
    "../components/local/LocalForecastExperience.tsx",
    "../components/local/RecordStationPicker.tsx",
    "../app/behind-the-data/page.tsx",
    "../app/layout.tsx",
    "../app/page.tsx",
    "../app/opengraph-image.tsx",
    "../app/not-found.tsx",
    "./localForecastView.ts",
    "./behindTheData.ts",
  ];
  const violations: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) && node.text.includes("\u2014")) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        violations.push(`${file}:${line + 1}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(violations, [], "visible copy must not reintroduce U+2014; historical comments are outside this check");
});
