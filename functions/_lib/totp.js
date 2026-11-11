// ==========================================
// 6-digit codes from an authenticator app (Google Authenticator etc.)
// Standard TOTP: HMAC-SHA1, 30-second steps.
// ==========================================

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newSecret() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let bits = '', out = '';
  bytes.forEach(b => { bits += b.toString(2).padStart(8, '0'); });
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out; // 32 characters
}

function decode(secret) {
  let bits = '';
  for (const c of secret.replace(/=+$/, '').toUpperCase()) {
    const v = B32.indexOf(c);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

async function codeAt(secret, step) {
  const key = await crypto.subtle.importKey('raw', decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new ArrayBuffer(8);
  new DataView(msg).setUint32(4, step);
  new DataView(msg).setUint32(0, Math.floor(step / 4294967296));
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}

// Returns the time step that matched (so it can't be reused), or -1.
// Allows one step either side for a phone clock that's slightly off.
export async function checkCode(secret, code, lastUsedStep) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return -1;
  const now = Math.floor(Date.now() / 30000);
  for (const step of [now - 1, now, now + 1]) {
    if (step <= (lastUsedStep || 0)) continue;
    if ((await codeAt(secret, step)) === code) return step;
  }
  return -1;
}

export function otpauthUrl(secret, label) {
  return 'otpauth://totp/' + encodeURIComponent(label || 'NASH Gnomie:Backstage') +
    '?secret=' + secret + '&issuer=' + encodeURIComponent('NASH Gnomie') + '&algorithm=SHA1&digits=6&period=30';
}

// For tests only
export { codeAt };
