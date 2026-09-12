// Market valuation for Bid Wars: what a copy of the record actually costs.
//
// Not a route (the leading underscore keeps Vercel from serving it). Imported
// by bid-war-create.js and by album-market.js, so the number that decides a
// market war is the same number you can query and check — the same arrangement
// _streams.js has with album-streams.js, for the same reason.
//
// Why Discogs rather than a ratings site: AOTY, RateYourMusic and Metacritic
// have no public API at all, sit behind bot protection, and their scores are
// aggregated third-party critic content. Discogs publishes a documented API
// with a token, rate-limit headers and a 429 when you cross the line. That is a
// contract. kworb is a scrape, and one scrape is enough for any app.
//
// Why price rather than the Discogs rating: `community.rating.average` clusters
// between about 3.7 and 4.6 because collectors rate everything highly, so as a
// war value it is flat and unplayable. `lowest_price` has real spread — a £2
// common pressing against a £180 original is a gap worth bidding across — and
// in a game called Bid Wars, inside an app named after vinyl, what the record
// is worth to buy is the value that belongs there.
//
// Env: DISCOGS_TOKEN (a personal access token from Discogs → Settings →
// Developers; generated instantly, no OAuth flow needed).

import { normTitle } from './_streams.js';

// Discogs rejects any request without a User-Agent. This is the single most
// common first failure and it returns a 403 that looks like an auth problem.
const UA = 'VINALL/1.0 +https://wildcrate.xyz';

const API = 'https://api.discogs.com';

function auth(token) {
  return { 'User-Agent': UA, Authorization: 'Discogs token=' + token };
}

async function dg(path, token) {
  const r = await fetch(API + path, { headers: auth(token) });
  if (r.status === 429) return { rateLimited: true };
  if (!r.ok) return null;
  try { return await r.json(); } catch (e) { return null; }
}

// Spotify album -> Discogs master. Titles disagree about pressings, reissues
// and punctuation constantly, so the candidate is only accepted if its
// normalised title matches -- the same test the stream valuation applies to
// track names.
export async function findMaster(name, artist, token) {
  const qs = new URLSearchParams({
    type: 'master',
    release_title: name,
    artist: artist || '',
    per_page: '5',
  });
  const d = await dg('/database/search?' + qs.toString(), token);
  if (!d || d.rateLimited) return d && d.rateLimited ? { rateLimited: true } : null;
  const want = normTitle(name);
  const hits = (d.results || []).filter(function (r) { return r && r.master_id; });
  for (const h of hits) {
    // Search results give "Artist - Title"; compare only the title half.
    const t = String(h.title || '');
    const tail = t.indexOf(' - ') >= 0 ? t.slice(t.indexOf(' - ') + 3) : t;
    if (normTitle(tail) === want) return h.master_id;
  }
  return null;
}

/* Community stats live on a RELEASE, not on a master -- a master returns no
   `community` object at all, which is a good half hour to lose. So: master,
   then its main_release, then the stats.

   Those stats are per-pressing, which means a famous album's ratings and
   have/want counts are fragmented across every version of it. Aggregating all
   of them would be one request per version. We take the main release as a
   proxy instead, and that is fine here: a war value does not have to be
   accurate, it has to be identical for both players and unguessable. Nobody
   knows what the "true" market price of an album is, so a consistent proxy is
   a perfectly good hidden number -- which was never true of stream totals,
   where a wrong figure looks like a bug. */
/* Score mode: the album's standing out of 100, weighted by how many people
   said so.

   The obvious version — `community.rating.average * 20` — does not work as a
   game. Collectors rate almost everything between 3.7 and 4.6, so every album
   scores 74 to 92 and five of them land within a few points of each other.
   There is nothing to read and nothing to bid on.

   So the rating is weighted by its own sample size. A 4.6 from three thousand
   people is a real consensus; a 4.8 from twelve is three enthusiasts. The
   weight is log-scaled, because the difference between 10 and 100 ratings
   matters far more than between 3,000 and 3,100, and it pulls a thinly-rated
   album toward the middle rather than toward zero — being obscure should cost
   you some standing, not all of it.

     score = 50 + (avg*20 - 50) * w,  w = min(1, ln(1+count) / ln(1+3000))

   A famous, well-loved record lands near 90; a famous, divisive one near 70;
   an obscure one with four ratings sits near 60 whatever those four said. That
   is a 30-point spread across a board, which is a game. */
export function scoreFromCommunity(avg, count) {
  const a = Number(avg) || 0;
  const n = Math.max(0, Number(count) || 0);
  if (!a) return null;
  const raw = a * 20;                                   // /5 → /100
  const w = Math.min(1, Math.log(1 + n) / Math.log(1 + 3000));
  return Math.max(1, Math.round(50 + (raw - 50) * w));
}

export async function valueMarket(name, artist, token) {
  const masterId = await findMaster(name, artist, token);
  if (!masterId) return { ok: false, reason: 'no-discogs-match' };
  if (masterId.rateLimited) return { ok: false, reason: 'rate-limited' };

  const master = await dg('/masters/' + masterId, token);
  if (!master || master.rateLimited) return { ok: false, reason: master ? 'rate-limited' : 'no-master' };

  const releaseId = master.main_release;
  if (!releaseId) return { ok: false, reason: 'no-main-release' };

  const rel = await dg('/releases/' + releaseId, token);
  if (!rel || rel.rateLimited) return { ok: false, reason: rel ? 'rate-limited' : 'no-release' };

  const c = rel.community || {};
  const price = rel.lowest_price;
  const score = scoreFromCommunity(c.rating && c.rating.average, c.rating && c.rating.count);

  /* A record with no rating cannot be scored, and score is what a war is
     valued by now. Rejected rather than valued at zero — a zero is an answer
     and a wrong one, the same rule the stream valuation follows. Price is
     still returned when there is one, but it is no longer what decides a war,
     so its absence is not fatal. */
  if (score == null) {
    return {
      ok: false, reason: 'no-rating',
      album: rel.title, artist: (rel.artists_sort || artist),
      have: c.have || 0, want: c.want || 0,
    };
  }

  return {
    ok: true,
    reason: null,
    // What a score-mode war is worth: standing out of 100.
    score: score,
    album: rel.title,
    artist: rel.artists_sort || artist,
    release_id: String(releaseId),
    master_id: String(masterId),
    // Minor units, because bid_war_values.value is bigint and £2.19 would
    // otherwise truncate to 2. Kept for the diagnostic endpoint; no longer
    // what a war is valued by.
    price_minor: price == null ? null : Math.round(Number(price) * 100),
    price: price == null ? null : Number(price),
    currency: rel.lowest_price_currency || 'USD',
    for_sale: rel.num_for_sale || 0,
    have: c.have || 0,
    want: c.want || 0,
    rating_avg: (c.rating && c.rating.average) || null,
    rating_count: (c.rating && c.rating.count) || 0,
  };
}

export function discogsToken() {
  return process.env.DISCOGS_TOKEN || null;
}
