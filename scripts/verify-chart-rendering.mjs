// Read-only browser regression check against the compiled production assets.
// Uses normal login; never saves records or prints credentials/document contents.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { StringDecoder } from "node:string_decoder";

const base = process.env.SIGNIN_TEST_URL;
const out = process.env.CHART_TEST_OUTPUT || "generated-artifacts/chart-rendering";
if (!base || !process.env.DEV_ADMIN_EMAIL || !process.env.DEV_ADMIN_PASSWORD) throw new Error("Browser test configuration missing");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(`${tmpdir()}/chart-regression-`);
const browser = spawn("/repl/tools/bin/chromium", [
  "--headless", "--no-sandbox", "--disable-gpu", "--remote-debugging-pipe", "--no-proxy-server",
  `--host-resolver-rules=MAP ${new URL(base).hostname} 127.0.0.1`,
  `--unsafely-treat-insecure-origin-as-secure=${base}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
let session, seq = 0, buffer = "";
const pending = new Map(), exceptions = [], results = [];
const decoder = new StringDecoder("utf8");
browser.stdio[4].on("data", chunk => {
  buffer += decoder.write(chunk);
  let end;
  while ((end = buffer.indexOf("\0")) !== -1) {
    const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    if (message.method === "Runtime.exceptionThrown") exceptions.push({ type: "Runtime exception" });
    const request = pending.get(message.id);
    if (request) {
      clearTimeout(request.timer); pending.delete(message.id);
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
    }
  }
});
const send = (method, params = {}, scoped = true) => new Promise((resolve, reject) => {
  const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 25000);
  pending.set(id, { resolve, reject, timer });
  browser.stdio[3].write(JSON.stringify({ id, method, params, ...(scoped && session ? { sessionId: session } : {}) }) + "\0");
});
const evaluate = async expression => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error("Browser evaluation failed");
  return result.result.value;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(expression, max = 20000) {
  const start = Date.now();
  while (Date.now() - start < max) { if (await evaluate(expression)) return; await sleep(100); }
  throw new Error("Browser state did not settle before timeout");
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  await sleep(80);
  let point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  // Entering a collapsed rail expands it; use its settled position, not the
  // coordinates measured before that existing hover animation.
  await sleep(280);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  if (!await evaluate(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${point.x},${point.y}))`)) throw new Error(`Blocked browser control: ${selector}`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}
function trackChartResponses() {
  window.__chartSpecs = new Map();
  const original = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await original(...args);
    const url = new URL(typeof args[0] === "string" ? args[0] : args[0].url, location.href);
    if (url.searchParams.get("insights") === "1" || url.pathname === "/api/agent-dashboard/financial") {
      const spec = { entity: url.pathname.split("/")[2], entityId: url.searchParams.get("entityId"), status: response.status, charts: [] };
      window.__chartSpecs.set(url.pathname + url.search, spec);
      if (response.ok) void response.clone().json().then(data => {
        if (url.pathname === "/api/agent-dashboard/financial") {
          spec.charts = [
            { kind: "cylinder", positive: data.months?.some(row => row.collected > 0) },
            { kind: "area", positive: data.months?.some(row => row.collected > 0 || row.invoiced > 0) },
          ];
        } else if (data.charts !== undefined) {
          spec.charts = data.charts.map(chart => ({ kind: chart.kind, positive: chart.data.some(row => chart.series.some(series => Number(row[series.key]) > 0)) }));
        } else {
          if (data.series?.length) spec.charts.push({ kind: "cylinder", positive: data.series.some(row => row.count > 0) }, { kind: "area", positive: true });
          if (data.breakdown?.length) spec.charts.push({ kind: "donut", positive: data.breakdown.some(row => row.value > 0) });
        }
        spec.loaded = true;
      }).catch(() => { spec.parseError = true; });
    }
    return response;
  };
}
function inspectCharts() {
  const problems = [], sections = [...document.querySelectorAll("[data-insights-entity]")];
  const specs = [...window.__chartSpecs.values()];
  if (document.querySelector("vite-error-overlay")) problems.push("Development overlay");
  if (/Access Denied|404 Page Not Found/.test(document.querySelector("main")?.innerText || "")) problems.push("Page inaccessible");
  let charts = 0, cylinders = 0, emptySections = 0;
  function inspectCard(card, spec) {
    const svg = card.querySelector("svg.recharts-surface");
    if (!svg) {
      if (!spec?.positive && card.querySelector(".ff-neu-chart-empty")) { emptySections++; return; }
      problems.push("Missing chart SVG"); return;
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) problems.push("Zero-sized chart");
    charts++;
    const caps = card.querySelectorAll(".recharts-bar-rectangle ellipse").length;
    cylinders += caps / 2;
    if (spec?.positive) {
      if (spec.kind === "cylinder" && caps === 0) problems.push("Missing positive cylinder geometry");
      if (spec.kind === "donut" && !card.querySelector(".recharts-pie-sector path[d]")) problems.push("Missing positive pie geometry");
      if (spec.kind === "area" && !card.querySelector(".recharts-area-area[d]")) problems.push("Missing area geometry");
    }
    for (const el of svg.querySelectorAll("[fill],[clip-path]")) for (const attr of ["fill", "clip-path"]) {
      const id = el.getAttribute(attr)?.match(/url\(["']?#([^)"']+)/)?.[1];
      if (id && !document.getElementById(id)) problems.push("Broken SVG reference");
    }
  }
  for (const section of sections) {
    const entity = section.dataset.insightsEntity;
    const path = location.pathname.split("/").filter(Boolean);
    const detailId = path.length === 2 && ["invoices", "tasks", "fuel-advance", "payouts", "loads"].includes(path[0]) ? path[1] : null;
    const candidates = specs.filter(spec => spec.entity === entity && (!detailId || spec.entityId === detailId));
    if (section.getAttribute("aria-busy") === "true" || /Loading chart|Loading insights/.test(section.innerText)) problems.push(`${entity}: still loading`);
    if (section.querySelector('[role="alert"]')) problems.push(`${entity}: request error`);
    const cards = [...section.querySelectorAll(".insight-chart")];
    const spec = candidates.find(spec => spec.loaded && spec.charts.length === cards.length);
    if (!spec) problems.push(`${entity}: chart count does not match data`);
    else {
      if (!cards.length) emptySections++;
      cards.forEach((card, i) => inspectCard(card, spec.charts[i]));
    }
    if (!section.querySelector(".insight-stat")) problems.push(`${entity}: missing metric values`);
  }
  if (location.pathname === "/") {
    const financial = specs.find(spec => spec.entity === "agent-dashboard");
    const cards = [...document.querySelectorAll('[data-testid="financial-overview"] .ff-neu-chart-card')];
    if (!financial?.loaded || cards.length !== 2 || document.querySelector("[data-dashboard-loading]")) problems.push("Dashboard financial data still loading");
    else cards.forEach((card, i) => inspectCard(card, financial.charts[i]));
    if (!document.querySelector(".ff-neu-kpi-card")) problems.push("Dashboard metrics missing");
  }
  // Other infographic renderers were not changed, but verify their real output
  // too: dimensions, SVG plots, and the completion of data-loading sections.
  if (document.querySelector('main section[aria-busy=true][aria-label^="Loading"]')) problems.push("Infographic statistics still loading");
  const requiredOverview = location.pathname === "/documents" ? "Document statistics"
    : location.pathname === "/tasks" ? "Task statistics"
    : /^\/clients\/[^/]+$/.test(location.pathname) ? "Carrier financial summary"
    : /^\/brokers\/[^/]+$/.test(location.pathname) ? "Broker financial summary" : null;
  if (requiredOverview && !document.querySelector(`section[aria-label="${requiredOverview}"]`)) problems.push("Infographic overview missing");
  let additionalCharts = 0, infographics = 0;
  for (const plot of document.querySelectorAll('main .recharts-responsive-container')) {
    if (plot.closest('[data-insights-entity],[data-testid="financial-overview"]')) continue;
    const svg = plot.querySelector("svg.recharts-surface"), rect = svg?.getBoundingClientRect();
    if (!rect || rect.width < 40 || rect.height < 40) problems.push("Additional chart missing or zero-sized");
    else additionalCharts++;
  }
  for (const label of ["Document statistics", "Task statistics", "Carrier financial summary", "Broker financial summary"]) {
    const root = document.querySelector(`section[aria-label="${label}"]`);
    for (const graphic of root?.querySelectorAll('[role="img"]') ?? []) {
      const rect = graphic.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) problems.push("Collapsed infographic");
      else infographics++;
    }
  }
  if (document.querySelector('[aria-label="Loading weekly chart"],[aria-label="Loading entity chart"]')) problems.push("Email charts still loading");
  // Only the active page's matching data/DOM matters. Navigation can cancel
  // cloned response reads for pages that have already unmounted.
  return { ready: problems.length === 0, problems: [...new Set(problems)], sections: sections.length, charts, additionalCharts, infographics, cylinders, emptySections };
}
try {
  const target = await send("Target.createTarget", { url: "about:blank" }, false);
  session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `(${trackChartResponses.toString()})()` });
  await send("Page.navigate", { url: `${base}/login` });
  await until("!!document.querySelector('input[type=email]')");
  await click("input[type=email]"); await send("Input.insertText", { text: process.env.DEV_ADMIN_EMAIL });
  await click("input[type=password]"); await send("Input.insertText", { text: process.env.DEV_ADMIN_PASSWORD });
  await click("button[type=submit]");
  await until("location.pathname==='/'&&!!document.querySelector('[data-testid=agent-dashboard]')");
  await sleep(800);
  await evaluate("window.__chartSidebar=document.querySelector('aside');true");
  const labels = await evaluate("[...document.querySelectorAll('aside button[aria-label]')].map(e=>e.getAttribute('aria-label'))");
  const source = await readFile("client/src/components/layout/sidebar.tsx", "utf8");
  const menu = [...source.matchAll(/\{\s*name:\s*"([^"]+)",\s*href:\s*"([^"]+)"/g)].map(([, label, route]) => ({ label, route })).filter(item => labels.includes(item.label));
  if (menu.length < 25) throw new Error("Full staff sidebar not available");
  const selected = process.env.CHART_TEST_ROUTES?.split(",");
  const detailsOnly = process.env.CHART_TEST_DETAILS_ONLY === "1";
  const visits = detailsOnly ? [] : selected ? menu.filter(item => selected.includes(item.route)) : menu;
  // Repeat core destinations to exercise cached charts as well as cold mounts.
  if (!selected && !detailsOnly) visits.push(...["/invoices", "/clients", "/brokers", "/"].map(route => menu.find(item => item.route === route)).filter(Boolean));
  if (!selected) {
    for (const route of detailsOnly ? [] : ["/activities", "/collections", "/workflow-builder"]) {
      if (!visits.some(item => item.route === route)) visits.push({ route, expectedInsights: true });
    }
    for (const [endpoint, route, expectedInsights] of [
      ["/api/invoices", "/invoices", true], ["/api/tasks", "/tasks", true],
      ["/api/fuel-advances", "/fuel-advance", true], ["/api/payouts", "/payouts", true],
      ["/api/loads", "/loads", true], ["/api/clients", "/clients", false], ["/api/brokers", "/brokers", false],
    ]) {
      const id = await evaluate(`(async()=>{const r=await fetch(${JSON.stringify(endpoint + "?limit=15")},{credentials:'include'});if(!r.ok)return null;const p=await r.json();const rows=Array.isArray(p)?p:p.data??p.items??p.rows??p[${JSON.stringify(endpoint.split("/").at(-1))}]??[];return Array.isArray(rows)&&rows[0]?.id!=null?String(rows[0].id):null})()`);
      if (id) visits.push({ route: `${route}/${encodeURIComponent(id)}`, expectedInsights });
      else results.push({ route: `${route}/:existing`, skipped: true, reason: "No existing accessible record; no fixture was created" });
    }
  }
  for (let index = 0; index < visits.length; index++) {
    const item = visits[index], start = performance.now();
    if (await evaluate("location.pathname+location.search") !== item.route) {
      if (item.label) await click(`aside button[aria-label=${JSON.stringify(item.label)}]`);
      else await evaluate(`history.pushState({},'',${JSON.stringify(item.route)});dispatchEvent(new PopStateEvent('popstate'));true`);
    }
    await until(`location.pathname+location.search===${JSON.stringify(item.route)}&&!document.querySelector('[data-route-viewport][aria-busy=true]')`);
    if (item.expectedInsights) await until("!!document.querySelector('[data-insights-entity]')");
    await sleep(300);
    if (item.route === "/vault" && !await evaluate("!!document.querySelector('[data-insights-entity]')")) {
      await until("!!document.querySelector('button[role=combobox]')");
      await click("button[role=combobox]");
      await until("!!document.querySelector('[role=option]')");
      await click("[role=option]");
      await until("!!document.querySelector('[data-insights-entity]')");
    }
    let state;
    const deadline = Date.now() + 20000;
    do { await sleep(120); state = await evaluate(`(${inspectCharts.toString()})()`); } while (!state.ready && Date.now() < deadline);
    // Allow existing Recharts draw animations to finish; do not alter them.
    await sleep(700);
    state = await evaluate(`(${inspectCharts.toString()})()`);
    const stable = await evaluate("document.querySelector('aside')===window.__chartSidebar&&window.__chartSidebar.isConnected");
    const result = { route: item.route, ...state, sidebarPreserved: stable, settledMs: Math.round(performance.now() - start) };
    results.push(result);
    const image = await send("Page.captureScreenshot", { format: "jpeg", quality: 65 });
    await writeFile(`${out}/${index}-${item.route.slice(1).replaceAll(/[^a-zA-Z0-9_-]/g, "-") || "dashboard"}.jpg`, Buffer.from(image.data, "base64"));
    await writeFile(`${out}/report.json`, JSON.stringify({ results, exceptions }, null, 2));
    console.log(JSON.stringify(result));
    if (!state.ready || !stable || exceptions.length) throw new Error(`Chart regression on ${item.route}: ${state.problems.join(", ")}`);
  }
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify({ results, exceptions }, null, 2));
  // The browser owns only test sessions; no application records were modified.
  try { await evaluate("fetch('/api/auth/logout',{method:'POST',credentials:'include'}).then(()=>true)"); } catch {}
  browser.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
