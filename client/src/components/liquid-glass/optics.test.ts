import { strict as assert } from "node:assert";
import { test } from "node:test";
import { lensPixels } from "./optics";

test("rounded lens leaves the center neutral and displaces only its shoulder", () => {
  const width = 240;
  const height = 200;
  const pixels = lensPixels(width, height, 30);
  const pixel = (x: number, y: number) => Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
  assert.deepEqual(pixel(120, 100), [128, 128, 128, 255]);
  assert.deepEqual(pixel(70, 80), [128, 128, 128, 255]);
  assert(pixel(5, 100)[0] > 128);
  assert(pixel(234, 100)[0] < 128);
  assert(pixel(120, 5)[1] > 128);
  assert(pixel(120, 194)[1] < 128);
  for (let i = 0; i < pixels.length; i += 4) {
    assert.equal(pixels[i + 2], 128);
    assert.equal(pixels[i + 3], 255);
    assert(pixels[i] >= 30 && pixels[i] <= 226);
    assert(pixels[i + 1] >= 30 && pixels[i + 1] <= 226);
  }
});

test("corner normals bend in both directions without whole-image noise", () => {
  const pixels = lensPixels(200, 200, 40);
  const index = (15 * 200 + 15) * 4;
  assert(pixels[index] > 128);
  assert(pixels[index + 1] > 128);
  assert.deepEqual(lensPixels(200, 200, 40), pixels);
});
