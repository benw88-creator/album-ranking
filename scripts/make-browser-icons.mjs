// Reproduce browser assets from the supplied official VINALL artwork.
// Native store artwork is intentionally independent of these browser icons.
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/icons');
const source = process.argv[2] || path.join(dir, 'vinall-official.png');
if (path.resolve(source) !== path.join(dir, 'vinall-official.png')) await fs.copyFile(source, path.join(dir, 'vinall-official.png'));
// The official white mark is supplied on a black matte. Its luminance is
// coverage: retain anti-aliased white edges while making the matte transparent.
const { data, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const rgba = Buffer.alloc(info.width * info.height * 4);
for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
  rgba[j] = rgba[j + 1] = rgba[j + 2] = 255;
  const light = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3);
  rgba[j + 3] = light < 12 ? 0 : light;
}
const trimmed = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).trim().png().toBuffer();
const icon = async (size, inset = 0, opaque = false) => {
  const side = Math.round(size * (1 - inset * 2));
  const background = opaque ? '#000000' : { r: 0, g: 0, b: 0, alpha: 0 };
  const logo = await sharp(trimmed).resize(side, side, { fit: 'contain', background }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } }).composite([{ input: logo, gravity: 'centre' }]).png().toBuffer();
};
for (const [name, size, inset, opaque] of [['favicon-16.png', 16, 0], ['favicon-32.png', 32, 0], ['favicon-48.png', 48, 0], ['apple-touch-icon.png', 180, .10, true], ['browser-192.png', 192, .06], ['browser-512.png', 512, .06], ['browser-maskable-192.png', 192, .20, true], ['browser-maskable-512.png', 512, .20, true]]) await fs.writeFile(path.join(dir, name), await icon(size, inset, opaque));
const images = await Promise.all([16, 32, 48].map(size => icon(size)));
const head = Buffer.alloc(6 + images.length * 16);
head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
let offset = head.length;
images.forEach((png, i) => {
  const size = [16, 32, 48][i], start = 6 + i * 16;
  head[start] = size; head[start + 1] = size;
  head.writeUInt16LE(1, start + 4); head.writeUInt16LE(32, start + 6);
  head.writeUInt32LE(png.length, start + 8); head.writeUInt32LE(offset, start + 12);
  offset += png.length;
});
await fs.writeFile(path.join(dir, 'favicon.ico'), Buffer.concat([head, ...images]));
console.log('Generated official browser, Apple and installable web icons.');
