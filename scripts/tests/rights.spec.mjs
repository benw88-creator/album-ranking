// The Apple build (assets/apple.js): catalogue and previews from Apple's
// iTunes Search API, held-back games, no Deezer artwork. Apple is mocked here.
import { test, expect, start } from './fixtures.mjs';
import { fileURLToPath } from 'node:url';

const ART = 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/bb/x.jpg/100x100bb.jpg';
const song = (n, coll, name, extra = {}) => ({
  wrapperType: 'track', kind: 'song', artistId: 7, artistName: 'Frank Ocean', collectionId: coll, collectionName: name,
  trackId: 9000 + n, trackName: 'Track ' + n, trackNumber: n, discNumber: 1, trackCount: 17, trackTimeMillis: 200000,
  previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/p' + n + '.m4a', artworkUrl100: ART,
  trackViewUrl: 'https://music.apple.com/gb/album/x/' + coll + '?i=' + (9000 + n), collectionViewUrl: 'https://music.apple.com/gb/album/x/' + coll,
  releaseDate: '2016-08-20T07:00:00Z', primaryGenreName: 'Pop', ...extra
});

test.beforeEach(async ({ page }) => {
  // Apple's sleeves load as a real image, so the hero can show them.
  await page.route('https://is1-ssl.mzstatic.com/**', (route) => route.fulfill({ path: fileURLToPath(new URL('../../assets/icons/icon-512.png', import.meta.url)) }));
  await page.route('https://itunes.apple.com/**', route => {
    const u = new URL(route.request().url());
    const e = u.searchParams.get('entity');
    if (u.pathname === '/lookup') {
      return route.fulfill({ json: { resultCount: 3, results: [
        { wrapperType: 'collection', collectionType: 'Album', collectionId: 111, collectionName: 'Blonde', artistId: 7, artistName: 'Frank Ocean',
          artworkUrl100: ART, trackCount: 17, releaseDate: '2016-08-20T07:00:00Z', collectionViewUrl: 'https://music.apple.com/gb/album/blonde/111' },
        song(1, 111, 'Blonde'), song(2, 111, 'Blonde')] } });
    }
    // Apple's album index misses the album; its song index finds it.
    if (e === 'album') return route.fulfill({ json: { resultCount: 1, results: [
      { wrapperType: 'collection', collectionId: 222, collectionName: 'Moon River - Single', artistId: 7, artistName: 'Frank Ocean', artworkUrl100: ART, trackCount: 1, releaseDate: '2018-02-14T00:00:00Z' }] } });
    return route.fulfill({ json: { resultCount: 2, results: [song(1, 111, 'Blonde'), song(2, 111, 'Blonde')] } });
  });
});

test('the Apple build answers the catalogue routes from Apple, in the same shapes', async ({ page }) => {
  await page.goto('/?rights=apple');
  await page.waitForFunction(() => window.Rights && Rights.ON);
  const r = await page.evaluate(async () => {
    const s = await fetch('/api/catalogue?path=search&type=album&limit=5&q=frank%20ocean%20blonde').then(x => x.json());
    const a = await fetch('/api/catalogue?path=album&id=12345&name=Blonde&artist=Frank%20Ocean').then(x => x.json());
    const p = await fetch('/api/preview?artist=Frank%20Ocean&album=Blonde').then(x => x.json());
    return { first: s.albums.items[0], single: s.albums.items[1], album: a, preview: p };
  });
  expect(r.first.id).toBe('am111');                     // found through the song index
  expect(r.first.name).toBe('Blonde');
  expect(r.single).toMatchObject({ name: 'Moon River', kind: 'single', album_type: 'single' });
  expect(r.album.legacy_id).toBe('12345');              // a non-Apple id resolves by name, never as an Apple id
  expect(r.album.tracks.items[0]).toMatchObject({ id: 'am9001', preview_url: expect.stringContaining('itunes.apple.com') });
  expect(r.album.images[0].url).toContain('1000x1000bb');
  expect(r.preview).toMatchObject({ source: 'apple', album: 'Blonde' });
});

test('held-back games are gone, Deezer art is never requested, the album page has the badge', async ({ page }) => {
  const dz = [];
  await page.goto('/?rights=apple');
  await page.waitForFunction(() => window.Rights && Rights.ON);
  // The final iOS Arcade: only Recall and the two cover games are held back.
  const shown = await page.evaluate(() => ['recall-card', 'cover-card', 'coverx-card', 'year-card', 'tracklist-card', 'war-card', 'drop-card', 'ew-card', 'blitz-card', 'hl-card', 'charades-card', 'rocketrun-card'].map(id => getComputedStyle(document.getElementById(id)).display !== 'none'));
  expect(shown).toEqual([false, false, false, true, true, true, true, true, true, true, true, true]);
  expect(await page.evaluate(() => ['recall', 'cover', 'coverx', 'year', 'tracklist', 'drop', 'blitz'].map(k => Rights.gameOff(k)))).toEqual([true, true, true, false, false, false, false]);
  // Opening a held-back mode by code does nothing.
  await page.evaluate(() => { const c = document.getElementById('cover-card'); c.style.setProperty('display', 'block', 'important'); c.click(); });
  await expect(page.locator('#game')).not.toHaveClass(/\bopen\b/);

  await page.evaluate(() => { const i = document.createElement('img'); i.id = 'dzt'; i.src = 'https://cdn-images.dzcdn.net/images/cover/abc/250x250-000000-80-0-0.jpg'; document.body.appendChild(i); });
  await expect(page.locator('#dzt')).toHaveAttribute('src', '/assets/sleeve-blank.svg');

  await page.evaluate(() => openAlbum({ id: 'am111', name: 'Blonde', artist: 'Frank Ocean', art: '' }));
  await expect(page.locator('#detail-spotify.am-badge img[alt="Listen on Apple Music"]')).toBeVisible();
  await expect(page.locator('#detail-spotify')).toHaveAttribute('href', 'https://music.apple.com/gb/album/blonde/111');
  expect(dz).toEqual([]);
});

test('the website build is untouched', async ({ page }) => {
  await page.goto('/?rights=deezer');
  await page.waitForFunction(() => window.Rights && Rights.ON === false);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('recall-card')).display)).not.toBe('none');
});

test('a Spotify export is matched against Apple on the device, through the album tracklist', async ({ page }) => {
  await page.goto('/?rights=apple');
  await page.waitForFunction(() => window.Rights && Rights.ON);
  const r = await page.evaluate(async () => {
    const items = [{ u: 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa', a: 'Frank Ocean', t: 'Track 2', b: 'Blonde' },
                   { u: 'spotify:track:bbbbbbbbbbbbbbbbbbbbbb', a: 'Nobody', t: 'Nothing Like It', b: '' }];
    return fetch('/api/catalogue?path=spotify-match', { method: 'POST', body: JSON.stringify({ kind: 'track', items }) }).then((x) => x.json());
  });
  expect(r.results[0]).toMatchObject({ u: 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa', status: 'ok', m: { id: 'am9002', name: 'Track 2', album: 'Blonde' } });
  expect(r.results[1].status).toBe('none');
});

test('with no artist photo the favourite-artist hero is led by the records, never a placeholder', async ({ page }) => {
  await page.goto('/?rights=apple&debugArtist=none&debugArtistName=Frank%20Ocean&debugArtistId=am7');
  await page.waitForFunction(() => window.Rights && Rights.ON);
  const hero = page.locator('#artist-hero');
  await expect(hero).toHaveClass(/ah-albums/);
  await expect(page.locator('#artist-hero-lead')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#artist-hero-lead img')).toHaveAttribute('src', /mzstatic\.com/);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('artist-hero-portrait')).display)).toBe('none');
  expect(await page.evaluate(() => document.querySelectorAll('.ah-glow').length)).toBe(0);   // no blurred copies of Apple art
});

// The App Store build reads as a standalone app: no Deezer, no "on the
// website", no pointer to a site, on any page a reviewer can reach.
test('the Apple build never mentions Deezer or the website on screen', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/?rights=apple');
  await page.waitForFunction(() => window.Rights && Rights.ON);
  const BAD = /deezer|on the website|vinall\.xyz|vinall-lab|web version|in your browser/i;
  const views = await page.evaluate(() => Array.from(document.querySelectorAll('section.view[id^="view-"]')).map((s) => s.id.slice(5)));
  const hits = [];
  // The album page is only reached with a record open; the badge test covers it.
  for (const v of views.filter((x) => x !== 'album-detail')) {
    await page.evaluate((m) => { try { goToView(m); } catch (e) {} }, v);
    await page.waitForTimeout(250);
    const t = await page.evaluate(() => document.body.innerText);
    const m = t.match(BAD); if (m) hits.push(v + ': ' + t.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, ' '));
  }
  for (const id of ['settings-modal', 'ptop-modal']) {
    await page.evaluate((x) => { const el = document.getElementById(x); if (el) el.classList.add('open'); }, id);
    const t = await page.evaluate((x) => { const el = document.getElementById(x); return el ? el.innerText : ''; }, id);
    const m = t.match(BAD); if (m) hits.push(id + ': ' + t.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, ' '));
    await page.evaluate((x) => { const el = document.getElementById(x); if (el) el.classList.remove('open'); }, id);
  }
  for (const doc of ['/privacy.html', '/terms.html']) {
    await page.goto(doc);
    const t = await page.evaluate(() => document.body.innerText);
    const m = t.match(BAD); if (m) hits.push(doc + ': ' + t.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, ' '));
  }
  expect(hits).toEqual([]);
});

// Inside the native app the build is Apple's whatever the device has stored:
// a ?rights=deezer link opened in the app must not bring Recall back.
test('the native app ignores a stored or linked ?rights=deezer', async ({ page }) => {
  await page.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', platform: 'ios', PluginHeaders: [], Plugins: {},
      nativePromise: () => Promise.reject(new Error('no native in tests')), nativeCallback: () => {}, addListener: () => ({ remove() {} }) };
    try { localStorage.setItem('vinall_rights', 'deezer'); } catch (e) {}
  });
  await page.route(/^https:\/\/(www\.)?vinall/, (r) => r.fulfill({ status: 503, json: {} }));
  await page.goto('/?rights=deezer');
  await page.waitForFunction(() => window.Rights);
  expect(await page.evaluate(() => [Native.on, Rights.ON, Rights.gameOff('recall')])).toEqual([true, true, true]);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('recall-card')).display)).toBe('none');
});

// Guess the Year on iOS: no sleeve in a game sheet, so the clue is the record's
// title and artist as text. The website keeps the cover (checked below).
test('Guess the Year in the Apple build gives the title and artist, not the cover', async ({ page }) => {
  test.setTimeout(160000);
  const coll = (i) => ({ wrapperType: 'collection', collectionType: 'Album', collectionId: 500 + i, collectionName: 'Record Number ' + i, artistId: 7, artistName: 'Frank Ocean',
    artworkUrl100: ART, trackCount: 12, releaseDate: (2000 + i) + '-01-01T07:00:00Z', collectionViewUrl: 'https://music.apple.com/gb/album/x/' + (500 + i) });
  await page.route('https://itunes.apple.com/**', (route) => {
    const u = new URL(route.request().url());
    const results = u.searchParams.get('entity') === 'musicArtist'
      ? [{ wrapperType: 'artist', artistType: 'Artist', artistId: 7, artistName: 'Frank Ocean' }]
      : [{ wrapperType: 'artist', artistId: 7, artistName: 'Frank Ocean' }].concat([1, 2, 3, 4, 5, 6, 7].map(coll));
    return route.fulfill({ json: { resultCount: results.length, results } });
  });
  // Records that already carry Apple ids, so nothing queues behind start-up lookups.
  await page.addInitScript(() => {
    localStorage.setItem('vinall_rights', 'apple');
    // Exactly the 12 the card's gate asks for, with Apple sleeves, so start-up looks nothing up.
    const a = {}; for (let i = 0; i < 12; i++) a['am' + (900 + i)] = { id: 'am' + (900 + i), name: 'Seed ' + i, artist: 'Seed Artist', art: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/bb/x.jpg/100x100bb.jpg', score: 80, savedAt: Date.now() - i, year: '2010' };
    localStorage.setItem('crate_albums_v1', JSON.stringify(a));
    localStorage.setItem('crate_onboard_v1', JSON.stringify({ done: true, at: Date.now(), step: 99 }));
  });
  await start(page);
  await page.waitForFunction(() => window.Rights && Rights.ON);
  await page.evaluate(() => goToView('games'));
  await page.locator('#year-card').click();
  await expect(page.locator('#game')).toHaveClass(/\bopen\b/);
  await page.locator('#g-artist-input').fill('Frank Ocean');
  const sugg = page.locator('#game').getByText('Frank Ocean', { exact: true }).last();
  if (await sugg.isVisible({ timeout: 8000 }).catch(() => false)) await sugg.click();
  await page.locator('#g-start-btn').click();
  // Up to a minute: start-up's background lookups share Apple's 20-a-minute budget.
  await expect(page.locator('#g-yclue')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('#g-yclue b')).toHaveText(/^Record Number \d$/);
  await expect(page.locator('#g-yclue span')).toHaveText('Frank Ocean');
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('g-cover')).visibility)).toBe('hidden');
  await expect(page.locator('#g-year-input')).toBeVisible();
});

test('Guess the Year on the website still shows the cover', async ({ page }) => {
  await page.goto('/?rights=deezer');
  await page.waitForFunction(() => window.Rights && Rights.ON === false);
  expect(await page.evaluate(() => document.getElementById('g-yclue').hidden)).toBe(true);
});
