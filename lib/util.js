function haversineKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v === null || v === undefined || Number.isNaN(v))) {
    return Infinity; // unknown location sorts last, never crashes the route
  }
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// §5.1: Daily = 1 day, Weekly = 7 days, Monthly = 30 days.
function cycleDaysFor(plan) {
  return { Daily: 1, Weekly: 7, Monthly: 30 }[plan] || 1;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function send(res, status, body) {
  res.status(status).json(body);
}

function ok(res, body) {
  send(res, 200, body);
}

function badRequest(res, message) {
  send(res, 400, { error: message || 'Bad request' });
}

function unauthorized(res) {
  send(res, 401, { error: 'Unauthorized' });
}

function serverError(res, err) {
  console.error(err);
  send(res, 500, { error: err && err.message ? err.message : 'Server error' });
}

module.exports = {
  haversineKm,
  cycleDaysFor,
  todayISO,
  tomorrowISO,
  ok,
  badRequest,
  unauthorized,
  serverError,
};
