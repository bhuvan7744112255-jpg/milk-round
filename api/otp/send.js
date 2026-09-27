const { sendOtpSms } = require('../../lib/apitxt');
const { createOtp } = require('../../lib/otpStore');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { ok, badRequest, serverError } = require('../../lib/util');

function isAdminPhone(phone) {
  const list = (process.env.ADMIN_PHONES || '')
    .split(',')
    .map((p) => p.replace(/\D/g, '').slice(-10))
    .filter(Boolean);
  const digits = String(phone).replace(/\D/g, '').slice(-10);
  return list.includes(digits);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return badRequest(res, 'POST only');
  const { phone, role } = req.body || {};
  if (!phone || !['customer', 'partner', 'admin'].includes(role)) {
    return badRequest(res, 'phone and a valid role are required');
  }
  if (role === 'admin' && !isAdminPhone(phone)) {
    return res.status(403).json({ error: 'This number is not authorized for admin access.' });
  }
  try {
    const db = supabaseAdmin();
    const code = await createOtp(db, phone, role);
    await sendOtpSms(phone, code);
    return ok(res, { sent: true });
  } catch (err) {
    if (err.status === 429) return res.status(429).json({ error: err.message });
    return serverError(res, err);
  }
};
