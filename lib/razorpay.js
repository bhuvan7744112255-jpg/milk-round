const Razorpay = require('razorpay');
const crypto = require('crypto');

let client;
function razorpayClient() {
  if (client) return client;
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set');
  client = new Razorpay({ key_id, key_secret });
  return client;
}

// amountRupees: e.g. 320.00 → Razorpay wants integer paise.
async function createOrder(amountRupees, receipt, notes) {
  const rp = razorpayClient();
  const order = await rp.orders.create({
    amount: Math.round(Number(amountRupees) * 100),
    currency: 'INR',
    receipt,
    payment_capture: 1,
    notes,
  });
  return { order_id: order.id, amount: order.amount, key_id: process.env.RAZORPAY_KEY_ID };
}

// Fetches the order back from Razorpay so callers can confirm the amount
// actually paid matches what they expect to charge — the signature alone
// only proves order_id/payment_id are a genuine pair, not that the order
// was created for the right amount (a client could otherwise create a ₹1
// order, pay it, then present that valid proof against a ₹500 charge).
async function fetchOrder(order_id) {
  const rp = razorpayClient();
  return rp.orders.fetch(order_id);
}

// Verifies the signature Razorpay Checkout.js hands back to the client after
// a successful payment. NEVER trust a "payment succeeded" claim from the
// client without this check.
function verifyPaymentSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) throw new Error('RAZORPAY_KEY_SECRET not set');
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(razorpay_signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Full payment confirmation: genuine signature AND correct amount AND
// actually captured. Use this instead of verifyPaymentSignature alone
// anywhere a rupee amount is being credited or a charge is being trusted.
async function confirmPayment(expectedAmountRupees, proof) {
  if (!verifyPaymentSignature(proof || {})) {
    return { ok: false, error: 'Payment verification failed' };
  }
  try {
    const order = await fetchOrder(proof.razorpay_order_id);
    const expectedPaise = Math.round(Number(expectedAmountRupees) * 100);
    if (order.amount !== expectedPaise) return { ok: false, error: 'Paid amount does not match the charge' };
    if (order.status !== 'paid') return { ok: false, error: 'Payment has not been captured' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not confirm payment with Razorpay' };
  }
}

module.exports = { razorpayClient, createOrder, fetchOrder, verifyPaymentSignature, confirmPayment };
