// Lab polish pass (2026-11-10): nav pill and badges, compact favourite
// artist, restored Arcade, Discover controls clear the sleeve, Community grid
// and sheet, scroll and place memory, Back, Profile sections and More menu.
// Every request is answered locally by the fixtures; nothing reaches Supabase.
// SHOTS=<dir> writes phone screenshots.
import { test, expect, start } from './fixtures.mjs';
import path from 'node:path';

const SHOTS = process.env.SHOTS;
async function shot(page, name, full) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: !!full }); }
test.use({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true });

const ME = '00000000-0000-4000-8000-000000000001';
async function signIn(page, extra = {}) {
  const user = { id: ME, email: 'tester@example.test', aud: 'authenticated', role: 'authenticated', user_metadata: { age_band: 'adult' } };
  await page.route(/supabase\.co\/auth\/v1\/user/, r => r.fulfill({ json: user }));
  await page.route(/supabase\.co\/rest\/v1\/profiles/, r => {
    const row = Object.assign({ id: ME, username: 'tester', bio: '', avatar_url: '', top3: [], discs: 26432, lifetime_xp: 40000, age_band: 'adult', ratings_visibility: 'public' }, extra);
    const single = r.request().headers().accept?.includes('object+json');
    return r.fulfill({ json: single ? row : [row] });
  });
  await page.addInitScript(u => {
    const now = Math.floor(Date.now() / 1000);
    const session = { access_token: 'test.' + btoa(JSON.stringify({ sub: u.id, exp: now + 3600 })) + '.x', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'test', user: u };
    localStorage.setItem('sb-obqwjntjlyuawmybkddm-auth-token', JSON.stringify(session));
    localStorage.setItem('vinall_local_owner', u.id);
    localStorage.setItem('crate_onboard_v1', JSON.stringify({ done: true, at: Date.now(), step: 99 }));
  }, user);
}
async function settle(page) {
  await page.evaluate(() => Cloud.ready);
  const gate = page.locator('#age-gate [data-band="adult"]');
  if (await gate.isVisible().catch(() => false)) await gate.click();
}

test('nav: five tabs, plus and controller icons, pill lands under the active tab', async ({ page }) => {
  await start(page, { seeded: true });
  await expect(page.locator('#modes button[data-mode="rate"] .nav-plus')).toHaveCount(1);
  await expect(page.locator('#modes')).toHaveClass(/nav-ready/);
  for (const m of ['games', 'rate', 'profile', 'home']) {
    await page.locator(`#modes button[data-mode="${m}"]`).click();
    await page.waitForTimeout(800);
    const d = await page.evaluate(mode => {
      const b = document.querySelector(`#modes button[data-mode="${mode}"]`).getBoundingClientRect();
      const p = document.getElementById('nav-indicator').getBoundingClientRect();
      return Math.abs(b.left - p.left) + Math.abs(b.width - p.width);
    }, m);
    expect(d).toBeLessThan(2);
  }
  await page.locator('#modes button[data-mode="rate"]').click();
  await page.waitForTimeout(700);
  await shot(page, 'nav-rate-active');
});

test('badges: Arcade counts unplayed dailies that are unlocked; none at zero', async ({ page }) => {
  await start(page, { seeded: true });   // 12 rated: Earworm (3) and Cover Fire (5) are open
  await page.evaluate(() => NavBadges.refresh());
  await expect(page.locator('#modes [data-mode="games"] .nav-badge')).toHaveText('4');
  await expect(page.locator('#modes [data-mode="home"] .nav-badge')).toBeHidden();
  // Mark today's Earworm and Cover Fire done the way the games store them.
  await page.evaluate(() => {
    window.EarwormDaily.done = () => true;
    window.Blitz.dailyDone = () => ({ score: 1 });
    NavBadges.refresh();
  });
  await expect(page.locator('#modes [data-mode="games"] .nav-badge')).toHaveText('2');
  // A fresh crate: the gated two do not count.
  await page.evaluate(() => { localStorage.setItem('crate_albums_v1', '{}'); window.EarwormDaily.done = () => false; window.Blitz.dailyDone = () => null; NavBadges.refresh(); });
  await expect(page.locator('#modes [data-mode="games"] .nav-badge')).toHaveText('2');
});

test('badges: Profile counts unclaimed milestones and drops on claim; Home counts claimable missions', async ({ page }) => {
  await signIn(page);
  await page.route(/rest\/v1\/rpc\/daily_missions_status/, r => r.fulfill({ json: { missions: [
    { key: 'a', label: 'Rate 3', progress: 3, target: 3, reward: 500, done: true, claimed: false },
    { key: 'b', label: 'Play', progress: 1, target: 1, reward: 500, done: true, claimed: true },
    { key: 'c', label: 'Lore', progress: 0, target: 2, reward: 500, done: false, claimed: false } ] } }));
  await start(page, { seeded: true });
  await settle(page);
  await expect(page.locator('#modes [data-mode="profile"] .nav-badge')).toHaveText('3', { timeout: 8000 });
  await expect(page.locator('#modes [data-mode="home"] .nav-badge')).toHaveText('1', { timeout: 8000 });
  await page.evaluate(() => { const c = Wallet.claimedMilestone; Wallet.claimedMilestone = k => k === 'albums:1' || c(k); window.dispatchEvent(new Event('vinall:wallet')); });
  await expect(page.locator('#modes [data-mode="profile"] .nav-badge')).toHaveText('2');
  await shot(page, 'badges');
});

test('Arcade is the original: marquee, Featured / Party / Daily / Quick play', async ({ page }) => {
  await start(page, { seeded: true });
  await page.locator('#modes button[data-mode="games"]').click();
  await expect(page.locator('#view-games .arc-marquee .arc-title')).toBeVisible();
  const labels = await page.locator('#games-grid .arc-label').allTextContents();
  expect(labels.map(s => s.trim())).toEqual(['Featured', 'Party', 'Daily', 'Quick play']);
  await expect(page.locator('#games-grid .arc-row, #games-grid .arc-tile')).toHaveCount(0);
  for (const id of ['recall-card', 'war-card', 'charades-card', 'drop-card', 'ew-card', 'blitz-card', 'cover-card', 'coverx-card', 'tracklist-card', 'year-card', 'hl-card'])
    await expect(page.locator('#' + id)).toHaveCount(1);
  await shot(page, 'arcade');
});

test('scroll and place memory across tab switches', async ({ page }) => {
  await start(page, { seeded: true });
  await page.locator('#modes button[data-mode="games"]').click();
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(200);
  await page.locator('#modes button[data-mode="profile"]').click();
  await page.locator('#view-profile .seg-main [data-seg-go="collection"]').click();
  await expect(page.locator('#view-collection')).toBeVisible();
  await page.locator('#modes button[data-mode="games"]').click();
  await page.waitForTimeout(400);
  expect(Math.abs(await page.evaluate(() => window.scrollY) - 900)).toBeLessThan(4);
  // Profile remembers its section.
  await page.locator('#modes button[data-mode="profile"]').click();
  await expect(page.locator('#view-collection')).toBeVisible();
  // Tapping the place you are in goes to its root, at the top.
  await page.locator('#modes button[data-mode="profile"]').click();
  await expect(page.locator('#view-profile')).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('Back: album page returns where it was opened; pushed pages return to their parent', async ({ page }) => {
  await start(page, { seeded: true });
  await page.locator('#modes button[data-mode="games"]').click();
  await page.evaluate(() => openAlbum({ id: '100', name: 'Record 100', artist: 'Test Artist', artistId: '42', art: '/assets/icons/icon-512.png' }));
  await expect(page.locator('#view-album-detail')).toBeVisible();
  await page.locator('#detail-back').click();
  await expect(page.locator('#view-games')).toBeVisible();
  // Browser Back walks the same way and never drops to Home.
  await page.locator('#modes button[data-mode="profile"]').click();
  await page.locator('#view-profile .seg-main [data-seg-go="about"]').click();
  await page.locator('#view-about [data-seg-go="passport"]').click();
  await expect(page.locator('#view-passport')).toBeVisible();
  await page.locator('#view-passport .back-btn').click();
  await expect(page.locator('#view-about')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#view-profile')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#view-games')).toBeVisible();
  // A deep link (no history behind it) goes to the parent, not Home.
  await page.evaluate(() => { history.replaceState({ vinall: 1, view: 'achievements', idx: 0 }, ''); goToView('achievements', true); });
  await page.locator('#view-achievements .back-btn').click();
  await expect(page.locator('#view-about')).toBeVisible();
});

test('Profile: Account / Ratings / Records / About You / Shop, and the More menu', async ({ page }) => {
  await signIn(page);
  await start(page, { seeded: true });
  await settle(page);
  await page.locator('#modes button[data-mode="profile"]').click();
  const segs = await page.locator('#view-profile .seg-main button').allTextContents();
  expect(segs).toEqual(['Account', 'Ratings', 'Records', 'About You', 'Shop']);
  // All five fit without scrolling at 375px.
  const fits = await page.evaluate(() => { const s = document.querySelector('#view-profile .seg-main'); return s.scrollWidth <= s.clientWidth + 1; });
  expect(fits).toBe(true);
  await page.locator('#pt-more').click();
  const m = page.locator('#pt-menu');
  await expect(m).toBeVisible();
  const geo = await page.evaluate(() => {
    const b = document.getElementById('pt-more').getBoundingClientRect(), r = document.getElementById('pt-menu').getBoundingClientRect();
    return { below: r.top >= b.bottom, gap: r.top - b.bottom, left: r.left, right: r.right, vw: innerWidth };
  });
  expect(geo.below).toBe(true);
  expect(geo.gap).toBeLessThan(16);
  expect(geo.left).toBeGreaterThanOrEqual(0);
  expect(geo.right).toBeLessThanOrEqual(geo.vw);
  await shot(page, 'profile-menu');
  await page.keyboard.press('Escape');
  await expect(m).toBeHidden();
  await page.locator('#pt-more').click();
  await page.mouse.click(20, 500);
  await expect(m).toBeHidden();
  await page.locator('#pt-more').click();
  await page.locator('#pt-menu [data-more="achievements"]').click();
  await expect(page.locator('#view-achievements')).toBeVisible();
  // Back is the screen it was opened from: the Profile.
  await page.locator('#view-achievements .back-btn').click();
  await expect(page.locator('#view-profile')).toBeVisible();
  await page.locator('#view-profile .seg-main [data-seg-go="rewards"]').click();
  await expect(page.locator('#view-rewards')).toBeVisible();
  await expect(page.locator('#view-rewards .back-bar')).toHaveCount(0);
  await expect(page.locator('#view-rewards [data-seg-go="passport"]')).toHaveCount(1);
});

test('Grooves description', async ({ page }) => {
  await start(page);
  await page.evaluate(() => goToView('people'));
  await expect(page.locator('#view-people .grooves-link small')).toHaveText('Join or create a groove');
});

test('Discover: no control overlaps the sleeve, on a small and a large phone', async ({ page }) => {
  for (const vp of [{ width: 375, height: 667 }, { width: 430, height: 932 }]) {
    await page.setViewportSize(vp);
    await start(page, { seeded: true });
    await page.locator('#modes button[data-mode="foryou"]').click();
    await page.locator('#fy-feed .fy-art').first().waitFor();
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const art = document.querySelector('#fy-feed .fy-card .fy-art').getBoundingClientRect();
      let low = 0;
      document.querySelectorAll('#view-foryou > .seg-main, #view-foryou .fy-tabs > *').forEach(n => { low = Math.max(low, n.getBoundingClientRect().bottom); });
      return { gap: art.top - low };
    });
    expect(r.gap).toBeGreaterThan(4);
    await shot(page, 'discover-' + vp.width);
  }
});

const POSTS = Array.from({ length: 9 }, (_, i) => ({ id: 'p' + i, user_id: 'u' + i, username: 'user' + i, avatar_url: '', album_id: String(100 + i), album_name: 'Record ' + (100 + i), album_artist: 'Test Artist', album_art: '/assets/icons/icon-512.png', score: 60 + i * 4, note: i % 3 ? '' : 'Front to back.', created_at: new Date().toISOString() }));
test('Community: three across, a tap opens the full card, closing puts it back', async ({ page }) => {
  await page.route(/rest\/v1\/crate_feed/, r => r.fulfill({ json: POSTS, headers: { 'content-range': '0-8/9' } }));
  await start(page);
  await page.evaluate(() => goToView('crate'));
  await expect(page.locator('#crate-feed .cf-card')).toHaveCount(9);
  const xs = await page.locator('#crate-feed .cf-card').evaluateAll(els => els.slice(0, 4).map(e => e.offsetLeft));
  expect(new Set(xs.slice(0, 3)).size).toBe(3);
  expect(xs[3]).toBe(xs[0]);
  await shot(page, 'community-grid');
  await page.locator('#crate-feed .cf-card').nth(1).click();
  await expect(page.locator('#cf-sheet')).toHaveClass(/open/);
  await expect(page.locator('#cf-sheet .cf-card .cf-foot')).toBeVisible();
  await shot(page, 'community-sheet');
  await page.locator('#cf-sheet .rs-x').click();
  await expect(page.locator('#cf-sheet')).not.toHaveClass(/open/);
  await expect(page.locator('#crate-feed .cf-card')).toHaveCount(9);
  expect(await page.locator('#crate-feed .cf-card').nth(1).getAttribute('data-feed-id')).toBe('p1');
  // Back closes it too, and the card still returns home.
  await page.locator('#crate-feed .cf-card').nth(2).click();
  await expect(page.locator('#cf-sheet')).toHaveClass(/open/);
  await page.goBack();
  await expect(page.locator('#cf-sheet')).not.toHaveClass(/open/);
  await expect(page.locator('#view-crate')).toBeVisible();
  await expect(page.locator('#crate-feed .cf-card')).toHaveCount(9);
});

test('favourite artist: compact, most popular records first', async ({ page }) => {
  await signIn(page, { fav_artist: { id: '42', name: 'Test Artist', image: '/assets/icons/icon-512.png' } });
  const fans = [500, 90000, 1200, 40000, 7];
  await page.route(/\/api\/catalogue/, (r) => {
    const u = new URL(r.request().url());
    if ((u.searchParams.get('path') || '') !== 'artist-albums') return r.fallback();
    return r.fulfill({ json: { items: fans.map((f, i) => ({ id: String(200 + i), name: 'Album ' + i, album_type: 'album', kind: 'album', release_date: '20' + (10 + i) + '-01-01', fans: f, images: [{ url: '/assets/icons/icon-512.png' }], artists: [{ id: '42', name: 'Test Artist' }] })) } });
  });
  await start(page, { seeded: true });
  await settle(page);
  await page.evaluate(() => goToView('home'));
  await expect(page.locator('#artist-hero .ah-sleeve')).toHaveCount(4, { timeout: 8000 });
  const titles = await page.locator('#artist-hero .ah-sleeve').evaluateAll(els => els.map(e => e.title));
  expect(titles).toEqual(['Album 1', 'Album 3', 'Album 2', 'Album 0']);
  const h = await page.evaluate(() => document.getElementById('artist-hero').getBoundingClientRect().height);
  expect(h).toBeLessThan(140);
  await shot(page, 'home-artist');
});
