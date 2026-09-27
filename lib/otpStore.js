// Since APITXT only delivers a code we hand it (it doesn't generate or
// verify OTPs itself), we own the whole lifecycle: generate a random code,
// store a salted hash of it with an expiry, and check submissions against
// that. Reuses APP_SESSION_SECRET as the HMAC key so there's no extra
// secret to configure.
const crypto = require('crypto');

const OTP_TTL_MS = 10 * 60 * 1000; // matches the "valid for 10 minutes" wording used in the OTP message
const RESEND_COOLDOWN_MS = 30 * 1000; // don't let someone spam the send endpoint (cost + abuse control)
const MAX_ATTEMPTS = 5;

function hashCode(phone, role, code) {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) throw new Error('APP_SESSION_SECRET is not set');
  return crypto.createHmac('sha256', secret).update(`${phone}:${role}:${code}`).digest('hex');
}

function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// Creates and stores a new OTP for phone+role, enforcing a resend cooldown.
// Returns the plaintext code so the caller can hand it to APITXT to deliver
// — it is never returned to the browser and never stored in plaintext.
async function createOtp(db, phone, role) {
  const { data: recent } = await db
    .from('otp_requests')
    .select('*')
    .eq('phone', phone)
    .eq('role', role)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent && !recent.consumed && new Date(recent.created_at).getTime() > Date.now() - RESEND_COOLDOWN_MS) {
    const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - new Date(recent.created_at).getTime())) / 1000);
    const err = new Error(`Please wait ${waitSeconds}s before requesting another OTP`);
    err.status = 429;
    throw err;
  }

  const code = generateCode();
  const { error } = await db.from('otp_requests').insert({
    phone,
    role,
    code_hash: hashCode(phone, role, code),
    expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    consumed: false,
    attempts: 0,
  });
  if (error) throw error;
  return code;
}

// Checks a submitted code against the most recent unconsumed OTP for
// phone+role. Returns true/false; marks the row consumed on success, or
// increments the attempt counter on failure (locks out after MAX_ATTEMPTS
// so the 6-digit code can't just be brute-forced).
async function verifyOtp(db, phone, role, submittedCode) {
  const { data: row } = await db
    .from('otp_requests')
    .select('*')
    .eq('phone', phone)
    .eq('role', role)
    .eq('consumed', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;
  if (row.attempts >= MAX_ATTEMPTS) return false;

  const expected = Buffer.from(hashCode(phone, role, submittedCode));
  const actual = Buffer.from(row.code_hash);
  const match = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (match) {
    await db.from('otp_requests').update({ consumed: true }).eq('id', row.id);
    return true;
  }
  await db.from('otp_requests').update({ attempts: row.attempts + 1 }).eq('id', row.id);
  return false;
}

module.exports = { createOtp, verifyOtp };
