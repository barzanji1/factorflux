import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import { NeuBadge, NeuButton, NeuCard, NeuInput, NeuSelect, NeuTextarea } from "./neu/components";

const css = postcss.parse(readFileSync(new URL("./ff-institutional-workspace.css", import.meta.url), "utf8"));
const dashboard = postcss.parse(readFileSync(new URL("./ff-financial-dashboard.css", import.meta.url), "utf8"));

function customProperties(sheet: postcss.Root, selector: string) {
  const values = new Map<string, string>();
  sheet.walkRules(selector, rule => {
    rule.walkDecls(declaration => { values.set(declaration.prop, declaration.value); });
  });
  return values;
}

test("authenticated materials reuse the approved dashboard palette", () => {
  const source = customProperties(dashboard, ".ff-financial-dashboard-shell");
  const shared = customProperties(css, ".ff-institutional-root:not(:has(.ff-neu-dashboard))");
  for (const [name, approved] of [
    ["navy", "navy"], ["workspace", "workspace"], ["surface", "porcelain"],
    ["teal", "teal"], ["ink", "charcoal"], ["muted", "slate"], ["border", "border"],
  ]) {
    assert.equal(shared.get(`--ff-institutional-${name}`), source.get(`--ff-financial-${approved}`), name);
  }
});

test("the shared migration layer only changes paint, not geometry or interaction", () => {
  const paint = new Set([
    "background", "background-color", "background-image", "color",
    "border-color", "border-top-color", "border-bottom-color", "border-left-color", "border-right-color",
    "box-shadow", "text-shadow", "font-family", "opacity", "outline-color",
    "fill", "stroke", "text-decoration-color",
  ]);
  css.walkDecls(declaration => {
    assert.ok(declaration.prop.startsWith("--") || paint.has(declaration.prop),
      `Non-paint declaration ${declaration.prop}: ${declaration.value}`);
  });
  assert.equal(css.nodes.some(node => node.type === "atrule" && /keyframes/.test(node.name)), false);
});

test("all new styling is authenticated-root scoped, including selected body portals", () => {
  css.walkRules(rule => {
    for (const selector of rule.selectors) {
      assert.ok(selector.includes(".ff-institutional-root"), selector);
      let bodyOnly = false;
      if (selector.startsWith("body:has(")) {
        let depth = 0;
        for (let i = selector.indexOf("("); i < selector.length; i++) {
          if (selector[i] === "(") depth++;
          if (selector[i] === ")" && --depth === 0) {
            bodyOnly = selector.slice(i + 1).trim() === "";
            break;
          }
        }
      }
      if (bodyOnly) {
        rule.walkDecls(declaration => {
          assert.ok(declaration.prop.startsWith("--"), "Never paint body or the persistent login shatter overlay");
        });
      }
    }
  });
});

test("shared material markers preserve native field props and public defaults", () => {
  const html = renderToStaticMarkup(createElement("div", null,
    createElement(NeuCard, { pressed: true }, "Card"),
    createElement(NeuInput, { name: "reference", defaultValue: "INV-123", required: true, "aria-label": "Reference" }),
    createElement(NeuTextarea, { name: "reason", defaultValue: "Document review" }),
    createElement(NeuSelect, { name: "status", defaultValue: "open" },
      createElement("option", { value: "open" }, "Open")),
  ));
  assert.match(html, /data-ff-neu-pressed="true"/);
  assert.match(html, /name="reference"/);
  assert.match(html, /value="INV-123"/);
  assert.match(html, /aria-label="Reference"/);
  assert.match(html, /required=""/);
  assert.match(html, /name="reason"/);
  assert.match(html, /name="status"/);
  assert.match(html, /bg-\[#e0e0e0\]/, "Unauthenticated surfaces keep their existing fallback");
});

test("button and badge semantic variants remain explicit rather than inferred from color", () => {
  const html = renderToStaticMarkup(createElement("div", null,
    createElement(NeuButton, { variant: "destructive", disabled: true, type: "submit" }, "Delete"),
    createElement(NeuButton, { variant: "accent" }, "Approve"),
    createElement(NeuBadge, { tone: "danger" }, "Blocked"),
  ));
  assert.match(html, /data-ff-neu-variant="destructive"/);
  assert.match(html, /data-ff-neu-variant="accent"/);
  assert.match(html, /type="submit"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /data-ff-neu-tone="danger"/);
});
