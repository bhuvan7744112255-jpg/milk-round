const { requireRole } = require('../../lib/session');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { applyOutcome } = require('../../lib/orderOutcome');
const { haversineKm, todayISO, ok, badRequest, unauthorized, serverError } = require('../../lib/util');

const PAYOUT_PER_DELIVERY = Number(process.env.PARTNER_PAYOUT_PER_DELIVERY || 15);
// ^ Not specified in the spec's business rules — a flat per-completed-stop
// payout is a placeholder assumption so Earnings has something real to show.
// Swap for whatever commission model you actually pay partners.

module.exports = async (req, res) => {
  const session = requireRole(req, 'partner');
  if (!session) return unauthorized(res);
  const db = supabaseAdmin();
  const action = (req.query.action || [])[0];

  try {
    // ── /api/partner/me ────────────────────────────────────────────────
    if (action === 'me') {
      if (req.method === 'GET') {
        const { data: partner } = await db.from('delivery_partners').select('*').eq('id', session.sub).single();
        const { data: zones } = await db.from('zones').select('*').order('name');
        return ok(res, { partner, zones: zones || [] });
      }
      if (req.method === 'PATCH') {
        const { name, zone_ids, active_zone_id } = req.body || {};
        const patch = {};
        if (name !== undefined) patch.name = name;
        if (zone_ids !== undefined) patch.zone_ids = zone_ids;
        if (active_zone_id !== undefined) patch.active_zone_id = active_zone_id;
        const { data, error } = await db
          .from('delivery_partners')
          .update(patch)
          .eq('id', session.sub)
          .select()
          .single();
        if (error) throw error;
        return ok(res, { partner: data });
      }
      return badRequest(res, 'Unsupported method');
    }

    // ── /api/partner/route ─────────────────────────────────────────────
    if (action === 'route') {
      const { data: partner } = await db.from('delivery_partners').select('*').eq('id', session.sub).single();
      if (!partner.active_zone_id) {
        return ok(res, { stops: [], upNext: null, message: 'Pick an active zone in your profile to see today\u2019s route.' });
      }
      const { data: zone } = await db.from('zones').select('*').eq('id', partner.active_zone_id).single();
      const { data: pending } = await db
        .from('orders')
        .select('*, customers(name, phone, address_text, lat, lng)')
        .eq('zone_id', zone.id)
        .eq('date', todayISO())
        .eq('status', 'Pending');

      const stops = (pending || [])
        .map((o) => ({
          order_id: o.id,
          customer_name: o.customers?.name,
          phone: o.customers?.phone,
          address: o.customers?.address_text,
          lat: o.customers?.lat,
          lng: o.customers?.lng,
          items: o.items,
          instant: o.instant,
          distance_km: haversineKm(zone.hub_lat, zone.hub_lng, o.customers?.lat, o.customers?.lng),
        }))
        .sort((a, b) => a.distance_km - b.distance_km);

      return ok(res, { zone, stops, upNext: stops[0] || null });
    }

    // ── /api/partner/outcome ───────────────────────────────────────────
    if (action === 'outcome') {
      if (req.method !== 'POST') return badRequest(res, 'POST only');
      const { order_id, status, items, reason } = req.body || {};
      if (!order_id || !['Delivered', 'Partially Delivered', 'Not Delivered'].includes(status)) {
        return badRequest(res, 'order_id and a valid status are required');
      }
      const { data: order } = await db.from('orders').select('*').eq('id', order_id).single();
      if (!order) return badRequest(res, 'Order not found');
      if (order.status !== 'Pending') return badRequest(res, 'This order has already been resolved');

      await applyOutcome(db, { order, status, items, reason, deliveryPartnerId: session.sub });
      return ok(res, { updated: true });
    }

    // ── /api/partner/earnings ──────────────────────────────────────────
    if (action === 'earnings') {
      const { data: todays } = await db
        .from('orders')
        .select('*')
        .eq('delivery_partner_id', session.sub)
        .eq('date', todayISO())
        .in('status', ['Delivered', 'Partially Delivered']);

      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const { data: week } = await db
        .from('orders')
        .select('*')
        .eq('delivery_partner_id', session.sub)
        .gte('date', weekAgo.toISOString().slice(0, 10))
        .in('status', ['Delivered', 'Partially Delivered']);

      const byDay = {};
      (week || []).forEach((o) => {
        byDay[o.date] = (byDay[o.date] || 0) + PAYOUT_PER_DELIVERY;
      });

      return ok(res, {
        today: { count: (todays || []).length, total: (todays || []).length * PAYOUT_PER_DELIVERY },
        week: Object.entries(byDay)
          .sort((a, b) => (a[0] < b[0] ? 1 : -1))
          .map(([date, total]) => ({ date, total })),
        payoutPerDelivery: PAYOUT_PER_DELIVERY,
      });
    }

    return badRequest(res, 'Unknown action');
  } catch (err) {
    return serverError(res, err);
  }
};
