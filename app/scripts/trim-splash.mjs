/* Runs after @capacitor/assets, which writes the launch image six times over:
 * the same 2732x2732 PNG filed at 1x, 2x AND 3x, light and dark. That is 45
 * megapixels of identical picture, and it wedged actool — every build sat on
 * "CompileAssetCatalogVariant thinned" for twenty minutes at 0% CPU, which is
 * a blocked helper rather than slow work.
 *
 * It is also just wrong. A scale says how many pixels go into a point, so the
 * same file at three scales claims three different physical sizes. One 1x
 * entry is what a universal launch image is, and Xcode scales it.
 *
 * 1536 rather than 2732 because the splash is a flat ground with a record in
 * the middle, it is on screen for about 200ms, and the real splash is the one
 * index.html draws.
 */
import { readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const set = resolve(here, '..', 'ios/App/App/Assets.xcassets/Splash.imageset');
const SIZE = 1536;

const keep = { light: 'splash@1x.png', dark: 'splash@1x-dark.png' };
const src = join(set, 'Default@1x~universal~anyany.png');
const srcDark = join(set, 'Default@1x~universal~anyany-dark.png');

await sharp(src).resize(SIZE, SIZE).png({ compressionLevel: 9 }).toFile(join(set, keep.light + '.tmp'));
await sharp(srcDark).resize(SIZE, SIZE).png({ compressionLevel: 9 }).toFile(join(set, keep.dark + '.tmp'));

for (const f of await readdir(set)) {
  if (f.endsWith('.tmp')) continue;
  await rm(join(set, f));
}
const { rename } = await import('node:fs/promises');
await rename(join(set, keep.light + '.tmp'), join(set, keep.light));
await rename(join(set, keep.dark + '.tmp'), join(set, keep.dark));

await writeFile(join(set, 'Contents.json'), JSON.stringify({
  images: [
    { idiom: 'universal', filename: keep.light, scale: '1x' },
    { appearances: [{ appearance: 'luminosity', value: 'dark' }],
      idiom: 'universal', filename: keep.dark, scale: '1x' }
  ],
  info: { version: 1, author: 'xcode' }
}, null, 2) + '\n');

console.log(`trim-splash: two ${SIZE}x${SIZE} launch images, was six at 2732`);
