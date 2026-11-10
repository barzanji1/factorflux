import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("workspace styles are eager and no longer load competing institutional reskins", () => {
  const main = source("../main.tsx");
  assert.ok(main.indexOf('import "./index.css"') < main.indexOf('import App from "./App"'));
  assert.ok(main.indexOf('import "@/styles/neu/dashboard.css"') < main.indexOf('import App from "./App"'));
  assert.doesNotMatch(source("../App.tsx") + source("../pages/dashboard.tsx"),
    /import.*(?:ff-institutional-workspace|ff-financial-dashboard)\.css/);
});

test("authenticated route shell has the same neumorphic classes before and after page data", () => {
  assert.match(source("../App.tsx"),
    /className="ff-app-shell ff-neu-root ff-institutional-root flex h-screen flex-col overflow-hidden"/);
  assert.doesNotMatch(source("../components/ui/card.tsx"), /bg-\[#d4d0c8\]|border-\[#808080\]/);
});
