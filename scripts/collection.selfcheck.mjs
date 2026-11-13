// The Collection's price and till, end to end in-process. Every request is
// intercepted: Wikipedia, Wikimedia and Apple answer from fixtures,
// and Supabase is a small in-memory stand-in (auth, album_plays, crate_feed,
// my_sealed_albums and collection_buy_from with its real refusals). Never
// loads production credentials.
import assert from 'node:assert/strict';
import buy from '../api/collection-buy.js';
import prices from '../api/collection-prices.js';
import { normTitle, SOURCE, valueAlbum } from '../api/_streams.js';
import { priceFromValue } from '../api/collection-buy.js';

process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-test-service-key';
const J = (d, status = 200) => new Response(JSON.stringify(d), { status });
const res = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(j) { this.body = j; return this; }, end() {} });
let groups = 0;
const check = async (name, fn) => { await fn(); groups++; console.log('ok — ' + name); };

/* ---- the world ---- */
// Records by id. A Wikipedia article (title + description) and its readers a
// year; 'none' = no article; Apple knows the am id.
const ALBUMS = {
  101: { name: 'Purple Rain', artist: 'Prince', article: 'Purple Rain (album)', desc: '1984 soundtrack and studio album by Prince and the Revolution', readers: 449036 },
  202: { name: 'Demos Before Prom', artist: 'Malcolm Todd', article: 'Demos Before Prom', desc: '2023 album by Malcolm Todd', readers: 9000 },
  303: { name: 'Rarities', artist: 'Deep Cut', article: null },
  404: { name: 'Stale One', artist: 'Old Hand', article: 'Stale One', desc: '2001 album by Old Hand', readers: 54000 },
  // A same-named page about something else must never price the record.
  606: { name: 'Views', artist: 'Drake', article: 'Views (album)', desc: '2016 studio album by Drake', readers: 233763, decoy: { title: 'Views', desc: 'Topics referred to by the same term' } },
};
const FEED = { '101': ALBUMS[101], '202': ALBUMS[202], '303': ALBUMS[303], '404': ALBUMS[404], '606': ALBUMS[606] };
const RATERS = { '101': 3 };
let wikiDown = false, rpcCalls = 0, sealedIds = [], sealedDown = false;
const db = { plays: {}, owned: {}, discs: 10000000, rated: new Set(['101', '202', '303', '404', '606', 'legacyLegacyLegacy0001', 'am777']) };
const USER = 'u-1';

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (u.pathname === '/auth/v1/user') return (opts.headers.Authorization === 'Bearer good') ? J({ id: USER }) : J({}, 401);
  if (u.pathname === '/rest/v1/rpc/my_sealed_albums') return sealedDown ? J({}, 500) : J(sealedIds.map((id) => ({ album_id: id })));
  if (u.pathname === '/rest/v1/crate_feed') {
    const id = decodeURIComponent((u.searchParams.get('album_id') || '').replace(/^eq./, ''));
    if (u.searchParams.get('select') === 'user_id') {
      const n = RATERS[id] || 0;
      return new Response('[]', { status: 200, headers: { 'content-range': (n ? '0-0' : '*') + '/' + n } });
    }
    const a = FEED[id];
    return J(a ? [{ album_name: a.name, album_artist: a.artist }] : []);
  }
  if (u.pathname === '/rest/v1/album_plays') {
    if (opts.method === 'POST') { body.forEach((r) => { db.plays[r.album_id] = r; }); return J({}, 201); }
    const id = decodeURIComponent((u.searchParams.get('album_id') || '').replace(/^eq./, ''));
    return J(db.plays[id] ? [db.plays[id]] : []);
  }
  if (u.pathname === '/rest/v1/rpc/collection_buy_from') {
    rpcCalls++;
    const k = USER + '|' + body.p_album_id;
    if (!db.rated.has(body.p_album_id)) return J({ message: 'Rate a record before buying it' }, 400);
    if (db.owned[k]) return J({ message: 'You already own that one' }, 400);
    if (db.discs < body.p_price) return J({ message: 'That costs ' + body.p_price + ' Discs and you have ' + db.discs }, 400);
    db.owned[k] = body.p_price; db.discs -= body.p_price;
    return J({ ok: true, album_id: body.p_album_id, price: body.p_price, discs: db.discs });
  }
  if (u.hostname === 'itunes.apple.com') {
    return J(u.searchParams.get('id') === '777' ? { resultCount: 1, results: [{ collectionName: 'Purple Rain', artistName: 'Prince' }] } : { resultCount: 0, results: [] });
  }
  if (u.hostname === 'en.wikipedia.org') {
    if (wikiDown) return new Response('', { status: 503 });
    const q = u.searchParams.get('gsrsearch');
    const a = Object.values(ALBUMS).find((x) => q.startsWith(x.name + ' ' + x.artist));
    const pages = {};
    if (a && a.decoy) pages[1] = { title: a.decoy.title, description: a.decoy.desc, index: 1 };
    if (a && a.article) pages[2] = { title: a.article, description: a.desc, index: 2 };
    return J({ query: { pages } });
  }
  if (u.hostname === 'wikimedia.org') {
    if (wikiDown) return new Response('', { status: 503 });
    const title = decodeURIComponent(u.pathname.split('/user/')[1].split('/monthly')[0]).replace(/_/g, ' ');
    const a = Object.values(ALBUMS).find((x) => x.article === title);
    return a ? J({ items: [{ views: a.readers - 1000 }, { views: 1000 }] }) : new Response('', { status: 404 });
  }
  throw new Error('unexpected request ' + url);
};

const priceReq = async (albums) => { const r = res(); await prices({ method: 'POST', headers: { authorization: 'Bearer good' }, body: { albums } }, r); return r; };
const buyReq = async (b) => { const r = res(); await buy({ method: 'POST', headers: { authorization: 'Bearer good' }, body: b }, r); return r; };

await check('VINALL Value takes the album article, never a same-named page, and prices on a curve', async () => {
  assert.equal(normTitle('When Doves Cry - 2015 Paisley Park Remaster'), normTitle('When Doves Cry'));   // _discogs.js still uses it
  const v = await valueAlbum('606', 'unused', {});
  assert.equal(v.ok, true);
  assert.equal(v.article, 'Views (album)', 'the disambiguation page is skipped');
  assert.equal(v.total, 233763);
  assert.equal(priceFromValue(v.total), 62290);
  assert.equal(priceFromValue(2050995), 302550, 'iconic records stay below the asymptote');
  assert.equal(priceFromValue(1000), 200, 'no article: the floor');
  // Every step up in readers is a step up in price: no ties anywhere, no cap.
  const ladder = [8312, 26578, 64640, 113831, 233763, 449036, 880907, 1277215, 2050995].map(priceFromValue);
  ladder.forEach((p, i) => { if (i) assert.ok(p > ladder[i - 1] * 1.2, 'each rung clearly dearer: ' + ladder.join(', ')); });
  assert.ok(ladder[ladder.length - 1] / ladder[0] > 250, 'iconic is hundreds of times an obscure record');
  assert.equal(priceFromValue(0), null);
  assert.equal(v.source, SOURCE);
});

await check('people here who rated a record lift its value, capped at +20%', async () => {
  const { uplift } = await import('../api/_streams.js');
  assert.equal(uplift(0), 0); assert.equal(uplift(3), 0.06); assert.equal(uplift(500), 0.2);
  const v = await valueAlbum('101', 'unused', {});
  assert.equal(v.raters, 3);
  assert.equal(v.total, Math.round(449036 * 1.06));
});

await check('a record with no article is priced at the floor, not refused', async () => {
  const r = await priceReq([{ id: '303' }]);
  assert.equal(r.body.prices['303'].price, 200);
});

await check('a Wikipedia outage is "not just now", is not remembered, and prices once it answers', async () => {
  wikiDown = true;
  const r1 = await priceReq([{ id: '202' }]);
  assert.equal(r1.body.prices['202'].price, null);
  assert.equal(r1.body.prices['202'].transient, true);
  assert.equal(db.plays['202'], undefined, 'nothing cached for a failure');
  wikiDown = false;
  const r2 = await priceReq([{ id: '202' }]);
  assert.equal(r2.body.prices['202'].price, priceFromValue(9000));
  assert.equal(db.plays['202'].source, SOURCE);
});

await check('an outage falls back to the last valuation, at the same price at the card and the till', async () => {
  db.plays['404'] = { album_id: '404', plays: 300000, source: SOURCE, fetched_at: new Date(Date.now() - 40 * 86400000).toISOString() };
  wikiDown = true;
  const card = (await priceReq([{ id: '404' }])).body.prices['404'].price;
  assert.equal(card, priceFromValue(300000));
  const before = db.discs;
  const r = await buyReq({ album_id: '404', name: 'Stale One', artist: 'Old Hand', expect: card });
  assert.equal(r.code, 200);
  assert.equal(r.body.price, card);
  assert.equal(before - db.discs, card);
  wikiDown = false;
});

await check('a kworb-era cache row is never used as a price', async () => {
  db.plays['606'] = { album_id: '606', plays: 12810000000, source: 'kworb', fetched_at: new Date().toISOString() };
  const r = await priceReq([{ id: '606' }]);
  assert.equal(r.body.prices['606'].price, 62290);
});

await check('the till charges nothing when pricing fails, and says why', async () => {
  wikiDown = true;
  const calls = rpcCalls, before = db.discs;
  db.rated.add('505');
  const r = await buyReq({ album_id: '505', name: 'Unreachable', artist: 'Nobody', expect: 500 });
  assert.equal(r.code, 503);
  assert.match(r.body.error, /nothing was charged/);
  assert.equal(rpcCalls, calls, 'no purchase function called');
  assert.equal(db.discs, before);
  wikiDown = false;
  db.rated.add('zz999');
  const r2 = await buyReq({ album_id: 'zz999' });
  assert.equal(r2.code, 400);
  assert.match(r2.body.error, /cannot be priced/);
  assert.equal(rpcCalls, calls);
  assert.equal(db.discs, before);
});

await check('the till refuses a price above the card, and buys at or below it', async () => {
  const card = (await priceReq([{ id: '101' }])).body.prices['101'].price;
  const calls = rpcCalls, before = db.discs;
  const r = await buyReq({ album_id: '101', name: 'Purple Rain', artist: 'Prince', expect: card - 1 });
  assert.equal(r.code, 409);
  assert.equal(r.body.price, card);
  assert.equal(rpcCalls, calls); assert.equal(db.discs, before);
  const ok = await buyReq({ album_id: '101', name: 'Purple Rain', artist: 'Prince', expect: card });
  assert.equal(ok.code, 200); assert.equal(before - db.discs, card);
});

await check('a second purchase of an owned record is refused and costs nothing', async () => {
  const before = db.discs;
  const r = await buyReq({ album_id: '101', name: 'Purple Rain', artist: 'Prince' });
  assert.equal(r.code, 400);
  assert.match(r.body.error, /already own/);
  assert.equal(db.discs, before);
});

await check('an Apple id nobody posted is named by Apple; a legacy id by the caller; no name is a real answer', async () => {
  const a = await priceReq([{ id: 'am777' }]);
  assert.ok(a.body.prices['am777'].price > 0);
  const r = await priceReq([{ id: 'legacyLegacyLegacy0001', name: 'Purple Rain', artist: 'Prince' }]);
  assert.ok(r.body.prices['legacyLegacyLegacy0001'].price > 0);
  const none = await priceReq([{ id: 'legacyLegacyLegacy0002' }]);
  assert.equal(none.body.prices['legacyLegacyLegacy0002'].transient, false, 'no name, no record: a real answer');
});

await check('signed-out callers are refused before anything is priced', async () => {
  const r = res();
  await buy({ method: 'POST', headers: {}, body: { album_id: '101' } }, r);
  assert.equal(r.code, 401);
  const r2 = res();
  await prices({ method: 'POST', headers: { authorization: 'Bearer bad' }, body: { albums: [{ id: '101' }] } }, r2);
  assert.equal(r2.code, 401);
});

await check('a record on a live Bid War board is neither priced nor sold by the till, and the seal fails closed', async () => {
  const before = db.discs, calls = rpcCalls;
  sealedIds = ['202'];
  const r = await buyReq({ album_id: '202', name: 'B', artist: 'B', expect: 1 });
  assert.equal(r.code, 409);
  assert.equal(r.body.reason, 'sealed');
  assert.equal(r.body.price, undefined, 'a sealed record must not leak its price');
  assert.ok(!/[0-9]{3}/.test(r.body.error), 'no number in the message either');
  sealedIds = []; sealedDown = true;
  const r2 = await buyReq({ album_id: '202', name: 'B', artist: 'B', expect: 1 });
  assert.equal(r2.code, 503);
  assert.equal(r2.body.price, undefined);
  sealedDown = false;
  assert.equal(rpcCalls, calls); assert.equal(db.discs, before);
});

console.log('collection selfcheck: ' + groups + ' groups passed');
