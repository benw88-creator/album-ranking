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
async function reopen(page) {
  await page.reload();
  await page.waitForFunction(() => typeof window.goToView === 'function');
  const go = page.locator('#splash-cta');
  if (await go.isVisible()) await go.click();
  await expect(page.locator('#splash-gate')).toHaveCount(0);
  await page.evaluate(() => goToView('foryou'));
}
test('unreached cards are stashed without clip urls and paint first on reload, once, for the same account only', async ({ page }) => {
  await enterFeed(page);
  const reached = await page.locator('.fy-card[data-i="0"] .fy-title').textContent();
  await page.locator('#modes [data-mode="games"]').click();
  const stash = await page.evaluate(() => JSON.parse(localStorage.getItem('crate_fy_stash_v1')));
  expect(stash.u).toBe('anon');
  expect(stash.items.length).toBeGreaterThan(0);
  expect(stash.items.length).toBeLessThanOrEqual(4);
  // Signed preview urls die in minutes: none may be written down.
  expect(JSON.stringify(stash)).not.toMatch(/preview|\.wav|\.mp3|"clip"/);
  expect(stash.items.map(c => c.title)).not.toContain(reached);
  const first = stash.items[0].title;
  await reopen(page);
  await expect(page.locator('.fy-card[data-i="0"] .fy-title')).toHaveText(first);
  // Taken, not read: the same card cannot be painted from it twice.
  expect(await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('crate_fy_stash_v1') || 'null'); return s ? s.items.map(c => c.title) : []; })).not.toContain(first);
  // Another account's stash is refused.
  await page.evaluate(() => localStorage.setItem('crate_fy_stash_v1', JSON.stringify({ u: 'someone-else', at: Date.now(), items: [{ title: 'Not yours', skey: 'x|y', key: 'k' }] })));
  await reopen(page);
  await expect(page.locator('#fy-feed .fy-card').first()).toBeVisible();
  await expect(page.locator('#fy-feed')).not.toContainText('Not yours');
});
