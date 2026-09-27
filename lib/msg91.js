// MSG91 OTP v5 API wrapper. Docs: https://docs.msg91.com (OTP → Send/Verify).
// Requires env vars: MSG91_AUTH_KEY, MSG91_TEMPLATE_ID.
// authkey is sent both as a query param and as a header — MSG91 has accepted
// either depending on endpoint/account vintage, sending both is harmless and
// avoids a silent 401 if your account expects one over the other.

const BASE = 'https://control.msg91.com/api/v5';

// Normalizes an Indian phone number to MSG91's expected "919876543210" shape.
function toMsg91Mobile(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits; // already international, or caller passed something unusual
}

async function sendOtp(phone) {
  const authkey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_TEMPLATE_ID;
  if (!authkey || !templateId) throw new Error('MSG91_AUTH_KEY / MSG91_TEMPLATE_ID not set');

  const mobile = toMsg91Mobile(phone);
  const url = `${BASE}/otp?template_id=${encodeURIComponent(templateId)}&mobile=${mobile}&authkey=${encodeURIComponent(authkey)}&otp_length=6&otp_expiry=10`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', authkey },
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (data.type !== 'success') {
    throw new Error(data.message || 'MSG91 send OTP failed');
  }
  return data;
}

async function verifyOtp(phone, otp) {
  const authkey = process.env.MSG91_AUTH_KEY;
  if (!authkey) throw new Error('MSG91_AUTH_KEY not set');
  const mobile = toMsg91Mobile(phone);
  const url = `${BASE}/otp/verify?otp=${encodeURIComponent(otp)}&mobile=${mobile}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', authkey },
  });
  const data = await res.json().catch(() => ({}));
  if (data.type !== 'success') {
    return false;
  }
  return true;
}

module.exports = { sendOtp, verifyOtp, toMsg91Mobile };
