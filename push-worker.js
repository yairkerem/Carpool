/**
 * Carpool push relay  —  a Cloudflare Worker
 *
 * Apps Script cannot send a web push. The protocol needs a VAPID token signed
 * with ECDSA P-256 and a payload encrypted through an ECDH key agreement, and
 * Apps Script has neither primitive — it can do HMAC and RSA and stops there.
 * So the backend decides *who* to tell and *what*, and this does the twenty
 * lines of cryptography it cannot, then posts to the push service.
 *
 * It holds no data. Subscriptions live in the spreadsheet with the parent they
 * belong to; this is a pipe.
 *
 * ── deploying ────────────────────────────────────────────────────────────
 *   1. dash.cloudflare.com → Workers & Pages → Create → Worker. Paste this
 *      file over the sample, Deploy.
 *   2. Settings → Variables and Secrets, add three SECRETS (not plain text
 *      variables — a secret is not readable again once saved):
 *        VAPID_JWK       the private key JSON  {"kty":"EC","crv":"P-256",...}
 *        VAPID_SUBJECT   mailto:you@example.com
 *        RELAY_SECRET    a long random string, also put in Script Properties
 *   3. Copy the worker's URL into the Script Property PUSH_RELAY.
 *
 * A GET returns "carpool push relay" so you can see it is alive. Everything
 * else is a POST from the backend and needs RELAY_SECRET.
 *
 * ── the request ──────────────────────────────────────────────────────────
 *   { auth, messages: [ { subscription:{endpoint,keys:{p256dh,auth}},
 *                         title, body, tag, url } ] }
 * and the reply is one result per message, in order:
 *   { ok, results: [ { status, gone } ] }
 * `gone` means the push service has forgotten this subscription — the phone
 * was reset, or the app removed. The backend clears those rows out.
 */

export default {
  async fetch(request, env) {
    if (request.method === 'GET') {
      return new Response('carpool push relay', {
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }
    if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405);

    let body;
    try { body = await request.json(); }
    catch (err) { return json({ ok: false, error: 'bad json' }, 400); }

    /* Constant-time-ish and, more importantly, present. Without this anybody
       who finds the URL can send notifications to this group's parents. */
    if (!env.RELAY_SECRET || !safeEqual(String(body.auth || ''), env.RELAY_SECRET)) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }

    const messages = Array.isArray(body.messages) ? body.messages.slice(0, 500) : [];
    const results = [];
    for (const m of messages) {
      try {
        results.push(await sendOne(m, env));
      } catch (err) {
        /* One bad subscription must not stop the rest of the group being told. */
        results.push({ status: 0, gone: false, error: String(err && err.message || err) });
      }
    }
    return json({ ok: true, results });
  }
};

async function sendOne(message, env) {
  const sub = message.subscription || {};
  const endpoint = String(sub.endpoint || '');
  if (!endpoint) return { status: 0, gone: true, error: 'no endpoint' };

  const payload = JSON.stringify({
    title: String(message.title || 'הסעות'),
    body: String(message.body || ''),
    tag: String(message.tag || ''),
    url: String(message.url || '/')
  });

  const encrypted = await encrypt(payload, sub.keys.p256dh, sub.keys.auth);
  const jwt = await vapidToken(endpoint, env);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': 'vapid t=' + jwt + ', k=' + env.VAPID_PUBLIC,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Urgency': 'normal'
    },
    body: encrypted
  });

  /* 404 and 410 are the push service saying this subscription no longer
     exists. Anything else — including a 5xx — might work next time and is not
     grounds for throwing a parent's subscription away. */
  return { status: res.status, gone: res.status === 404 || res.status === 410 };
}

/* ── RFC 8291 (web push encryption) over RFC 8188 (aes128gcm) ───────────── */
async function encrypt(plaintextString, p256dhB64, authB64) {
  const uaPublic = b64uToBytes(p256dhB64);
  const authSecret = b64uToBytes(authB64);

  /* A fresh key pair per message. Reusing one would let anyone who ever saw a
     payload work out the others. */
  const as = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));

  const uaKey = await crypto.subtle.importKey(
    'raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaKey }, as.privateKey, 256));

  /* "WebPush: info" || 0x00 || ua_public || as_public — the order matters and
     is the receiver's first, which is easy to get backwards. */
  const authInfo = concat(utf8('WebPush: info'), Uint8Array.of(0), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, authInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, concat(utf8('Content-Encoding: aes128gcm'), Uint8Array.of(0)), 16);
  const nonce = await hkdf(salt, ikm, concat(utf8('Content-Encoding: nonce'), Uint8Array.of(0)), 12);

  /* 0x02 is the delimiter that says "last record". One record is all we ever
     send: these payloads are a line of Hebrew, not a file. */
  const padded = concat(utf8(plaintextString), Uint8Array.of(2));
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, padded));

  /* salt(16) | record size(4) | key id length(1) | key id(65) | ciphertext */
  const header = concat(salt, be32(4096), Uint8Array.of(asPublic.length), asPublic);
  return concat(header, ciphertext);
}

/* ── RFC 8292 (VAPID) ──────────────────────────────────────────────────── */
async function vapidToken(endpoint, env) {
  const jwk = JSON.parse(env.VAPID_JWK);
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const head = bytesToB64u(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  /* Twelve hours, not twenty-four: the spec's ceiling is a day, and a token
     minted right on the boundary of a clock that is a little fast is refused. */
  const claims = bytesToB64u(utf8(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: env.VAPID_SUBJECT || 'mailto:carpool@example.com'
  })));

  const input = head + '.' + claims;
  /* WebCrypto returns r||s, which is exactly what JWS ES256 wants — no DER
     unwrapping, unlike most other ECDSA APIs. */
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, utf8(input)));
  return input + '.' + bytesToB64u(sig);
}

/* ── small helpers ─────────────────────────────────────────────────────── */
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt, info: info }, key, length * 8));
}

function utf8(s) { return new TextEncoder().encode(s); }

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function be32(n) {
  return Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}

function b64uToBytes(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  t += '='.repeat((4 - (t.length % 4)) % 4);
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64u(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
