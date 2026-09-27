const { requireRole } = require('../../lib/session');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { applyOutcome } = require('../../lib/orderOutcome');
const { cycleDaysFor, todayISO, tomorrowISO, ok, badRequest, unauthorized, serverError, parsePathParams } = require('../../lib/util');

module.exports = async (req, res) => {
  const session = requireRole(req, 'admin');
  if (!session) return unauthorized(res);
  const db = supabaseAdmin();
  const [resource, pathId] = parsePathParams(req, 'resource', '/api/admin/');
  const targetId = pathId || req.query.id || (req.body && req.body.id);

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
        if (!targetId) return badRequest(res, 'Zone ID is required');
        const { id: _, ...patch } = req.body || {};
        const { data, error } = await db.from('zones').update(patch).eq('id', targetId).select().single();
        if (error) throw error;
        return ok(res, { zone: data });
      }
      if (req.method === 'DELETE') {
        if (!targetId) return badRequest(res, 'Zone ID is required');
        const { error } = await db.from('zones').delete().eq('id', targetId);
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
        if (!targetId) return badRequest(res, 'Product ID is required');
        const { id: _, ...patch } = req.body || {};
        const { data, error } = await db.from('products').update(patch).eq('id', targetId).select().single();
        if (error) throw error;
        return ok(res, { product: data });
      }
      if (req.method === 'DELETE') {
        if (!targetId) return badRequest(res, 'Product ID is required');
        const { error } = await db.from('products').delete().eq('id', targetId);
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
        const { zone_id, clear_all, clear_product_id, date, product_id, qty_available } = req.body || {};
        if (!zone_id) return badRequest(res, 'zone_id required');
        const d = date || todayISO();
        if (clear_all) {
          const { error } = await db.from('inventory').update({ qty_available: 0 }).eq('zone_id', zone_id).eq('date', d);
          if (error) throw error;
          return ok(res, { cleared: true });
        }
        if (clear_product_id) {
          const { error } = await db.from('inventory').update({ qty_available: 0 }).eq('zone_id', zone_id).eq('product_id', clear_product_id).eq('date', d);
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

    // ── Subscribers (customer + subscription) ───────────────────────
    if (resource === 'subscribers') {
      if (req.method === 'GET') {
        const { data } = await db
          .from('subscriptions')
          .select('*, customers(name, phone, address_text), zones(name), products(name)')
          .order('created_at', { ascending: false });
        return ok(res, { subscribers: data || [] });
      }
      if (req.method === 'POST') {
        const { phone, name, zone_id, product_id, plan, qty_per_day } = req.body || {};
        if (!phone || !zone_id || !product_id || !plan || !qty_per_day) {
          return badRequest(res, 'phone, zone_id, product_id, plan, qty_per_day required');
        }
        const cleanPhone = String(phone).replace(/\D/g, '');
        if (cleanPhone.length !== 10) return badRequest(res, 'Phone number must be 10 digits');

        let { data: customer } = await db.from('customers').select('*').eq('phone', cleanPhone).maybeSingle();
        if (!customer) {
          const { data: created, error } = await db
            .from('customers')
            .insert({ phone: cleanPhone, name: name || null, zone_id })
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
        if (!targetId) return badRequest(res, 'Subscription ID required');
        const { id: _, ...patch } = req.body || {};
        const { data, error } = await db.from('subscriptions').update(patch).eq('id', targetId).select().single();
        if (error) throw error;
        return ok(res, { subscriber: data });
      }
      if (req.method === 'DELETE') {
        if (!targetId) return badRequest(res, 'Subscription ID required');
        const { error } = await db.from('subscriptions').delete().eq('id', targetId);
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
        const { name, phone, zone_ids, status } = req.body || {};
        const cleanPhone = String(phone || '').replace(/\D/g, '');
        if (!name || cleanPhone.length !== 10) {
          return badRequest(res, 'Name and valid 10-digit phone number are required');
        }
        const { data, error } = await db
          .from('delivery_partners')
          .insert({ name, phone: cleanPhone, zone_ids: zone_ids || [], status: status || 'active' })
          .select()
          .single();
        if (error) throw error;
        return ok(res, { partner: data });
      }
      if (req.method === 'PUT') {
        if (!targetId) return badRequest(res, 'Partner ID required');
        const { id: _, ...patch } = req.body || {};
        if (patch.phone) patch.phone = String(patch.phone).replace(/\D/g, '');
        const { data, error } = await db.from('delivery_partners').update(patch).eq('id', targetId).select().single();
        if (error) throw error;
        return ok(res, { partner: data });
      }
      if (req.method === 'DELETE') {
        if (!targetId) return badRequest(res, 'Partner ID required');
        const { error } = await db.from('delivery_partners').delete().eq('id', targetId);
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
        if (!targetId) return badRequest(res, 'Order ID required');
        const { status, reason, items } = req.body || {};
        if (!['Delivered', 'Partially Delivered', 'Not Delivered'].includes(status)) {
          return badRequest(res, 'Invalid status');
        }
        const { data: order } = await db.from('orders').select('*').eq('id', targetId).single();
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

    // ── Comprehensive Analytics Summary ─────────────────────────────
    if (resource === 'summary') {
      const date = req.query.date || todayISO();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayISO = yesterday.toISOString().slice(0, 10);

      const [
        { data: orders },
        { data: allCustomers },
        { data: activeSubs }
      ] = await Promise.all([
        db.from('orders').select('*').eq('date', date),
        db.from('customers').select('id, created_at'),
        db.from('subscriptions').select('id, customer_id').eq('status', 'Active')
      ]);

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

      const totalOrdersCount = (orders || []).length;
      const aov = totalOrdersCount > 0 ? Math.round((totalOrderValue / totalOrdersCount) * 100) / 100 : 0;

      const customers = allCustomers || [];
      const totalCustomers = customers.length;

      const newCustomersToday = customers.filter((c) => c.created_at && c.created_at.slice(0, 10) === date).length;
      const newCustomersYesterday = customers.filter((c) => c.created_at && c.created_at.slice(0, 10) === yesterdayISO).length;

      const customersWithSubs = new Set((activeSubs || []).map((s) => s.customer_id));
      const customersWithOrders = new Set((orders || []).map((o) => o.customer_id));
      const convertedCustomersCount = customers.filter((c) => customersWithSubs.has(c.id) || customersWithOrders.has(c.id)).length;
      const conversionRate = totalCustomers > 0 ? Math.round((convertedCustomersCount / totalCustomers) * 100) : 0;

      return ok(res, {
        date,
        totalOrders: totalOrdersCount,
        ond,
        pd,
        totalOrderValue: Math.round(totalOrderValue * 100) / 100,
        revenueLost: Math.round(revenueLost * 100) / 100,
        revenueRealized: Math.round((totalOrderValue - revenueLost) * 100) / 100,
        aov,
        totalCustomers,
        newCustomersToday,
        newCustomersYesterday,
        convertedCustomersCount,
        conversionRate,
        activeSubscriptionsCount: (activeSubs || []).length,
      });
    }

    // ── Simulated WhatsApp broadcast ──────────────────────────────
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
