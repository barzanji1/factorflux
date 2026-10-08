import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { TesseractProvider } from "./tesseractProvider";

test("installed Tesseract worker API extracts a real image and terminates", { timeout: 90000 }, async () => {
  const canvas = createCanvas(1200, 400);
  const context = canvas.getContext("2d");
  context.fillStyle = "white"; context.fillRect(0, 0, 1200, 400);
  context.fillStyle = "black"; context.font = "42px sans-serif";
  context.fillText("Invoice Number: INV-9001", 40, 100);
  context.fillText("Load Number: LD-777", 40, 180);
  context.fillText("Total: $1250.00", 40, 260);
  const result = await new TesseractProvider().extract(canvas.toBuffer("image/png"), "image/png", "invoice");
  assert.match(result.text, /INV-9001/);
  assert.equal(result.fields.invoiceNumber, "INV-9001");
  assert.equal(result.fields.loadNumber, "LD-777");
  assert.ok(result.confidence > .5);
});
