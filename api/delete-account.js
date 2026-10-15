// /api/delete-account — permanently deletes the caller's account.
//
// Two halves. The rows this project owns are removed by delete_my_data(),
// which runs as the user. The auth.users row is not ours to write from SQL,
// so it goes through the Admin API with the service role — which is exactly
// why this is a server route and not a button that calls Supabase directly.
//
// Apple has required in-app account deletion since June 2022 for any app that
// lets you create an account, and GDPR requires it regardless of the store.
//
// Env: SUPABASE_SERVICE_ROLE_KEY, optional SUPABASE_URL.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cqfxyebejpkyhswolrwi.supabase.co';

import { cors } from './_cors.js';

async function removeAvatars(userId, service) {
  const headers = { apikey: service, Authorization: 'Bearer ' + service, 'Content-Type': 'application/json' };
  // Delete each page before listing again at offset zero. A fixed limit used
  // to leave files behind, and storage errors were incorrectly called success.
  for (let page = 0; page < 20; page++) {
    const list = await fetch(SUPABASE_URL + '/storage/v1/object/list/avatars', {
      method: 'POST', headers, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ prefix: userId + '/', limit: 100, offset: 0 }),
    });
    if (!list.ok) throw new Error('Avatar listing failed');
    const files = await list.json();
    if (!Array.isArray(files)) throw new Error('Invalid avatar listing');
    if (!files.length) return;
    const names = files.map(f => {
      if (!f || typeof f.name !== 'string' || !f.name || /[\\/]/.test(f.name) || f.name === '.' || f.name === '..') throw new Error('Invalid avatar file');
      return userId + '/' + f.name;
    });
    const del = await fetch(SUPABASE_URL + '/storage/v1/object/avatars', {
      method: 'DELETE', headers, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ prefixes: names }),
    });
    if (!del.ok) throw new Error('Avatar removal failed');
  }
  throw new Error('Avatar cleanup needs another attempt');
}

export default async function handler(req, res) {
  // Answers the preflight and stops. Must be first: the method checks below
  // would 405 an OPTIONS, and three of these routes have one.
  if (cors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE) { res.status(500).json({ error: 'Server not configured' }); return; }

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) { res.status(401).json({ error: 'Not signed in' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }

  // Moderation: delete a reported user's avatar FILES. admin_resolve already
  // clears avatar_url, but the object stays publicly reachable at its URL until
  // storage removes it, which only the service role can do. Rides this route
  // because it owns the avatar purge and Hobby allows twelve functions (trap 11).
  // is_admin() runs as the caller, so the database decides who is an admin.
  if (body && body.moderate === 'avatar') {
    const target = String(body.user || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target)) { res.status(400).json({ error: 'Bad user' }); return; }
    try {
      const a = await fetch(SUPABASE_URL + '/rest/v1/rpc/is_admin', {
        method: 'POST', headers: { apikey: SERVICE, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' }, body: '{}',
      });
      if (!a.ok || (await a.json()) !== true) { res.status(403).json({ error: 'Admins only' }); return; }
      await removeAvatars(target, SERVICE);
      res.status(200).json({ ok: true });
    } catch (e) { res.status(503).json({ error: 'Could not remove the avatar files' }); }
    return;
  }

  // Deleting an account is irreversible, so the request has to say so out
  // loud. A stray POST from anywhere else cannot wipe somebody by accident.
  if (!body || body.confirm !== 'DELETE') {
    res.status(400).json({ error: 'Deletion not confirmed' });
    return;
  }

  let userId = null;
  try {
    const u = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SERVICE, Authorization: 'Bearer ' + jwt },
    });
    if (!u.ok) { res.status(401).json({ error: 'Session expired — log in again' }); return; }
    const uj = await u.json();
    userId = uj && uj.id;
  } catch (e) { res.status(502).json({ error: 'Could not verify your session' }); return; }
  if (!userId) { res.status(401).json({ error: 'Not signed in' }); return; }

  try {
    // Storage first: retain the login and rows on failure so the person can
    // retry. Never report account deletion while a public avatar survives.
    try { await removeAvatars(userId, SERVICE); }
    catch (e) { res.status(503).json({ error: 'Could not remove your avatar files. Your account is still active; please try again.' }); return; }
    // Rows first, as the user, so RLS is still the thing deciding what may go.
    const purge = await fetch(SUPABASE_URL + '/rest/v1/rpc/delete_my_data', {
      method: 'POST',
      headers: { apikey: SERVICE, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!purge.ok) {
      const t = await purge.text();
      res.status(500).json({ error: 'Could not remove your data', detail: t.slice(0, 200) });
      return;
    }

    // Then the login itself, which needs the service role.
    const del = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + userId, {
      method: 'DELETE',
      headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE },
    });
    if (!del.ok) {
      const t = await del.text();
      // The data is already gone at this point, so say so rather than
      // pretending nothing happened.
      res.status(500).json({ error: 'Your data was deleted but the login could not be removed. Contact support.', detail: t.slice(0, 200) });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Deletion failed: ' + String((e && e.message) || e) });
  }
}
