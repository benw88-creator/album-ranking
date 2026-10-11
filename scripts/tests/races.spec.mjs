import { test, expect, start, album } from './fixtures.mjs';
test('a delayed album cannot overwrite the next album', async ({ page }) => {
  await start(page);
  await page.route('**/api/catalogue?**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('path') === 'album') {
      const id = url.searchParams.get('id');
      if (id === '100') await new Promise(resolve => setTimeout(resolve, 300));
      return route.fulfill({ json: album(id) });
    }
    return route.fallback();
  });
  await page.evaluate(() => {
    openAlbum({ id: '100', name: 'First record', artist: 'Test Artist' });
    openAlbum({ id: '101', name: 'Second record', artist: 'Test Artist' });
  });
  await expect(page.locator('#detail-name')).toHaveText('Second record');
  await expect(page.locator('#detail-tracks')).toContainText('Song 101-0');
  expect(await page.locator('#detail-tracks').textContent()).not.toContain('Song 100-0');
  await page.goBack();
  await expect(page.locator('#detail-name')).toHaveText('First record');
  await expect(page.locator('#detail-tracks')).toContainText('Song 100-0');
});
test('public profile history and delayed results follow the latest person', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    Cloud.fetchProfile = id => new Promise(resolve => setTimeout(() => resolve({ id, username: id === 'slow' ? 'Slow Person' : 'Fast Person', top3: [] }), id === 'slow' ? 300 : 10));
    viewUserProfile('slow'); viewUserProfile('fast');
  });
  await expect(page.locator('#profile-body')).toContainText('Fast Person');
  await page.waitForTimeout(400);
  expect(await page.locator('#profile-body').textContent()).not.toContain('Slow Person');
  await page.goBack();
  await expect(page.locator('#profile-body')).toContainText('Slow Person');
});
test('closing a sheet consumes its history without closing the underlying view', async ({ page }) => {
  await start(page);
  await page.evaluate(() => goToView('profile'));
  await page.locator('#prof-login').click();
  await page.locator('#auth-close').click();
  await expect(page.locator('#auth-modal')).not.toHaveClass(/open/);
  await expect.poll(() => page.evaluate(() => history.state?.layer || 0)).toBe(0);
  await page.goBack();
  await expect(page).toHaveTitle('VINALL');
});
