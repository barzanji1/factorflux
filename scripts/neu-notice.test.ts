import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

test("notice renders each severity, caller content, links and acknowledgement controls", async () => {
  const result = await build({
    stdin: {
      contents: `
        import React from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        import { NeuNotice } from "./client/src/components/shared/NeuNotice";
        export const markup = ["info", "ack", "block"].map(severity =>
          renderToStaticMarkup(
            <NeuNotice severity={severity} title="Sample title" aria-label="Risk notice">
              <p>Complete notice content</p><a href="/invoices/123">View invoice</a>
              {severity === "ack" && <label><input type="checkbox" defaultChecked />Acknowledged<textarea defaultValue="Reviewed" /></label>}
            </NeuNotice>
          )
        );
        export const overriddenRole = renderToStaticMarkup(<NeuNotice role="alert">Provider failed</NeuNotice>);
      `,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
    bundle: true,
    jsx: "automatic",
    platform: "node",
    format: "cjs",
    write: false,
    loader: { ".css": "empty" },
    logLevel: "silent",
  });
  const compiled = { exports: {} as { markup: string[]; overriddenRole: string } };
  new Function("module", "exports", "require", result.outputFiles[0].text)(
    compiled, compiled.exports, createRequire(import.meta.url),
  );
  const { markup, overriddenRole } = compiled.exports;
  for (const [index, severity] of ["info", "ack", "block"].entries()) {
    assert.match(markup[index], new RegExp(`data-neu-notice="${severity}"`));
    assert.match(markup[index], /neu-notice-title[^>]*>Sample title/);
    assert.match(markup[index], /Complete notice content/);
    assert.match(markup[index], /href="\/invoices\/123"/);
    assert.match(markup[index], /aria-label="Risk notice"/);
  }
  assert.match(markup[2], /role="alert"/);
  assert.match(markup[0], /role="status"/);
  assert.match(markup[1], /type="checkbox"[^>]*checked/);
  assert.match(markup[1], /<textarea>Reviewed<\/textarea>/);
  assert.match(overriddenRole, /role="alert"/);
});

test("notice styles use one inset surface, severity edge, accessible controls and spacing", () => {
  const css = readFileSync("client/src/components/shared/neu-notice.css", "utf8");
  assert.match(css, /background:\s*#e0e0e0\s*!important/);
  assert.match(css, /border-left:\s*4px solid var\(--notice-color\)/);
  assert.match(css, /padding:\s*16px/);
  assert.match(css, /\.neu-notice \+ \.neu-notice.*margin-top:\s*12px/);
  assert.match(css, /box-shadow:\s*inset/);
  assert.match(css, /data-neu-notice="ack".*#b66a16/);
  assert.match(css, /data-neu-notice="block".*#b33d3d/);
  assert.match(css, /a:hover\s*\{\s*text-decoration:\s*underline/);
  assert.match(css, /checkbox.*:checked::after/);
  assert.match(css, /focus-visible/);
});
