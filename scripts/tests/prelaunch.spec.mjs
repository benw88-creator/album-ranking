import { test, expect, start } from './fixtures.mjs';
// Regressions from the 2026-10-21 pre-submission pass.

test('odometer digits stack vertically wherever they are used', async ({ page }) => {
  await start(page);
  // profile2.css once defined .pl-strip { display: flex }, which laid every
  // odometer's digit strip out sideways ("0123456789012…" in Bid Wars).
  const widths = await page.evaluate(async () => {
    const host = document.createElement('div'); host.className = 'war-chips';
    host.innerHTML = '<div class="war-chips-num"><span id="t-chips"></span></div>';
    document.body.appendChild(host);
    const n = host.querySelector('#t-chips'), out = [];
    for (const v of [100, 80, 20, 0]) { Play.roll(n, v); await new Promise(r => setTimeout(r, 50)); out.push(n.getBoundingClientRect().width); }
    return out;
  });
  for (const w of widths) expect(w).toBeLessThan(160);
});

test('Earworm shows the artist from the start and has no reveal button', async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.openEarworm());
  await expect(page.locator('#ew-modal')).toHaveClass(/open/);
  await expect(page.locator('#ew-hint')).toHaveCount(0);
  await expect(page.locator('#ew-clues .ew-clue-hint')).toHaveCount(1);
});

test('rating a song in For You does not move the feed', async ({ page }) => {
  await start(page, { seeded: true });
  await page.locator('#modes [data-mode="foryou"]').click();
  await expect.poll(() => page.locator('#fy-feed .fy-card').count()).toBeGreaterThan(3);
  const at = () => page.locator('#fy-feed').evaluate(n => Math.round(n.scrollTop / n.clientHeight));
  expect(await at()).toBe(0);
  await page.locator('.fy-card[data-i="0"] .fy-save').click();
  await page.waitForTimeout(1500);
  expect(await at()).toBe(0);
});

test('a level climb is never announced before the wallet has loaded', async ({ page }) => {
  await start(page);
  // Signed out, so load() never runs; an award arriving now must stay silent.
  const popped = await page.evaluate(async () => {
    if (!window.Wallet || !Wallet._apply) return 'missing';
    Wallet._apply({ level: 200 });
    await new Promise(r => setTimeout(r, 500));
    return !!document.querySelector('.lvl-pop');
  });
  expect(popped).toBe(false);
});
