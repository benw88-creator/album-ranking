import { test, expect, start } from './fixtures.mjs';

// A local audio transport, so the tutorial round resolves offline, and spies in
// place of the two tutorial RPCs (the fixture signs nobody in).
async function boot(page) {
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    if (!window.VinalAudio) return;
    VinalAudio.register('spec', {
      label: 'Spec transport', link: () => null,
      resolve: t => Promise.resolve({ url: 'test:' + (t.dzId || t.title), ms: 30000 }),
      play: function () { this.t = performance.now(); return Promise.resolve(true); },
      stop: function () { this.t = null; },
      position: function () { return this.t == null ? 0 : (performance.now() - this.t) / 1000; }
    });
    VinalAudio.use('spec');
  }));
  await start(page);
  await page.evaluate(() => {
    window.__tut = [];
    Cloud.recallTutorialStart = () => { __tut.push({ k: 'start' }); return Promise.resolve({ started_at: new Date().toISOString() }); };
    Cloud.recallTutorialSubmit = o => { __tut.push(Object.assign({ k: 'submit' }, o)); return Promise.resolve({ score: o.guess ? 940 : 0, correct: !!o.guess, rank: 3, total: 12 }); };
  });
}

test('the tutorial round is Memories, named from the list, and hands back to the tutorial by itself', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => [Recall.TUTORIAL.title, Recall.TUTORIAL.artist, Recall.TUTORIAL.dzId])).toEqual(['Memories', 'David Guetta', '5594020']);
  await page.evaluate(() => openRecall('tutorial'));
  const input = page.locator('#recall-input');
  await expect(input).toBeEnabled();
  await page.locator('#recall-hear').click();
  await input.pressSequentially('memori');
  // The tutorial song is offered even though it is not in the shared pool.
  await expect(page.locator('#recall-sugg .rc-sug[data-t="Memories"]')).toHaveCount(1);
  await input.press('Enter');
  await expect(input).toHaveValue('Memories');
  await input.press('Enter');
  await expect(page.locator('#recall-reveal .rc-rev-head')).toContainText('Correct');
  await expect(page.locator('#recall-rev-actions button')).toHaveText(['Continue']);
  // No Go again, no summary: the sheet closes on its own and nothing is left to resume.
  await expect(page.locator('#recall-modal')).not.toHaveClass(/\bopen\b/, { timeout: 5000 });
  await expect(page.locator('#recall-over')).toBeHidden();
  const tut = await page.evaluate(() => __tut);
  expect(tut.map(x => x.k)).toEqual(['start', 'submit']);
  expect(tut[1].guess).toBe('Memories');
  expect(await page.evaluate(() => window.RecallLast && [RecallLast.mode, RecallLast.songs, RecallLast.score > 0])).toEqual(['tutorial', 1, true]);
  expect(await page.evaluate(() => localStorage.getItem('crate_recall_live'))).toBeNull();
  const board = await page.evaluate(() => RecallLast.board);
  expect(board.rank).toBe(3);
});

test('closing the tutorial after the first clip files a miss, and reopening never resumes it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => openRecall('tutorial'));
  await expect(page.locator('#recall-input')).toBeEnabled();
  await page.locator('#recall-hear').click();
  await page.locator('#recall-close').click();
  await expect(page.locator('#recall-modal')).not.toHaveClass(/\bopen\b/);
  const tut = await page.evaluate(() => __tut);
  expect(tut.map(x => x.k)).toEqual(['start', 'submit']);
  expect(tut[1].guess).toBe('');
  expect(await page.evaluate(() => RecallLast && RecallLast.songs)).toBe(0);
  await page.evaluate(() => openRecall());
  await expect(page.locator('#recall-lobby')).toBeVisible();
});

test('closing the tutorial before anything played records nothing', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => openRecall('tutorial'));
  await expect(page.locator('#recall-input')).toBeEnabled();
  await page.locator('#recall-close').click();
  expect(await page.evaluate(() => __tut.length)).toBe(0);
});

async function toFirstRecord(page) {
  await page.evaluate(() => {
    Cloud.saveProfile = async f => ({ data: f });
    localStorage.removeItem('crate_onboard_v1');
    Onboard.restart();
  });
  await page.locator('#onb-go').click();           // drop the needle
  await page.locator('#onb-go').click();           // let's go
  await page.locator('#onb-u').fill('tester_1');
  await page.locator('#onb-go').click();
  await page.locator('#onb-foot #onb-go').click({ timeout: 4000 });
  await expect(page.locator('.onb-alb h3')).toBeVisible();
}

test('one album, a swap when you do not know it, and an optional search that rates anything', async ({ page }) => {
  await boot(page);
  const searched = [];
  page.on('request', r => { const u = new URL(r.url()); if (u.pathname === '/api/catalogue' && u.searchParams.get('q')) searched.push(u.searchParams.get('q')); });
  await toFirstRecord(page);
  // The catalogue is mocked, so the card's name is whatever resolve() picked;
  // what matters is which record it went looking for.
  await expect.poll(() => searched.some(q => /thriller/i.test(q))).toBe(true);
  await page.locator('#onb-alt').click();          // Don't know it
  await expect.poll(() => searched.some(q => /graduation/i.test(q))).toBe(true);
  await expect(page.locator('.onb-alb h3')).toBeVisible();

  await page.locator('.onb-find-link').click();
  await expect(page.locator('.onb-find')).toBeVisible();
  await page.locator('#onb-q').fill('record');
  await expect(page.locator('.onb-hit').first()).toBeVisible();
  await page.locator('.onb-hit').first().click();
  await page.locator('#onb-go').click();           // Save it
  await expect(page.locator('#onb-go')).toHaveText(/Done · 1 rated/, { timeout: 6000 });
  const rated = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('crate_albums_v1') || '{}')).length);
  expect(rated).toBe(1);
  // Done counts the searched album as the album beat and moves on.
  await page.locator('#onb-go').click();
  await expect(page.locator('#onb-spin')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('crate_onboard_v1')).step)).toBe(3);
});

test('the Recall leaderboard has a Tutorial board read from its own table', async ({ page }) => {
  await boot(page);
  const asked = [];
  page.on('request', r => { if (r.url().includes('/rpc/')) asked.push(r.url().split('/rpc/')[1]); });
  await page.evaluate(() => Boards.open({ game: 'recall', mode: 'tutorial' }));
  await expect(page.locator('#gb-modes button[data-m="tutorial"]')).toHaveClass(/\bon\b/);
  await expect(page.locator('.gb-empty')).toContainText('first Recall');
  expect(asked).toContain('recall_tutorial_board');
  expect(asked).not.toContain('game_board');
});

test('sign-in draws only the providers Supabase has switched on', async ({ page }) => {
  await page.route('**/auth/v1/settings', r => r.fulfill({ json: { external: { email: true, apple: true, google: false } } }));
  await start(page);
  await page.evaluate(() => document.getElementById('auth-modal').classList.add('open'));
  await expect(page.locator('#auth-apple')).toBeVisible();
  await expect(page.locator('#auth-google')).toBeHidden();
  await expect(page.locator('#auth-social-divider')).toBeVisible();
});

test('with every provider off, no social button is drawn at all', async ({ page }) => {
  await page.route('**/auth/v1/settings', r => r.fulfill({ json: { external: { email: true, apple: false, google: false } } }));
  await start(page);
  await page.evaluate(() => document.getElementById('auth-modal').classList.add('open'));
  await expect(page.locator('#auth-social')).toBeHidden();
});

test('a cancelled Apple/Google return opens the login, not the password-reset screen', async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem('vinall_oauth_pending', 'apple'); } catch (e) {} });
  await page.goto('/#error=access_denied&error_description=user+cancelled');
  await expect(page.locator('#auth-modal')).toHaveClass(/\bopen\b/, { timeout: 8000 });
  await expect(page.locator('#auth-view-main')).toBeVisible();
  await expect(page.locator('#auth-error')).toHaveText('Sign-in was cancelled.');
});
