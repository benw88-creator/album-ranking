import { test, expect, start } from './fixtures.mjs';

// Regression tests for the 2026-10-29 audit fixes. A fixture session is
// restored from storage (the safety spec's pattern) and every Supabase request
// is answered here; nothing reaches production.
const UID = '11111111-1111-4111-8111-111111111111';
const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

async function signedIn(page, o = {}) {
  const now = Date.now();
  const user = { id: UID, email: 'fixture@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { age_band: 'adult' }, created_at: new Date().toISOString() };
  const token = [Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: UID, role: 'authenticated', aud: 'authenticated', exp: Math.floor(now / 1000) + 3600 })).toString('base64url'), 'fixture'].join('.');
  const seen = { claims: 0, logout: [], appStatePosts: 0, feed: [] };
  await page.addInitScript(({ user, token, onb, local }) => {
    localStorage.setItem('sb-cqfxyebejpkyhswolrwi-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user }));
    localStorage.setItem('vinall_local_owner', user.id);
    localStorage.setItem('crate_onboard_v1', JSON.stringify(onb || { done: true, step: 5, v: 2 }));
    Object.keys(local || {}).forEach(k => localStorage.setItem(k, JSON.stringify(local[k])));
  }, { user, token, onb: o.onb, local: o.local });
  const profile = { id: UID, username: 'Fixture', is_admin: false, discs: 1000, owned_themes: ['classic'], ratings_visibility: 'public',
                    login_streak: 1, login_last_date: o.lastLogin || yesterday() };
  await page.route('**/auth/v1/user', route => route.fulfill({ json: user }));
  await page.route('**/auth/v1/logout**', route => { seen.logout.push(route.request().url()); return route.fulfill({ status: 204, body: '' }); });
  await page.route('**/rest/v1/**', route => {
    const req = route.request(), name = new URL(req.url()).pathname.split('/').pop();
    const single = (req.headers().accept || '').includes('object+json');
    if (name === 'profiles') return route.fulfill({ json: single ? profile : [profile] });
    if (name === 'wallet_daily_login') {
      seen.claims++;
      const already = profile.login_last_date === today();
      profile.login_last_date = today();
      return route.fulfill({ json: already ? { earned: 0, claimed_already: true, login_streak: 2, login_last_date: today(), discs: 3000 }
        : { earned: 2000, claimed_already: false, login_streak: 2, login_last_date: today(), discs: 3000, day: 2, granted: { kind: 'discs', discs: 2000 } } });
    }
    if (name === 'app_state' && req.method() !== 'GET') {
      seen.appStatePosts++;
      return o.appStateDown ? route.fulfill({ status: 500, json: { message: 'down' } }) : route.fulfill({ status: 201, json: [] });
    }
    if (name === 'crate_feed' && req.method() !== 'GET') {
      seen.feed.push({ method: req.method(), url: req.url(), body: req.postDataJSON ? (() => { try { return req.postDataJSON(); } catch (e) { return null; } })() : null });
      if (o.feedReply) return route.fulfill({ json: o.feedReply(req) });
      return route.fulfill({ json: [] });
    }
    return route.fallback();
  });
  await start(page);
  await page.evaluate(() => Cloud.ready);
  return seen;
}

test('#1 the daily reward claims itself when the app opens, once a day', async ({ page }) => {
  const seen = await signedIn(page);
  await expect.poll(() => seen.claims, { timeout: 8000 }).toBe(1);
  // Coming back to the front, or asking again, does not ask the server again.
  await page.evaluate(() => { Wallet.autoClaim(); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(800);
  expect(seen.claims).toBe(1);
  expect(await page.evaluate(() => Wallet.get().login_last_date)).toBe(today());
});

test('#1 nothing is claimed under the tutorial; it claims when the tutorial ends', async ({ page }) => {
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    const o = document.getElementById('onb'); if (o) o.classList.add('open');
  }));
  const seen = await signedIn(page);
  await page.waitForTimeout(3500);
  expect(seen.claims).toBe(0);
  await page.evaluate(() => { document.getElementById('onb').classList.remove('open'); window.dispatchEvent(new Event('vinall:onboarded')); });
  await expect.poll(() => seen.claims, { timeout: 5000 }).toBe(1);
});

test('#1 an account that already claimed today is not asked again', async ({ page }) => {
  const seen = await signedIn(page, { lastLogin: today() });
  await page.waitForTimeout(3000);
  expect(seen.claims).toBe(0);
});

test('#3/#8 logout signs out this device only, and asks before wiping unsynced work', async ({ page }) => {
  const seen = await signedIn(page, { appStateDown: true });
  await page.evaluate(() => localStorage.setItem('crate_shortlist_v1', JSON.stringify({ x1: { id: 'x1', name: 'Unsynced', savedAt: Date.now() } })));
  const out = page.evaluate(() => Cloud.logout());
  await expect(page.locator('#ask-modal')).toHaveClass(/\bopen\b/, { timeout: 8000 });
  await expect(page.locator('#ask-title')).toContainText('haven’t synced');
  await page.locator('#ask-no').click();
  expect(await out).toBe(false);
  expect(await page.evaluate(() => Cloud.isOn() && !!localStorage.getItem('crate_shortlist_v1'))).toBe(true);
  expect(seen.logout.length).toBe(0);
  // Logging out anyway goes through, and only for this device.
  const out2 = page.evaluate(() => Cloud.logout());
  await page.locator('#ask-yes').click();
  await out2;
  expect(seen.logout.length).toBe(1);
  expect(seen.logout[0]).toContain('scope=local');
  expect(await page.evaluate(() => Cloud.isOn())).toBe(false);
});

test('#3 with everything synced, logout asks nothing', async ({ page }) => {
  const seen = await signedIn(page);
  await page.evaluate(() => Cloud.logout());
  await expect(page.locator('#ask-modal')).not.toHaveClass(/\bopen\b/);
  expect(seen.logout.length).toBe(1);
  expect(seen.logout[0]).toContain('scope=local');
});

test('#6 a legacy-keyed record re-rated posts under its own key and drops its twin', async ({ page }) => {
  const legacy = '4yP0hdKOZPNshxUOjY0cZj';
  const seen = await signedIn(page, { local: { crate_albums_v1: { [legacy]: { id: legacy, name: 'Blonde', artist: 'Frank Ocean', score: 80, savedAt: 1, ratedAt: 1 } } } });
  await page.evaluate(() => saveAlbum({ id: '13775045', name: 'Blonde', artist: 'Frank Ocean', art: '' }, 92));
  await expect.poll(() => seen.feed.filter(f => f.method === 'DELETE').length, { timeout: 8000 }).toBeGreaterThan(0);
  const post = seen.feed.find(f => f.method === 'POST');
  expect(post.body.album_id || (post.body[0] && post.body[0].album_id)).toBe(legacy);
  const del = seen.feed.find(f => f.method === 'DELETE').url;
  expect(decodeURIComponent(del)).toContain('album_id=neq.' + legacy);
  expect(decodeURIComponent(del)).toMatch(/album_name=ilike\.Blonde/);
});

test('#7 re-rating an album pays once; a new album still pays', async ({ page }) => {
  await start(page);
  const paid = await page.evaluate(() => {
    let n = 0; Wallet.recordRating = () => { n++; };
    saveAlbum({ id: '900', name: 'One', artist: 'A', art: '' }, 70);
    saveAlbum({ id: '900', name: 'One', artist: 'A', art: '' }, 85);
    saveAlbum({ id: '901', name: 'Two', artist: 'A', art: '' }, 60);
    return n;
  });
  expect(paid).toBe(2);
});

test('#9 the Draw odds panel states what a duplicate really pays', async ({ page }) => {
  await start(page);
  const html = await page.content();
  expect(html).toContain('pays half its shop price back in Discs');
  expect(html).not.toContain('pays its shop price back in Discs instead');
});

test('#10 a paused Endless run keeps its leaderboard run across a reload', async ({ page }) => {
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    VinalAudio.register('spec', { label: 'Spec', link: () => null,
      resolve: () => Promise.resolve({ url: 'test:spec', ms: 30000 }),
      play: function () { this.t = performance.now(); return Promise.resolve(true); },
      stop: function () { this.t = null; },
      position: function () { return this.t == null ? 0 : (performance.now() - this.t) / 1000; } });
    VinalAudio.use('spec');
  }));
  await start(page);
  await page.evaluate(() => openRecall('endless'));
  await expect(page.locator('#recall-input')).toBeEnabled();
  // Stand in for the run game_start would have issued to a signed-in player.
  await page.evaluate(() => Boards.adopt('recall', { id: 'run-kept', mode: 'endless', day: null, t0: Date.now() - 60000 }));
  await page.locator('#recall-hear').click();
  await page.locator('#recall-close').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('crate_recall_live')).board.id)).toBe('run-kept');
  await page.reload();
  await page.waitForFunction(() => typeof window.openRecall === 'function');
  const go = page.locator('#splash-cta'); if (await go.isVisible()) await go.click();
  await page.evaluate(() => openRecall());
  await expect(page.locator('#recall-play')).toBeVisible();
  expect(await page.evaluate(() => Boards.live('recall') && Boards.live('recall').id)).toBe('run-kept');
});

test('#14 a dropped tutorial start is retried before the round is filed', async ({ page }) => {
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    VinalAudio.register('spec', { label: 'Spec', link: () => null,
      resolve: () => Promise.resolve({ url: 'test:spec', ms: 30000 }),
      play: () => Promise.resolve(true), stop: () => {}, position: () => 0 });
    VinalAudio.use('spec');
  }));
  await start(page);
  await page.evaluate(() => {
    window.__t = { starts: 0, submits: [] };
    Cloud.recallTutorialStart = () => { __t.starts++; return Promise.resolve(__t.starts < 3 ? null : { started_at: new Date().toISOString() }); };
    Cloud.recallTutorialSubmit = o => { __t.submits.push(o); return Promise.resolve({ score: 900, correct: true, rank: 1, total: 1 }); };
  });
  await page.evaluate(() => openRecall('tutorial'));
  await expect(page.locator('#recall-input')).toBeEnabled();
  await page.locator('#recall-hear').click();
  await expect.poll(() => page.evaluate(() => __t.starts), { timeout: 5000 }).toBe(3);
  await page.locator('#recall-input').fill('Memories');
  await page.locator('#recall-input').press('Enter');   // picks the suggestion
  await page.locator('#recall-input').press('Enter');   // and guesses it
  await expect.poll(() => page.evaluate(() => __t.submits.length), { timeout: 5000 }).toBe(1);
  expect(await page.evaluate(() => __t.starts)).toBe(3);
});

test('#14 when every start fails, one more is asked for and the server floor is respected', async ({ page }) => {
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    VinalAudio.register('spec', { label: 'Spec', link: () => null,
      resolve: () => Promise.resolve({ url: 'test:spec', ms: 30000 }),
      play: () => Promise.resolve(true), stop: () => {}, position: () => 0 });
    VinalAudio.use('spec');
  }));
  await start(page);
  await page.evaluate(() => {
    window.__t = { starts: [], submitAt: 0 };
    Cloud.recallTutorialStart = () => { __t.starts.push(Date.now()); return Promise.resolve(__t.starts.length < 4 ? null : { started_at: new Date().toISOString() }); };
    Cloud.recallTutorialSubmit = () => { __t.submitAt = Date.now(); return Promise.resolve({ score: 900, correct: true }); };
  });
  await page.evaluate(() => openRecall('tutorial'));
  await expect(page.locator('#recall-input')).toBeEnabled();
  await page.locator('#recall-hear').click();
  await expect.poll(() => page.evaluate(() => __t.starts.length), { timeout: 5000 }).toBe(3);
  await page.locator('#recall-input').fill('Memories');
  await page.locator('#recall-input').press('Enter');   // picks the suggestion
  await page.locator('#recall-input').press('Enter');   // and guesses it
  await expect.poll(() => page.evaluate(() => __t.submitAt), { timeout: 6000 }).toBeGreaterThan(0);
  const t = await page.evaluate(() => __t);
  expect(t.starts.length).toBe(4);
  expect(t.submitAt - t.starts[3]).toBeGreaterThanOrEqual(1050);
});

test('#11 import posts that hit the daily limit wait, and go up when the limit allows', async ({ page }) => {
  let accept = false;
  const row = { user_id: UID, username: 'Fixture', avatar_url: '', kind: 'album_rating', album_id: 'imp1', album_name: 'Imported', album_art: '', album_artist: 'A', score: 77, note: '', created_at: '2000-01-01T00:00:00Z' };
  const seen = await signedIn(page, {
    local: { crate_albums_v1: { imp1: { id: 'imp1', name: 'Imported', artist: 'A', score: 77, imported: true, savedAt: 1, ratedAt: 1 } },
             crate_feed_pending_v1: [row] },
    feedReply: req => (req.method() === 'POST' && accept) ? [{ album_id: 'imp1' }] : []
  });
  // The login already tried once and the server took nothing: still queued.
  await expect.poll(() => seen.feed.filter(f => f.method === 'POST').length, { timeout: 8000 }).toBeGreaterThan(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('crate_feed_pending_v1') || '[]').length)).toBe(1);
  accept = true;
  await page.evaluate(() => VinallImport.flushFeedPending());
  expect(await page.evaluate(() => localStorage.getItem('crate_feed_pending_v1'))).toBeNull();
});

test('sweep #2 deleting one of two crate entries for a record keeps the survivor\'s post', async ({ page }) => {
  const seen = await signedIn(page, { local: { crate_albums_v1: {
    legacyL: { id: 'legacyL', name: 'Views', artist: 'Drake', score: 92, savedAt: 1, ratedAt: 1 },
    '13775099': { id: '13775099', name: 'Views', artist: 'Drake', score: 95, savedAt: 2, ratedAt: 2 } } } });
  await page.evaluate(() => removeAlbum('legacyL'));
  await expect.poll(() => seen.feed.filter(f => f.method === 'DELETE').length, { timeout: 8000 }).toBe(1);
  await page.waitForTimeout(600);
  const dels = seen.feed.filter(f => f.method === 'DELETE').map(f => decodeURIComponent(f.url));
  expect(dels.length).toBe(1);
  expect(dels[0]).toContain('album_id=eq.legacyL');
  expect(dels[0]).not.toContain('album_name');
});

test('sweep #2 deleting the only entry removes every post of the record', async ({ page }) => {
  const seen = await signedIn(page, { local: { crate_albums_v1: {
    only1: { id: 'only1', name: 'Solo Record', artist: 'Solo', score: 60, savedAt: 1, ratedAt: 1 } } } });
  await page.evaluate(() => removeAlbum('only1'));
  await expect.poll(() => seen.feed.filter(f => f.method === 'DELETE').length, { timeout: 8000 }).toBe(2);
  const dels = seen.feed.filter(f => f.method === 'DELETE').map(f => decodeURIComponent(f.url));
  expect(dels.some(u => u.replace(/\+/g, ' ').includes('album_name=ilike.Solo Record'))).toBe(true);
});

test('sweep #3 the songs slider at zero deletes through removeSong, with a tombstone, only on release', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    localStorage.setItem('crate_songs_v1', JSON.stringify({ s1: { id: 's1', name: 'Song One', artist: 'A', albumId: 'x', albumName: 'X', art: '', score: 7, savedAt: 1, ratedAt: 1 } }));
    renderSongs(); goToView('songs');
  });
  const slider = page.locator('.song-slider[data-song="s1"]');
  await expect(slider).toHaveCount(1);
  // Passing through zero mid-drag deletes nothing.
  await slider.evaluate(el => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); el.value = '4'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('crate_songs_v1')).s1.score)).toBe(4);
  // Releasing at zero removes it and records the deletion, so a sync cannot bring it back.
  await page.locator('.song-slider[data-song="s1"]').evaluate(el => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('crate_songs_v1')).s1)).toBeUndefined();
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('crate_rating_deletions_v1') || '{}')))).toContain('song|s1');
});
