import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createRequire } from "node:module";
import { neuTokenClasses } from "./tokens";
const { compactShadow } = createRequire(import.meta.url)("./compact-shadows.cjs") as { compactShadow: (value: string) => string };

test("neumorphic depth stays compact for cards, pressed surfaces and controls", () => {
  assert.equal(neuTokenClasses.convex, "shadow-[4px_4px_8px_#c8c8c8,-4px_-4px_8px_#ffffff]");
  assert.equal(neuTokenClasses.concave, "shadow-[inset_3px_3px_6px_#c8c8c8,inset_-3px_-3px_6px_#ffffff]");
  assert.equal(neuTokenClasses.flat, "shadow-[2px_2px_4px_#c8c8c8,-2px_-2px_4px_#ffffff]");
  assert.equal(neuTokenClasses.button, "shadow-[3px_3px_6px_#c8c8c8,-3px_-3px_6px_#ffffff]");
  assert.equal(neuTokenClasses.input, "!shadow-[inset_2px_2px_4px_#c8c8c8,inset_-2px_-2px_4px_#ffffff]");
  assert.match(neuTokenClasses.buttonPressed, /^active:shadow-\[inset_3px_3px_6px/);
});

test("all shared inputs use the same reduced inset token and keep forwarded props/ref", () => {
  const source = readFileSync(new URL("./components.tsx", import.meta.url), "utf8");
  for (const name of ["NeuInput", "NeuTextarea", "NeuSelect"]) {
    const start = source.indexOf(`export const ${name} =`);
    const end = source.indexOf(`${name}.displayName`, start);
    const component = source.slice(start, end);
    assert.ok(component.includes("neuTokenClasses.input"), name);
    assert.ok(component.includes("ref={ref}"), `${name} forwards ref`);
    assert.ok(component.includes("{...props}"), `${name} forwards form handlers and value`);
  }
  assert.ok(!source.includes("#b8b8b8"), "no old heavy shared-component shadows");
  assert.match(source, /neuTokenClasses\.buttonPressed/);
  assert.match(source, /neuTokenClasses\.focus/);
});

test("legacy arbitrary shadows compile at reduced depth without changing states or rings", () => {
  assert.equal(compactShadow("-7px -7px 16px #fff,7px 7px 16px #b8b8b8"),
    "-3.5px -3.5px 8px #fff,3.5px 3.5px 8px #c8c8c8");
  assert.equal(compactShadow("inset 5px 5px 10px #b8b8b8,inset -5px -5px 10px #ffffff"),
    "inset 2.5px 2.5px 5px #c8c8c8,inset -2.5px -2.5px 5px #ffffff");
  const withRing = "inset 4px 4px 8px #b8b8b8,inset -4px -4px 8px #fff,0 0 0 2px #27aab8";
  assert.ok(compactShadow(withRing).endsWith(",0 0 0 2px #27aab8"));
  for (const unchanged of [
    "4px 4px 8px #c8c8c8,-4px -4px 8px #fff",
    "2px 2px 0 #808080,-1px -1px 0 #fff",
    "0 0 12px rgba(39,170,184,.3)",
    "inset 4px 4px 8px #c8aaa7,inset -4px -4px 8px #fff",
    "0 5px 20px rgba(0,0,0,.2)",
  ]) assert.equal(compactShadow(unchanged), unchanged);
  const once = compactShadow(withRing);
  assert.equal(compactShadow(once), once, "build transform is idempotent");
});

test("Tailwind pipeline compacts legacy utilities in normal, focus and active states", async () => {
  const require = createRequire(import.meta.url);
  const postcss = require("postcss");
  const tailwind = require("tailwindcss");
  const plugin = require("./compact-shadows.cjs");
  const result = await postcss([
    tailwind({ content: [{ raw: '<button class="shadow-[7px_7px_16px_#b8b8b8,-7px_-7px_16px_#ffffff] active:shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#ffffff] focus:shadow-[4px_4px_9px_#c1c1c1,-4px_-4px_9px_#fff]"></button>' }], corePlugins: { preflight: false } }),
    plugin(),
  ]).process("@tailwind utilities;", { from: undefined });
  assert.match(result.css, /--tw-shadow: 3.5px 3.5px 8px #c8c8c8/);
  assert.match(result.css, /--tw-shadow: inset 2.5px 2.5px 5px #c8c8c8/);
  assert.match(result.css, /:focus/);
  assert.match(result.css, /:active/);
  assert.ok(!result.css.includes("16px #b8b8b8"));
});
