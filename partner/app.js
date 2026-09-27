const { api, toast, rupees, el } = MR;
const root = document.getElementById('app');

const ICONS = {
  route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h8a4 4 0 014 4v0a4 4 0 01-4 4H8a4 4 0 00-4 4v0"/></svg>',
  earnings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 9.5c0-1.4 1.3-2.5 3-2.5s3 1 3 2.2-1.3 1.8-3 2-3 .8-3 2 1.3 2.3 3 2.3 3-1 3-2.3"/></svg>',
  profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  nav: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-8-8 18-2-8-8-2z"/></svg>',
};
const REASONS = ['Gate locked', 'No answer', 'Subscription paused', 'Wrong address'];

const state = { profile: null, tab: 'route' };

async function boot() {
  try {
    const me = await api('/partner/me');
    state.profile = me.partner;
    renderApp();
  } catch {
    renderAuth();
  }
}

// ── Auth ────────────────────────────────────────────────────────────
function renderAuth() {
  let step = 'phone';
  let phone = '';

  function draw() {
    root.innerHTML = '';
    const wrap = el('div', { class: 'screen center-fill', style: 'flex-direction:column;gap:18px;width:100%;padding:0 24px;' });
    const mark = el('div', { style: 'width:56px;height:56px;border-radius:16px;background:var(--accent);display:flex;align-items:center;justify-content:center;margin:0 auto 6px;color:white;font-family:var(--font-head);font-weight:700;font-size:22px;' }, 'M');
    const heading = el('h1', { style: 'text-align:center;' }, step === 'phone' ? 'Partner Login' : 'Verify it\u2019s you');
    const sub = el('p', { class: 'muted', style: 'text-align:center;' }, step === 'phone' ? 'Milk Round delivery team' : `Code sent to ${phone}`);
    const card = el('div', { class: 'card' });

    if (step === 'phone') {
      const input = el('input', { type: 'tel', placeholder: '10-digit mobile number', maxlength: '10', inputmode: 'numeric' });
      const btn = el('button', { class: 'btn btn-primary', style: 'margin-top:12px;' }, 'Send OTP');
      btn.onclick = async () => {
        const val = input.value.replace(/\D/g, '');
        if (val.length !== 10) return toast('Enter a valid 10-digit number', true);
        btn.disabled = true; btn.textContent = 'Sending…';
        try {
          await api('/otp/send', { method: 'POST', body: { phone: val, role: 'partner' } });
          phone = val; step = 'otp'; draw();
        } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Send OTP'; }
      };
      card.append(input, btn);
    } else {
      const otpInput = el('input', { class: 'otp-input', type: 'tel', maxlength: '6', inputmode: 'numeric', placeholder: '••••••' });
      const nameInput = el('input', { type: 'text', placeholder: 'Your name', style: 'margin-top:10px;' });
      const btn = el('button', { class: 'btn btn-primary', style: 'margin-top:12px;' }, 'Verify & continue');
      const back = el('button', { class: 'btn btn-outline', style: 'margin-top:8px;' }, 'Use a different number');
      back.onclick = () => { step = 'phone'; draw(); };
      btn.onclick = async () => {
        if (otpInput.value.length < 4) return toast('Enter the OTP', true);
        btn.disabled = true; btn.textContent = 'Verifying…';
        try {
          const res = await api('/otp/verify', { method: 'POST', body: { phone, otp: otpInput.value, role: 'partner', name: nameInput.value || undefined } });
          state.profile = res.profile;
          renderApp();
        } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Verify & continue'; }
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
    el('div', { class: 'brand' }, [el('div', { class: 'mark' }, 'M'), el('h2', {}, 'Today\u2019s Route')]),
  ]);
  const screen = el('div', { class: 'screen', id: 'screen' });
  const nav = el('div', { class: 'bottomnav' }, [
    navBtn('route', 'Route', ICONS.route),
    navBtn('earnings', 'Earnings', ICONS.earnings),
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
  ({ route: renderRoute, earnings: renderEarnings, profile: renderProfile }[state.tab])(screen);
}

// ── Route ───────────────────────────────────────────────────────────
async function renderRoute(screen) {
  const data = await api('/partner/route');
  screen.innerHTML = '';

  if (data.message) {
    screen.appendChild(el('div', { class: 'card' }, [el('p', {}, data.message)]));
    return;
  }
  if (!data.upNext) {
    screen.appendChild(el('div', { class: 'card', style: 'text-align:center;' }, [
      el('h3', {}, 'All done! 🎉'),
      el('p', { class: 'muted' }, 'No pending stops left in ' + (data.zone?.name || 'your zone') + '.'),
    ]));
    return;
  }

  screen.appendChild(el('span', { class: 'badge badge-accent' }, `${data.stops.length} stop${data.stops.length === 1 ? '' : 's'} left · ${data.zone.name}`));
  screen.appendChild(stopCard(data.upNext, true));

  if (data.stops.length > 1) {
    screen.appendChild(el('h3', { style: 'margin-top:18px;' }, 'Then'));
    data.stops.slice(1).forEach((s) => screen.appendChild(stopCard(s, false)));
  }
}

function stopCard(stop, isNext) {
  const card = el('div', { class: 'card' + (isNext ? '' : ' tight') });
  card.appendChild(el('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;' }, [
    el('div', {}, [
      el('h3', {}, stop.customer_name || 'Customer'),
      el('p', { class: 'muted small', style: 'margin:2px 0;' }, stop.address || 'No address on file'),
    ]),
    el('span', { class: 'badge ' + (stop.instant ? 'badge-amber' : 'badge-accent') }, stop.instant ? 'Instant' : 'Subscription'),
  ]));
  card.appendChild(el('p', { class: 'small' }, (stop.items || []).map((i) => `${i.name} ×${i.qty}`).join(', ')));
  card.appendChild(el('p', { class: 'small muted' }, Number.isFinite(stop.distance_km) ? `${stop.distance_km.toFixed(1)} km from hub` : ''));

  if (isNext) {
    const navBtn2 = el('button', { class: 'btn btn-secondary' }, [el('span', { html: ICONS.nav, style: 'width:16px;height:16px;' }), ' Navigate']);
    navBtn2.onclick = () => {
      if (stop.lat && stop.lng) window.open(`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`, '_blank');
      else toast('No GPS location for this customer yet', true);
    };
    const deliveredBtn = el('button', { class: 'btn btn-primary' }, 'Delivered');
    deliveredBtn.onclick = () => submitOutcome(stop, 'Delivered');
    const issueBtn = el('button', { class: 'btn btn-outline' }, 'Report issue');
    issueBtn.onclick = () => openIssueSheet(stop);
    card.appendChild(navBtn2);
    card.appendChild(el('div', { class: 'btn-row', style: 'margin-top:8px;' }, [deliveredBtn, issueBtn]));
  }
  return card;
}

async function submitOutcome(stop, status, items, reason) {
  try {
    await api('/partner/outcome', { method: 'POST', body: { order_id: stop.order_id, status, items, reason } });
    toast(status === 'Delivered' ? 'Marked delivered' : 'Outcome recorded');
    renderApp();
  } catch (e) {
    toast(e.message, true);
  }
}

function openIssueSheet(stop) {
  const overlay = el('div', { class: 'overlay' });
  const checks = (stop.items || []).map((item) => {
    const cb = el('input', { type: 'checkbox' });
    const row = el('label', { class: 'list-row', style: 'cursor:pointer;' }, [
      el('span', {}, `${item.name} ×${item.qty}`),
      cb,
    ]);
    return { item, cb, row };
  });
  let selectedReason = REASONS[0];
  const reasonChips = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin:10px 0;' });
  REASONS.forEach((r) => {
    const chip = el('button', { class: 'btn btn-outline btn-sm' + (r === selectedReason ? ' active' : '') }, r);
    chip.style.borderColor = r === selectedReason ? 'var(--accent)' : '';
    chip.onclick = () => { selectedReason = r; [...reasonChips.children].forEach((c) => (c.style.borderColor = '')); chip.style.borderColor = 'var(--accent)'; };
    reasonChips.appendChild(chip);
  });

  const sheet = el('div', { class: 'sheet' }, [
    el('h3', {}, 'What happened at this stop?'),
    el('p', { class: 'muted small' }, 'Tick what was actually delivered.'),
    ...checks.map((c) => c.row),
    el('p', { class: 'small muted', style: 'margin-top:10px;' }, 'If nothing was delivered, pick a reason:'),
    reasonChips,
  ]);
  const submit = el('button', { class: 'btn btn-primary', style: 'margin-top:10px;' }, 'Submit');
  submit.onclick = () => {
    const items = checks.map((c) => ({ ...c.item, delivered: c.cb.checked }));
    const deliveredCount = items.filter((i) => i.delivered).length;
    const status = deliveredCount === items.length ? 'Delivered' : deliveredCount === 0 ? 'Not Delivered' : 'Partially Delivered';
    overlay.remove();
    submitOutcome(stop, status, items, status === 'Not Delivered' ? selectedReason : undefined);
  };
  const cancel = el('button', { class: 'btn btn-outline', style: 'margin-top:8px;' }, 'Cancel');
  cancel.onclick = () => overlay.remove();
  sheet.append(submit, cancel);
  overlay.appendChild(sheet);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

// ── Earnings ────────────────────────────────────────────────────────
async function renderEarnings(screen) {
  const data = await api('/partner/earnings');
  screen.innerHTML = '';
  screen.appendChild(el('div', { class: 'card', style: 'text-align:center;' }, [
    el('p', { class: 'muted small' }, 'Today'),
    el('h1', {}, rupees(data.today.total)),
    el('p', { class: 'small muted' }, `${data.today.count} deliveries · ${rupees(data.payoutPerDelivery)} each`),
  ]));
  const week = el('div', { class: 'card' }, [el('h3', { style: 'margin-bottom:8px;' }, 'This week')]);
  if (data.week.length === 0) week.appendChild(el('p', { class: 'muted small' }, 'No completed deliveries yet.'));
  data.week.forEach((d) => week.appendChild(el('div', { class: 'list-row' }, [el('span', {}, d.date), el('span', { style: 'font-weight:700;' }, rupees(d.total))])));
  screen.appendChild(week);
}

// ── Profile ─────────────────────────────────────────────────────────
async function renderProfile(screen) {
  const { partner, zones } = await api('/partner/me');
  screen.innerHTML = '';
  const card = el('div', { class: 'card' }, [el('h3', {}, 'Your details')]);
  const nameInput = el('input', { type: 'text', value: partner.name || '' });
  card.appendChild(nameInput);
  screen.appendChild(card);

  const zoneCard = el('div', { class: 'card' }, [el('h3', {}, 'Zones you cover')]);
  const zoneIds = new Set(partner.zone_ids || []);
  zones.forEach((z) => {
    const cb = el('input', { type: 'checkbox', checked: zoneIds.has(z.id) ? '' : undefined });
    cb.onchange = () => { cb.checked ? zoneIds.add(z.id) : zoneIds.delete(z.id); refreshActiveSelect(); };
    zoneCard.appendChild(el('label', { class: 'list-row', style: 'cursor:pointer;' }, [el('span', {}, z.name), cb]));
  });
  screen.appendChild(zoneCard);

  const activeCard = el('div', { class: 'card' }, [el('h3', {}, 'Working today in')]);
  const activeSelect = el('select', {});
  function refreshActiveSelect() {
    activeSelect.innerHTML = '';
    zones.filter((z) => zoneIds.has(z.id)).forEach((z) => activeSelect.appendChild(el('option', { value: z.id, selected: z.id === partner.active_zone_id ? '' : undefined }, z.name)));
    if (![...zoneIds].length) activeSelect.appendChild(el('option', { value: '' }, 'Tick a zone above first'));
  }
  refreshActiveSelect();
  activeCard.appendChild(activeSelect);
  screen.appendChild(activeCard);

  const saveBtn = el('button', { class: 'btn btn-primary' }, 'Save changes');
  saveBtn.onclick = async () => {
    await api('/partner/me', { method: 'PATCH', body: { name: nameInput.value, zone_ids: [...zoneIds], active_zone_id: activeSelect.value || null } });
    toast('Saved');
    renderApp();
  };
  screen.appendChild(el('div', { class: 'card' }, [saveBtn]));

  const logoutBtn = el('button', { class: 'btn btn-outline' }, 'Log out');
  logoutBtn.onclick = () => { document.cookie = 'mr_session=; Max-Age=0; path=/'; location.reload(); };
  screen.appendChild(el('div', { class: 'card' }, [logoutBtn]));
}

boot();
