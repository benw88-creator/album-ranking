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

test('scoring: hearing less and naming faster both pay more, with no time limit', async ({ page }) => {
  await start(page);
  const p = await page.evaluate(() => [Recall.points(0, 0), Recall.points(0, 1200), Recall.points(3, 60000),
    Recall.points(1, 2000), Recall.points(1, 20000), Recall.points(0, 12000), Recall.points(3, 12000)]);
  expect(p[0]).toBe(1000); expect(p[1]).toBe(980); expect(p[2]).toBe(125);
  expect(p[3]).toBeGreaterThan(p[4]); expect(p[5]).toBeGreaterThan(p[6]);
});

test('the clock never fails a round; wrong at the full ten seconds ends an Endless run', async ({ page }) => {
  test.setTimeout(45000);
  await openRecall(page);
  await page.locator('#recall-hear').click();
  await expect(page.locator('#recall-timer')).toHaveClass(/\brun\b/);
  await page.waitForTimeout(1500);
  await expect(page.locator('#recall-play')).not.toHaveClass(/revealed/);
  expect(Number((await page.locator('#recall-timer span').textContent()).replace(/,/g, ''))).toBeLessThan(1000);
  for (let i = 0; i < 4; i++) await page.locator('#recall-skip').click();
  await expect(page.locator('#recall-play')).toHaveClass(/revealed/);
  await expect(page.locator('#recall-reveal .rc-rev-head')).toContainText(/run over/i);
  // No way on to another song after a miss.
  await expect(page.locator('#recall-next')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('crate_recall_live'))).toBeNull();
  await page.locator('#recall-stop').click();
  await expect(page.locator('#recall-over')).toBeVisible();
  await page.locator('#recall-again').click();
  await expect(page.locator('#recall-timer span')).toHaveText('1,000');
});

test('closing pauses the round; reopening resumes it with the clock where it was', async ({ page }) => {
  test.setTimeout(45000);
  await openRecall(page);
  await page.locator('#recall-hear').click();
  await page.waitForTimeout(2000);
  // The backdrop no longer closes a game sheet.
  await page.mouse.click(4, 4);
  await expect(page.locator('#recall-modal')).toHaveClass(/open/);
  await page.locator('#recall-close').click();
  const live = await page.evaluate(() => JSON.parse(localStorage.getItem('crate_recall_live')));
  expect(live.mode).toBe('endless');
  expect(live.clockMs).toBeGreaterThan(1500);
  expect(live.clockMs).toBeLessThan(4000);
  await page.waitForTimeout(2500);   // closed time does not count
  await page.evaluate(() => openRecall());
  await expect(page.locator('#recall-play')).toBeVisible();
  await expect(page.locator('#recall-verdict')).toContainText(/paused/i);
  const shown = Number((await page.locator('#recall-timer span').textContent()).replace(/,/g, ''));
  expect(shown).toBe(await page.evaluate(ms => Recall.points(0, ms), live.clockMs));
  const again = await page.evaluate(() => JSON.parse(localStorage.getItem('crate_recall_live')));
  expect(again.song).toBe(live.song);
  // Playing again carries the clock on from where it stopped.
  await page.locator('#recall-hear').click();
  await expect(page.locator('#recall-timer')).toHaveClass(/\brun\b/);
});

test('album answers: the record names its pressings, never a different record', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => [
    ['For All the Dogs', 'For All the Dogs Scary Hours Edition'],
    ['Fearless', "Fearless (Taylor's Version)"],
    ['Nevermind', 'Nevermind Remastered'],
    ['Thriller', 'Thriller 25th Anniversary Edition'],
    ['Sweet Boy', 'Sweet Boy Pt. 1'],
    ['Abbey Road', 'Abbey Road (Remastered 2009)'],
    ['Views', 'Views 2'],
    ['Sweet Boy Pt 2', 'Sweet Boy Pt. 1'],
    ['Scary Hours', 'For All the Dogs Scary Hours Edition'],
    ['Lover', 'Folklore']
  ].map(([g, a]) => VinalTitles.albumMatch(g, a)));
  expect(r).toEqual([true, true, true, true, true, true, false, false, false, false]);
});
