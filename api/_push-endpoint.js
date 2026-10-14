// Keep in sync with public.is_push_endpoint() in the launch migration.
// A subscription is client input, never permission to POST to an arbitrary URL.
export function pushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 1000 || /[\s#]/.test(value)) throw new Error('Invalid push endpoint');
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.port) throw new Error('Invalid push endpoint');
  const valid = (u.hostname === 'fcm.googleapis.com' && /^\/(fcm\/send|wp)\/[^/]+/.test(u.pathname)) ||
    (u.hostname === 'updates.push.services.mozilla.com' && /^\/wpush\/v[12]\/[^/]+/.test(u.pathname)) ||
    (u.hostname === 'web.push.apple.com' && u.pathname.length > 1) ||
    /^wns[0-9]+-[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname);
  if (!valid) throw new Error('Unsupported push endpoint');
  return u.href;
}
