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

function parsePathParams(req, paramName, prefix) {
  const raw = req.query ? req.query[paramName] : undefined;
  let params = [];

  if (Array.isArray(raw)) {
    params = raw.filter(Boolean);
  } else if (typeof raw === 'string' && raw.trim()) {
    params = raw.split('/').filter(Boolean);
  }

  if (params.length === 0 && req.url) {
    try {
      const urlPath = new URL(req.url, 'http://localhost').pathname;
      const idx = urlPath.indexOf(prefix);
      if (idx !== -1) {
        const sub = urlPath.slice(idx + prefix.length);
        params = sub.split('/').filter(Boolean);
      }
    } catch (e) {
      // ignore
    }
  }

  return params;
}

const DEFAULT_FARMERS = [
  {
    id: 'farmer-1',
    farmer_code: 'FARMER-01',
    farmer_name: 'Ramesh Goud',
    village: 'Medak District, Telangana',
    story: 'Ramesh has been raising 25 pure-breed Gir cows for over 15 years on 12 acres of organic green pasture. Cows are fed natural organic fodder, free-grazed, and hand-milked daily at 4:30 AM with zero antibiotics or hormones.',
    pdf_url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    image_url: 'https://images.unsplash.com/photo-1595855759920-86582396756a?w=500'
  },
  {
    id: 'farmer-2',
    farmer_code: 'FARMER-02',
    farmer_name: 'Suresh Kumar',
    village: 'Rangareddy District, Telangana',
    story: 'Suresh manages our organic dairy cluster focusing on chemical-free, unadulterated fresh morning milk tested for zero preservatives, zero oxytocin, and 100% natural fat content.',
    pdf_url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    image_url: 'https://images.unsplash.com/photo-1500595046743-cd271d694d30?w=500'
  }
];

module.exports = {
  haversineKm,
  cycleDaysFor,
  todayISO,
  tomorrowISO,
  send,
  ok,
  badRequest,
  unauthorized,
  serverError,
  parsePathParams,
  DEFAULT_FARMERS,
};
