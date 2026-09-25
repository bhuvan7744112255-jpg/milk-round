// §5.5: a marked outcome updates the order, logs an Exception for anything
// short of a full delivery, and — for subscription (non-instant) orders —
// decrements the matching subscription's days_remaining (§5.1).
async function applyOutcome(db, { order, status, items, reason, deliveryPartnerId }) {
  const finalItems = items && Array.isArray(items) ? items : order.items;

  const { error: updateErr } = await db
    .from('orders')
    .update({
      status,
      items: finalItems,
      delivery_partner_id: deliveryPartnerId || order.delivery_partner_id || null,
      not_delivered_reason: status === 'Not Delivered' ? reason || 'Not specified' : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id);
  if (updateErr) throw updateErr;

  if (status !== 'Delivered') {
    await db.from('exceptions').insert({
      customer_id: order.customer_id,
      zone_id: order.zone_id,
      order_id: order.id,
      reason: status === 'Not Delivered' ? reason || 'Not specified' : 'Partially delivered',
    });
  }

  if (!order.instant && (status === 'Delivered' || status === 'Partially Delivered')) {
    for (const item of finalItems) {
      const { data: sub } = await db
        .from('subscriptions')
        .select('*')
        .eq('customer_id', order.customer_id)
        .eq('product_id', item.product_id)
        .maybeSingle();
      if (sub && sub.days_remaining > 0) {
        await db.from('subscriptions').update({ days_remaining: sub.days_remaining - 1 }).eq('id', sub.id);
      }
    }
  }
}

module.exports = { applyOutcome };
