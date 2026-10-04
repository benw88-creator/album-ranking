// /api/push — turns a notification row into a push on every device its
// recipient has switched them on for.
//
// GET  → { key } the VAPID public key, which the browser needs to subscribe.
// POST → { table: 'notifications' | 'messages', id } from the database
//        trigger (..._20261004100000_push.sql), which fires on every insert.
//
// THERE IS NO SHARED SECRET, AND THAT IS DELIBERATE. The route takes an id and
// nothing else, then reads the row itself with the service role. It sends only
// a row that exists, is under ten minutes old, and has not been pushed — and it
// claims the row (pushed_at) in the same UPDATE that reads it, so a replay or a
// retry finds it already claimed. Somebody calling this by hand can at most
// deliver a real notification to its real recipient a few seconds early. A
// secret would have to live in two places (Vercel and a database table) and
// would be the thing that silently stopped matching.
//
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
//      SUPABASE_SERVICE_ROLE_KEY, optional SUPABASE_URL.

import { cors } from './_cors.js';
import { sendPush } from './_webpush.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cqfxyebejpkyhswolrwi.supabase.co';
const FRESH_MS = 10 * 60 * 1000;

function sb(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...opts,
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) },
  });
}

// What the lock screen says. Plain text: a push has no HTML.
export function compose(n) {
  const d = n.data || {}, who = d.username || 'Someone';
  const it = d.item || {};
  const album = d.item || d.album || {};
  const albumUrl = album.id ? '/?album=' + encodeURIComponent(album.id) + '&n=' + encodeURIComponent(album.name || '') + '&ar=' + encodeURIComponent(album.artist || '') : '/';
  switch (n.type) {
    case 'follow': return { title: who + ' followed you', url: '/?u=' + encodeURIComponent(n.actor_id || '') };
    case 'suggestion': return { title: who + ' recommended ' + (it.name || 'something'), body: it.artist || '', url: '/' };
    case 'groove_invite': return { title: who + ' invited you to a Groove', body: d.groove_name || '', url: '/' };
    case 'rated_too': return {
      title: who + ' gave ' + (album.name || 'a record') + ' ' + d.score,
      body: d.yours != null ? 'You gave it ' + d.yours + '.' : (album.artist || ''),
      url: albumUrl + '#reviews', image: album.art || undefined };
    case 'review_like': return { title: who + ' liked your review', body: album.name ? album.name + (album.artist ? ' · ' + album.artist : '') : '', url: albumUrl + '#reviews' };
    case 'blitz_challenge': return { title: who + ' challenged you to Cover Fire', url: '/' };
    case 'blitz_turn': return { title: who + ' scored ' + (d.score || 0) + ' in Cover Fire', body: 'Your go.', url: '/' };
    case 'blitz_result': return { title: d.outcome === 'won' ? 'You beat ' + who + ' at Cover Fire' : d.outcome === 'lost' ? who + ' beat you at Cover Fire' : 'You and ' + who + ' tied at Cover Fire', url: '/' };
    case 'bid_war_challenge': return { title: who + ' challenged you to a Bid War', url: '/' };
    case 'bid_war_turn': return { title: who + ' has bid', body: 'Your move.', url: '/' };
    case 'bid_war_result': return { title: d.outcome === 'won' ? 'You won your Bid War with ' + who : d.outcome === 'lost' ? who + ' won your Bid War' : 'Your Bid War with ' + who + ' ended level', url: '/' };
    default: return { title: who + ' — something new on VINALL', url: '/' };
  }
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    res.status(keys.publicKey ? 200 : 503).json({ key: keys.publicKey || null });
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'GET or POST' }); return; }
  if (!keys.publicKey || !keys.privateKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) { res.status(503).json({ error: 'push not configured' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const table = body && body.table, id = body && String(body.id || '');
  if (!/^(notifications|messages)$/.test(table || '') || !/^[\w-]{1,64}$/.test(id)) { res.status(400).json({ error: 'bad request' }); return; }

  // Claim it: one UPDATE that only matches an unpushed row.
  const since = new Date(Date.now() - FRESH_MS).toISOString();
  const claim = await sb(table + '?id=eq.' + encodeURIComponent(id) + '&pushed_at=is.null&created_at=gte.' + encodeURIComponent(since),
    { method: 'PATCH', body: JSON.stringify({ pushed_at: new Date().toISOString() }) });
  const rows = claim.ok ? await claim.json() : [];
  const row = rows && rows[0];
  if (!row) { res.status(200).json({ sent: 0, why: 'not found, stale or already pushed' }); return; }

  let to, msg;
  if (table === 'messages') {
    to = row.recipient_id;
    const p = await sb('profiles?select=username&id=eq.' + row.sender_id).then(r => r.ok ? r.json() : []);
    const who = (p[0] && p[0].username) || 'Someone';
    msg = { title: who, body: String(row.body || '').slice(0, 140), url: '/?dm=' + row.sender_id, tag: 'dm-' + row.sender_id };
  } else {
    to = row.user_id;
    msg = compose(row);
    msg.tag = 'n-' + row.id;
  }

  const subs = await sb('push_subscriptions?select=endpoint,p256dh,auth&user_id=eq.' + to).then(r => r.ok ? r.json() : []);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const st = await sendPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, msg, keys, process.env.VAPID_SUBJECT);
      if (st === 404 || st === 410) await sb('push_subscriptions?endpoint=eq.' + encodeURIComponent(s.endpoint), { method: 'DELETE' });
      else if (st >= 200 && st < 300) sent++;
    } catch (e) { /* one dead device is not a failed push */ }
  }));
  res.status(200).json({ sent });
}
