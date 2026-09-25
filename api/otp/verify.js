const { verifyOtp } = require('../../lib/msg91');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { createSessionCookie } = require('../../lib/session');
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
  const { phone, otp, role, name } = req.body || {};
  if (!phone || !otp || !['customer', 'partner', 'admin'].includes(role)) {
    return badRequest(res, 'phone, otp and a valid role are required');
  }

  try {
    const verified = await verifyOtp(phone, otp);
    if (!verified) return res.status(401).json({ error: 'Incorrect or expired OTP' });

    const db = supabaseAdmin();

    if (role === 'admin') {
      if (!isAdminPhone(phone)) {
        return res.status(403).json({ error: 'This number is not authorized for admin access.' });
      }
      res.setHeader('Set-Cookie', createSessionCookie({ sub: 'admin', role: 'admin', phone }));
      return ok(res, { profile: { role: 'admin', phone } });
    }

    if (role === 'customer') {
      let { data: customer } = await db.from('customers').select('*').eq('phone', phone).maybeSingle();
      if (!customer) {
        const { data: created, error } = await db
          .from('customers')
          .insert({ phone, name: name || null })
          .select()
          .single();
        if (error) throw error;
        customer = created;
        await db.from('wallets').insert({ customer_id: customer.id, balance: 0 });
      } else if (name && !customer.name) {
        await db.from('customers').update({ name }).eq('id', customer.id);
        customer.name = name;
      }
      res.setHeader(
        'Set-Cookie',
        createSessionCookie({ sub: customer.id, role: 'customer', phone, name: customer.name })
      );
      return ok(res, { profile: customer });
    }

    // role === 'partner'
    let { data: partner } = await db.from('delivery_partners').select('*').eq('phone', phone).maybeSingle();
    if (!partner) {
      const { data: created, error } = await db
        .from('delivery_partners')
        .insert({ phone, name: name || 'New Partner', zone_ids: [] })
        .select()
        .single();
      if (error) throw error;
      partner = created;
    }
    res.setHeader(
      'Set-Cookie',
      createSessionCookie({ sub: partner.id, role: 'partner', phone, name: partner.name })
    );
    return ok(res, { profile: partner });
  } catch (err) {
    return serverError(res, err);
  }
};
