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

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE) { res.status(500).json({ error: 'Server not configured' }); return; }

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) { res.status(401).json({ error: 'Not signed in' }); return; }

  // Deleting an account is irreversible, so the request has to say so out
  // loud. A stray POST from anywhere else cannot wipe somebody by accident.
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
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

    // The avatar file. delete_my_data() only clears rows, so before this the
    // uploaded image outlived the account it belonged to — a photo, under
    // Apple's own data types, sitting in a public bucket with nobody left to
    // remove it. Files live at "<user id>/avatar.<ext>", so the whole folder
    // goes. Best-effort: a storage hiccup must not strand a half-deleted
    // account, and the rows are already gone by here.
    try {
      const ls = await fetch(SUPABASE_URL + '/storage/v1/object/list/avatars', {
        method: 'POST',
        headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: userId + '/', limit: 100 }),
      });
      if (ls.ok) {
        const files = await ls.json();
        const names = (Array.isArray(files) ? files : [])
          .map((f) => f && f.name).filter(Boolean)
          .map((n) => userId + '/' + n);
        if (names.length) {
          await fetch(SUPABASE_URL + '/storage/v1/object/avatars', {
            method: 'DELETE',
            headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefixes: names }),
          });
        }
      }
    } catch (e) { /* the account still goes */ }

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
