import { test, expect, start } from './fixtures.mjs';
const views = { home: 'VINALL', albums: 'Albums', songs: 'Songs', crate: 'The Crate', choice: 'Community Choice', foryou: 'For You', games: 'Arcade', wars: 'Bid Wars', collection: 'Collection', rewards: 'Shop', achievements: 'Achievements', profile: 'Profile', people: 'Discover', grooves: 'Grooves' };
for (const [width, height] of [[320, 568], [375, 812], [768, 1024], [1024, 768], [1440, 900], [2560, 1440]]) {
  test(`all views at ${width}×${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await start(page, { seeded: true });
    for (const [mode, title] of Object.entries(views)) {
      await page.evaluate(m => goToView(m), mode);
      await expect(page.locator('#view-' + mode)).toBeVisible();
      await expect(page).toHaveTitle(mode === 'home' ? title : 'VINALL — ' + title);
      await page.waitForTimeout(100);
      const overflow = await page.evaluate(() => {
        const root = document.querySelector('.view[style*="display: block"]');
        return Array.from(root.querySelectorAll('button, input, select, .game-card, .card')).filter(n => {
          if (!n.getClientRects().length || n.closest('#fy-feed, .cc-cats, .sort-grip, [hidden]')) return false;
          const r = n.getBoundingClientRect();
          return r.width > 0 && (r.left < -2 || r.right > innerWidth + 2);
        }).slice(0, 5).map(n => n.outerHTML.slice(0, 150));
      });
      expect(overflow, `${mode} controls should fit ${width}px`).toEqual([]);
      if (width === 375 && ['home', 'games', 'albums', 'foryou'].includes(mode)) await page.screenshot({ path: info.outputPath(`${mode}.png`) });
    }
    expect(errors).toEqual([]);
  });
}
test('public documents, branding and official icons', async ({ page }) => {
  for (const [file, title] of [['/', 'VINALL'], ['/privacy.html', 'VINALL — Privacy Policy'], ['/terms.html', 'VINALL — Terms of Use'], ['/offline.html', 'VINALL — Offline'], ['/reset.html', 'VINALL — Reset Password']]) {
    await page.goto(file);
    await expect(page).toHaveTitle(title);
    expect(await page.locator('head').textContent()).not.toContain('Music Ranker');
    expect(await page.locator('link[rel="icon"]').count()).toBeGreaterThan(0);
  }
  for (const icon of ['favicon.ico', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png', 'browser-192.png', 'browser-512.png']) {
    const response = await page.request.get('/assets/icons/' + icon);
    expect(response.ok()).toBeTruthy();
    expect((await response.body()).length).toBeGreaterThan(100);
  }
});
test('search, album tracks and browser back', async ({ page }) => {
  await start(page, { seeded: true });
  await page.locator('#search-input').fill('Record');
  await expect(page.locator('.suggestion').first()).toBeVisible();
  await page.locator('#search-input').press('ArrowDown');
  await page.locator('#search-input').press('Enter');
  await expect(page).toHaveTitle('VINALL — Album');
  await expect(page.locator('#detail-tracks .song-row').first()).toBeVisible();
  await page.evaluate(() => goToView('games'));
  await page.goBack();
  await expect(page).toHaveTitle('VINALL — Album');
  await page.evaluate(() => goToView('missing-page'));
  await expect(page).toHaveTitle('VINALL — Album');
});
test('dialogs trap focus, close with Escape and restore focus', async ({ page }) => {
  await start(page);
  await page.evaluate(() => goToView('profile'));
  await page.locator('#prof-login').click();
  const dialog = page.locator('#auth-modal');
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  for (let i = 0; i < 20; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.closest('#auth-modal') !== null)).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveClass(/open/);
  await expect(page.locator('#prof-login')).toBeFocused();
  expect(await page.evaluate(() => document.querySelectorAll('[inert]').length)).toBe(0);
});
test('game cards work from the keyboard and reduced motion is respected', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page, { seeded: true });
  await page.evaluate(() => goToView('games'));
  await page.locator('.game-card[data-game="cover"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#game')).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#game')).not.toHaveClass(/open/);
  expect(await page.evaluate(() => motionReduced())).toBeTruthy();
  expect(await page.locator('#fy-feed').evaluate(n => getComputedStyle(n).scrollSnapType)).toBe('y mandatory');
});
