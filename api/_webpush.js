// Web Push, by hand, on Node's own crypto.
//
// There is no package.json in this repo and there is not going to be one for
// this: the `web-push` package is a wrapper around exactly two RFCs, and both
// fit in this file.
//
//   RFC 8292 (VAPID)       — a short ES256 JWT that says which server is
//                            sending, so the push service will accept it.
//   RFC 8291 (aes128gcm)   — the payload is encrypted to the browser's own
//                            key, so Apple / Google / Mozilla carry a message
//                            they cannot read.
//
// `node api/_webpush.selfcheck.mjs` decrypts what this encrypts, using the
// receiving half of the RFC, and checks the JWT verifies. If either breaks,
// every push silently 400s at the push service — so the check is the point.
//
// Keys: VAPID_PUBLIC_KEY (65-byte uncompressed P-256 point) and
// VAPID_PRIVATE_KEY (32-byte scalar), both base64url — what
// `node scripts/vapid-keys.mjs` prints. VAPID_SUBJECT is a mailto: or https:.

import crypto from 'node:crypto';

export const b64u = {
  enc: (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
};

export function generateVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u.enc(ecdh.getPublicKey()), privateKey: b64u.enc(ecdh.getPrivateKey()) };
}

function privateKeyObject(pub, priv) {
  const P = b64u.dec(pub);
  return crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: b64u.enc(b64u.dec(priv)), x: b64u.enc(P.subarray(1, 33)), y: b64u.enc(P.subarray(33, 65)) },
    format: 'jwk',
  });
}

// The VAPID header. `aud` is the push service's origin, never ours.
export function vapidAuth(endpoint, keys, subject, now = Date.now()) {
  const head = b64u.enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u.enc(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: subject || 'mailto:hello@vinall.xyz',
  }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body),
    { key: privateKeyObject(keys.publicKey, keys.privateKey), dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + head + '.' + body + '.' + b64u.enc(sig) + ', k=' + keys.publicKey;
}

// RFC 8291 §3.4 and RFC 8188: one record, so the whole payload plus its
// 0x02 "last record" delimiter is a single AES-128-GCM block run.
export function encrypt(payload, sub, _salt, _ephemeral) {
  const ua = b64u.dec(sub.keys.p256dh), authSecret = b64u.dec(sub.keys.auth);
  const ecdh = _ephemeral || crypto.createECDH('prime256v1');
  if (!_ephemeral) ecdh.generateKeys();
  const as = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(ua);
  const salt = _salt || crypto.randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([as.length]), as, ct]);
}

// Returns the push service's status: 201 sent, 404/410 the subscription is
// dead and should be deleted, anything else is somebody else's bad minute.
export async function sendPush(sub, data, keys, subject) {
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuth(sub.endpoint, keys, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body: encrypt(JSON.stringify(data), sub),
  });
  return r.status;
}
