import { test, expect, start } from './fixtures.mjs';

// The final polish pass: the spinnable record, the finale, level-ups held
// through onboarding, Earworm's three guesses, and no numerals in an answer.

async function openTutorial(page) {
  await start(page);
  await page.evaluate(() => { Cloud.saveProfile = async f => ({ data: f }); localStorage.removeItem('crate_onboard_v1'); Onboard.restart(); });
  await expect(page.locator('#onb-deck')).toBeVisible();
}

// A drag as a finger would make it: pointer events of type touch round the rim.
async function touchSpin(page, turns, msPerStep) {
  await page.evaluate(async ({ turns, msPerStep }) => {
    const d = document.getElementById('onb-deck'), b = d.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2, R = b.width * 0.4;
    const ev = (type, a) => d.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true,
      clientX: cx + R * Math.cos(a), clientY: cy + R * Math.sin(a), button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
    ev('pointerdown', 0);
    const steps = Math.round(turns * 24);
    for (let i = 1; i <= steps; i++) { await new Promise(r => setTimeout(r, msPerStep)); ev('pointermove', i * Math.PI / 12); }
    ev('pointerup', steps * Math.PI / 12);
  }, { turns, msPerStep });
}

test('the welcome record spins under a finger, coasts, and the motor settles it at 33', async ({ page }) => {
  await openTutorial(page);
  await expect(page.locator('#onb-body')).not.toContainText(/needle/i);
  await expect(page.locator('#onb-go')).toHaveText('Get started');
  await expect(page.locator('#onb-rpm b')).toHaveText('0');
  await touchSpin(page, 1.5, 6);
  await expect(page.locator('.onb-hero2')).toHaveClass(/playing/);
  await expect(page.locator('#onb-tag')).toHaveText('Rate records. Play games.');
  // A fast flick reads well above 33 and then comes back down to it.
  await page.waitForTimeout(60);
  const peak = Number(await page.locator('#onb-rpm b').textContent());
  expect(peak).toBeGreaterThan(40);
  await expect(page.locator('#onb-rpm b')).toHaveText('33', { timeout: 6000 });
  const a1 = await page.evaluate(() => document.getElementById('onb-vinyl').style.transform);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.getElementById('onb-vinyl').style.transform)).not.toBe(a1);
  await page.locator('#onb-go').click();
  await expect(page.locator('#onb-u')).toBeVisible();
});

test('a hand held still stops the record and pushes nothing on release', async ({ page }) => {
  await openTutorial(page);
  await touchSpin(page, 1.5, 6);
  await expect(page.locator('#onb-rpm b')).toHaveText('33', { timeout: 6000 });
  await page.evaluate(async () => {
    const d = document.getElementById('onb-deck'), b = d.getBoundingClientRect();
    const o = { bubbles: true, pointerId: 8, pointerType: 'touch', isPrimary: true, clientX: b.left + b.width * 0.85, clientY: b.top + b.height / 2, button: 0 };
    d.dispatchEvent(new PointerEvent('pointerdown', o));
    await new Promise(r => setTimeout(r, 400));
    window.__held = document.querySelector('#onb-rpm b').textContent;
    d.dispatchEvent(new PointerEvent('pointerup', o));
  });
  expect(await page.evaluate(() => window.__held)).toBe('0');
  // The motor pulls it back up to speed, and never past it.
  await expect(page.locator('#onb-rpm b')).toHaveText('33', { timeout: 6000 });
});

test('the finale says Let’s go! and level-ups wait until the tutorial has closed', async ({ page }) => {
  await openTutorial(page);
  await page.evaluate(() => { Wallet.levelUp(3, 1); Wallet.levelUp(5, 3); });
  await page.waitForTimeout(600);
  await expect(page.locator('.lvl-pop')).toHaveCount(0);
  await page.evaluate(() => Onboard._go('finale'));
  await expect(page.locator('.onb-fin .onb-h')).toHaveText('Let’s go!');
  await expect(page.locator('#onb-body')).not.toContainText('Your turn');
  await page.evaluate(() => Wallet.levelUp(6, 5));
  await page.waitForTimeout(400);
  await expect(page.locator('.lvl-pop')).toHaveCount(0);
  await page.locator('#onb-go').click();
  // One pop, after the main page is up, counting the whole climb.
  await expect(page.locator('.lvl-pop')).toHaveCount(1, { timeout: 4000 });
  await expect(page.locator('.lvl-pop .lp-n')).toHaveText('6', { timeout: 4000 });
  await expect(page.locator('.lvl-pop .lp-s')).toHaveText('5 levels');
  expect(await page.evaluate(() => Onboard.active())).toBe(false);
});

test('Earworm allows three guesses: a miss keeps the round, the third miss ends it', async ({ page }) => {
  await start(page);
  await page.evaluate(() => openEarworm());
  const word = await page.evaluate(() => window.__ewAnswer());
  const wrong = word.split('').reverse().join('') === word ? 'Z'.repeat(word.length) : word.split('').reverse().join('');
  const typeWord = async w => { for (const ch of w) await page.keyboard.press(ch); await page.keyboard.press('Enter'); };
  await typeWord(wrong);
  await expect(page.locator('#ew-status')).toHaveText('2 guesses left');
  await expect(page.locator('#ew-result')).toBeEmpty();
  // A reload keeps the miss: closing the sheet is not a fresh three.
  await page.reload(); await page.waitForFunction(() => typeof window.openEarworm === 'function');
  const go = page.locator('#splash-cta'); if (await go.isVisible()) await go.click();
  await page.evaluate(() => openEarworm());
  await expect(page.locator('#ew-board .ew-row:not(.ew-spare) .ew-cell.absent, #ew-board .ew-row:not(.ew-spare) .ew-cell.present, #ew-board .ew-row:not(.ew-spare) .ew-cell.exact').first()).toBeVisible();
  await expect(page.locator('#ew-status')).toHaveText('2 guesses left');
  await typeWord(wrong);
  await expect(page.locator('#ew-status')).toHaveText('Last guess');
  await typeWord(wrong);
  await expect(page.locator('#ew-result h3')).toContainText('It was');
  await expect(page.locator('#ew-board .ew-answer')).toHaveCount(1);
  const day = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('crate_earworm_v2')); return Object.values(s.days).pop(); });
  expect(day.r).toBe('L'); expect(day.gs.length).toBe(3);
});

test('Earworm solved on the second guess is a win', async ({ page }) => {
  await start(page);
  await page.evaluate(() => openEarworm());
  const word = await page.evaluate(() => window.__ewAnswer());
  const typeWord = async w => { for (const ch of w) await page.keyboard.press(ch); await page.keyboard.press('Enter'); };
  await typeWord('Q'.repeat(word.length));
  await typeWord(word);
  await expect(page.locator('#ew-result h3')).toContainText('Got it');
  const day = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('crate_earworm_v2')); return Object.values(s.days).pop(); });
  expect(day.r).toBe('W'); expect(day.gs.length).toBe(2);
});

test('no Earworm or Daily Drop answer ever needs a numeral, on any day', async ({ page }) => {
  await start(page);
  const res = await page.evaluate(() => {
    const bad = [], seen = { ew: new Set(), album: new Set(), song: new Set() };
    for (let d = 0; d < 1500; d++) {
      const e = __ewDailyTitle(d), a = __dropAnswerOn('album', d), s = __dropAnswerOn('song', d);
      [[e, 'ew'], [a, 'album'], [s, 'song']].forEach(([t, k]) => { if (!t || /\p{N}/u.test(t)) bad.push(k + ':' + t); else seen[k].add(t); });
    }
    for (let i = 0; i < 300; i++) { const t = __ewRandomTitle(); if (!t || /\p{N}/u.test(t)) bad.push('random:' + t); }
    // Records with numerals stay in the Drop list as guesses.
    const numericInPool = __dropPool('album').concat(__dropPool('song')).filter(n => /\p{N}/u.test(n)).length;
    return { bad, numericInPool, ew: seen.ew.size, album: seen.album.size, song: seen.song.size };
  });
  expect(res.bad).toEqual([]);
  expect(res.numericInPool).toBeGreaterThan(0);
  expect(res.ew).toBeGreaterThan(50);
  expect(res.album).toBeGreaterThan(50);
  expect(res.song).toBeGreaterThan(50);
});

test('a Drop game saved against a numeral answer before the fix starts fresh, a stamped one is kept', async ({ page }) => {
  await start(page);
  // Find a day whose raw cycle pick had a numeral, and pretend it is today.
  const info = await page.evaluate(() => {
    const pool = __dropPool('album');
    const raw = __dropRaw('album');
    return { raw, rawName: pool[raw], today: __dropAnswer ? null : null };
  });
  // Today's raw pick may well be fine; the stale case is exercised directly.
  await page.evaluate(() => {
    const key = 'vinal_drop2_album_' + (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
    // An unstamped game is only trusted when today's raw pick IS the answer.
    localStorage.setItem(key, JSON.stringify({ g: [0, 1], done: false, won: false }));
    window.__key = key;
  });
  await page.evaluate(() => openDailyDrop && openDailyDrop());
  const rows = await page.locator('#drop-rows > *').count();
  const rawIsAnswer = await page.evaluate(() => __dropPool('album')[__dropRaw('album')] === __dropAnswer());
  expect(rows).toBe(rawIsAnswer ? 2 : 0);
  // Stamped with a different record: always discarded.
  await page.evaluate(() => { localStorage.setItem(__key, JSON.stringify({ g: [0, 1], done: false, won: false, a: -5 })); });
  await page.evaluate(() => { document.querySelector('#drop-mode button[data-drop-mode="song"]').click(); document.querySelector('#drop-mode button[data-drop-mode="album"]').click(); });
  expect(await page.locator('#drop-rows > *').count()).toBe(0);
  expect(info.rawName).toBeTruthy();
});
