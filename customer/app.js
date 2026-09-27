const { api, toast, rupees, timeAgo, el, payWithRazorpay } = MR;
const root = document.getElementById('app');

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  sub: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="16" height="14" rx="2"/><path d="M8 7V5a4 4 0 018 0v2"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12h3"/><path d="M3 10h18"/></svg>',
  track: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 21s7-6.5 7-11a7 7 0 00-14 0c0 4.5 7 11 7 11z"/></svg>',
  profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  milk: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 2h6v3.5l2 3V20a2 2 0 01-2 2H9a2 2 0 01-2-2V8.5l2-3V2z"/></svg>',
  veg: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="14" r="7"/><path d="M12 7c1-2 3-3 4-3-1 2-1 4-2 5" stroke="currentColor" stroke-width="0" /></svg>',
  basket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h16l-1.5 10a2 2 0 01-2 1.7H7.5a2 2 0 01-2-1.7L4 9z"/><path d="M8 9V7a4 4 0 018 0v2"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19c8 1 14-5 14-13-8 0-14 5-14 13z"/></svg>',
};

const state = { profile: null, tab: 'home', home: null, subs: [], wallet: null, order: null };

async function boot() {
  try {
    const me = await api('/customer/me');
    state.profile = me.customer;
    renderApp();
  } catch {
    renderAuth();
  }
}

// ── Auth ────────────────────────────────────────────────────────────
function renderAuth() {
  root.innerHTML = '';
  let step = 'phone';
  let phone = '';

  function draw() {
    root.innerHTML = '';
    const wrap = el('div', { class: 'screen center-fill', style: 'flex-direction:column;gap:18px;width:100%;padding:0 24px;' });
    const mark = el('div', { style: 'width:56px;height:56px;border-radius:16px;background:var(--accent);display:flex;align-items:center;justify-content:center;margin:0 auto 6px;' }, [el('div', { html: ICONS.milk, style: 'width:28px;height:28px;color:white;' })]);
    const heading = el('h1', { style: 'text-align:center;' }, step === 'phone' ? 'Milk Round' : 'Verify it\u2019s you');
    const sub = el('p', { class: 'muted', style: 'text-align:center;' }, step === 'phone' ? 'Fresh milk, delivered daily.' : `We sent a code to ${phone}`);
    const card = el('div', { class: 'card' });

    if (step === 'phone') {
      const input = el('input', { type: 'tel', placeholder: '10-digit mobile number', maxlength: '10', inputmode: 'numeric' });
      const btn = el('button', { class: 'btn btn-primary', style: 'margin-top:12px;' }, 'Send OTP');
      btn.onclick = async () => {
        const val = input.value.replace(/\D/g, '');
        if (val.length !== 10) return toast('Enter a valid 10-digit number', true);
        btn.disabled = true;
        btn.textContent = 'Sending…';
        try {
          await api('/otp/send', { method: 'POST', body: { phone: val, role: 'customer' } });
          phone = val;
          step = 'otp';
          draw();
        } catch (e) {
          toast(e.message, true);
          btn.disabled = false;
          btn.textContent = 'Send OTP';
        }
      };
      card.append(input, btn);
    } else {
      const otpInput = el('input', { class: 'otp-input', type: 'tel', maxlength: '6', inputmode: 'numeric', placeholder: '••••••' });
      const nameInput = el('input', { type: 'text', placeholder: 'Your name (optional)', style: 'margin-top:10px;' });
      const btn = el('button', { class: 'btn btn-primary', style: 'margin-top:12px;' }, 'Verify & continue');
      const back = el('button', { class: 'btn btn-outline', style: 'margin-top:8px;' }, 'Use a different number');
      back.onclick = () => { step = 'phone'; draw(); };
      btn.onclick = async () => {
        if (otpInput.value.length < 4) return toast('Enter the OTP', true);
        btn.disabled = true;
        btn.textContent = 'Verifying…';
        try {
          const res = await api('/otp/verify', { method: 'POST', body: { phone, otp: otpInput.value, role: 'customer', name: nameInput.value || undefined } });
          state.profile = res.profile;
          renderApp();
        } catch (e) {
          toast(e.message, true);
          btn.disabled = false;
          btn.textContent = 'Verify & continue';
        }
      };
      card.append(otpInput, nameInput, btn, back);
    }
    wrap.append(mark, heading, sub, card);
    root.appendChild(wrap);
  }
  draw();
}

// ── App shell ───────────────────────────────────────────────────────
function renderApp() {
  root.innerHTML = '';
  const topbar = el('div', { class: 'topbar' }, [
    el('div', { class: 'brand' }, [el('div', { class: 'mark' }, 'M'), el('h2', {}, 'Milk Round')]),
  ]);
  const screen = el('div', { class: 'screen', id: 'screen' });
  const nav = el('div', { class: 'bottomnav' }, [
    navBtn('home', 'Home', ICONS.home),
    navBtn('sub', 'Subscribe', ICONS.sub),
    navBtn('wallet', 'Wallet', ICONS.wallet),
    navBtn('track', 'Track', ICONS.track),
    navBtn('profile', 'Profile', ICONS.profile),
  ]);
  root.append(topbar, screen, nav);
  renderTab();
}

function navBtn(tab, label, icon) {
  const b = el('button', { class: state.tab === tab ? 'active' : '' }, [el('div', { html: icon }), el('span', {}, label)]);
  b.onclick = () => { state.tab = tab; renderApp(); };
  return b;
}

function renderTab() {
  const screen = document.getElementById('screen');
  screen.innerHTML = '<div class="center-fill"><div class="spinner"></div></div>';
  const renderers = { home: renderHome, sub: renderSubscribe, wallet: renderWallet, track: renderTrack, profile: renderProfile };
  renderers[state.tab](screen);
}

// ── Home ────────────────────────────────────────────────────────────
async function renderHome(screen) {
  const data = await api('/customer/home');
  state.home = data;
  screen.innerHTML = '';

  const tiles = el('div', { class: 'tile-grid' }, [
    tile('milk', 'Milk', ICONS.milk, true),
    tile('veg', 'Vegetables', ICONS.veg, false),
    tile('grocery', 'Groceries', ICONS.basket, false),
    tile('organic', 'Organic', ICONS.leaf, false),
  ]);
  screen.appendChild(tiles);

  if (!data.zone) {
    screen.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Set your address'),
      el('p', { class: 'muted' }, data.message),
      el('button', { class: 'btn btn-primary', onclick: () => { state.tab = 'profile'; renderApp(); } }, 'Go to Profile'),
    ]));
    return;
  }

  const hero = el('div', { class: 'hero' });
  if (data.heroVideos.milk) {
    hero.appendChild(el('video', { src: data.heroVideos.milk, autoplay: '', muted: '', loop: '', playsinline: '' }));
  } else {
    hero.style.background = 'linear-gradient(135deg, var(--accent-soft), var(--amber-soft))';
  }
  hero.appendChild(el('div', { class: 'hero-caption' }, [el('h3', {}, `Delivering to ${data.zone.name}`), el('p', { class: 'small', style: 'margin:0;opacity:.9;' }, 'Farm-fresh, every morning.')]));
  screen.appendChild(hero);

  const offer = data.products.find((p) => p.discount_active);
  if (offer) {
    screen.appendChild(el('div', { class: 'card tight', style: 'background:var(--amber-soft);border-color:var(--amber);' }, [
      el('span', { class: 'badge badge-amber' }, `${offer.discount_pct}% OFF`),
      el('p', { style: 'margin:6px 0 0;font-weight:600;' }, offer.banner_text || `${offer.name} is on offer`),
    ]));
  }

  const list = el('div', { class: 'card' }, [el('h3', { style: 'margin-bottom:10px;' }, 'Products')]);
  data.products.forEach((p) => {
    const price = p.discount_active ? p.price * (1 - p.discount_pct / 100) : p.price;
    const row = el('div', { class: 'list-row' }, [
      el('div', {}, [el('div', { style: 'font-weight:600;' }, `${p.name} · ${p.pack_size}`), el('div', { class: 'muted small' }, p.discount_active ? el('span', {}, [el('s', {}, rupees(p.price)), ' ', rupees(price)]) : rupees(price))]),
    ]);
    list.appendChild(row);
  });
  screen.appendChild(list);

  if (data.instantAvailable) {
    const stock = data.stockByProduct;
    const card = el('div', { class: 'card' }, [
      el('div', { style: 'display:flex;align-items:center;justify-content:space-between;' }, [el('h3', {}, 'Instant Delivery'), el('span', { class: 'badge badge-accent' }, 'Available now')]),
      el('p', { class: 'muted small' }, 'Order now, delivered today.'),
    ]);
    const cart = {};
    data.products.forEach((p) => {
      const avail = stock[p.id] || 0;
      if (avail <= 0) return;
      const row = el('div', { class: 'list-row' });
      const qty = el('span', {}, '0');
      const minus = el('button', { class: 'btn btn-outline btn-sm' }, '−');
      const plus = el('button', { class: 'btn btn-outline btn-sm' }, '+');
      cart[p.id] = 0;
      minus.onclick = () => { if (cart[p.id] > 0) cart[p.id]--; qty.textContent = cart[p.id]; };
      plus.onclick = () => { if (cart[p.id] < avail) cart[p.id]++; qty.textContent = cart[p.id]; };
      row.append(el('div', {}, `${p.name} (${avail} left)`), el('div', { style: 'display:flex;align-items:center;gap:10px;' }, [minus, qty, plus]));
      card.appendChild(row);
    });
    const orderBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:10px;' }, 'Order now');
    orderBtn.onclick = () => placeInstantOrder(cart, data.products);
    card.appendChild(orderBtn);
    screen.appendChild(card);
  }
}

function tile(id, label, icon, active) {
  const t = el('div', { class: 'tile' + (active ? ' active' : ' locked') }, [
    el('div', { class: 'tile-icon', html: icon }),
    el('span', {}, label),
  ]);
  t.onclick = () => toast(active ? `${label} selected` : `${label} — coming soon`);
  return t;
}

async function placeInstantOrder(cart, products) {
  const items = Object.entries(cart).filter(([, q]) => q > 0).map(([product_id, qty]) => ({ product_id, qty }));
  if (items.length === 0) return toast('Add at least one item', true);
  const total = items.reduce((sum, it) => {
    const p = products.find((x) => x.id === it.product_id);
    const price = p.discount_active ? p.price * (1 - p.discount_pct / 100) : p.price;
    return sum + price * it.qty;
  }, 0);
  openPaySheet(total, 'Instant delivery', async (payment_method, proof) => {
    const res = await api('/customer/order', { method: 'POST', body: { items, payment_method, ...proof } });
    toast('Order placed! Track it in the Track tab.');
    state.tab = 'track';
    renderApp();
  });
}

// ── Subscribe ───────────────────────────────────────────────────────
async function renderSubscribe(screen) {
  const [{ subscriptions }, home] = await Promise.all([api('/customer/subscription'), api('/customer/home')]);
  screen.innerHTML = '';
  if (!home.zone) {
    screen.appendChild(el('div', { class: 'card' }, [el('p', {}, 'Set your address in Profile before subscribing.')]));
    return;
  }
  const product = home.products.find((p) => p.name.toLowerCase().includes('full cream')) || home.products[0];
  if (!product) {
    screen.appendChild(el('div', { class: 'card' }, [el('p', {}, 'No products are set up yet — check back soon.')]));
    return;
  }
  const existing = subscriptions.find((s) => s.product_id === product?.id);

  if (existing) {
    const cyclePct = Math.round(((existing.cycle_days - existing.days_remaining) / existing.cycle_days) * 100);
    screen.appendChild(el('div', { class: 'card' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;' }, [el('h3', {}, existing.products?.name || 'Your subscription'), el('span', { class: 'badge badge-accent' }, existing.status)]),
      el('p', { class: 'muted small' }, `${existing.plan} · ${existing.qty_per_day}/day`),
      el('div', { style: 'height:8px;background:var(--border);border-radius:4px;margin:10px 0;overflow:hidden;' }, [el('div', { style: `height:100%;width:${cyclePct}%;background:var(--accent);` })]),
      el('p', { class: 'small' }, `${existing.days_remaining} of ${existing.cycle_days} days left this cycle`),
      existing.pending_plan ? el('p', { class: 'small', style: 'color:var(--amber);' }, `Changing to ${existing.pending_plan} / ${existing.pending_qty_per_day} per day next cycle`) : null,
    ]));
  }

  const card = el('div', { class: 'card' }, [el('h3', {}, existing ? 'Change plan' : 'Subscribe to ' + (product?.name || 'Milk'))]);
  const planSel = el('select', {}, ['Daily', 'Weekly', 'Monthly'].map((p) => el('option', { value: p, selected: existing?.plan === p ? '' : undefined }, p)));
  const qtyInput = el('input', { type: 'number', min: '1', value: existing?.qty_per_day || 1, style: 'margin-top:10px;' });
  const costLine = el('p', { class: 'small muted', style: 'margin-top:10px;' });
  const cycleDays = { Daily: 1, Weekly: 7, Monthly: 30 };
  function updateCost() {
    const unit = product.discount_active ? product.price * (1 - product.discount_pct / 100) : product.price;
    const cost = unit * Number(qtyInput.value || 1) * cycleDays[planSel.value];
    costLine.textContent = `This cycle: ${rupees(cost)} (${planSel.value.toLowerCase()})`;
  }
  planSel.onchange = updateCost;
  qtyInput.oninput = updateCost;
  updateCost();

  const btn = el('button', { class: 'btn btn-primary', style: 'margin-top:14px;' }, existing && existing.days_remaining > 0 ? 'Save change for next cycle' : 'Subscribe & pay');
  btn.onclick = () => {
    const plan = planSel.value;
    const qty = Number(qtyInput.value || 1);
    const unit = product.discount_active ? product.price * (1 - product.discount_pct / 100) : product.price;
    const cost = unit * qty * cycleDays[plan];
    if (existing && existing.status === 'Active' && existing.days_remaining > 0) {
      api('/customer/subscription', { method: 'POST', body: { product_id: product.id, plan, qty_per_day: qty, payment_method: 'wallet' } })
        .then((r) => { toast(r.message); renderApp(); })
        .catch((e) => toast(e.message, true));
      return;
    }
    openPaySheet(cost, `${plan} subscription`, async (payment_method, proof) => {
      await api('/customer/subscription', { method: 'POST', body: { product_id: product.id, plan, qty_per_day: qty, payment_method, ...proof } });
      toast('Subscribed! Deliveries start tomorrow.');
      renderApp();
    });
  };
  card.append(planSel, qtyInput, costLine, btn);
  screen.appendChild(card);
}

// ── Wallet ──────────────────────────────────────────────────────────
async function renderWallet(screen) {
  const data = await api('/customer/wallet');
  state.wallet = data;
  screen.innerHTML = '';
  screen.appendChild(el('div', { class: 'card', style: 'text-align:center;' }, [
    el('p', { class: 'muted small' }, 'Wallet balance'),
    el('h1', {}, rupees(data.wallet?.balance)),
  ]));
  const rechargeCard = el('div', { class: 'card' }, [el('h3', {}, 'Add money')]);
  const amountRow = el('div', { class: 'btn-row', style: 'margin-bottom:10px;' });
  [100, 300, 500].forEach((amt) => {
    const b = el('button', { class: 'btn btn-outline' }, rupees(amt));
    b.onclick = () => recharge(amt);
    amountRow.appendChild(b);
  });
  rechargeCard.appendChild(amountRow);
  screen.appendChild(rechargeCard);

  const txCard = el('div', { class: 'card' }, [el('h3', { style: 'margin-bottom:8px;' }, 'History')]);
  if (data.transactions.length === 0) txCard.appendChild(el('p', { class: 'muted small' }, 'No transactions yet.'));
  data.transactions.forEach((t) => {
    txCard.appendChild(el('div', { class: 'list-row' }, [
      el('div', {}, [el('div', { style: 'font-weight:600;' }, t.note), el('div', { class: 'muted small' }, timeAgo(t.date))]),
      el('div', { style: `font-weight:700;color:${t.type === 'credit' ? 'var(--accent)' : 'var(--ink)'}` }, (t.type === 'credit' ? '+' : '−') + rupees(t.amount)),
    ]));
  });
  screen.appendChild(txCard);
}

function recharge(amount) {
  openPaySheet(amount, 'Wallet recharge', async (payment_method, proof) => {
    if (payment_method !== 'razorpay') return toast('Choose UPI/Card to recharge', true);
    await api('/customer/wallet', { method: 'POST', body: { amount, ...proof } });
    toast('Wallet recharged');
    renderApp();
  }, true);
}

// ── Track ───────────────────────────────────────────────────────────
async function renderTrack(screen) {
  const data = await api('/customer/order');
  screen.innerHTML = '';
  const steps = ['Pending', 'Delivered'];
  screen.appendChild(el('h3', {}, 'Today'));
  if (data.today.length === 0) {
    screen.appendChild(el('div', { class: 'card' }, [el('p', { class: 'muted' }, 'No delivery scheduled for today yet.')]));
  }
  data.today.forEach((o) => screen.appendChild(orderCard(o)));

  screen.appendChild(el('h3', { style: 'margin-top:18px;' }, 'History'));
  if (data.history.length === 0) screen.appendChild(el('p', { class: 'muted small' }, 'Nothing here yet.'));
  data.history.filter((o) => !data.today.find((t) => t.id === o.id)).forEach((o) => screen.appendChild(orderCard(o)));
}

function statusBadgeClass(status) {
  return { Delivered: 'badge-accent', 'Partially Delivered': 'badge-amber', 'Not Delivered': 'badge-danger', Pending: 'badge-muted' }[status] || 'badge-muted';
}

function orderCard(o) {
  const itemsText = (o.items || []).map((i) => `${i.name} ×${i.qty}`).join(', ');
  return el('div', { class: 'card tight' }, [
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;' }, [
      el('span', { style: 'font-weight:600;' }, o.date),
      el('span', { class: 'badge ' + statusBadgeClass(o.status) }, o.status),
    ]),
    el('p', { class: 'small muted', style: 'margin-top:6px;' }, itemsText),
    o.not_delivered_reason ? el('p', { class: 'small', style: 'color:var(--danger);' }, `Reason: ${o.not_delivered_reason}`) : null,
  ]);
}

// ── Profile ─────────────────────────────────────────────────────────
async function renderProfile(screen) {
  const { customer, zone } = await api('/customer/me');
  const zonesRes = await api('/customer/home').catch(() => ({}));
  screen.innerHTML = '';
  const card = el('div', { class: 'card' }, [el('h3', {}, 'Your details')]);
  const nameInput = el('input', { type: 'text', value: customer.name || '', placeholder: 'Full name' });
  const addrInput = el('textarea', { rows: '2', placeholder: 'Address' }, customer.address_text || '');
  const gpsBtn = el('button', { class: 'btn btn-outline', style: 'margin-top:10px;' }, zone ? `📍 ${zone.name}` : '📍 Capture my location');
  let lat = customer.lat, lng = customer.lng;
  gpsBtn.onclick = () => {
    if (!navigator.geolocation) return toast('Geolocation not supported on this device', true);
    gpsBtn.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition(
      (pos) => { lat = pos.coords.latitude; lng = pos.coords.longitude; gpsBtn.textContent = '📍 Location captured'; toast('Location captured — save to confirm'); },
      () => { toast('Could not get location', true); gpsBtn.textContent = '📍 Capture my location'; }
    );
  };
  const saveBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:14px;' }, 'Save changes');
  saveBtn.onclick = async () => {
    await api('/customer/me', { method: 'PATCH', body: { name: nameInput.value, address_text: addrInput.value, lat, lng } });
    toast('Saved');
  };
  card.append(nameInput, addrInput, gpsBtn, saveBtn);
  screen.appendChild(card);

  const logoutBtn = el('button', { class: 'btn btn-outline' }, 'Log out');
  logoutBtn.onclick = () => { document.cookie = 'mr_session=; Max-Age=0; path=/'; location.reload(); };
  screen.appendChild(el('div', { class: 'card' }, [logoutBtn]));
}

// ── Payment sheet (Wallet vs UPI/Card) ─────────────────────────────
function openPaySheet(amount, description, onConfirm, forceRazorpay) {
  const overlay = el('div', { class: 'overlay' });
  const sheet = el('div', { class: 'sheet' }, [
    el('h3', {}, description),
    el('p', { class: 'muted' }, `Amount: ${rupees(amount)}`),
  ]);
  const walletBtn = el('button', { class: 'btn btn-secondary', style: 'margin-top:10px;' }, 'Pay from Wallet');
  const rzpBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:10px;' }, 'Pay with UPI / Card');
  const cancel = el('button', { class: 'btn btn-outline', style: 'margin-top:10px;' }, 'Cancel');
  cancel.onclick = () => overlay.remove();

  walletBtn.onclick = async () => {
    overlay.remove();
    try {
      await onConfirm('wallet', {});
    } catch (e) { toast(e.message, true); }
  };
  rzpBtn.onclick = async () => {
    overlay.remove();
    try {
      const order = await api('/razorpay/create-order', { method: 'POST', body: { amount, purpose: description.includes('Wallet') ? 'wallet_recharge' : description.includes('Instant') ? 'instant_order' : 'subscription' } });
      const payment = await payWithRazorpay({ key_id: order.key_id, order_id: order.order_id, amount: order.amount, name: 'Milk Round', description, prefillPhone: state.profile?.phone });
      await onConfirm('razorpay', { razorpay_order_id: payment.razorpay_order_id, razorpay_payment_id: payment.razorpay_payment_id, razorpay_signature: payment.razorpay_signature });
    } catch (e) { toast(e.message, true); }
  };

  sheet.append(...(forceRazorpay ? [rzpBtn, cancel] : [walletBtn, rzpBtn, cancel]));
  overlay.appendChild(sheet);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

boot();
