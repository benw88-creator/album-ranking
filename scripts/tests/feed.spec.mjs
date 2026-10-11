import { test, expect, start } from './fixtures.mjs';
async function enterFeed(page) {
  await start(page, { seeded: true });
  await page.locator('#modes [data-mode="foryou"]').click();
  await expect(page.locator('#fy-feed .fy-card').first()).toBeVisible();
  await expect.poll(() => page.locator('#fy-feed .fy-card').count()).toBeGreaterThan(5);
  await page.locator('#fy-feed').focus();
}
async function post(page) { return page.locator('#fy-feed').evaluate(n => Math.round(n.scrollTop / n.clientHeight)); }
test('desktop arrows, wheel blocking, rapid changes, focus guards and audio', async ({ page }) => {
  await enterFeed(page);
  const feed = page.locator('#fy-feed');
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => post(page)).toBe(1);
  await expect(page.locator('.fy-card[data-i="1"]')).toHaveClass(/is-playing|needs-tap/);
  const beforeWheel = await feed.evaluate(n => n.scrollTop);
  await feed.hover(); await page.mouse.wheel(0, 900);
  await page.waitForTimeout(350);
  expect(await feed.evaluate(n => n.scrollTop)).toBeCloseTo(beforeWheel, 0);
  await feed.focus();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
  await expect.poll(() => post(page)).toBe(2);
  const slider = page.locator('.fy-card[data-i="2"] input');
  await slider.focus(); const value = await slider.inputValue();
  await slider.press('ArrowUp');
  expect(Number(await slider.inputValue())).toBe(Number(value) + 1);
  expect(await post(page)).toBe(2);
  await page.locator('#search-input').focus();
  await page.keyboard.press('ArrowDown');
  expect(await post(page)).toBe(2);
  await feed.focus(); await page.keyboard.press('ArrowUp');
  await expect.poll(() => post(page)).toBe(1);
  expect(await page.locator('.fy-card.is-playing').count()).toBeLessThanOrEqual(1);
  await page.locator('#modes [data-mode="games"]').click();
  await expect(page.locator('.fy-card.is-playing')).toHaveCount(0);
  await page.locator('#modes [data-mode="foryou"]').click();
  await expect.poll(() => post(page)).toBe(1);
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.waitForTimeout(300);
  expect(await post(page)).toBe(1);
  expect(await feed.evaluate(n => Math.abs(n.scrollTop - n.clientHeight))).toBeLessThan(2);
});
test('reduced-motion arrow navigation keeps a whole post aligned', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterFeed(page);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => post(page)).toBe(1);
  expect(await page.locator('#fy-feed').evaluate(n => Math.abs(n.scrollTop - n.clientHeight))).toBeLessThan(2);
});
test('refresh and feed switching while pending uses the latest selection', async ({ page }) => {
  await enterFeed(page);
  await page.locator('#fy-refresh').click();
  await page.locator('#fy-seg [data-feed="pushed"]').click();
  await expect(page.locator('#fy-feed')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#fy-feed')).toContainText('Nothing pushed yet');
  await page.locator('#fy-seg [data-feed="you"]').click();
  await expect(page.locator('#fy-feed .fy-card').first()).toBeVisible();
});
test('autoplay refusal asks for a tap and clears its cue after playback', async ({ page }) => {
  await start(page, { seeded: true });
  await page.evaluate(() => {
    const play = VinalAudio.play;
    let blocked = true;
    VinalAudio.play = function (...args) { if (blocked) { blocked = false; return Promise.resolve('blocked'); } return play(...args); };
    goToView('foryou');
  });
  const card = page.locator('.fy-card[data-i="0"]');
  await expect(card).toHaveClass(/needs-tap/);
  // Returning to a blocked card can be allowed after a different gesture.
  await page.evaluate(() => ForYou.render());
  await card.locator('[data-play]').click();
  await expect(card).toHaveClass(/is-playing/);
  await expect(card).not.toHaveClass(/needs-tap/);
});
