const { getSession } = require('../../lib/session');
const { createOrder } = require('../../lib/razorpay');
const { ok, badRequest, unauthorized, serverError } = require('../../lib/util');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return badRequest(res, 'POST only');
  const session = getSession(req);
  if (!session) return unauthorized(res);

  const { amount, purpose } = req.body || {};
  if (!amount || Number(amount) <= 0) return badRequest(res, 'amount must be > 0');
  if (!['subscription', 'instant_order', 'wallet_recharge'].includes(purpose)) {
    return badRequest(res, 'invalid purpose');
  }

  try {
    const receipt = `${purpose}_${session.sub}_${Date.now()}`.slice(0, 40);
    const order = await createOrder(amount, receipt, { purpose, sub: session.sub });
    return ok(res, order);
  } catch (err) {
    return serverError(res, err);
  }
};
