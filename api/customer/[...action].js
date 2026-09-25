const { requireRole } = require('../../lib/session');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { confirmPayment } = require('../../lib/razorpay');
const { cycleDaysFor, todayISO, ok, badRequest, unauthorized, serverError } = require('../../lib/util');

async function chargeAmount(db, session, amount, payment_method, proof, note) {
  if (payment_method === 'wallet') {
    const { data: wallet } = await db.from('wallets').select('*').eq('customer_id', session.sub).single();
    if (!wallet || Number(wallet.balance) < amount) {
      return { ok: false, status: 402, error: 'Insufficient wallet balance' };
    }
    const newBalance = Number(wallet.balance) - amount;
    await db.from('wallets').update({ balance: newBalance }).eq('customer_id', session.sub);
    await db
      .from('wallet_transactions')
      .insert({ customer_id: session.sub, type: 'debit', amount, note });
    return { ok: true };
  }
  if (payment_method === 'razorpay') {
    const result = await confirmPayment(amount, proof);
    if (!result.ok) return { ok: false, status: 400, error: result.error };
    return { ok: true };
  }
  return { ok: false, status: 400, error: 'Invalid payment method' };
}

module.exports = async (req, res) => {
  const session = requireRole(req, 'customer');
  if (!session) return unauthorized(res);
  const db = supabaseAdmin();
  const action = (req.query.action || [])[0];

  try {
    // ── /api/customer/me ──────────────────────────────────────────────
    if (action === 'me') {
      if (req.method === 'GET') {
        const { data: customer } = await db.from('customers').select('*').eq('id', session.sub).single();
        const { data: wallet } = await db.from('wallets').select('*').eq('customer_id', session.sub).single();
        const { data: zone } = customer.zone_id
          ? await db.from('zones').select('*').eq('id', customer.zone_id).single()
          : { data: null };
        return ok(res, { customer, wallet, zone });
      }
      if (req.method === 'PATCH') {
        const { name, address_text, lat, lng, zone_id } = req.body || {};
        const patch = {};
        if (name !== undefined) patch.name = name;
        if (address_text !== undefined) patch.address_text = address_text;
        if (lat !== undefined) patch.lat = lat;
        if (lng !== undefined) patch.lng = lng;
        if (zone_id !== undefined) patch.zone_id = zone_id;
        const { data, error } = await db
          .from('customers')
          .update(patch)
          .eq('id', session.sub)
          .select()
          .single();
        if (error) throw error;
        return ok(res, { customer: data });
      }
      return badRequest(res, 'Unsupported method');
    }

    // ── /api/customer/home ────────────────────────────────────────────
    if (action === 'home') {
      const { data: customer } = await db.from('customers').select('*').eq('id', session.sub).single();
      if (!customer.zone_id) {
        return ok(res, {
          zone: null,
          products: [],
          instantAvailable: false,
          message: 'Set your address to see products in your area.',
        });
      }
      const { data: zone } = await db.from('zones').select('*').eq('id', customer.zone_id).single();
      const { data: products } = await db.from('products').select('*').order('name');
      const { data: todaysStock } = await db
        .from('inventory')
        .select('*')
        .eq('zone_id', zone.id)
        .eq('date', todayISO());
      const anyStock = (todaysStock || []).some((r) => r.qty_available > 0);
      const instantAvailable = !!zone.instant_delivery_enabled && anyStock;
      return ok(res, {
        zone,
        products,
        instantAvailable,
        stockByProduct: Object.fromEntries((todaysStock || []).map((r) => [r.product_id, r.qty_available])),
        heroVideos: {
          milk: process.env.MILK_VIDEO_URL || '',
          other: process.env.VEGETABLE_VIDEO_URL || '',
        },
      });
    }

    // ── /api/customer/subscription ────────────────────────────────────
    if (action === 'subscription') {
      if (req.method === 'GET') {
        const { data } = await db.from('subscriptions').select('*, products(*)').eq('customer_id', session.sub);
        return ok(res, { subscriptions: data || [] });
      }
      if (req.method === 'POST') {
        const { product_id, plan, qty_per_day, payment_method, razorpay_order_id, razorpay_payment_id, razorpay_signature } =
          req.body || {};
        if (!product_id || !plan || !qty_per_day) return badRequest(res, 'product_id, plan, qty_per_day required');

        const { data: customer } = await db.from('customers').select('*').eq('id', session.sub).single();
        if (!customer.zone_id) return badRequest(res, 'Set your delivery zone before subscribing');

        const { data: product } = await db.from('products').select('*').eq('id', product_id).single();
        if (!product) return badRequest(res, 'Unknown product');

        const { data: existing } = await db
          .from('subscriptions')
          .select('*')
          .eq('customer_id', session.sub)
          .eq('product_id', product_id)
          .maybeSingle();

        const cycle_days = cycleDaysFor(plan);
        const unitPrice = product.discount_active
          ? Number(product.price) * (1 - Number(product.discount_pct) / 100)
          : Number(product.price);
        const cost = Math.round(unitPrice * qty_per_day * cycle_days * 100) / 100;

        // §5.1: mid-cycle change on an already-active, already-paid cycle is
        // staged as "pending" and takes effect on the next renewal — no
        // charge now, current cycle is left untouched.
        if (existing && existing.status === 'Active' && existing.days_remaining > 0) {
          const { data: updated, error } = await db
            .from('subscriptions')
            .update({ pending_plan: plan, pending_qty_per_day: qty_per_day, updated_at: new Date().toISOString() })
            .eq('id', existing.id)
            .select()
            .single();
          if (error) throw error;
          return ok(res, {
            subscription: updated,
            charged: 0,
            message: 'Your current cycle is already paid for — this change takes effect next cycle.',
          });
        }

        // New subscription, or renewing one whose cycle has ended.
        const charge = await chargeAmount(
          db,
          session,
          cost,
          payment_method,
          { razorpay_order_id, razorpay_payment_id, razorpay_signature },
          `Subscription — ${product.name} (${plan})`
        );
        if (!charge.ok) return res.status(charge.status).json({ error: charge.error });

        const row = {
          customer_id: session.sub,
          product_id,
          zone_id: customer.zone_id,
          plan,
          qty_per_day,
          cycle_days,
          days_remaining: cycle_days,
          status: 'Active',
          pending_plan: null,
          pending_qty_per_day: null,
          updated_at: new Date().toISOString(),
        };
        const { data: sub, error } = existing
          ? await db.from('subscriptions').update(row).eq('id', existing.id).select().single()
          : await db.from('subscriptions').insert(row).select().single();
        if (error) throw error;
        return ok(res, { subscription: sub, charged: cost });
      }
      return badRequest(res, 'Unsupported method');
    }

    // ── /api/customer/wallet ───────────────────────────────────────────
    if (action === 'wallet') {
      if (req.method === 'GET') {
        const { data: wallet } = await db.from('wallets').select('*').eq('customer_id', session.sub).single();
        const { data: transactions } = await db
          .from('wallet_transactions')
          .select('*')
          .eq('customer_id', session.sub)
          .order('date', { ascending: false })
          .limit(50);
        return ok(res, { wallet, transactions: transactions || [] });
      }
      if (req.method === 'POST') {
        const { amount, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
        if (!amount || amount <= 0) return badRequest(res, 'amount must be > 0');
        const result = await confirmPayment(amount, { razorpay_order_id, razorpay_payment_id, razorpay_signature });
        if (!result.ok) return res.status(400).json({ error: result.error });
        const { data: wallet } = await db.from('wallets').select('*').eq('customer_id', session.sub).single();
        const newBalance = Number(wallet.balance) + Number(amount);
        await db.from('wallets').update({ balance: newBalance }).eq('customer_id', session.sub);
        await db.from('wallet_transactions').insert({
          customer_id: session.sub,
          type: 'credit',
          amount,
          note: 'Wallet recharge',
        });
        return ok(res, { balance: newBalance });
      }
      return badRequest(res, 'Unsupported method');
    }

    // ── /api/customer/order (instant delivery) ─────────────────────────
    if (action === 'order') {
      if (req.method === 'GET') {
        const { data: today } = await db
          .from('orders')
          .select('*')
          .eq('customer_id', session.sub)
          .eq('date', todayISO());
        const { data: history } = await db
          .from('orders')
          .select('*')
          .eq('customer_id', session.sub)
          .order('date', { ascending: false })
          .limit(30);
        return ok(res, { today: today || [], history: history || [] });
      }
      if (req.method === 'POST') {
        const { items, payment_method, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
        if (!Array.isArray(items) || items.length === 0) return badRequest(res, 'items required');

        const { data: customer } = await db.from('customers').select('*').eq('id', session.sub).single();
        if (!customer.zone_id) return badRequest(res, 'Set your delivery zone first');
        const { data: zone } = await db.from('zones').select('*').eq('id', customer.zone_id).single();

        const today = todayISO();
        const { data: stockRows } = await db.from('inventory').select('*').eq('zone_id', zone.id).eq('date', today);
        const stockMap = Object.fromEntries((stockRows || []).map((r) => [r.product_id, r]));

        if (!zone.instant_delivery_enabled) return badRequest(res, 'Instant delivery is not available in your zone right now');

        const { data: allProducts } = await db.from('products').select('*');
        const productMap = Object.fromEntries((allProducts || []).map((p) => [p.id, p]));

        let total = 0;
        const orderItems = [];
        for (const it of items) {
          const stock = stockMap[it.product_id];
          const product = productMap[it.product_id];
          if (!product) return badRequest(res, `Unknown product ${it.product_id}`);
          if (!stock || stock.qty_available < it.qty) {
            return badRequest(res, `${product.name} is out of stock for instant delivery today`);
          }
          const unitPrice = product.discount_active
            ? Number(product.price) * (1 - Number(product.discount_pct) / 100)
            : Number(product.price);
          total += unitPrice * it.qty;
          orderItems.push({ product_id: it.product_id, name: product.name, qty: it.qty, price: unitPrice, delivered: false });
        }
        total = Math.round(total * 100) / 100;

        const charge = await chargeAmount(
          db,
          session,
          total,
          payment_method,
          { razorpay_order_id, razorpay_payment_id, razorpay_signature },
          'Instant delivery order'
        );
        if (!charge.ok) return res.status(charge.status).json({ error: charge.error });

        // Decrement stock for each item.
        for (const it of items) {
          const stock = stockMap[it.product_id];
          await db
            .from('inventory')
            .update({ qty_available: stock.qty_available - it.qty })
            .eq('zone_id', zone.id)
            .eq('product_id', it.product_id)
            .eq('date', today);
        }

        // §5.3: if ANY product in the zone is now at zero stock for today,
        // auto-disable the zone's instant toggle.
        const { data: refreshedStock } = await db.from('inventory').select('*').eq('zone_id', zone.id).eq('date', today);
        if ((refreshedStock || []).some((r) => r.qty_available <= 0)) {
          await db.from('zones').update({ instant_delivery_enabled: false }).eq('id', zone.id);
        }

        const { data: order, error } = await db
          .from('orders')
          .insert({
            customer_id: session.sub,
            zone_id: zone.id,
            date: today,
            items: orderItems,
            status: 'Pending',
            instant: true,
            payment_method,
          })
          .select()
          .single();
        if (error) throw error;
        return ok(res, { order, charged: total });
      }
      return badRequest(res, 'Unsupported method');
    }

    return badRequest(res, 'Unknown action');
  } catch (err) {
    return serverError(res, err);
  }
};
