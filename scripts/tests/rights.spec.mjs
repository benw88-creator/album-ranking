// The Apple build (assets/apple.js): catalogue and previews from Apple's
// iTunes Search API, held-back games, no Deezer artwork. Apple is mocked here.
import { test, expect } from './fixtures.mjs';
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
  page.on('request', q => { if (/dzcdn.net|deezer.com/.test(new URL(q.url()).hostname)) dz.push(q.url()); });
  await page.goto('/?rights=apple');
  await page.waitForFunction(() => window.Rights && Rights.ON);
  const shown = await page.evaluate(() => ['recall-card', 'cover-card', 'coverx-card', 'war-card'].map(id => getComputedStyle(document.getElementById(id)).display !== 'none'));
  expect(shown).toEqual([false, false, false, true]);
  expect(await page.evaluate(() => [Rights.gameOff('recall'), Rights.gameOff('cover'), Rights.gameOff('coverx'), Rights.gameOff('year')])).toEqual([true, true, true, false]);

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
