// APITXT is a pure delivery channel here: we generate and verify the OTP
// ourselves (see lib/otpStore.js) and just ask APITXT to deliver it.
// Docs: https://apitxt.com/developer/otp-api
const BASE = 'https://apitxt.com/api';

function normalizeMobile(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`; // APITXT auto-prepends 91 for 10-digit numbers anyway; done explicitly for clarity/logging
  return digits;
}

// Sends `code` to `phone` via APITXT. Throws on any non-2xx response.
//
// NOTE: the docs page didn't show an example success/failure response body,
// so this treats HTTP status as the signal (2xx = sent) and surfaces
// whatever the body contains for debugging. If APITXT actually returns
// HTTP 200 with an internal {status:"error", ...} field even on failure —
// common with some Indian SMS gateways — send a real test OTP once you have
// live credentials and tell me what the response body looks like; this
// function will need a one-line tweak to check that field too.
async function sendOtpSms(phone, code) {
  const authkey = process.env.APITXT_AUTH_KEY;
  if (!authkey) throw new Error('APITXT_AUTH_KEY is not set');

  const params = new URLSearchParams({
    authkey,
    mobile: normalizeMobile(phone),
    otp: code,
  });
  if (process.env.APITXT_TEMPLATE_ID) params.set('template_id', process.env.APITXT_TEMPLATE_ID);
  if (process.env.APITXT_CHANNEL) params.set('channel', process.env.APITXT_CHANNEL); // sms (default) | whatsapp | voice

  const res = await fetch(`${BASE}/sendOTP?${params.toString()}`, { method: 'GET' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data && (data.message || data.error)) || `APITXT send failed (HTTP ${res.status})`);
  }
  return data;
}

module.exports = { sendOtpSms, normalizeMobile };
