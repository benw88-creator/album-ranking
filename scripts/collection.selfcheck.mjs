// The Collection's price and till, end to end in-process. Every request is
// intercepted: Deezer, Wikidata, MusicBrainz and kworb answer from fixtures,
// and Supabase is a small in-memory stand-in (auth, album_plays, crate_feed,
// my_sealed_albums and collection_buy_from with its real refusals). Never
// loads production credentials.
import assert from 'node:assert/strict';
import buy from '../api/collection-buy.js';
import prices from '../api/collection-prices.js';
import { normTitle } from '../api/_streams.js';

process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-test-service-key';
const J = (d, status = 200) => new Response(JSON.stringify(d), { status });
const res = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(j) { this.body = j; return this; }, end() {} });
let groups = 0;
const check = async (name, fn) => { await fn(); groups++; console.log('ok — ' + name); };

/* ---- the world ---- */
const SP = { A: 'AAAAAAAAAAAAAAAAAAAAAA', B: 'BBBBBBBBBBBBBBBBBBBBBB', C: 'CCCCCCCCCCCCCCCCCCCCCC', D: 'DDDDDDDDDDDDDDDDDDDDDD' };
const ALBUMS = {
  // Prince-shaped: kworb names every track "X - 2015 Paisley Park Remaster".
  101: { title: 'Purple Rain', artist: { id: 1, name: 'Prince' }, tracks: ['Let\'s Go Crazy', 'Take Me with U', 'The Beautiful Ones', 'Computer Blue', 'Darling Nikki', 'When Doves Cry', 'I Would Die 4 U', 'Baby I\'m a Star', 'Purple Rain'] },
  // Only on MusicBrainz, never Wikidata — the Malcolm Todd case.
  202: { title: 'Demos Before Prom', artist: { id: 2, name: 'Malcolm Todd' }, tracks: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'] },
  // A real "too few tracks matched".
  303: { title: 'Rarities', artist: { id: 3, name: 'Deep Cut' }, tracks: ['Hit', 'B1', 'B2', 'B3', 'B4', 'B5'] },
  404: { title: 'Stale One', artist: { id: 4, name: 'Old Hand' }, tracks: ['S1', 'S2', 'S3', 'S4'] },
};
const KWORB = {
  [SP.A]: ALBUMS[101].tracks.map((t, i) => [t + ' - 2015 Paisley Park Remaster', 100000000 - i * 1000]),
  [SP.B]: ALBUMS[202].tracks.map((t) => [t, 20000000]),
  [SP.C]: [['Hit', 900000000]],
  [SP.D]: ALBUMS[404].tracks.map((t) => [t, 50000000]),
};
let mbDown = false, kworbDown = false, rpcCalls = 0, sealedIds = [], sealedDown = false;
const db = { plays: {}, owned: {}, discs: 10000000, rated: new Set(['101', '202', '303', '404', 'legacyLegacyLegacy0001']) };
const USER = 'u-1';

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (u.pathname === '/auth/v1/user') return (opts.headers.Authorization === 'Bearer good') ? J({ id: USER }) : J({}, 401);
  if (u.pathname === '/rest/v1/rpc/my_sealed_albums') return sealedDown ? J({}, 500) : J(sealedIds.map((id) => ({ album_id: id })));
  if (u.pathname === '/rest/v1/crate_feed') return J([]);   // never posted: a private rating
  if (u.pathname === '/rest/v1/album_plays') {
    if (opts.method === 'POST') { body.forEach((r) => { db.plays[r.album_id] = r; }); return J({}, 201); }
    const id = decodeURIComponent((u.searchParams.get('album_id') || '').replace(/^eq\./, ''));
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
  if (u.hostname === 'api.deezer.com') {
    const m = u.pathname.match(/^\/album\/(\d+)$/);
    if (m) {
      const a = ALBUMS[m[1]]; if (!a) return J({ error: { code: 800, message: 'no data' } });
      return J({ id: +m[1], title: a.title, artist: a.artist, tracks: { data: a.tracks.map((t) => ({ title: t, title_short: t })) } });
    }
    if (u.pathname === '/search/album') {
      const q = u.searchParams.get('q');
      const hit = Object.entries(ALBUMS).find(([, a]) => q.includes(a.title));
      return J({ data: hit ? [{ id: +hit[0], title: hit[1].title, artist: hit[1].artist }] : [] });
    }
  }
  if (u.hostname === 'query.wikidata.org') {
    const id = (u.searchParams.get('query').match(/P2722 "(\d+)"/) || [])[1];
    const map = { 1: SP.A, 3: SP.C, 4: SP.D };
    return J({ results: { bindings: map[id] ? [{ sp: { value: map[id] } }] : [] } });
  }
  if (u.hostname === 'musicbrainz.org') {
    if (mbDown) return new Response('slow down', { status: 503 });
    if (u.pathname === '/ws/2/url') return J({ relations: [{ artist: { id: 'mb-todd' } }] });
    return J({ relations: [{ url: { resource: 'https://open.spotify.com/artist/' + SP.B } }] });
  }
  if (u.hostname === 'kworb.net') {
    if (kworbDown) return new Response('', { status: 502 });
    const id = u.pathname.match(/artist\/(\w+)_songs/)[1];
    const rows = KWORB[id]; if (!rows) return new Response('', { status: 404 });
    return new Response(rows.map(([t, n]) => '<tr><td class="text"><div><a href="x">' + t + '</a></div></td><td>' + n.toLocaleString('en-US') + '</td><td>1</td></tr>').join('\n'));
  }
  throw new Error('unexpected request ' + url);
};

const priceReq = async (albums) => { const r = res(); await prices({ method: 'POST', headers: { authorization: 'Bearer good' }, body: { albums } }, r); return r; };
const buyReq = async (b) => { const r = res(); await buy({ method: 'POST', headers: { authorization: 'Bearer good' }, body: b }, r); return r; };

await check('kworb version tails after a spaced dash still match the track', async () => {
  assert.equal(normTitle('When Doves Cry - 2015 Paisley Park Remaster'), normTitle('When Doves Cry'));
  assert.equal(normTitle('Dreams - 2004 Remaster'), 'dreams');
  assert.equal(normTitle('Self Control'), 'selfcontrol');
  const r = await priceReq([{ id: '101' }]);
  assert.equal(r.code, 200);
  assert.ok(r.body.prices['101'].price > 0, 'Purple Rain prices');
});

await check('a failed artist lookup is "not just now", is not remembered, and prices once the service answers', async () => {
  mbDown = true;
  const r1 = await priceReq([{ id: '202' }]);
  assert.equal(r1.body.prices['202'].price, null);
  assert.equal(r1.body.prices['202'].transient, true);
  assert.equal(db.plays['202'], undefined, 'nothing cached for a failure');
  mbDown = false;
  const r2 = await priceReq([{ id: '202' }]);
  assert.ok(r2.body.prices['202'].price > 0, 'priced on the retry, not stuck as unpriceable');
});

await check('a real "too few tracks" is permanent and not transient', async () => {
  const r = await priceReq([{ id: '303' }]);
  assert.equal(r.body.prices['303'].price, null);
  assert.equal(r.body.prices['303'].transient, false);
  assert.equal(r.body.prices['303'].reason, 'too-few-matched');
});

await check('an outage falls back to the last valuation, at the same price at the card and the till', async () => {
  db.plays['404'] = { album_id: '404', plays: 300000000, source: 'kworb', fetched_at: new Date(Date.now() - 40 * 86400000).toISOString() };
  kworbDown = true;
  const card = (await priceReq([{ id: '404' }])).body.prices['404'].price;
  assert.equal(card, 1200);
  const before = db.discs;
  const r = await buyReq({ album_id: '404', name: 'Stale One', artist: 'Old Hand', expect: card });
  assert.equal(r.code, 200);
  assert.equal(r.body.price, card);
  assert.equal(before - db.discs, card);
  kworbDown = false;
});

await check('the till charges nothing when pricing fails, and says why', async () => {
  mbDown = true; kworbDown = true;
  delete db.plays['202'];
  const calls = rpcCalls, before = db.discs;
  // A fresh artist so the in-process cache cannot answer for it.
  ALBUMS[505] = { title: 'Unreachable', artist: { id: 5, name: 'Nobody' }, tracks: ['a', 'b', 'c', 'd'] };
  db.rated.add('505');
  const r = await buyReq({ album_id: '505', name: 'Unreachable', artist: 'Nobody', expect: 500 });
  assert.equal(r.code, 503);
  assert.match(r.body.error, /nothing was charged/);
  assert.equal(rpcCalls, calls, 'no purchase function called');
  assert.equal(db.discs, before);
  mbDown = false; kworbDown = false;
  const r2 = await buyReq({ album_id: '303', name: 'Rarities', artist: 'Deep Cut' });
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

await check('a legacy id nobody posted is valued from the caller\'s name', async () => {
  const r = await priceReq([{ id: 'legacyLegacyLegacy0001', name: 'Purple Rain', artist: 'Prince' }]);
  assert.ok(r.body.prices['legacyLegacyLegacy0001'].price > 0);
  const legacyOld = await priceReq([{ id: 'legacyLegacyLegacy0002' }]);
  assert.equal(legacyOld.body.prices['legacyLegacyLegacy0002'].transient, false, 'no name, no record: a real answer');
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
