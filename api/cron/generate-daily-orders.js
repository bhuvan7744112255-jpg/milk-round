// Not part of the spec's explicit business rules — the spec defines Orders
// and Subscriptions but not the step that turns "an active subscription"
// into "today's order for the partner to deliver." This cron job is that
// step: once a day, for every Active subscription with days_remaining > 0,
// create today's Order row (skipped if one already exists for that
// customer+product+date, so re-runs are safe).
//
// Wire this up in vercel.json under "crons" and set CRON_SECRET — Vercel
// sends `Authorization: Bearer $CRON_SECRET` on requests it triggers.
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { todayISO, ok, serverError } = require('../../lib/util');

module.exports = async (req, res) => {
  const auth = req.headers.authorization || '';
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = supabaseAdmin();
  const today = todayISO();

  try {
    const { data: subs } = await db
      .from('subscriptions')
      .select('*, products(*)')
      .eq('status', 'Active')
      .gt('days_remaining', 0);

    let created = 0;
    for (const sub of subs || []) {
      const { data: existing } = await db
        .from('orders')
        .select('id')
        .eq('customer_id', sub.customer_id)
        .eq('date', today)
        .eq('instant', false)
        .contains('items', [{ product_id: sub.product_id }])
        .maybeSingle();
      if (existing) continue;

      const unitPrice = sub.products.discount_active
        ? Number(sub.products.price) * (1 - Number(sub.products.discount_pct) / 100)
        : Number(sub.products.price);

      await db.from('orders').insert({
        customer_id: sub.customer_id,
        zone_id: sub.zone_id,
        date: today,
        items: [{ product_id: sub.product_id, name: sub.products.name, qty: sub.qty_per_day, price: unitPrice, delivered: false }],
        status: 'Pending',
        instant: false,
      });
      created += 1;
    }

    return ok(res, { created, checked: (subs || []).length });
  } catch (err) {
    return serverError(res, err);
  }
};
