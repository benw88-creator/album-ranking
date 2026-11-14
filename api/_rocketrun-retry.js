import { createHmac, timingSafeEqual } from 'node:crypto';
const sign = (text, key) => createHmac('sha256', key).update('rocketrun-answer:' + text).digest('base64url');
// This receipt can only retry the SAME answer that arrived before the deadline.
// It cannot extend the clock to research or submit a different answer.
export function answerReceipt(fields, key) {
  const text = Buffer.from(JSON.stringify(fields)).toString('base64url');
  return text + '.' + sign(text, key);
}
export function receiptArrival(token, expected, key, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 1500) return null;
  try {
    const [text, mac, extra] = token.split('.');
    if (extra || !mac) return null;
    const got = Buffer.from(mac, 'base64url'), want = Buffer.from(sign(text, key), 'base64url');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    const f = JSON.parse(Buffer.from(text, 'base64url'));
    if (!Object.keys(expected).every(k => f[k] === expected[k])) return null;
    const at = Date.parse(f.at);
    return Number.isFinite(at) && at <= now && now - at <= 90000 ? f.at : null;
  } catch { return null; }
}
