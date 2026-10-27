import { test, expect, start } from './fixtures.mjs';

test('a multi-level jump counts through every level and leaves by itself', async ({ page }) => {
  await start(page);
  await page.evaluate(() => Wallet.levelUp(5, 2));
  const n = page.locator('.lvl-pop .lp-n');
  await expect(n).toHaveText('5', { timeout: 3000 });
  await expect(page.locator('.lvl-pop .lp-s')).toHaveText('3 levels');
  // A second level-up while it is up merges rather than stacking.
  await page.evaluate(() => Wallet.levelUp(6, 5));
  await expect(n).toHaveText('6', { timeout: 2000 });
  await expect(page.locator('.lvl-pop')).toHaveCount(1);
  await expect(page.locator('.lvl-pop')).toHaveCount(0, { timeout: 6000 });
});

test('sound: every named effect renders without throwing, and Off means silent', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await start(page);
  await page.mouse.click(5, 5);   // a gesture, so the context can start
  await page.evaluate(() => ['rate', 'correct', 'fail', 'discs', 'celebrate', 'levelUp',
    // removed in Phase 1: must be harmless no-ops
    'tap', 'tick', 'release', 'success', 'open', 'discover', 'levelTick'].forEach(n => Sfx.play(n, { v: .8, n: 2 })));
  await page.evaluate(() => Sfx.setEnabled(false));
  expect(await page.evaluate(() => Sfx.enabled())).toBe(false);
  expect(errors).toEqual([]);
});

test('haptics never sound, and the audio session follows music', async ({ page }) => {
  await start(page);
  await page.mouse.click(5, 5);
  const r = await page.evaluate(() => {
    const played = [];
    const orig = Sfx.play; Sfx.play = function (n) { played.push(n); };
    ['select', 'tap', 'soft', 'press', 'good', 'warn', 'bad', 'big', 'nonsense'].forEach(k => buzz(k));
    Sfx.play = orig;
    const out = { played, m0: AudioMode.mode() };
    const a = new Audio();
    a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    a.play().catch(() => {});
    out.afterPrime = AudioMode.mode();
    a.src = '/test-preview.wav'; a.play().catch(() => {});
    out.afterMusic = AudioMode.mode();
    out.gated = AudioMode.gated();
    a.pause();
    return out;
  });
  expect(r.played).toEqual([]);
  expect(r.m0).toBe('ambient');
  expect(r.afterPrime).toBe('ambient');     // the silent unlock clip never takes the session
  expect(r.afterMusic).toBe('playback');
});

test('discovery: a prompt docks to the side, tucks into a tab, and the × retires it', async ({ page }) => {
  await start(page);
  await page.evaluate(() => { Discover.reset(); Discover.show('arcade'); });
  const tip = page.locator('.vx-tip');
  await expect(tip.locator('.vx-card')).toBeVisible();
  const box = await tip.locator('.vx-card').boundingBox();
  const vw = page.viewportSize().width;
  expect(box.x + box.width).toBeGreaterThan(vw - 20);   // against the right edge
  await page.evaluate(() => document.querySelector('.vx-tip').classList.add('tucked'));
  await expect(tip.locator('.vx-tab')).toBeVisible();
  await tip.locator('.vx-tab').click();
  await tip.locator('.vx-x').click();
  await expect(tip).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('crate_tips_v1')).d.arcade)).toBe('dismissed');
});
