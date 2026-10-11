import { test, expect, start } from './fixtures.mjs';
test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
async function enter(page) {
  await start(page, { seeded: true });
  await page.locator('#modes [data-mode="foryou"]').tap();
  await expect(page.locator('.fy-card').first()).toBeVisible();
  await expect.poll(() => page.locator('.fy-card').count()).toBeGreaterThan(5);
}
async function swipe(page, x, startY, endY) {
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY }] });
  for (let i = 1; i <= 12; i++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: startY + (endY - startY) * i / 12 }] });
    await page.waitForTimeout(16);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}
test('mobile targets, full-post layout, snapping and rotation', async ({ page }, info) => {
  await enter(page);
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBeTruthy();
  const sizes = await page.locator('#fy-refresh, #fy-push, .fy-card[data-i="0"] .fy-like, .fy-card[data-i="0"] .fy-save').evaluateAll(nodes => nodes.map(n => ({ w: n.getBoundingClientRect().width, h: n.getBoundingClientRect().height })));
  for (const size of sizes) { expect(size.h).toBeGreaterThanOrEqual(44); expect(size.w).toBeGreaterThanOrEqual(44); }
  const overlap = await page.evaluate(() => {
    const rate = document.querySelector('.fy-card .fy-rate').getBoundingClientRect();
    const nav = document.querySelector('#modes').getBoundingClientRect();
    return rate.bottom > nav.top;
  });
  expect(overlap).toBeFalsy();
  await page.screenshot({ path: info.outputPath('mobile-feed.png') });
  await page.locator('#fy-feed').evaluate(n => n.scrollTo({ top: n.clientHeight, behavior: 'instant' }));
  await expect(page.locator('.fy-card[data-i="1"]')).toHaveClass(/is-playing|needs-tap/);
  await page.setViewportSize({ width: 812, height: 375 });
  await page.waitForTimeout(400);
  const alignment = await page.locator('#fy-feed').evaluate(n => ({ post: Math.round(n.scrollTop / n.clientHeight), delta: Math.abs(n.scrollTop - n.clientHeight) }));
  expect(alignment.post).toBe(1); expect(alignment.delta).toBeLessThan(2);
});
test('actual vertical flick and swipe starting on the rating slider', async ({ page }, info) => {
  test.skip(info.project.name !== 'chrome', 'Chrome DevTools injects native touchscreen gestures; WebKit layout/snapping covered separately.');
  await enter(page);
  const windowY = await page.evaluate(() => scrollY);
  const feed = page.locator('#fy-feed');
  await swipe(page, 180, 620, 160);
  await expect.poll(() => feed.evaluate(n => Math.round(n.scrollTop / n.clientHeight))).toBe(1);
  await expect.poll(() => feed.evaluate(n => Math.abs(n.scrollTop - n.clientHeight))).toBeLessThan(2);
  expect(await page.evaluate(() => scrollY)).toBe(windowY);
  const slider = page.locator('.fy-card[data-i="1"] input');
  const r = await slider.boundingBox();
  const value = await slider.inputValue();
  await swipe(page, r.x + r.width / 2, r.y + r.height / 2, r.y - 430);
  await expect.poll(() => feed.evaluate(n => Math.round(n.scrollTop / n.clientHeight))).toBe(2);
  expect(await slider.inputValue()).toBe(value);
  await expect(page.locator('.fy-card.is-playing')).toHaveCount(1);
});
