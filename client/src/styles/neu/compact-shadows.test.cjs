const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const postcss = require("postcss");
const compactNeumorphicShadows = require("./compact-shadows.cjs");

async function compile(css, from) {
  const result = await postcss([compactNeumorphicShadows()]).process(css, { from });
  return result.root;
}

function rule(root, selector) {
  return root.nodes.find(node => node.type === "rule" && node.selector === selector);
}

function declaration(ruleNode, prop) {
  return ruleNode.nodes.find(node => node.type === "decl" && node.prop === prop);
}

function customProperty(ruleNode, name) {
  return declaration(ruleNode, name)?.value;
}

test("authenticated neutral tokens preserve exact light paint values", async () => {
  const root = await compile(
    ".ff-card { background-color: #e0e0e0; color: #333333; border-color: #c9c9c9; }",
    "/workspace/client/src/index.css",
  );
  const card = rule(root, ".ff-card");
  const lightTokens = rule(root, ":root");

  assert.match(declaration(card, "background-color").value, /^var\(--ff-darkable-surface-/);
  assert.match(declaration(card, "color").value, /^var\(--ff-darkable-text-/);
  assert.match(declaration(card, "border-color").value, /^var\(--ff-darkable-border-/);

  for (const declarationNode of card.nodes) {
    const token = declarationNode.value.match(/^var\((--ff-darkable-[^)]+)\)$/)?.[1];
    if (!token) continue;
    assert.equal(customProperty(lightTokens, token), ({
      "background-color": "#e0e0e0",
      color: "#333333",
      "border-color": "#c9c9c9",
    })[declarationNode.prop]);
  }
});

test("neumorphic shadows map dark-side neutrals to shadow black and highlights to white", async () => {
  const root = await compile(
    ".ff-neu-card { box-shadow: -4px -4px 8px #fff, 4px 4px 8px #c8c8c8, inset 2px 2px 4px #aeaeae; }",
    "/workspace/client/src/styles/neu/dashboard.css",
  );
  const card = rule(root, ".ff-neu-card");
  const shadow = declaration(card, "box-shadow");
  const lightTokens = rule(root, ":root");
  const darkTokens = rule(root, ':root[data-theme="dark"], .dark');
  const names = [...shadow.value.matchAll(/var\((--ff-darkable-shadow-[^)]+)\)/g)].map(match => match[1]);

  assert.equal(names.length, 3);
  assert.deepEqual(names.map(name => customProperty(lightTokens, name)), ["#fff", "#c8c8c8", "#aeaeae"]);
  assert.deepEqual(names.map(name => customProperty(darkTokens, name)), [
    "rgba(255,255,255,0.05)",
    "rgba(0,0,0,0.5)",
    "rgba(0,0,0,0.5)",
  ]);
});

test("authored rgba shadow opacity and neumorphic offsets remain unchanged", async () => {
  const original = "box-shadow: -3px -3px 6px rgba(255,255,255,.08), 3px 3px 6px rgba(0,0,0,.12)";
  const root = await compile(`.ff-card { ${original}; }`, "/workspace/client/src/index.css");
  const value = declaration(rule(root, ".ff-card"), "box-shadow").value;
  const names = [...value.matchAll(/var\((--ff-darkable-shadow-[^)]+)\)/g)].map(match => match[1]);
  const darkTokens = rule(root, ':root[data-theme="dark"], .dark');

  assert.match(value, /-3px -3px 6px var\(/);
  assert.match(value, /3px 3px 6px var\(/);
  assert.deepEqual(names.map(name => customProperty(darkTokens, name)), [
    "rgba(255,255,255,.08)",
    "rgba(0,0,0,.12)",
  ]);
});

test("dark-only declarations are not tokenized or remapped", async () => {
  const css = `
    .ff-card { background: #e0e0e0; }
    :root[data-theme="dark"] .ff-card { background: #0d0d0d; color: #1a1a1a; }
    .dark .ff-neu-app-shell { background: #0d0d0d; box-shadow: 4px 4px 8px #c8c8c8; }
  `;
  const root = await compile(css, "/workspace/client/src/index.css");

  assert.equal(declaration(rule(root, ":root[data-theme=\"dark\"] .ff-card"), "background").value, "#0d0d0d");
  assert.equal(declaration(rule(root, ":root[data-theme=\"dark\"] .ff-card"), "color").value, "#1a1a1a");
  assert.equal(declaration(rule(root, ".dark .ff-neu-app-shell"), "background").value, "#0d0d0d");
  assert.equal(declaration(rule(root, ".dark .ff-neu-app-shell"), "box-shadow").value, "4px 4px 8px #c8c8c8");
});

test("institutional neutral rules are covered while login and semantic styles remain authored", async () => {
  const root = await compile(
    [
      ".ff-institutional-root { background: rgba(255, 255, 255, .8); color: #333333; }",
      ".ff-institutional-root .ff-institutional-neu-badge { background: #f3f6f7; }",
      ".ff-login-glass { background: #ffffff; color: #333333; }",
    ].join("\n"),
    "/workspace/client/src/styles/ff-institutional-workspace.css",
  );

  const institutional = rule(root, ".ff-institutional-root");
  assert.match(declaration(institutional, "background").value, /^var\(--ff-darkable-surface-/);
  assert.match(declaration(institutional, "color").value, /^var\(--ff-darkable-text-/);
  assert.equal(declaration(rule(root, ".ff-institutional-root .ff-institutional-neu-badge"), "background").value, "#f3f6f7");
  assert.equal(declaration(rule(root, ".ff-login-glass"), "background").value, "#ffffff");
  assert.equal(declaration(rule(root, ".ff-login-glass"), "color").value, "#333333");
});

test("color token identifiers are collision-safe across hex and functional syntax", async () => {
  const root = await compile(
    ".ff-card { background: #a0b0a0; background-color: rgb(160, 176, 160); }",
    "/workspace/client/src/index.css",
  );
  const card = rule(root, ".ff-card");
  const first = declaration(card, "background").value;
  const second = declaration(card, "background-color").value;
  const lightTokens = rule(root, ":root");

  assert.notEqual(first, second);
  assert.equal(customProperty(lightTokens, first.match(/^var\(([^)]+)\)$/)[1]), "#a0b0a0");
  assert.equal(customProperty(lightTokens, second.match(/^var\(([^)]+)\)$/)[1]), "rgb(160, 176, 160)");
});

test("legacy neutral table text adapts only inside staff pages and portals, never accent text", async () => {
  const root = await compile(
    ".text-\\[\\#394541\\] { color: #394541; } .text-\\[\\#68746f\\] { color: #68746f; } .text-\\[\\#347d69\\] { color: #347d69; }",
    "/workspace/client/src/index.css",
  );
  assert.equal(declaration(rule(root, ".text-\\[\\#394541\\]"), "color").value, "#394541");
  const dark = root.nodes.filter(node => node.type === "rule" && node.selector.includes('data-theme="dark"'));
  assert.equal(dark.length, 2);
  assert.match(dark[0].selector, /\.ff-institutional-root/);
  assert.match(dark[0].selector, /role="dialog"/);
  assert.equal(declaration(dark[0], "color").value, "var(--ff-text-0)");
  assert.equal(declaration(dark[1], "color").value, "var(--ff-text-1)");
  assert.ok(dark.every(node => !node.selector.includes("347d69")));
});

test("financial dashboard neutrals are tokenized without changing light values or shadow measurements", async () => {
  const root = await compile(
    [
      ".ff-financial-dashboard-shell .ff-neu-kpi-arrow {",
      "  background: #f3f8f8;",
      "  box-shadow: 0 3px 10px rgba(20, 46, 55, .067), inset 0 0 0 1px #dce9e9;",
      "}",
    ].join("\n"),
    "/workspace/client/src/styles/ff-financial-dashboard.css",
  );
  const arrow = rule(root, ".ff-financial-dashboard-shell .ff-neu-kpi-arrow");
  const lightTokens = rule(root, ":root");
  const darkTokens = rule(root, ':root[data-theme="dark"], .dark');
  const backgroundName = declaration(arrow, "background").value.match(/^var\(([^)]+)\)$/)[1];
  const shadowValue = declaration(arrow, "box-shadow").value;
  const shadowNames = [...shadowValue.matchAll(/var\((--ff-darkable-shadow-[^)]+)\)/g)].map(match => match[1]);

  assert.equal(customProperty(lightTokens, backgroundName), "#f3f8f8");
  assert.match(customProperty(darkTokens, backgroundName), /#242424/);
  assert.match(shadowValue, /0 3px 10px var\(/);
  assert.match(shadowValue, /inset 0 0 0 1px var\(/);
  assert.deepEqual(shadowNames.map(name => customProperty(lightTokens, name)), [
    "rgba(20, 46, 55, .067)",
    "#dce9e9",
  ]);
  assert.deepEqual(shadowNames.map(name => customProperty(darkTokens, name)), [
    "rgba(0,0,0,.067)",
    "rgba(255,255,255,0.05)",
  ]);
});

test("financial dashboard dark aliases set workspace, surface, ink, muted text and border while retaining teal", async () => {
  const stylesheet = fs.readFileSync(
    path.join(__dirname, "../ff-financial-dashboard.css"),
    "utf8",
  );
  const root = await compile(stylesheet, "/workspace/client/src/styles/ff-financial-dashboard.css");
  const darkAliases = rule(root, ':is(:root[data-theme="dark"], .dark) .ff-financial-dashboard-shell');
  const lightAliases = rule(root, ".ff-financial-dashboard-shell");

  assert.equal(customProperty(darkAliases, "--ff-financial-workspace"), "#0d0d0d");
  assert.equal(customProperty(darkAliases, "--ff-financial-porcelain"), "#1a1a1a");
  assert.equal(customProperty(darkAliases, "--ff-financial-charcoal"), "#e8e8e8");
  assert.equal(customProperty(darkAliases, "--ff-financial-slate"), "#a0a0a0");
  assert.equal(customProperty(darkAliases, "--ff-financial-border"), "#333333");
  assert.equal(customProperty(lightAliases, "--ff-financial-teal"), "#087f87");
});
