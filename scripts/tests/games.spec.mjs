import { test, expect, start } from './fixtures.mjs';
test('every minigame entry opens its menu or destination without errors', async ({ page }) => {
  await start(page, { seeded: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluate(() => {
    const records = loadAlbums();
    for (let i = 200; i < 260; i++) records[i] = { id: String(i), name: `Record ${i}`, artist: 'Test Artist', score: 80, art: '/assets/icons/icon-512.png', ratedAt: Date.now() };
    localStorage.setItem('crate_albums_v1', JSON.stringify(records));
    paintUnlocks(false);
    goToView('games');
  });
  const entries = [
    ['#recall-card', '#recall-modal'], ['#drop-card', '#drop-modal'], ['#ew-card', '#ew-modal'],
    ['.game-card[data-game="cover"]', '#game'], ['.game-card[data-game="coverx"]', '#game'],
    ['.game-card[data-game="tracklist"]', '#game'], ['.game-card[data-game="year"]', '#game'],
    ['#blitz-card', '#blitz-modal'], ['#hl-card', '#hl-modal']
  ];
  for (const [card, modal] of entries) {
    await page.locator(card).click();
    await expect(page.locator(modal)).toHaveClass(/open/);
    await page.locator(modal + ' .modal-close').click();
    await expect(page.locator(modal)).not.toHaveClass(/open/);
  }
  await page.locator('#war-card').click();
  await expect(page).toHaveTitle('VINALL — Bid Wars');
  expect(errors).toEqual([]);
});
