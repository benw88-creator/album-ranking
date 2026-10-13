import { test, expect, start } from './fixtures.mjs';

// Recall with a local audio transport, so every round resolves offline.
async function openRecall(page) {
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    if (!window.VinalAudio) return;
    VinalAudio.register('spec', {
      label: 'Spec transport', link: () => null,
      resolve: () => Promise.resolve({ url: 'test:spec', ms: 30000 }),
      play: function () { this.t = performance.now(); return Promise.resolve(true); },
      stop: function () { this.t = null; },
      position: function () { return this.t == null ? 0 : (performance.now() - this.t) / 1000; }
    });
    VinalAudio.use('spec');
  }));
  await start(page);
  await page.evaluate(() => openRecall('endless'));
  await expect(page.locator('#recall-input')).toBeEnabled();
}
const step = page => page.locator('#recall-steps .now');

test('Enter picks the only suggestion instead of guessing, and the length never moves', async ({ page }) => {
  await openRecall(page);
  const input = page.locator('#recall-input');
  await input.fill('');
  await input.pressSequentially('smells like');
  await expect(page.locator('#recall-sugg .rc-sug')).toHaveCount(1);
  await input.press('Enter');
  await expect(input).toHaveValue('Smells Like Teen Spirit');
  await expect(page.locator('#recall-answer')).toHaveClass(/picked/);
  await expect(step(page)).toHaveText('1s');
  // Now the list is closed, Enter is a deliberate guess.
  const correct = await page.evaluate(() => document.querySelector('#recall-input').value);
  await input.press('Enter');
  await expect.poll(async () => (await step(page).textContent().catch(() => null)) !== '1s' ||
    await page.locator('#recall-play').evaluate(e => e.classList.contains('revealed'))).toBe(true);
  expect(correct).toBe('Smells Like Teen Spirit');
});

test('several suggestions: Enter highlights, arrows move, Enter picks; nothing is guessed', async ({ page }) => {
  await openRecall(page);
  const input = page.locator('#recall-input');
  await input.pressSequentially('love');
  const items = page.locator('#recall-sugg .rc-sug');
  expect(await items.count()).toBeGreaterThan(1);
  await input.press('Enter');
  await expect(items.first()).toHaveClass(/\bon\b/);
  await expect(input).toHaveValue('love');
  await input.press('ArrowDown');
  await expect(items.nth(1)).toHaveClass(/\bon\b/);
  const second = await items.nth(1).getAttribute('data-t');
  await input.press('Enter');
  await expect(input).toHaveValue(second);
  await expect(step(page)).toHaveText('1s');
  // Escape closes a list without closing Recall.
  await input.fill('');
  await input.pressSequentially('love');
  await input.press('Escape');
  await expect(page.locator('#recall-sugg')).toBeHidden();
  await expect(page.locator('#recall-modal')).toHaveClass(/open/);
});

test('a tapped suggestion fills the box rather than firing a guess', async ({ page }) => {
  await openRecall(page);
  const input = page.locator('#recall-input');
  await input.pressSequentially('love');
  await page.locator('#recall-sugg .rc-sug').first().click();
  await expect(page.locator('#recall-answer')).toHaveClass(/picked/);
  await expect(step(page)).toHaveText('1s');
});

test('game cards own their stacking context, so hover cannot re-layer them', async ({ page }) => {
  await start(page);
  await page.evaluate(() => goToView('games'));
  const cards = page.locator('#games-grid .game-card');
  const n = await cards.count();
  for (let i = 0; i < n; i++) {
    expect(await cards.nth(i).evaluate(c => getComputedStyle(c).isolation)).toBe('isolate');
  }
  // Rapid passes across the grid: nothing throws, nothing is left lifted.
  for (let pass = 0; pass < 3; pass++) for (let i = 0; i < n; i++) await cards.nth(i).hover({ force: true });
  await page.mouse.move(2, 2);
  await expect.poll(() => cards.first().evaluate(c => getComputedStyle(c).transform)).toMatch(/none|matrix\(1, 0, 0, 1, 0, 0\)/);
});
