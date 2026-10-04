// node api/_webpush.selfcheck.mjs — decrypts what _webpush.js encrypts, as a
// browser would (RFC 8291 receiving side), and verifies the VAPID signature.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { b64u, encrypt, vapidAuth, generateVapidKeys } from './_webpush.js';

// A fake browser subscription.
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const authSecret = crypto.randomBytes(16);
const sub = { endpoint: 'https://push.example.net/abc', keys: { p256dh: b64u.enc(ua.getPublicKey()), auth: b64u.enc(authSecret) } };

const msg = JSON.stringify({ title: 'charlie gave IGOR 94', body: 'You gave it 71' });
const blob = encrypt(msg, sub);

// Receive.
const salt = blob.subarray(0, 16), rs = blob.readUInt32BE(16), idlen = blob[20];
const as = blob.subarray(21, 21 + idlen), ct = blob.subarray(21 + idlen);
assert.equal(rs, 4096); assert.equal(idlen, 65);
const shared = ua.computeSecret(as);
const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), as]);
const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
d.setAuthTag(ct.subarray(ct.length - 16));
const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
assert.equal(plain[plain.length - 1], 2);                 // last-record delimiter
assert.equal(plain.subarray(0, -1).toString(), msg);

// RFC 8291 Appendix A, byte for byte: the published test vector.
const eph = crypto.createECDH('prime256v1'); eph.setPrivateKey(b64u.dec('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'));
assert.equal(b64u.enc(encrypt('When I grow up, I want to be a watermelon',
  { keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } },
  b64u.dec('DGv6ra1nlYgDCS1FRnbzlw'), eph)),
  'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');

// VAPID: the JWT verifies against the public key it advertises.
const keys = generateVapidKeys();
const h = vapidAuth(sub.endpoint, keys, 'mailto:x@y.z');
const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(h);
assert.equal(k, keys.publicKey);
const [hd, bd, sg] = jwt.split('.');
const P = b64u.dec(keys.publicKey);
const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u.enc(P.subarray(1, 33)), y: b64u.enc(P.subarray(33)) }, format: 'jwk' });
assert.ok(crypto.verify('sha256', Buffer.from(hd + '.' + bd), { key: pub, dsaEncoding: 'ieee-p1363' }, b64u.dec(sg)));
assert.equal(JSON.parse(b64u.dec(bd)).aud, 'https://push.example.net');

console.log('ok');
