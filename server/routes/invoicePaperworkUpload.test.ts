import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import ts from "typescript";
import express from "express";
import multer from "multer";

async function setup(t: { after: (fn: () => Promise<void>) => void }, kind: "paperwork" | "ocr") {
  // Exercise the real multipart parser from routes.ts without starting jobs,
  // sending emails or writing fixture documents to the shared database/S3.
  const routes = fs.readFileSync("server/routes.ts", "utf8");
  const start = routes.indexOf(kind === "ocr" ? "function handleOcrIntakeUpload(" : "function handleInvoicePaperworkUpload(");
  const end = routes.indexOf(kind === "ocr" ? "// Invoice intake uses" : "function sanitizeOriginalName(", start);
  const functionName = kind === "ocr" ? "handleOcrIntakeUpload" : "handleInvoicePaperworkUpload";
  const source = ts.transpileModule(`${routes.slice(start, end)}\nexports.handler = ${functionName};`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { handler?: express.RequestHandler } = {};
  vm.runInNewContext(source, { exports, multer, path, DOCUMENT_UPLOAD_LIMIT: 135 * 1024 * 1024 });
  const app = express();
  app.post("/upload", exports.handler!, (req, res) => {
    const files = req.files as Record<string, Express.Multer.File[]> | Express.Multer.File[];
    res.json({ count: Array.isArray(files) ? files.length : Object.values(files).flat().length,
      slots: Array.isArray(files) ? [] : Object.fromEntries(Object.entries(files).map(([key, value]) => [key, value.length])) });
  });
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const address = server.address() as { port: number };
  return async (slots: string[]) => {
    const data = new FormData();
    slots.forEach((slot, index) => data.append(slot, new Blob(["%PDF-fixture"], { type: "application/pdf" }), `${index}.pdf`));
    return fetch(`http://127.0.0.1:${address.port}/upload`, { method: "POST", body: data });
  };
}

test("paperwork accepts repeated files in every slot and 20 PDFs total", async t => {
  const upload = await setup(t, "paperwork");
  const slots = ["rateConfirmation", "carrierInvoice", "billOfLading", "proofOfDelivery",
    "weightTicket", "dispatchSheet", "lumperReceipt", "other"];
  const response = await upload([...slots, ...slots, ...Array(4).fill("billOfLading")]);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.count, 20);
  assert.equal(body.slots.billOfLading, 6);
  for (const slot of slots) assert(body.slots[slot] >= 2);
});

test("paperwork rejects a 21-file batch instead of silently dropping files", async t => {
  const upload = await setup(t, "paperwork");
  assert.equal((await upload(Array(21).fill("billOfLading"))).status, 400);
});

test("OCR intake accepts 20 PDFs and rejects 21", async t => {
  const upload = await setup(t, "ocr");
  const response = await upload(Array(20).fill("files"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).count, 20);
  assert.equal((await upload(Array(21).fill("files"))).status, 400);
});
