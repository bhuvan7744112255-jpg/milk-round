const { requireRole } = require('../../lib/session');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { applyOutcome } = require('../../lib/orderOutcome');
const { cycleDaysFor, todayISO, tomorrowISO, ok, badRequest, unauthorized, serverError } = require('../../lib/util');

module.exports = async (req, res) => {
  const session = requireRole(req, 'admin');
  if (!session) return unauthorized(res);
  const db = supabaseAdmin();
  const [resource, id] = req.query.resource || [];

  try {
    // ── Zones ────────────────────────────────────────────────────────
    if (resource === 'zones') {
      if (req.method === 'GET') {
        const { data } = await db.from('zones').select('*').order('name');
        return ok(res, { zones: data || [] });
      }
      if (req.method === 'POST') {
        const { data, error } = await db.from('zones').insert(req.body).select().single();
        if (error) throw error;
        return ok(res, { zone: data });
      }
      if (req.method === 'PUT') {
        const { data, error } = await db.from('zones').update(req.body).eq('id', id).select().single();
        if (error) throw error;
        return ok(res, { zone: data });
      }
      if (req.method === 'DELETE') {
        const { error } = await db.from('zones').delete().eq('id', id);
        if (error) throw error;
        return ok(res, { deleted: true });
      }
    }

    // ── Products & pricing ──────────────────────────────────────────
    if (resource === 'products') {
      if (req.method === 'GET') {
        const { data } = await db.from('products').select('*').order('name');
        return ok(res, { products: data || [] });
      }
      if (req.method === 'POST') {
        const { data, error } = await db.from('products').insert(req.body).select().single();
        if (error) throw error;
        return ok(res, { product: data });
      }
      if (req.method === 'PUT') {
        const { data, error } = await db.from('products').update(req.body).eq('id', id).select().single();
        if (error) throw error;
        return ok(res, { product: data });
      }
      if (req.method === 'DELETE') {
        const { error } = await db.from('products').delete().eq('id', id);
        if (error) throw error;
        return ok(res, { deleted: true });
      }
    }

    // ── Daily inventory ──────────────────────────────────────────────
    if (resource === 'inventory') {
      if (req.method === 'GET') {
        const { zone_id, date } = req.query;
        let q = db.from('inventory').select('*, products(name)').eq('date', date || todayISO());
        if (zone_id) q = q.eq('zone_id', zone_id);
        const { data } = await q;
        return ok(res, { inventory: data || [] });
      }
      if (req.method === 'POST') {
        const { zone_id, clear_all, date, product_id, qty_available } = req.body || {};
        if (!zone_id) return badRequest(res, 'zone_id required');
        const d = date || todayISO();
        if (clear_all) {
          const { error } = await db.from('inventory').update({ qty_available: 0 }).eq('zone_id', zone_id).eq('date', d);
          if (error) throw error;
          return ok(res, { cleared: true });
        }
        if (!product_id || qty_available === undefined) return badRequest(res, 'product_id and qty_available required');
        const { data, error } = await db
          .from('inventory')
          .upsert({ zone_id, product_id, date: d, qty_available }, { onConflict: 'zone_id,product_id,date' })
          .select()
          .single();
        if (error) throw error;
        return ok(res, { inventory: data });
      }
    }

    // ── Subscribers (customer + subscription, source of truth for §5.6) ─
    if (resource === 'subscribers') {
      if (req.method === 'GET') {
        const { data } = await db
          .from('subscriptions')
          .select('*, customers(name, phone, address_text), zones(name), products(name)')
          .order('created_at', { ascending: false });
        return ok(res, { subscribers: data || [] });
      }
      if (req.method === 'POST') {
        // Admin-added subscriber: find-or-create the customer, then create
        // an Active subscription immediately (no payment flow here — this
        // is an operational tool, billing is the admin's call).
        const { phone, name, zone_id, product_id, plan, qty_per_day } = req.body || {};
        if (!phone || !zone_id || !product_id || !plan || !qty_per_day) {
          return badRequest(res, 'phone, zone_id, product_id, plan, qty_per_day required');
        }
        let { data: customer } = await db.from('customers').select('*').eq('phone', phone).maybeSingle();
        if (!customer) {
          const { data: created, error } = await db
            .from('customers')
            .insert({ phone, name: name || null, zone_id })
            .select()
            .single();
          if (error) throw error;
          customer = created;
          await db.from('wallets').insert({ customer_id: customer.id, balance: 0 });
        }
        const cycle_days = cycleDaysFor(plan);
        const { data: sub, error } = await db
          .from('subscriptions')
          .upsert(
            {
              customer_id: customer.id,
              product_id,
              zone_id,
              plan,
              qty_per_day,
              cycle_days,
              days_remaining: cycle_days,
              status: 'Active',
            },
            { onConflict: 'customer_id,product_id' }
          )
          .select()
          .single();
        if (error) throw error;
        return ok(res, { subscriber: sub, customer });
      }
      if (req.method === 'PUT') {
        // id = subscription id. Body may include status/qty_per_day/plan/zone_id.
        const { data, error } = await db.from('subscriptions').update(req.body).eq('id', id).select().single();
        if (error) throw error;
        return ok(res, { subscriber: data });
      }
      if (req.method === 'DELETE') {
        const { error } = await db.from('subscriptions').delete().eq('id', id);
        if (error) throw error;
        return ok(res, { deleted: true });
      }
    }

    // ── Delivery partners ───────────────────────────────────────────
    if (resource === 'partners') {
      if (req.method === 'GET') {
        const { data } = await db.from('delivery_partners').select('*, zones:active_zone_id(name)').order('name');
        return ok(res, { partners: data || [] });
      }
      if (req.method === 'POST') {
        const { data, error } = await db.from('delivery_partners').insert(req.body).select().single();
        if (error) throw error;
        return ok(res, { partner: data });
      }
      if (req.method === 'PUT') {
        const { data, error } = await db.from('delivery_partners').update(req.body).eq('id', id).select().single();
        if (error) throw error;
        return ok(res, { partner: data });
      }
      if (req.method === 'DELETE') {
        const { error } = await db.from('delivery_partners').delete().eq('id', id);
        if (error) throw error;
        return ok(res, { deleted: true });
      }
    }

    // ── Orders (list + manual outcome override) ─────────────────────
    if (resource === 'orders') {
      if (req.method === 'GET') {
        const date = req.query.date || todayISO();
        const { data } = await db
          .from('orders')
          .select('*, customers(name, phone), zones(name)')
          .eq('date', date)
          .order('created_at', { ascending: false });
        return ok(res, { orders: data || [] });
      }
      if (req.method === 'PUT') {
        const { status, reason, items } = req.body || {};
        if (!['Delivered', 'Partially Delivered', 'Not Delivered'].includes(status)) {
          return badRequest(res, 'Invalid status');
        }
        const { data: order } = await db.from('orders').select('*').eq('id', id).single();
        if (!order) return badRequest(res, 'Order not found');
        await applyOutcome(db, { order, status, items, reason, deliveryPartnerId: order.delivery_partner_id });
        return ok(res, { updated: true });
      }
    }

    // ── Procurement: total units per product, all zones combined ────
    if (resource === 'procurement') {
      const { data: subs } = await db
        .from('subscriptions')
        .select('product_id, qty_per_day, products(name)')
        .eq('status', 'Active')
        .gt('days_remaining', 0);
      const byProduct = {};
      (subs || []).forEach((s) => {
        const key = s.product_id;
        if (!byProduct[key]) byProduct[key] = { product_id: key, name: s.products?.name, units: 0 };
        byProduct[key].units += s.qty_per_day;
      });
      return ok(res, { procurement: Object.values(byProduct), forDate: tomorrowISO() });
    }

    // ── Dispatch: same, split by zone, vs current stock ──────────────
    if (resource === 'dispatch') {
      const { data: subs } = await db
        .from('subscriptions')
        .select('zone_id, product_id, qty_per_day, products(name), zones(name)')
        .eq('status', 'Active')
        .gt('days_remaining', 0);
      const forDate = tomorrowISO();
      const { data: stock } = await db.from('inventory').select('*').eq('date', forDate);
      const stockMap = Object.fromEntries((stock || []).map((r) => [`${r.zone_id}:${r.product_id}`, r.qty_available]));

      const byZoneProduct = {};
      (subs || []).forEach((s) => {
        const key = `${s.zone_id}:${s.product_id}`;
        if (!byZoneProduct[key]) {
          byZoneProduct[key] = {
            zone_id: s.zone_id,
            zone_name: s.zones?.name,
            product_id: s.product_id,
            product_name: s.products?.name,
            units_needed: 0,
          };
        }
        byZoneProduct[key].units_needed += s.qty_per_day;
      });

      const dispatch = Object.entries(byZoneProduct).map(([key, row]) => {
        const current_stock = stockMap[key] ?? 0;
        return {
          ...row,
          current_stock,
          short: current_stock < row.units_needed,
        };
      });
      return ok(res, { dispatch, forDate });
    }

    // ── Exceptions log ─────────────────────────────────────────────
    if (resource === 'exceptions') {
      const date = req.query.date;
      let q = db
        .from('exceptions')
        .select('*, customers(name, phone), zones(name)')
        .order('date', { ascending: false });
      if (date) q = q.eq('date', date);
      const { data } = await q;
      return ok(res, { exceptions: data || [] });
    }

    // ── Today's Revenue & Orders summary (ONDs / PDs / revenue lost) ─
    if (resource === 'summary') {
      const date = req.query.date || todayISO();
      const { data: orders } = await db.from('orders').select('*').eq('date', date);
      let totalOrderValue = 0;
      let revenueLost = 0;
      let ond = 0;
      let pd = 0;
      (orders || []).forEach((o) => {
        const orderValue = (o.items || []).reduce((sum, it) => sum + it.price * it.qty, 0);
        totalOrderValue += orderValue;
        if (o.status === 'Not Delivered') {
          ond += 1;
          revenueLost += orderValue;
        } else if (o.status === 'Partially Delivered') {
          pd += 1;
          revenueLost += (o.items || []).filter((it) => !it.delivered).reduce((s, it) => s + it.price * it.qty, 0);
        }
      });
      return ok(res, {
        date,
        totalOrders: (orders || []).length,
        ond,
        pd,
        totalOrderValue: Math.round(totalOrderValue * 100) / 100,
        revenueLost: Math.round(revenueLost * 100) / 100,
        revenueRealized: Math.round((totalOrderValue - revenueLost) * 100) / 100,
      });
    }

    // ── Simulated WhatsApp broadcast (§8: not yet wired to the real API) ─
    if (resource === 'broadcast') {
      if (req.method !== 'POST') return badRequest(res, 'POST only');
      const { product_id, message } = req.body || {};
      if (!product_id || !message) return badRequest(res, 'product_id and message required');
      return ok(res, { simulated: true, note: 'WhatsApp Business API is not connected yet — this only logs the intent.' });
    }

    return badRequest(res, 'Unknown resource');
  } catch (err) {
    return serverError(res, err);
  }
};
