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
// Downscale in linear light (gamma) so the mark's thin white lines keep their
// brightness instead of greying out; sharpen the tab sizes, where they are a pixel wide.
const icon = async (size, inset = .06) => {
  const side = Math.round(size * (1 - inset * 2));
  let logo = sharp(trimmed).gamma(2.2).resize(side, side, { fit: 'contain', background: '#000000' });
  if (size <= 96) logo = logo.sharpen({ sigma: .5 });
  return sharp({ create: { width: size, height: size, channels: 3, background: '#000000' } }).composite([{ input: await logo.png().toBuffer(), gravity: 'centre' }]).png().toBuffer();
};
for (const [name, size, inset] of [['favicon-16.png', 16, .03], ['favicon-32.png', 32, .03], ['favicon-48.png', 48, .03], ['favicon-96.png', 96, .03], ['apple-touch-icon.png', 180, .10], ['browser-192.png', 192, .10], ['browser-512.png', 512, .10], ['browser-maskable-192.png', 192, .20], ['browser-maskable-512.png', 512, .20]]) await fs.writeFile(path.join(dir, name), await icon(size, inset));
console.log('Generated official browser, Apple and installable web icons.');
