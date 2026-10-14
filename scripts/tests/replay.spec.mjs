import { test, expect, start } from './fixtures.mjs';

// A crate with dated score history: twelve albums rated through this year,
// one of them changed its mind. All local, all synthetic.
// Replay is the day-five prize of a login run (ReplayGate), and these run
// signed out, so the tests that exercise the open Replay unlock it first.
const unlock = page => page.evaluate(() => { window.ReplayGate.unlocked = () => true; window.dispatchEvent(new Event('vinall:replay-gate')); });

async function seedCrate(page) {
  await page.addInitScript(() => {
    const now = Date.now(), y0 = new Date(new Date().getFullYear(), 0, 2).getTime(), A = {};
    for (let i = 0; i < 14; i++) {
      const t = y0 + Math.floor((now - y0) * i / 15), s = 60 + i * 2;
      const h = [{ s, t }];
      if (i === 3) h.push({ s: s + 18, t: Math.min(now - 3600e3, t + 20 * 864e5) });
      A['r' + i] = { id: 'r' + i, name: 'Record ' + i, artist: 'Artist ' + (i % 4), genre: ['Rock', 'Pop', 'Hip-Hop', 'Jazz'][i % 4],
        year: String(1990 + i), art: '/assets/icons/icon-512.png', score: h[h.length - 1].s, history: h, savedAt: t };
    }
    localStorage.setItem('crate_albums_v1', JSON.stringify(A));
  });
}

test('Replay home lists periods and the story moves, pauses and closes like a sheet', async ({ page }) => {
  await seedCrate(page);
  await start(page);
  await unlock(page);
  await page.evaluate(() => goToView('replay'));
  await expect(page.locator('#rp-home .rp-hero-word')).toHaveText(String(new Date().getFullYear()));
  await expect(page.locator('#rp-home .rp-card').first()).toBeVisible();
  await page.locator('#rp-home .rp-play').click();
  const story = page.locator('#rp-story');
  await expect(story).toHaveClass(/open/);
  await expect(story.locator('.rp-scene.sc-open')).toBeVisible();
  const scenes = await story.locator('.rp-bar span').count();
  expect(scenes).toBeGreaterThanOrEqual(4);
  // Keyboard forward and back; a control press never navigates.
  await page.keyboard.press('ArrowRight');
  await expect(story.locator('.rp-scene:not(.is-out)')).not.toHaveClass(/sc-open/);
  await page.keyboard.press('ArrowLeft');
  await expect(story.locator('.rp-scene:not(.is-out)')).toHaveClass(/sc-open/);
  await story.locator('#rp-pause').click();
  await expect(story).toHaveClass(/rp-story-paused/);
  await expect(story.locator('.rp-scene:not(.is-out)')).toHaveClass(/sc-open/);
  // To the end: the card is drawn at exactly 1080x1920, then 1080x1080.
  for (let i = 0; i < scenes; i++) await page.keyboard.press('ArrowRight');
  await expect(story.locator('.rp-scene.sc-final')).toBeVisible();
  const img = story.locator('#rp-summary img.pv');
  await expect(img).toBeVisible({ timeout: 10000 });
  expect(await img.evaluate(i => [i.naturalWidth, i.naturalHeight])).toEqual([1080, 1920]);
  await story.locator('[data-rp-fmt="square"]').click();
  await expect.poll(() => img.evaluate(i => i.naturalHeight).catch(() => 0)).toBe(1080);
  // Back closes the story and stays on Replay.
  await page.goBack();
  await expect(story).not.toHaveClass(/open/);
  expect(await page.evaluate(() => window.currentMode)).toBe('replay');
});

test('nothing is invented: no ratings means an empty state, and the demo is marked', async ({ page }) => {
  await start(page);
  await unlock(page);
  await page.evaluate(() => goToView('replay'));
  await expect(page.locator('#rp-home .rp-empty h3')).toHaveText('Nothing to replay yet');
  await page.locator('[data-rp-act="demo"]').click();
  await expect(page.locator('#rp-story .rp-demo-tag')).toHaveText(/not your data/i);
});

test('Replay fits a 375px phone with no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await seedCrate(page);
  await start(page);
  await unlock(page);
  await page.evaluate(() => goToView('replay'));
  await expect(page.locator('#rp-home .rp-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.locator('#rp-home .rp-play').click();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  }
});

test('locked until a five-day login streak, with the Spotify import and a demo on offer', async ({ page }) => {
  await seedCrate(page);
  await start(page);
  await page.evaluate(() => goToView('replay'));
  await expect(page.locator('#view-replay')).toContainText('Unlock on 5 day login streak');
  await expect(page.locator('#view-replay')).toContainText(/Spotify/);
  await expect(page.locator('#view-replay')).toContainText(/coming soon/i);
});
