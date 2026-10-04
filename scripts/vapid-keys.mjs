// node scripts/vapid-keys.mjs — prints a fresh VAPID key pair for push.
// Paste both into Vercel → Settings → Environment Variables, plus
// VAPID_SUBJECT=mailto:<a real address>. Generate ONCE: a new pair
// invalidates every existing subscription.
import { generateVapidKeys } from '../api/_webpush.js';
const k = generateVapidKeys();
console.log('VAPID_PUBLIC_KEY=' + k.publicKey);
console.log('VAPID_PRIVATE_KEY=' + k.privateKey);
