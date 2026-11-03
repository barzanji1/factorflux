// Isolated Chromium API fixtures; no real invoices, notes or staff are changed.
const { spawn } = require("node:child_process");
const { mkdtempSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = mkdtempSync("/tmp/invoice-notes-browser-");
let chrome, ws, seq = 0, stage = "startup", failAdd = true;
const pending = new Map(), errors = [], writes = [];
let actor = { id: "note-fixture-author", firstName: "Dosh", lastName: "Fixture", role: "employee", status: "active" };
const notes = [
  { id: 3, entityType: "invoice", entityId: 741, noteText: "My own original note with enough detail to require the full expanded text rather than a short preview.",
    userId: actor.id, author: actor, createdAt: "2026-11-03T17:00:00Z" },
  { id: 2, entityType: "invoice", entityId: 741, noteText: "Another agent's note with context that the current employee cannot edit or delete.",
    userId: "other-agent", author: { id: "other-agent", firstName: "Maria", lastName: "Fixture" }, createdAt: "2026-11-02T17:00:00Z" },
];
const timeline = [];
function fixture(path, method, raw, query) {
  if (path === "/api/auth/verify") return { user: actor };
  if (path === "/api/auth/permissions") return { permissions: ["dashboard", "invoices", "chat", "tasks"] };
  if (path === "/api/tasks/741") return { id: 741, title: "Shared notes task fixture", status: "todo", priority: "medium", progress: 0, type: "task" };
  if (path === "/api/notes" && method === "GET") return notes.filter(n => !n.deletedAt && n.entityType === query.get("entityType") && n.entityId === Number(query.get("entityId")));
  if (path === "/api/notes" && method === "POST") {
    const body = JSON.parse(raw); writes.push({ method, body });
    if (failAdd) { failAdd = false; return { __status: 503, message: "Fixture storage unavailable; draft retained" }; }
    const note = { id: Math.max(...notes.map(n => n.id)) + 1, ...body, userId: actor.id, author: actor, createdAt: new Date().toISOString() };
    notes.unshift(note);
    if (body.entityType === "invoice") timeline.unshift({ id: "event-add", category: "collection", title: "Note added by Dosh Fixture", timestamp: note.createdAt,
      actor, meta: { noteId: note.id, noteAction: "add" } });
    return note;
  }
  if (path.match(/\/notes\/\d+$/)) {
    const note = notes.find(n => n.id === Number(path.split("/").pop()));
    writes.push({ method, id: note.id });
    if (method === "PATCH") { note.noteText = JSON.parse(raw).noteText; note.editedAt = new Date().toISOString(); return note; }
    if (method === "DELETE") { note.deletedAt = new Date().toISOString(); return { id: note.id, deletedAt: note.deletedAt }; }
  }
  if (path === "/api/invoices/741/detail") return {
    id: 741, invoiceNumber: "NOTES-FIXTURE", loadNumber: "FIXTURE-741", amount: "500", status: "funded",
    factoringStage: "funded", clientId: 1, client: { id: 1, name: "Fixture Carrier" },
    broker: { id: 1, name: "Fixture Broker" }, documents: [], notes: "Legacy text must not be rendered separately",
    chargeback: { status: "none", history: [] },
    activities: [], statusHistory: [], payments: [], payouts: [],
  };
  if (path.includes("/timeline")) return timeline;
  if (path.endsWith("/document-status")) return { rules: [], missingForReview: [], missingForApproval: [], completenessPercent: 100 };
  if (path.endsWith("/ocr-alerts") || path.endsWith("/preflight")) return { alerts: [] };
  if (path.includes("unread") || path.endsWith("pending-count")) return { count: 0, unreadCount: 0 };
  return [];
}
(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 150 && !existsSync(`${profile}/DevToolsActivePort`); i++) await sleep(100);
  const port = readFileSync(`${profile}/DevToolsActivePort`, "utf8").split("\n")[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.once("open", resolve));
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  ws.on("message", async raw => {
    const event = JSON.parse(raw);
    if (event.id) { const call = pending.get(event.id); pending.delete(event.id); if (call) event.error ? call.reject(event.error) : call.resolve(event.result); }
    if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    try {
      const url = new URL(request.url);
      const result = fixture(url.pathname, request.method, request.postData, url.searchParams);
      const { __status, ...body } = result;
      await cdp("Fetch.fulfillRequest", { requestId, responseCode: __status || 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(__status ? body : result)).toString("base64") });
    } catch (error) { if (!String(error?.message).includes("Invalid InterceptionId")) errors.push(String(error?.message || error)); }
  });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("isAuthenticated","true");if(!localStorage.getItem("user"))localStorage.setItem("user",${JSON.stringify(JSON.stringify(actor))});` });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 300; i++) { if (await evaluate(expression)) return; await sleep(100); }
    throw Error(`Timed out ${expression}; ${await evaluate("document.body.innerText.slice(-1800)")} ${errors.join("\n")}`);
  };
  const click = async expression => {
    await evaluate(`(${expression}).scrollIntoView({block:"center",behavior:"instant"})`); await sleep(250);
    const point = await evaluate(`(()=>{const e=${expression},r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", {
      type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
    });
    await sleep(120);
  };
  const button = text => `Array.from(document.querySelectorAll("button")).find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  const fill = async (expression, text) => {
    await click(expression);
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, commands: ["selectAll"] });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 });
    await cdp("Input.insertText", { text });
  };
  await cdp("Page.navigate", { url: "http://127.0.0.1:5000/invoices/741" });
  await until(`document.querySelectorAll(".ff-entity-note").length===2`);
  stage = "author edit";
  assert(!await evaluate(`document.body.innerText.includes("Legacy text must not")`));
  await click(`document.querySelector(".ff-entity-note")`);
  await until(`document.querySelector(".ff-entity-note__body.is-full")!==null`);
  await click(`document.querySelector('.ff-entity-note__actions button[aria-label^="Edit"]')`);
  await fill(`document.querySelector('textarea[aria-label="Edit note"]')`, "Corrected note");
  await click(button("Save"));
  await until(`document.querySelector(".ff-entity-note__edited")!==null`);
  assert.equal(notes[0].noteText, "Corrected note");
  stage = "other author's permissions";
  await click(`document.querySelectorAll(".ff-entity-note")[1]`);
  assert.equal(await evaluate(`document.querySelectorAll(".ff-entity-note")[1].querySelectorAll(".ff-entity-note__actions button").length`), 0);
  stage = "failed add retains draft";
  await click(button("Add note"));
  await fill(`document.getElementById("entity-note-draft-invoice-741")`, "New multi-agent note");
  await click(button("Save note"));
  await until(`document.querySelector(".ff-entity-notes__error")!==null`);
  assert.equal(await evaluate(`document.getElementById("entity-note-draft-invoice-741").value`), "New multi-agent note");
  await click(button("Save note"));
  await until(`document.querySelectorAll(".ff-entity-note").length===3`);
  stage = "timeline link";
  await click(button("Timeline"));
  await until(`!!(${button("View note")})`);
  assert(!await evaluate(`document.body.innerText.includes("New multi-agent note")`));
  await click(button("View note"));
  await until(`document.querySelector(".ff-entity-note.is-expanded")?.textContent.includes("New multi-agent note")`);
  stage = "manager can delete but not edit";
  actor = { ...actor, id: "note-fixture-manager", role: "manager" };
  await evaluate(`localStorage.setItem("user",${JSON.stringify(JSON.stringify(actor))})`);
  await cdp("Page.reload");
  await until(`document.querySelectorAll(".ff-entity-note").length===3`);
  await click(`document.querySelector(".ff-entity-note")`);
  assert.equal(await evaluate(`document.querySelectorAll('.ff-entity-note__actions button[aria-label^="Edit"]').length`), 0);
  await click(`document.querySelector('.ff-entity-note__actions button[aria-label^="Delete"]')`);
  await until(`document.body.innerText.includes("Delete this note?")`);
  await click(button("Yes"));
  await until(`document.querySelectorAll(".ff-entity-note").length===2`);
  assert.ok(notes.find(n => n.id === 4).deletedAt);
  stage = "shared component on task, no cross-entity leakage";
  await cdp("Page.navigate", { url: "http://127.0.0.1:5000/tasks/741" });
  await until(`document.getElementById("task-notes-741")!==null`);
  assert.equal(await evaluate(`document.querySelectorAll(".ff-entity-note").length`), 0);
  await click(button("Add note"));
  await fill(`document.getElementById("entity-note-draft-task-741")`, "Task-only context");
  await click(button("Save note"));
  await until(`document.querySelectorAll(".ff-entity-note").length===1`);
  assert.equal(notes.find(n => n.entityType === "task").entityId, 741);
  await cdp("Page.navigate", { url: "http://127.0.0.1:5000/invoices/741" });
  await until(`document.querySelectorAll(".ff-entity-note").length===2`);
  assert(!await evaluate(`document.querySelector(".ff-entity-notes").textContent.includes("Task-only context")`));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click(`document.querySelector(".ff-entity-note")`);
  assert(await evaluate(`document.querySelector(".ff-entity-note.is-expanded")!==null`));
  const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync("/tmp/invoice-notes-mobile.png", Buffer.from(screenshot.data, "base64"));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, browserFixturesOnly: true, authorEdit: true, managerCannotEdit: true,
    softDelete: true, failedDraftRetained: true, timelineLink: true, touchExpansion: true, sharedTaskComponent: true, noCrossEntityLeak: true, writes: writes.length }));
})().catch(error => { console.error(stage, error); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill("SIGKILL"); });
