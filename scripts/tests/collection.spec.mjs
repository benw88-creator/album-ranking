import { test, expect, start } from './fixtures.mjs';

/* The Market against a signed-in fixture account. Every Supabase and /api
   request is answered here; nothing reaches production. */
const uid = '22222222-2222-4222-8222-222222222222';
async function signedIn(page, { discs = 100000, failShelf = false } = {}) {
  const now = Date.now();
  const user = { id: uid, email: 'fixture@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { age_band: 'adult' }, created_at: new Date().toISOString() };
  const token = [Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: Math.floor(now / 1000) + 3600 })).toString('base64url'), 'fixture'].join('.');
  const rec = (id, name, artist) => ({ id, name, artist, art: '/assets/icons/icon-512.png', score: 80, ratedAt: now - 1000, savedAt: now - 1000 });
  const crate = {
    '101': rec('101', 'Purple Rain', 'Prince'),
    '202': rec('202', 'PLAN A', 'Lil Tecca'),
    '303': rec('303', 'Demos Before Prom', 'Malcolm Todd'),
    '404': rec('404', 'Rarities', 'Deep Cut'),
  };
  const state = { owned: [
    // Bought before the catalogue moved: a Spotify id, same record as 303.
    { album_id: '6IkS2cDHxaYVkJueCPSdFx', name: 'Demos Before Prom', artist: 'Malcolm Todd', art: '/assets/icons/icon-512.png', price: 494, bought_at: new Date(now - 86400000).toISOString(), via_pick: false },
  ], buys: [], priceCalls: 0, discs, failShelf };
  await page.addInitScript(({ user, token, crate }) => {
    localStorage.setItem('sb-cqfxyebejpkyhswolrwi-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user }));
    localStorage.setItem('crate_albums_v1', JSON.stringify(crate));
    localStorage.setItem('crate_onboard_v1', JSON.stringify({ done: true, step: 9 }));
    localStorage.setItem('vinall_local_owner', user.id);
  }, { user, token, crate });
  await page.route('**/auth/v1/user**', (route) => route.fulfill({ json: user }));
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), name = url.pathname.split('/').pop();
    const single = (req.headers().accept || '').includes('object+json');
    if (name === 'profiles') {
      const p = { id: uid, username: 'Fixture', is_admin: false, discs: state.discs, album_picks: 0, owned_themes: ['classic'], ratings_visibility: 'public', level: 3 };
      return route.fulfill({ json: single ? p : [p] });
    }
    if (name === 'collection') {
      if (state.failShelf) return route.fulfill({ status: 500, json: { message: 'fixture outage' } });
      return route.fulfill({ json: state.owned });
    }
    if (name === 'collection_net_worth') return route.fulfill({ json: { net_worth: state.owned.reduce((t, r) => t + r.price, 0) } });
    return route.fallback();
  });
  await page.route('**/api/collection-prices', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      return route.fulfill({ json: { items: [
        { album_id: '202', name: 'PLAN A', artist: 'Lil Tecca', art: '/assets/icons/icon-512.png', price: 2673 },
        { album_id: '303', name: 'Demos Before Prom', artist: 'Malcolm Todd', art: '/assets/icons/icon-512.png', price: null },
      ] } });
    }
    const albums = req.postDataJSON().albums;
    const out = {};
    albums.forEach((a) => {
      if (a.id === '101') {
        // Purple Rain: the service fails the first time and answers after.
        state.priceCalls++;
        out[a.id] = state.priceCalls === 1 ? { price: null, reason: 'lookup-failed', transient: true } : { price: 3812, reason: null };
      } else if (a.id === '404') out[a.id] = { price: null, reason: 'too-few-matched', transient: false };
      else out[a.id] = { price: 1000, reason: null };
    });
    return route.fulfill({ json: { prices: out } });
  });
  await page.route('**/api/collection-buy', async (route) => {
    const b = route.request().postDataJSON();
    state.buys.push(b);
    const price = b.album_id === '202' ? 2673 : 3812;
    if (b.expect != null && price > b.expect) return route.fulfill({ status: 409, json: { error: 'The price changed', price } });
    state.owned.push({ album_id: b.album_id, name: b.name, artist: b.artist, art: b.art, price, bought_at: new Date().toISOString(), via_pick: false });
    state.discs -= price;
    return route.fulfill({ json: { ok: true, price, discs: state.discs, net_worth: 9999 } });
  });
  return state;
}
const card = (page, id) => page.locator('#col-body .col-rec[data-rec="' + id + '"]');

test('the Market prices, retries, refuses owned records and buys at the shown price', async ({ page }, info) => {
  const state = await signedIn(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await start(page);
  await page.evaluate(() => Cloud.ready);
  await page.evaluate(() => { goToView('collection'); document.querySelector('[data-col-tab="market"]').click(); });

  // Owned under its legacy id: no Buy, and it says so rather than "counting streams".
  await expect(card(page, '303')).toHaveClass(/owned/);
  await expect(card(page, '303').locator('button[data-buy]')).toHaveCount(0);
  await expect(card(page, '303').locator('.col-price')).toContainText(/paid/);

  // Priced and affordable once the wallet lands.
  await expect(card(page, '202').locator('button[data-buy]')).toBeEnabled();

  // A real "too few tracks" is permanent; an outage is retryable.
  await expect(card(page, '404').locator('.col-price')).toHaveText('cannot be priced');
  await expect(card(page, '101').locator('.col-price')).toContainText('price unavailable just now');
  await page.screenshot({ path: info.outputPath('market.png') });
  await card(page, '101').locator('[data-reprice]').click();
  await expect(card(page, '101').locator('.col-price')).toContainText('3,812');
  await expect(card(page, '101').locator('button[data-buy]')).toBeEnabled();

  // Buy sends the card's price as the most it may charge.
  await card(page, '202').locator('button[data-buy]').click();
  await expect(card(page, '202').locator('.col-bought')).toBeVisible();
  expect(state.buys[0]).toMatchObject({ album_id: '202', expect: 2673 });

  // Switching away and back: the purchase is owned, not buyable again.
  await page.locator('[data-col-tab="mine"]').click();
  await expect(page.locator('#col-body .col-rec[data-rec="202"]')).toBeVisible();
  await page.locator('[data-col-tab="market"]').click();
  await expect(card(page, '202')).toHaveClass(/owned/);
  await expect(card(page, '202').locator('button[data-buy]')).toHaveCount(0);
  expect(state.buys.length).toBe(1);
  await page.screenshot({ path: info.outputPath('market-after.png') });
});

test('an unreadable shelf pauses buying instead of guessing nothing is owned', async ({ page }) => {
  await signedIn(page, { failShelf: true });
  await start(page);
  await page.evaluate(() => Cloud.ready);
  await page.evaluate(() => { goToView('collection'); document.querySelector('[data-col-tab="market"]').click(); });
  await expect(page.locator('.col-err-bar')).toBeVisible();
  await expect(card(page, '202').locator('button[data-buy]')).toBeDisabled();
  await expect(card(page, '303').locator('button[data-buy]')).toBeDisabled();
});

test('Home leads with Today, and the album sheet keeps every control on screen', async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await start(page, { seeded: true });
  await page.evaluate(() => goToView('home'));
  await expect(page.locator('#rp-home-card .rp-door')).toBeVisible();
  const door = await page.locator('#rp-home-card .rp-door').boundingBox();
  expect(door.height).toBeLessThan(72);
  const today = await page.locator('#today-block').boundingBox();
  expect(today.y).toBeLessThan(420);
  await page.screenshot({ path: info.outputPath('home.png') });

  await page.route('**/rest/v1/ratings**', (route) => route.fulfill({ json: [
    { user_id: 'a', item_id: '100', data: { score: 79, note: 'Grower. The back half is the record.' } },
    { user_id: 'b', item_id: '100', data: { score: 70 } },
    { user_id: 'c', item_id: '100', data: { score: 91 } },
  ] }));
  await page.route('**/rest/v1/profiles**', (route) => route.fulfill({ json: [{ id: 'a', username: 'Bob' }, { id: 'b', username: 'charlie' }, { id: 'c', username: 'dee' }] }));
  await page.route('**/rest/v1/feed_comments**', (route) => route.fulfill({ json: [{ id: 'x1', user_id: 'b', username: 'charlie', body: 'Track 4 is the best thing he has done in years.', created_at: new Date(Date.now() - 7200000).toISOString() }] }));
  await page.evaluate(() => openAlbumPage({ album_id: '100', album_name: 'ICEMAN', album_artist: 'Drake', album_art: '/assets/icons/icon-512.png' }));
  await expect(page.locator('#ap-avg-count')).toHaveText('3 ratings');
  await page.waitForTimeout(500);
  const close = page.locator('#albumpage-close');
  await expect(close).toBeVisible();
  // The close button is the topmost thing at its own centre.
  const hit = await close.evaluate((b) => { const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return b.contains(el); });
  expect(hit).toBe(true);
  for (const sel of ['#ap-rate-btn', '.ap-sleeve', '.ap-avg']) {
    const b = await page.locator(sel).boundingBox();
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(375);
  }
  const sleeve = await page.locator('.ap-sleeve').boundingBox();
  expect(Math.abs(sleeve.width - sleeve.height)).toBeLessThan(2);
  expect(sleeve.width).toBeGreaterThan(200);
  await page.screenshot({ path: info.outputPath('album-sheet.png') });
  await close.click();
  await expect(page.locator('#albumpage-modal')).not.toHaveClass(/open/);
});
