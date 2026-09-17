/* Builds the source images @capacitor/assets wants, out of the icon the web
 * app already ships. Nothing here is hand-drawn: assets/icons/icon-1024.png is
 * the app's real icon and everything below is that file placed on VINALL's own
 * ground (#0a0908, the same colour as the manifest and the splash).
 *
 * Two details that are not cosmetic:
 *   - iOS refuses an app icon with an alpha channel, so it is flattened.
 *   - the Android adaptive foreground is the MASKABLE icon, which is already
 *     drawn at 66% so Android's circular mask does not crop the record.
 */
import sharp from 'sharp';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const out = resolve(here, '..', 'assets');
const BG = { r: 0x0a, g: 0x09, b: 0x08, alpha: 1 };

const icon = resolve(root, 'assets/icons/icon-1024.png');
const maskable = resolve(root, 'assets/icons/icon-maskable-512.png');

// The store icon, flattened — iOS rejects transparency here.
await sharp(icon).flatten({ background: BG }).png().toFile(resolve(out, 'icon-only.png'));

await sharp(maskable).resize(1024, 1024).flatten({ background: BG }).png()
  .toFile(resolve(out, 'icon-foreground.png'));

await sharp({ create: { width: 1024, height: 1024, channels: 3, background: BG } })
  .png().toFile(resolve(out, 'icon-background.png'));

/* The splash is square at 2732 because it gets cropped to every shape a phone
   comes in; the record sits at a third of that so it survives the crop on the
   narrowest one. Light and dark are the same image — VINALL has one ground. */
const mark = await sharp(icon).resize(900, 900).toBuffer();
for (const name of ['splash.png', 'splash-dark.png']) {
  await sharp({ create: { width: 2732, height: 2732, channels: 3, background: BG } })
    .composite([{ input: mark, gravity: 'center' }])
    .png().toFile(resolve(out, name));
}

console.log('make-assets: icon-only, icon-foreground, icon-background, splash, splash-dark');
