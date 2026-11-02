// The record-label mark for the tutorial deck: the official artwork
// (assets/icons/vinall-official.png, white on black), trimmed to the mark and
// turned into WHITE-WITH-ALPHA, so CSS can use it as a mask and colour it.
// Nothing is redrawn — the alpha is the artwork's own brightness.
// Run from the repo root: node scripts/make-label-logo.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require(path.resolve('app/node_modules/sharp'));
const src = path.resolve('assets/icons/vinall-official.png');
const out = path.resolve('assets/icons/vinall-mark-alpha.png');
const trimmed = await sharp(src).greyscale().trim({ threshold: 40 }).toBuffer();
const alpha = await sharp(trimmed).resize({ width: 360, withoutEnlargement: true }).greyscale().toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
const { width, height } = alpha.info;
const rgba = Buffer.alloc(width * height * 4);
for (let i = 0; i < width * height; i++) {
  rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = alpha.data[i];
}
await sharp(rgba, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(out);
console.log('wrote', out, width + 'x' + height);
