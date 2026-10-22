// The splash record must land on the header mark wherever the header goes
// during the flight (hero opening above it, scroll), and leave nothing behind.
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function fly(page, during, landed = true) {
  await page.goto('/');
  await page.waitForSelector('#splash-cta');
  await page.evaluate(() => {
    window.__last = null;
    (function tick() {
      const g = document.getElementById('splash-gate');
      const d = document.getElementById('splash-disc');
      const m = document.querySelector('.brand-mark');
      if (g && d && g.classList.contains('is-handing')) {
        const a = d.getBoundingClientRect(), b = m.getBoundingClientRect();
        window.__last = { dx: a.left + a.width / 2 - (b.left + b.width / 2),
          dy: a.top + a.height / 2 - (b.top + b.height / 2),
          dw: a.width - parseFloat(getComputedStyle(m).width) };
      }
      if (g || !window.__last) requestAnimationFrame(tick);
    })();
  });
  await page.click('#splash-cta');
  if (during) await page.evaluate(during);
  await page.waitForFunction(() => !document.getElementById('splash-gate'), null, { timeout: 6000 });
  const last = await page.evaluate(() => window.__last);
  if (landed) {
  expect(Math.abs(last.dx)).toBeLessThan(1.5);
  expect(Math.abs(last.dy)).toBeLessThan(1.5);
  expect(Math.abs(last.dw)).toBeLessThan(1.5);
  }
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => {
    const m = document.querySelector('.brand-mark');
    return { op: getComputedStyle(m).opacity, recv: m.classList.contains('is-receiving'),
      rings: document.querySelectorAll('.mark-ring').length };
  });
  expect(after).toEqual({ op: '1', recv: false, rings: 0 });
}

test('lands on the mark', async ({ page }) => { await fly(page); });

test('lands on the mark when the hero opens above the header mid-flight', async ({ page }) => {
  await fly(page, () => new Promise(r => setTimeout(() => {
    showArtistHero(document.getElementById('artist-hero')); r();
  }, 900)));
  // Held during the flight, applied once the gate has gone.
  await page.waitForFunction(() => { const h = document.getElementById('artist-hero');
    return h.style.display === 'block' && !h.classList.contains('artist-hero-hidden'); }, null, { timeout: 3000 });
});

test('the flight runs as a compositor animation', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#splash-cta');
  await page.click('#splash-cta');
  await page.waitForFunction(() => document.querySelector('.splash-gate.is-handing'));
  const n = await page.evaluate(() => document.getElementById('splash-disc').getAnimations().filter(a => a.playState === 'running').length);
  expect(n).toBe(1);
});

test('lands on the mark when the page scrolls mid-flight', async ({ page }) => {
  await fly(page, () => new Promise(r => setTimeout(() => {
    document.body.style.minHeight = '3000px'; window.scrollTo(0, 120); r();
  }, 1100)));
});

test('a tab hidden mid-flight comes back clean', async ({ page }) => {
  await fly(page, () => new Promise(r => setTimeout(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden; r();
  }, 1000)), false);
});

test('repeated presses do not restart it', async ({ page }) => {
  await fly(page, async () => {
    for (let i = 0; i < 5; i++) { document.getElementById('splash-cta')?.click(); await new Promise(r => setTimeout(r, 60)); }
  });
});
