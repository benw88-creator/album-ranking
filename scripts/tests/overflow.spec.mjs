import { test, expect, start } from './fixtures.mjs';
// Nothing on a phone may scroll or spill sideways: not the page in any view,
// and not the content of any game sheet (2026-10-21, Cover Fire and friends).
test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

function spill() {
  const W = document.documentElement.clientWidth;
  const out = [];
  if (document.scrollingElement.scrollWidth > W + 1) out.push('page ' + document.scrollingElement.scrollWidth);
  document.querySelectorAll('.modal.open .modal-panel').forEach(p => {
    if (p.scrollWidth > p.clientWidth + 1) {
      // Name the widest child so a failure says where to look.
      let worst = null, wr = 0;
      p.querySelectorAll('*').forEach(n => { const r = n.getBoundingClientRect(); if (r.width && r.right > wr && getComputedStyle(n).position !== 'fixed') { wr = r.right; worst = n; } });
      out.push(p.parentElement.id + ' ' + p.scrollWidth + '>' + p.clientWidth + ' ' + (worst ? (worst.id || worst.className) : ''));
    }
  });
  return out;
}

test('no view spills sideways at 375px', async ({ page }) => {
  await start(page, { seeded: true });
  for (const mode of ['home', 'crate', 'albums', 'songs', 'foryou', 'games', 'collection', 'rewards', 'profile']) {
    await page.evaluate(m => window.goToView(m), mode);
    await page.waitForTimeout(350);
    expect(await page.evaluate(spill), mode).toEqual([]);
  }
});

test('no game sheet spills sideways at 375px', async ({ page }) => {
  await start(page, { seeded: true });
  for (const open of ['openEarworm', 'openDailyDrop', 'openAlbumBlitz', 'openHigherLower', 'openRecall']) {
    await page.evaluate(fn => window[fn] && window[fn](), open);
    await page.waitForTimeout(500);
    expect(await page.evaluate(spill), open).toEqual([]);
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')));
  }
});
