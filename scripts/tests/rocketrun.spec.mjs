// RocketRun in the Arcade, against a mocked /api/rocketrun and MusicBrainz.
// The real route and database are covered by scripts/rocketrun.route-test.mjs.
import { test, expect, start } from './fixtures.mjs';

const RG = (id, title, year, artist, extra = {}) => ({ id, title, 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': String(year), count: 3, score: 100, 'artist-credit': [{ name: artist, artist: { id: 'a-' + id, name: artist } }], ...extra });
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const QUESTIONS = [
  { tpl: 'year', tier: 1, kind: 'album', text: 'Name an album first released in 1997.', hint: 'Studio, live and soundtrack albums count.', conds: [['year', 1997]] },
  { tpl: 'aletter', tier: 1, kind: 'artist', text: 'Name an artist whose name starts with M.', hint: 'Bands count.', conds: [['starts', 'M']] },
  { tpl: 'tletter', tier: 2, kind: 'album', text: 'Name an album whose title starts with B.', hint: '', conds: [['starts', 'B']] },
  { tpl: 'colour', tier: 2, kind: 'album', text: 'Name an album with a colour in its title.', hint: '', conds: [['colour']] },
  { tpl: 'live', tier: 3, kind: 'album', text: 'Name a live album from the 1970s.', hint: '', conds: [['live'], ['between', 1970, 1979]] }
];
const RESULTS = {
  1997: [RG(ID(1), 'OK Computer', 1997, 'Radiohead'), RG(ID(2), 'Homogenic', 1997, 'Björk'), RG(ID(9), 'Greatest Hits', 1997, 'X', { 'secondary-types': ['Compilation'] })],
  blonde: [RG(ID(3), 'Blonde', 2016, 'Frank Ocean'), RG(ID(4), 'Blue', 1971, 'Joni Mitchell')],
  kind: [RG(ID(5), 'Kind of Blue', 1959, 'Miles Davis')],
  live: [RG(ID(6), 'At Fillmore East', 1971, 'The Allman Brothers Band', { 'secondary-types': ['Live'] })]
};

async function mock(page, { signedIn = true, finished = false } = {}) {
  const calls = [];
  let answered = [];
  await page.route('**/musicbrainz.org/ws/2/**', (route) => {
    const u = new URL(route.request().url()), q = (u.searchParams.get('query') || '').toLowerCase();
    if (u.pathname.includes('/artist')) return route.fulfill({ json: { count: 1, artists: [{ id: ID(7), name: 'Mitski', type: 'Person', country: 'US', score: 100 }] } });
    const key = Object.keys(RESULTS).find((k) => q.includes(k));
    return route.fulfill({ json: { count: 3, 'release-groups': key ? RESULTS[key] : [] } });
  });
  await page.route('**/api/rocketrun**', async (route) => {
    const r = route.request(), u = new URL(r.url()), body = r.postDataJSON ? r.postDataJSON() : null;
    const op = u.searchParams.get('op') || (body && body.op);
    calls.push({ op, body, auth: r.headers().authorization || '' });
    if (op === 'day') return route.fulfill({ json: { day: 2508, questions: QUESTIONS } });
    if (op === 'state') return route.fulfill({ json: { day: 2508, questions: QUESTIONS, started: false, finished, total: finished ? 9000 : 0, streak: finished ? 3 : 0, best: 0, awarded: 0, answers: finished ? QUESTIONS.map((q, i) => ({ q: i, key: 'rg:' + ID(i + 1), label: 'Answer ' + (i + 1), sub: 'Artist', grade: 1, gain: 1200, pct: 6, sample: 2 })) : [] } });
    if (op === 'answer') {
      if (body.id === ID(2) && body.q === 0) return route.fulfill({ json: { ok: false, reason: 'nofit', message: 'Homogenic is not allowed in this test. Try another.' } });
      answered.push(body.id);
      const n = answered.length, fin = n === 5;
      return route.fulfill({ json: { ok: true, q: body.q, grade: n % 5, gain: [500, 1200, 2500, 5000, 9000][n % 5], pct: 3.2, sample: 0, total: 1000 * n, finished: fin, award: fin ? 1600 : 0, streak: fin ? 1 : null, label: 'Answer ' + n, sub: 'Someone · 1997' } });
    }
    if (op === 'pass') { answered.push(null); return route.fulfill({ json: { ok: true, q: body.q, grade: -1, gain: 0, total: 1000 * (answered.length - 1), finished: answered.length === 5 } }); }
    if (op === 'missing') return route.fulfill({ json: { ok: true } });
    return route.fulfill({ status: 400, json: {} });
  });
  await start(page);
  if (signedIn) await page.evaluate(() => {
    const fake = { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }), onAuthStateChange() {} } };
    Cloud.client = () => fake;
  });
  return calls;
}
const game = (page) => page.frameLocator('#rocketrun-sheet iframe');
async function openGame(page) {
  await page.evaluate(() => goToView('games'));
  await expect(page.locator('#rocketrun-card')).toBeVisible();
  await page.locator('#rocketrun-card').click();
  await expect(page.locator('#rocketrun-sheet.open iframe')).toBeVisible();
}
async function pick(page, text, choose) {
  const g = game(page);
  await g.locator('#answer').fill(text);
  await g.locator('.suggestion', { hasText: choose }).first().click();
}
async function waitPlay(page, n) {
  await expect(game(page).locator('.card-tab')).toHaveText(`Q0${n} / 05`, { timeout: 20000 });
}

test('RocketRun leads the Arcade and opens full screen', async ({ page }) => {
  await mock(page);
  await page.evaluate(() => goToView('games'));
  const first = page.locator('#games-grid .game-card').first();
  await expect(first).toHaveId('rocketrun-card');
  await expect(first).toContainText('RocketRun');
  await openGame(page);
  await expect(game(page).locator('#start')).toBeVisible();
  await expect(game(page).locator('.game-footer a')).toHaveText(/MUSICBRAINZ/);
  // Leaving closes the sheet and throws the frame away.
  await game(page).locator('#exit').click();
  await expect(page.locator('#rocketrun-sheet')).not.toHaveClass(/open/);
  await expect(page.locator('#rocketrun-sheet iframe')).toHaveCount(0);
});

test('signed out: asks to log in, and plays nothing', async ({ page }) => {
  const calls = await mock(page, { signedIn: false });
  await openGame(page);
  await expect(game(page).locator('#signin')).toHaveText(/LOG IN TO FLY/);
  expect(calls.some((c) => c.op === 'state')).toBe(false);
});

test('a full run: search, rule pre-check, server refusal, pass, results', async ({ page }) => {
  test.setTimeout(150000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const calls = await mock(page);
  await openGame(page);
  const g = game(page);
  await g.locator('#start').click();
  await waitPlay(page, 1);
  await expect(g.locator('.question-card h2')).toContainText('1997');

  // Compilations never appear; the list shows artist and year, no artwork.
  await g.locator('#answer').fill('1997');
  await expect(g.locator('.suggestion')).toHaveCount(2);
  await expect(g.locator('.suggestion').first()).toContainText('Radiohead · 1997');
  await expect(g.locator('.suggestions img')).toHaveCount(0);

  // The server's refusal is shown and costs nothing.
  await g.locator('.suggestion', { hasText: 'Homogenic' }).click();
  await g.locator('#launch-answer').click();
  await expect(g.locator('#answer-error')).toContainText('Try another');

  await pick(page, '1997', 'OK Computer');
  await g.locator('#launch-answer').click();
  await expect(g.locator('#rarity-reveal')).toHaveClass(/show/);
  const sent = calls.filter((c) => c.op === 'answer').at(-1);
  expect(sent.body).toMatchObject({ day: 2508, q: 0, id: ID(1) });
  expect(sent.auth).toBe('Bearer test-token');

  await waitPlay(page, 2);
  await pick(page, 'mits', 'Mitski');
  await g.locator('#launch-answer').click();

  // Q3 asks for a B title: Blue starts with B; Blonde too. Pick a non-B to see the instant check.
  await waitPlay(page, 3);
  await pick(page, 'kind', 'Kind of Blue');
  await g.locator('#launch-answer').click();
  await expect(g.locator('#answer-error')).toContainText('Kind of Blue starts with K');
  expect(calls.filter((c) => c.op === 'answer').length).toBe(3);
  await pick(page, 'blonde', 'Blonde');
  await g.locator('#launch-answer').click();

  await waitPlay(page, 4);
  await g.locator('#pass').click();
  await expect(g.locator('#pass')).toContainText('Tap again');
  await g.locator('#pass').click();

  await waitPlay(page, 5);
  // Nothing on MusicBrainz: an honest message and a way to report it.
  await g.locator('#answer').fill('zzqx unknown');
  await expect(g.locator('.no-results')).toContainText('Nothing on MusicBrainz');
  await g.locator('#report-missing').click();
  await expect(g.locator('#notice')).toContainText('missing');
  await pick(page, 'live', 'At Fillmore East');
  await g.locator('#launch-answer').click();

  await expect(g.locator('.results-card')).toBeVisible({ timeout: 25000 });
  await expect(g.locator('.results-card')).toContainText('+1,600 Discs');
  await expect(g.locator('.answer-recap > div')).toHaveCount(5);
  await expect(g.locator('.answer-recap')).toContainText('Passed');
  const note = await page.evaluate(() => JSON.parse(localStorage.getItem('crate_rocketrun_v1')));
  expect(note).toMatchObject({ day: 2508, done: true });
});

test('a finished day shows the flight, not a second run', async ({ page }) => {
  await mock(page, { finished: true });
  await openGame(page);
  const g = game(page);
  await expect(g.locator('.results-card')).toBeVisible();
  await expect(g.locator('#start')).toHaveCount(0);
  await expect(g.locator('.results-card')).toContainText('Streak 3');
});

test('hardware Back closes the game', async ({ page }) => {
  await mock(page);
  await openGame(page);
  await page.goBack();
  await expect(page.locator('#rocketrun-sheet')).not.toHaveClass(/open/);
  await expect(page.locator('#rocketrun-sheet iframe')).toHaveCount(0);
});

for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`fits a ${vp.width}px phone with no sideways scroll`, async ({ page }) => {
    await page.setViewportSize(vp);
    await mock(page);
    await openGame(page);
    const g = game(page);
    await g.locator('#start').click();
    await waitPlay(page, 1);
    const frame = page.frames().find((f) => f.url().includes('/arcade/rocketrun/'));
    const over = await frame.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(over).toBeLessThanOrEqual(0);
    const box = await g.locator('#answer').boundingBox();
    expect(box.y + box.height).toBeLessThan(vp.height * 0.62);   // above where the keyboard rises
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/rocketrun-${vp.width}.png` });
  });
}

test('desktop: the cabinet frames the playfield, and the card art is drawn', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mock(page);
  await page.evaluate(() => goToView('games'));
  const art = await page.locator('#rocketrun-card .rrh-art').boundingBox();
  const card = await page.locator('#rocketrun-card').boundingBox();
  expect(art.width).toBeGreaterThan(card.width * 0.95);
  expect(await page.locator('#rocketrun-card .rrh-rocket').boundingBox()).not.toBeNull();
  if (process.env.SHOTS) await page.locator('#rocketrun-card').screenshot({ path: `${process.env.SHOTS}/rocketrun-card.png` });
  await openGame(page);
  await expect(game(page).locator('.cabinet-left')).toBeVisible();
  await expect(game(page).locator('.cabinet-right .destination')).toHaveCount(8);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/rocketrun-desktop.png` });
});

test('phone: the card art is drawn', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await page.evaluate(() => goToView('games'));
  await expect(page.locator('#rocketrun-card .rrh-rocket')).toBeVisible();
  if (process.env.SHOTS) await page.locator('#rocketrun-card').screenshot({ path: `${process.env.SHOTS}/rocketrun-card-phone.png` });
});
