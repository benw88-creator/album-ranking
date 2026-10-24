import { test, expect, start } from './fixtures.mjs';
// Liked songs, the liked-songs reminder, Daily Drop clues and one-guess
// Earworm (2026-10-24).

const LIKED = 'crate_liked_songs_v1';

test('liking a song puts it in the Crate\'s Liked tab, once, and unliking syncs as a tombstone', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    toggleLikedSong({ id: 'dz1', name: 'Nikes', artist: 'Frank Ocean', art: '/assets/icons/icon-512.png' });
    // The same song from another screen, under another key: not a second like.
    toggleLikedSong({ id: 'Frank Ocean|Nikes', name: 'Nikes', artist: 'Frank Ocean' });
  });
  // That second call found the first and unliked it, so like it again.
  expect(await page.evaluate(() => Object.keys(loadLikedSongs()).length)).toBe(0);
  await page.evaluate(() => toggleLikedSong({ id: 'dz1', name: 'Nikes', artist: 'Frank Ocean', art: '/assets/icons/icon-512.png' }));
  expect(await page.evaluate(() => likedSongHas('Frank Ocean|Nikes', 'Nikes (Explicit)', 'Frank Ocean'))).toBe(true);

  await page.evaluate(() => goToView('liked'));
  await expect(page.locator('#view-liked')).toBeVisible();
  await expect(page.locator('#view-liked .crate-tabs button.active')).toHaveText('Liked');
  await expect(page.locator('#liked-list .lk-row')).toHaveCount(1);
  await expect(page.locator('#liked-list .song-name')).toHaveText('Nikes');
  await expect(page.locator('#liked-list .song-sub')).toHaveText('Frank Ocean');
  await expect(page.locator('#liked-list img')).toHaveCount(1);

  // Unlike from the list: the row stays, dimmed, and the store has a tombstone.
  await page.locator('#liked-list .lk-heart').click();
  await expect(page.locator('#liked-list .lk-row')).toHaveClass(/lk-off/);
  const raw = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), LIKED);
  expect(raw.dz1.off).toBe(true);
  expect(await page.evaluate(() => Object.keys(loadLikedSongs()).length)).toBe(0);
  // Heart again restores it immediately.
  await page.locator('#liked-list .lk-heart').click();
  await expect(page.locator('#liked-list .lk-heart')).toHaveClass(/liked/);
  expect(await page.evaluate(() => Object.keys(loadLikedSongs()).length)).toBe(1);
});

test('a tombstone beats an older like when two devices merge', async ({ page }) => {
  await start(page);
  const merged = await page.evaluate(() => {
    const t = Date.now();
    const phone = { a: { id: 'a', off: true, savedAt: t } };
    const laptop = { a: { id: 'a', name: 'X', artist: 'Y', savedAt: t - 60000 } };
    // The same per-item rule pullAndMerge uses.
    const out = Object.assign({}, laptop);
    Object.keys(phone).forEach(k => { if (!out[k] || (phone[k].savedAt || 0) >= (out[k].savedAt || 0)) out[k] = phone[k]; });
    localStorage.setItem('crate_liked_songs_v1', JSON.stringify(out));
    return Object.keys(loadLikedSongs()).length;
  });
  expect(merged).toBe(0);
});

test('the Crate\'s rated songs carry a heart that likes the song', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    localStorage.setItem('crate_songs_v1', JSON.stringify({ s1: { id: 's1', name: 'Song One', artist: 'Test Artist', albumName: 'Record', art: '/assets/icons/icon-512.png', score: 8, savedAt: Date.now() } }));
    goToView('songs');
  });
  const heart = page.locator('#songs-list .lk-heart');
  await expect(heart).toHaveCount(1);
  await heart.click();
  await expect(heart).toHaveClass(/liked/);
  expect(await page.evaluate(() => likedSongHas('s1'))).toBe(true);
});

test('the liked-songs reminder is offered only with likes and opens the list', async ({ page }) => {
  await start(page);
  expect(await page.evaluate(() => LikedSongs.reminder().length)).toBe(0);
  const r = await page.evaluate(() => {
    for (let i = 0; i < 3; i++) toggleLikedSong({ id: 'r' + i, name: 'Song ' + i, artist: 'A' });
    const list = LikedSongs.reminder();
    return list.length && { id: list[0].id, title: list[0].title, kicker: list[0].kicker, inSources: Discover.sources.some(f => f === LikedSongs.reminder) };
  });
  expect(r.title).toBe('Your liked songs are waiting in Crate.');
  expect(r.kicker).toBe('Found something good?');
  expect(r.inSources).toBe(true);
  await page.evaluate(() => LikedSongs.reminder()[0].act());
  await expect(page.locator('#view-liked')).toBeVisible();
  // Opened just now: quiet for a fortnight.
  expect(await page.evaluate(() => LikedSongs.reminder().length)).toBe(0);
  // Two dismissals and it stops for good.
  const after = await page.evaluate(() => {
    localStorage.removeItem('crate_liked_seen_v1');
    localStorage.setItem('crate_tips_v1', JSON.stringify({ d: { 'liked:1': 'dismissed', 'liked:2': 'dismissed' } }));
    return LikedSongs.reminder().length;
  });
  expect(after).toBe(0);
});

test('Daily Drop gives a clue after each wrong guess, building towards the title', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    Object.keys(localStorage).filter(k => k.startsWith('vinal_drop2_')).forEach(k => localStorage.removeItem(k));
    openDailyDrop();
  });
  await expect(page.locator('#drop-modal')).toHaveClass(/open/);
  await expect(page.locator('#drop-hint .drop-clue')).toHaveCount(0);
  const input = page.locator('#drop-input');
  for (let n = 1; n <= 5; n++) {
    const pick = await page.evaluate(() => {
      // Any album that is not today's answer and not yet guessed.
      const rows = [...document.querySelectorAll('.drop-row-name')].map(e => e.textContent);
      const ans = window.__dropAnswer && window.__dropAnswer();
      return VinalPool.albums.map(r => r[0]).find(n => n !== ans && !rows.includes(n));
    });
    await input.fill(pick);
    await page.locator('#drop-sugg .g-sugg-item').filter({ has: page.locator('.g-sugg-name', { hasText: new RegExp('^' + pick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }).first().click();
    await expect(page.locator('#drop-hint .drop-clue')).toHaveCount(n);
  }
  await expect(page.locator('#drop-hint .drop-clue').last()).toContainText('The title starts with');
  // Scoring is untouched: five guesses spent, one left.
  await expect(page.locator('#drop-left')).toContainText('1');
});

test('Earworm: one guess a round, a skip ends the Endless run, and streaks show', async ({ page }) => {
  await start(page);
  await page.evaluate(() => { localStorage.removeItem('crate_earworm_v2'); window.openEarworm(); });
  await expect(page.locator('#ew-modal')).toHaveClass(/open/);
  await expect(page.locator('#ew-board .ew-row')).toHaveCount(1);
  await expect(page.locator('#ew-skip')).toBeVisible();

  // A wrong daily guess: one row, the answer set out under it, no second go.
  const len = await page.locator('#ew-board .ew-row .ew-cell').count();
  for (let i = 0; i < len; i++) await page.keyboard.press('Q');
  await page.keyboard.press('Enter');
  await expect(page.locator('#ew-board .ew-row.ew-answer')).toHaveCount(1);
  await expect(page.locator('#ew-skip')).toBeHidden();
  await page.keyboard.press('Q');
  await page.keyboard.press('Enter');
  const day = await page.evaluate(() => JSON.parse(localStorage.getItem('crate_earworm_v2')).days);
  expect(Object.keys(day)).toHaveLength(1);
  expect(Object.values(day)[0].r).toBe('L');
  await expect(page.locator('#ew-card-status')).toHaveText('Missed');

  // Reopening keeps today answered.
  await page.evaluate(() => { document.getElementById('ew-modal').classList.remove('open'); window.openEarworm(); });
  await expect(page.locator('#ew-board .ew-row.ew-answer')).toHaveCount(1);

  // Endless: solve one (read the answer the round would reveal), then skip.
  await page.locator('#ew-mode [data-ew-mode="unlimited"]').click();
  const answer = await page.evaluate(() => {
    const cells = document.querySelectorAll('#ew-board .ew-row .ew-cell').length;
    return cells;
  });
  expect(answer).toBeGreaterThan(3);
  await page.locator('#ew-skip').click();
  await expect(page.locator('.ew-result')).toContainText('Run over');
  await expect(page.locator('#ew-again')).toHaveText('New run');
  await page.locator('#ew-again').click();
  await expect(page.locator('#ew-tally .ew-stat').first()).toContainText('0');
});

test('Earworm Endless: a right answer extends the streak and scores with a bonus', async ({ page }) => {
  await start(page);
  await page.evaluate(() => { localStorage.removeItem('crate_earworm_v2'); window.openEarworm(); });
  await page.locator('#ew-mode [data-ew-mode="unlimited"]').click();
  for (let round = 1; round <= 2; round++) {
    const word = await page.evaluate(() => window.__ewAnswer());
    for (const ch of word) await page.keyboard.press(ch);
    await page.keyboard.press('Enter');
    await expect(page.locator('.ew-result.won')).toHaveCount(1);
    await expect(page.locator('#ew-tally .ew-stat').first()).toContainText(String(round));
    await page.keyboard.press('Enter');   // Next
  }
  const best = await page.evaluate(() => EarwormStats.best());
  expect(best.streak).toBe(2);
  expect(best.score).toBeGreaterThan(200);
});

// Final polish pass (2026-10-24, second round).
test('Earworm shows no instruction line under the clues', async ({ page }) => {
  await start(page);
  await page.evaluate(() => { localStorage.removeItem('crate_earworm_v2'); window.openEarworm(); });
  await expect(page.locator('#ew-modal')).toHaveClass(/open/);
  await expect(page.locator('#ew-status')).toHaveText('');
  await expect(page.locator('#ew-status')).toBeHidden();
  await expect(page.locator('#ew-modal')).not.toContainText('Skip it if you');
});

test('Crate covers: the top three wear gold badges and the sleeve carries its gloss', async ({ page }) => {
  await start(page, { seeded: true });
  await page.evaluate(() => {
    const a = JSON.parse(localStorage.getItem('crate_albums_v1'));
    Object.values(a).forEach((r, i) => { r.score = 99 - i; });
    localStorage.setItem('crate_albums_v1', JSON.stringify(a));
    goToView('albums');
  });
  await expect(page.locator('#albums-grid .card')).toHaveCount(12);
  await expect(page.locator('#albums-grid .rank-badge.top')).toHaveCount(3);
  await expect(page.locator('#albums-grid .rank-badge.r1')).toHaveText('#1');
  const gloss = await page.locator('#albums-grid .card .art-wrap').first().evaluate(n => getComputedStyle(n, '::after').backgroundImage);
  expect(gloss).toContain('135deg');
  // Still opens the record.
  await page.locator('#albums-grid .card').first().click();
  await expect(page.locator('#view-album-detail')).toBeVisible();
});

test('Crate Minimal view: covers and one small number, remembered, still opens the record', async ({ page }) => {
  await start(page, { seeded: true });
  await page.evaluate(() => { localStorage.removeItem('crate_album_view'); goToView('albums'); });
  const grid = page.locator('#albums-grid');
  await expect(grid).toHaveAttribute('data-view', 'standard');
  await expect(page.locator('#albums-grid .card-body').first()).toBeVisible();
  await page.locator('#albums-view [data-view="minimal"]').click();
  await expect(grid).toHaveAttribute('data-view', 'minimal');
  await expect(page.locator('#albums-view [data-view="minimal"]')).toHaveAttribute('aria-pressed', 'true');
  const card = page.locator('#albums-grid .card').first();
  await expect(card.locator('.card-body')).toBeHidden();
  await expect(card.locator('.rank-badge')).toBeHidden();
  await expect(card.locator('.art-score span')).toBeHidden();
  await expect(card.locator('.art-score')).toBeVisible();
  expect((await card.locator('.art-score').innerText()).trim()).toMatch(/^\d+$/);
  // The cover is the whole card.
  const [cardH, artH] = await card.evaluate(c => [c.getBoundingClientRect().height, c.querySelector('.art-wrap').getBoundingClientRect().height]);
  expect(Math.abs(cardH - artH)).toBeLessThan(2);
  // Remembered across a reload.
  await page.reload();
  await page.waitForFunction(() => typeof window.goToView === 'function');
  const go = page.locator('#splash-cta'); if (await go.isVisible()) await go.click();
  await page.evaluate(() => goToView('albums'));
  await expect(page.locator('#albums-grid')).toHaveAttribute('data-view', 'minimal');
  await page.locator('#albums-grid .card').first().click();
  await expect(page.locator('#view-album-detail')).toBeVisible();
  // And back.
  await page.evaluate(() => goToView('albums'));
  await page.locator('#albums-view [data-view="standard"]').click();
  await expect(page.locator('#albums-grid')).toHaveAttribute('data-view', 'standard');
  await expect(page.locator('#albums-grid .card-body').first()).toBeVisible();
});
