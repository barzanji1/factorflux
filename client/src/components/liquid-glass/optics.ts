/** Static displacement textures; generated only when the panel changes size. */
export function lensPixels(width: number, height: number, radius: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const halfX = width / 2;
  const halfY = height / 2;
  const r = Math.min(radius, halfX, halfY);
  const band = Math.max(8, Math.min(width, height) * 0.085);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5 - halfX;
      const py = y + 0.5 - halfY;
      const qx = Math.abs(px) - (halfX - r);
      const qy = Math.abs(py) - (halfY - r);
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const length = Math.hypot(ox, oy);
      const distance = -(length + Math.min(Math.max(qx, qy), 0) - r);
      let nx = 0;
      let ny = 0;
      if (length > 0) {
        nx = ox / length * Math.sign(px);
        ny = oy / length * Math.sign(py);
      } else if (qx > qy) nx = Math.sign(px);
      else ny = Math.sign(py);
      // Curved shoulder tapers to an entirely neutral, undistorted center.
      const amount = distance >= 0 && distance < band
        ? Math.sin(Math.PI * distance / band) * 98
        : 0;
      const index = (y * width + x) * 4;
      pixels[index] = 128 - nx * amount;
      pixels[index + 1] = 128 - ny * amount;
      pixels[index + 2] = 128;
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

export function createLensTexture(width: number, height: number, radius: number): string {
  const scale = Math.min(1, 256 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return "";
  const image = context.createImageData(canvas.width, canvas.height);
  image.data.set(lensPixels(canvas.width, canvas.height, radius * scale));
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}
