// Minimal signed-session tokens. No external JWT library needed — just an
// HMAC-SHA256 signature over a base64url JSON payload, verified on every
// protected request. Session lives in an httpOnly cookie so client JS never
// touches the token directly.
const crypto = require('crypto');

const SECRET = process.env.APP_SESSION_SECRET;
const COOKIE_NAME = 'mr_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadObj) {
  if (!SECRET) throw new Error('APP_SESSION_SECRET is not set');
  const body = b64url(JSON.stringify(payloadObj));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!SECRET || !token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// Creates a session for {sub, role, phone, name?} and returns a Set-Cookie value.
function createSessionCookie({ sub, role, phone, name }) {
  const exp = Date.now() + MAX_AGE_SECONDS * 1000;
  const token = sign({ sub, role, phone, name: name || null, exp });
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${MAX_AGE_SECONDS}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ];
  return parts.join('; ');
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

// Reads + verifies the session from a Vercel Node request. Returns the
// session payload ({sub, role, phone, name}) or null.
function getSession(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  return verify(token);
}

// Throws-free auth guard for handlers: returns the session if role matches
// (or if role is an array of allowed roles), otherwise null.
function requireRole(req, role) {
  const session = getSession(req);
  if (!session) return null;
  const roles = Array.isArray(role) ? role : [role];
  if (!roles.includes(session.role)) return null;
  return session;
}

module.exports = {
  COOKIE_NAME,
  createSessionCookie,
  clearSessionCookie,
  getSession,
  requireRole,
};
