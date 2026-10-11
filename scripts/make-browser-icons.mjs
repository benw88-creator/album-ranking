// Reproduce browser assets from the supplied official VINALL artwork.
// Native store artwork is intentionally independent of these browser icons.
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/icons');
const source = process.argv[2] || path.join(dir, 'vinall-official.png');
if (path.resolve(source) !== path.join(dir, 'vinall-official.png')) await fs.copyFile(source, path.join(dir, 'vinall-official.png'));
// Trim the source's empty black margins without redrawing or changing the mark.
const trimmed = await sharp(source).trim({ background: '#000000', threshold: 35 }).png().toBuffer();
const icon = async (size, inset = .06) => {
  const side = Math.round(size * (1 - inset * 2));
  const logo = await sharp(trimmed).resize(side, side, { fit: 'contain', background: '#000000' }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: '#000000' } }).composite([{ input: logo, gravity: 'centre' }]).png().toBuffer();
};
for (const [name, size, inset] of [['favicon-16.png', 16, .03], ['favicon-32.png', 32, .03], ['apple-touch-icon.png', 180, .10], ['browser-192.png', 192, .10], ['browser-512.png', 512, .10], ['browser-maskable-192.png', 192, .20], ['browser-maskable-512.png', 512, .20]]) await fs.writeFile(path.join(dir, name), await icon(size, inset));
const images = await Promise.all([16, 32, 48].map(size => icon(size, .03)));
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
