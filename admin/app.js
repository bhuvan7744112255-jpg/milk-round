const { api, toast, rupees, el, runScreen } = MR;
const root = document.getElementById('app');

const TABS = [
  { id: 'revenue', label: 'Revenue & Orders' },
  { id: 'zones', label: 'Zones' },
  { id: 'products', label: 'Products & Pricing' },
  { id: 'inventory', label: 'Daily Inventory' },
  { id: 'subscribers', label: 'Subscribers' },
  { id: 'partners', label: 'Delivery Partners' },
  { id: 'exceptions', label: 'Exceptions' },
];
const state = { tab: 'revenue' };

async function boot() {
  try {
    await api('/admin/zones');
    renderApp();
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      renderAuth();
    } else {
      console.error('Boot failed:', err);
      root.innerHTML = '';
      root.appendChild(
        el('div', { class: 'load-error', style: 'min-height:100vh;justify-content:center;' }, [
          el('h3', {}, 'Couldn\u2019t reach Milk Round'),
          el('p', {}, err.message || 'Check your connection and try again.'),
          el('button', { class: 'btn btn-primary', style: 'width:auto;padding:11px 24px;', onclick: boot }, 'Retry'),
        ])
      );
    }
  }
}

// ── Auth ────────────────────────────────────────────────────────────
function renderAuth() {
  let step = 'phone';
  let phone = '';
  function draw() {
    root.innerHTML = '';
    const wrap = el('div', { class: 'center-fill', style: 'flex-direction:column;gap:16px;min-height:100vh;' });
    const box = el('div', { class: 'card', style: 'width:340px;' }, [
      el('h2', {}, 'Admin sign in'),
      el('p', { class: 'muted small', style: 'margin-bottom:14px;' }, step === 'phone' ? 'Enter an authorized admin number.' : `Code sent to ${phone}`),
    ]);
    if (step === 'phone') {
      const input = el('input', { type: 'tel', placeholder: '10-digit mobile number', maxlength: '10' });
      const btn = el('button', { class: 'btn btn-primary', style: 'margin-top:12px;' }, 'Send OTP');
      btn.onclick = async () => {
        const val = input.value.replace(/\D/g, '');
        if (val.length !== 10) return toast('Enter a valid number', true);
        btn.disabled = true; btn.textContent = 'Sending…';
        try {
          await api('/otp/send', { method: 'POST', body: { phone: val, role: 'admin' } });
          phone = val; step = 'otp'; draw();
        } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Send OTP'; }
      };
      box.append(input, btn);
    } else {
      const otpInput = el('input', { class: 'otp-input', maxlength: '6', placeholder: '••••••' });
      const btn = el('button', { class: 'btn btn-primary', style: 'margin-top:12px;' }, 'Verify');
      btn.onclick = async () => {
        btn.disabled = true; btn.textContent = 'Verifying…';
        try {
          await api('/otp/verify', { method: 'POST', body: { phone, otp: otpInput.value, role: 'admin' } });
          renderApp();
        } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Verify'; }
      };
      box.append(otpInput, btn);
    }
    wrap.appendChild(box);
    root.appendChild(wrap);
  }
  draw();
}

// ── Shell ───────────────────────────────────────────────────────────
function renderApp() {
  root.innerHTML = '';
  const shell = el('div', { class: 'admin-shell' });
  const sidebar = el('div', { class: 'admin-sidebar' }, [el('div', { class: 'brand' }, 'Milk Round')]);
  TABS.forEach((t) => {
    const b = el('button', { class: state.tab === t.id ? 'active' : '' }, t.label);
    b.onclick = () => { state.tab = t.id; renderApp(); };
    sidebar.appendChild(b);
  });
  const logout = el('button', { style: 'margin-top:auto;color:var(--danger);' }, 'Log out');
  logout.onclick = () => { document.cookie = 'mr_session=; Max-Age=0; path=/'; location.reload(); };
  sidebar.appendChild(logout);

  const main = el('div', { class: 'admin-main', id: 'main' });
  shell.append(sidebar, main);
  root.appendChild(shell);

  const renderers = {
    revenue: renderRevenue, zones: renderZones, products: renderProducts,
    inventory: renderInventory, subscribers: renderSubscribers, partners: renderPartners, exceptions: renderExceptions,
  };
  runScreen(main, renderers[state.tab]);
}

function statCard(label, value) {
  return el('div', { class: 'stat-card' }, [el('p', { class: 'muted small' }, label), el('div', { class: 'stat-value' }, String(value))]);
}

// ── Revenue & Orders ────────────────────────────────────────────────
async function renderRevenue(main) {
  const [summary, { procurement }, { dispatch }, { orders }] = await Promise.all([
    api('/admin/summary'), api('/admin/procurement'), api('/admin/dispatch'), api('/admin/orders'),
  ]);
  main.innerHTML = '';
  main.appendChild(el('h1', {}, 'Revenue & Orders Overview'));
  main.appendChild(el('p', { class: 'muted', style: 'margin-bottom:18px;' }, `Data for ${summary.date}`));

  main.appendChild(el('h3', { style: 'margin-bottom:10px;' }, '📊 Key Performance Metrics'));
  main.appendChild(el('div', { class: 'stat-grid' }, [
    statCard('Total Customers', summary.totalCustomers ?? 0),
    statCard('New Customers (Today / Yest)', `${summary.newCustomersToday ?? 0} / ${summary.newCustomersYesterday ?? 0}`),
    statCard('Converted Customers', `${summary.convertedCustomersCount ?? 0} (${summary.conversionRate ?? 0}%)`),
    statCard('Active Subscriptions', summary.activeSubscriptionsCount ?? 0),
    statCard('Average Order Value (AOV)', rupees(summary.aov ?? 0)),
  ]));

  main.appendChild(el('h3', { style: 'margin:20px 0 10px;' }, '📦 Today’s Delivery & Revenue Rollup'));
  main.appendChild(el('div', { class: 'stat-grid' }, [
    statCard('Total Orders Today', summary.totalOrders),
    statCard('Not Delivered (OND)', summary.ond),
    statCard('Partially Delivered (PD)', summary.pd),
    statCard('Revenue Lost', rupees(summary.revenueLost)),
    statCard('Revenue Realized', rupees(summary.revenueRealized)),
  ]));

  main.appendChild(el('h2', { style: 'margin-top:24px;' }, 'Procurement — Tomorrow, All Zones'));
  main.appendChild(dataTable(['Product', 'Units Needed'], procurement.map((p) => [p.name, p.units])));

  main.appendChild(el('h2', { style: 'margin-top:22px;' }, 'Dispatch — Tomorrow, By Zone'));
  main.appendChild(dataTable(
    ['Zone', 'Product', 'Needed', 'Current Stock', 'Status'],
    dispatch.map((d) => [d.zone_name, d.product_name, d.units_needed, d.current_stock, d.short ? el('span', { class: 'badge badge-danger' }, 'Short') : el('span', { class: 'badge badge-accent' }, 'OK')])
  ));

  main.appendChild(el('h2', { style: 'margin-top:22px;' }, "Today's Orders"));
  const rows = orders.map((o) => {
    const itemsText = (o.items || []).map((i) => `${i.name} ×${i.qty}`).join(', ');
    let action = el('span', { class: 'badge ' + statusBadgeClass(o.status) }, o.status);
    if (o.status === 'Pending') {
      const wrap = el('div', { style: 'display:flex;gap:6px;' });
      const mk = (label, status) => {
        const b = el('button', { class: 'btn btn-outline btn-sm' }, label);
        b.onclick = async () => {
          let reason;
          if (status === 'Not Delivered') reason = prompt('Reason (gate locked / no answer / subscription paused / wrong address)?') || 'Not specified';
          try {
            await api('/admin/orders', { method: 'PUT', body: { id: o.id, status, reason } });
            toast('Updated');
            renderApp();
          } catch (e) { toast(e.message, true); }
        };
        return b;
      };
      wrap.append(mk('Delivered', 'Delivered'), mk('Partial', 'Partially Delivered'), mk('Not delivered', 'Not Delivered'));
      action = wrap;
    }
    return [o.customers?.name || o.customers?.phone || '—', o.zones?.name, itemsText, action];
  });
  main.appendChild(dataTable(['Customer', 'Zone', 'Items', 'Outcome'], rows));
}

function statusBadgeClass(status) {
  return { Delivered: 'badge-accent', 'Partially Delivered': 'badge-amber', 'Not Delivered': 'badge-danger', Pending: 'badge-muted' }[status] || 'badge-muted';
}

function dataTable(cols, rows) {
  const table = el('table', { class: 'data-table' });
  table.appendChild(el('thead', {}, [el('tr', {}, cols.map((c) => el('th', {}, c)))]));
  const tbody = el('tbody', {});
  if (rows.length === 0) tbody.appendChild(el('tr', {}, [el('td', { colspan: String(cols.length), class: 'muted' }, 'Nothing here yet.')]));
  rows.forEach((r) => tbody.appendChild(el('tr', {}, r.map((cell) => el('td', {}, cell instanceof Node ? cell : String(cell ?? ''))))));
  table.appendChild(tbody);
  return el('div', { class: 'card', style: 'overflow-x:auto;' }, [table]);
}

// ── Zones ───────────────────────────────────────────────────────────
async function renderZones(main) {
  const { zones } = await api('/admin/zones');
  main.innerHTML = '';
  main.appendChild(el('h1', {}, 'Zones'));

  const form = el('div', { class: 'card' }, [el('h3', {}, 'Add a zone')]);
  const name = el('input', { placeholder: 'Zone name' });
  const pincode = el('input', { placeholder: 'Pincode' });
  const lat = el('input', { placeholder: 'Hub latitude', type: 'number', step: 'any' });
  const lng = el('input', { placeholder: 'Hub longitude', type: 'number', step: 'any' });
  const addBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:8px;' }, 'Add zone');
  addBtn.onclick = async () => {
    if (!name.value || !lat.value || !lng.value) return toast('Name, latitude and longitude are required', true);
    await api('/admin/zones', { method: 'POST', body: { name: name.value, pincode: pincode.value, hub_lat: Number(lat.value), hub_lng: Number(lng.value), instant_delivery_enabled: false } });
    toast('Zone added');
    renderApp();
  };
  form.append(name, pincode, lat, lng, addBtn);
  main.appendChild(form);

  main.appendChild(dataTable(
    ['Name', 'Pincode', 'Hub Coordinates', 'Instant Delivery Toggle', 'Actions'],
    zones.map((z) => {
      const toggle = el('button', { class: 'btn btn-sm ' + (z.instant_delivery_enabled ? 'btn-primary' : 'btn-outline') }, z.instant_delivery_enabled ? 'Instant ON' : 'Instant OFF');
      toggle.onclick = async () => {
        try {
          await api('/admin/zones', { method: 'PUT', body: { id: z.id, instant_delivery_enabled: !z.instant_delivery_enabled } });
          toast(`Instant delivery turned ${!z.instant_delivery_enabled ? 'ON' : 'OFF'}`);
          renderApp();
        } catch (e) {
          toast(e.message, true);
        }
      };
      const del = el('button', { class: 'btn btn-outline btn-sm' }, 'Delete');
      del.onclick = async () => {
        if (confirm(`Delete zone "${z.name}"?`)) {
          try {
            await api('/admin/zones', { method: 'DELETE', body: { id: z.id } });
            toast('Zone deleted');
            renderApp();
          } catch (e) {
            toast(e.message, true);
          }
        }
      };
      return [z.name, z.pincode || '—', `${z.hub_lat}, ${z.hub_lng}`, toggle, del];
    })
  ));
}

// ── Products & Pricing ──────────────────────────────────────────────
async function renderProducts(main) {
  const { products } = await api('/admin/products');
  main.innerHTML = '';
  main.appendChild(el('h1', {}, 'Products & Pricing'));

  const form = el('div', { class: 'card' }, [el('h3', {}, 'Add a product')]);
  const name = el('input', { placeholder: 'Product name' });
  const pack = el('input', { placeholder: 'Pack size, e.g. 500 ml' });
  const price = el('input', { placeholder: 'Price (₹)', type: 'number', step: '0.01' });
  const addBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:8px;' }, 'Add product');
  addBtn.onclick = async () => {
    if (!name.value || !price.value) return toast('Name and price are required', true);
    await api('/admin/products', { method: 'POST', body: { name: name.value, pack_size: pack.value, price: Number(price.value), discount_pct: 0, discount_active: false } });
    toast('Product added');
    renderApp();
  };
  form.append(name, pack, price, addBtn);
  main.appendChild(form);

  products.forEach((p) => {
    const priceInput = el('input', { type: 'number', step: '0.01', value: p.price, style: 'width:90px;' });
    const discInput = el('input', { type: 'number', step: '1', value: p.discount_pct, style: 'width:70px;' });
    const activeToggle = el('button', { class: 'btn btn-sm ' + (p.discount_active ? 'btn-primary' : 'btn-outline') }, p.discount_active ? 'Offer live' : 'No offer');
    let discountActive = p.discount_active;
    activeToggle.onclick = () => {
      discountActive = !discountActive;
      activeToggle.textContent = discountActive ? 'Offer live' : 'No offer';
      activeToggle.className = 'btn btn-sm ' + (discountActive ? 'btn-primary' : 'btn-outline');
    };
    const bannerInput = el('input', { placeholder: 'Banner text for the offer', value: p.banner_text || '', style: 'width:100%;margin-top:8px;' });
    const saveBtn = el('button', { class: 'btn btn-secondary btn-sm', style: 'margin-top:8px;' }, 'Save Offer & Price');
    saveBtn.onclick = async () => {
      try {
        await api('/admin/products', { method: 'PUT', body: { id: p.id, price: Number(priceInput.value), discount_pct: Number(discInput.value), discount_active: discountActive, banner_text: bannerInput.value } });
        toast('Product updated');
      } catch (e) {
        toast(e.message, true);
      }
    };
    const broadcastBtn = el('button', { class: 'btn btn-amber btn-sm', style: 'margin-top:8px;' }, 'Broadcast Offer');
    broadcastBtn.onclick = async () => {
      const r = await api('/admin/broadcast', { method: 'POST', body: { product_id: p.id, message: bannerInput.value || `${p.name} is on offer` } });
      toast(r.note || 'Broadcast simulated');
    };
    const delBtn = el('button', { class: 'btn btn-outline btn-sm', style: 'margin-top:8px;' }, 'Delete Product');
    delBtn.onclick = async () => {
      if (confirm(`Delete product "${p.name}"?`)) {
        try {
          await api('/admin/products', { method: 'DELETE', body: { id: p.id } });
          toast('Product deleted');
          renderApp();
        } catch (e) {
          toast(e.message, true);
        }
      }
    };

    main.appendChild(el('div', { class: 'card' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;' }, [el('h3', {}, `${p.name} · ${p.pack_size || ''}`), activeToggle]),
      el('div', { style: 'display:flex;gap:14px;align-items:center;margin-top:10px;' }, [
        el('label', { class: 'small muted' }, ['Price ₹', priceInput]),
        el('label', { class: 'small muted' }, ['Discount %', discInput]),
      ]),
      bannerInput,
      el('div', { class: 'btn-row', style: 'margin-top:8px;' }, [saveBtn, broadcastBtn, delBtn]),
    ]));
  });
}

// ── Daily Inventory ─────────────────────────────────────────────────
async function renderInventory(main) {
  const { zones } = await api('/admin/zones');
  const { products } = await api('/admin/products');
  main.innerHTML = '';
  main.appendChild(el('h1', {}, 'Daily Inventory'));

  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const zoneSelect = el('select', {}, zones.map((z) => el('option', { value: z.id }, z.name)));
  const dateInput = el('input', { type: 'date', value: tomorrow.toISOString().slice(0, 10) });
  const controls = el('div', { class: 'card' }, [
    el('div', { style: 'display:flex;gap:14px;align-items:flex-end;' }, [
      el('label', { class: 'small muted' }, ['Zone', zoneSelect]),
      el('label', { class: 'small muted' }, ['Date', dateInput]),
    ]),
  ]);
  main.appendChild(controls);

  const tableWrap = el('div', { id: 'inv-table' });
  main.appendChild(tableWrap);

  async function draw() {
    tableWrap.innerHTML = '<div class="spinner"></div>';
    const { inventory } = await api(`/admin/inventory?zone_id=${zoneSelect.value}&date=${dateInput.value}`);
    const stockMap = Object.fromEntries(inventory.map((r) => [r.product_id, r.qty_available]));
    tableWrap.innerHTML = '';
    const card = el('div', { class: 'card' });
    products.forEach((p) => {
      const input = el('input', { type: 'number', min: '0', value: stockMap[p.id] ?? 0, style: 'width:90px;' });
      const save = el('button', { class: 'btn btn-secondary btn-sm' }, 'Save Stock');
      save.onclick = async () => {
        await api('/admin/inventory', { method: 'POST', body: { zone_id: zoneSelect.value, product_id: p.id, date: dateInput.value, qty_available: Number(input.value) } });
        toast('Stock updated');
      };
      const clearOne = el('button', { class: 'btn btn-outline btn-sm' }, 'Clear');
      clearOne.onclick = async () => {
        await api('/admin/inventory', { method: 'POST', body: { zone_id: zoneSelect.value, date: dateInput.value, clear_product_id: p.id } });
        toast(`Cleared stock for ${p.name}`);
        draw();
      };
      card.appendChild(el('div', { class: 'list-row', style: 'padding:8px 0;' }, [
        el('span', { style: 'font-weight:600;' }, p.name),
        el('div', { style: 'display:flex;gap:8px;align-items:center;' }, [input, save, clearOne])
      ]));
    });
    const clearBtn = el('button', { class: 'btn btn-outline', style: 'margin-top:14px;color:var(--danger);' }, 'Clear ALL stock for this zone/date');
    clearBtn.onclick = async () => {
      if (!confirm('Set every product to zero stock for this zone and date?')) return;
      await api('/admin/inventory', { method: 'POST', body: { zone_id: zoneSelect.value, date: dateInput.value, clear_all: true } });
      toast('All stock cleared');
      draw();
    };
    card.appendChild(clearBtn);
    tableWrap.appendChild(card);
  }
  zoneSelect.onchange = draw;
  dateInput.onchange = draw;
  draw();
}

// ── Subscribers ─────────────────────────────────────────────────────
async function renderSubscribers(main) {
  const [{ subscribers }, { zones }, { products }] = await Promise.all([api('/admin/subscribers'), api('/admin/zones'), api('/admin/products')]);
  main.innerHTML = '';
  main.appendChild(el('h1', {}, 'Subscribers & Delivery Addresses'));

  const form = el('div', { class: 'card' }, [el('h3', {}, 'Add a subscriber')]);
  const phone = el('input', { placeholder: 'Phone number (10 digits)', type: 'tel', maxlength: '10' });
  const name = el('input', { placeholder: 'Name (optional)' });
  const zoneSelect = el('select', {}, zones.map((z) => el('option', { value: z.id }, z.name)));
  const productSelect = el('select', {}, products.map((p) => el('option', { value: p.id }, p.name)));
  const planSelect = el('select', {}, ['Daily', 'Weekly', 'Monthly'].map((p) => el('option', { value: p }, p)));
  const qty = el('input', { type: 'number', min: '1', value: '1', style: 'width:70px;' });
  const addBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:8px;' }, 'Add subscriber');
  addBtn.onclick = async () => {
    if (!phone.value || phone.value.replace(/\D/g, '').length !== 10) {
      return toast('Valid 10-digit phone number is required', true);
    }
    try {
      await api('/admin/subscribers', { method: 'POST', body: { phone: phone.value, name: name.value, zone_id: zoneSelect.value, product_id: productSelect.value, plan: planSelect.value, qty_per_day: Number(qty.value) } });
      toast('Subscriber added');
      renderApp();
    } catch (e) {
      toast(e.message, true);
    }
  };
  form.append(phone, name, zoneSelect, productSelect, planSelect, qty, addBtn);
  main.appendChild(form);

  main.appendChild(dataTable(
    ['Customer Name', 'Phone & Delivery Address', 'Zone', 'Product', 'Plan', 'Qty/day', 'Status', 'Actions'],
    subscribers.map((s) => {
      const statusSelect = el('select', {}, ['Active', 'Paused', 'Cancelled'].map((st) => el('option', { value: st, selected: s.status === st ? '' : undefined }, st)));
      statusSelect.onchange = async () => {
        try {
          await api('/admin/subscribers', { method: 'PUT', body: { id: s.id, status: statusSelect.value } });
          toast('Status updated');
        } catch (e) {
          toast(e.message, true);
        }
      };
      const del = el('button', { class: 'btn btn-outline btn-sm' }, 'Delete');
      del.onclick = async () => {
        if (confirm('Delete this subscription?')) {
          try {
            await api('/admin/subscribers', { method: 'DELETE', body: { id: s.id } });
            toast('Subscription deleted');
            renderApp();
          } catch (e) {
            toast(e.message, true);
          }
        }
      };

      const custDetails = el('div', {}, [
        el('div', { style: 'font-weight:600;' }, s.customers?.phone || '—'),
        el('div', { class: 'small muted', style: 'max-width:260px;word-break:break-word;' }, s.customers?.address_text || '⚠️ Address not set yet'),
      ]);

      return [s.customers?.name || 'Customer', custDetails, s.zones?.name, s.products?.name, s.plan, s.qty_per_day, statusSelect, del];
    })
  ));
}

// ── Delivery Partners ───────────────────────────────────────────────
async function renderPartners(main) {
  const [{ partners }, { zones }] = await Promise.all([api('/admin/partners'), api('/admin/zones')]);
  main.innerHTML = '';
  main.appendChild(el('h1', {}, 'Delivery Partners'));

  const form = el('div', { class: 'card' }, [el('h3', {}, 'Add a delivery partner')]);
  const name = el('input', { placeholder: 'Partner name' });
  const phone = el('input', { placeholder: '10-digit mobile number', type: 'tel', maxlength: '10', inputmode: 'numeric' });
  const addBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:8px;' }, 'Add partner');
  addBtn.onclick = async () => {
    const cleanPhone = phone.value.replace(/\D/g, '');
    if (!name.value || cleanPhone.length !== 10) {
      return toast('Please enter a name and a valid 10-digit phone number', true);
    }
    try {
      await api('/admin/partners', { method: 'POST', body: { name: name.value, phone: cleanPhone, zone_ids: [], status: 'active' } });
      toast('Partner added');
      renderApp();
    } catch (e) {
      toast(e.message, true);
    }
  };
  form.append(name, phone, addBtn);
  main.appendChild(form);

  main.appendChild(dataTable(
    ['Name', 'Phone Number', 'Active Zone', 'Status', 'Actions'],
    partners.map((p) => {
      const statusToggle = el('button', { class: 'btn btn-sm ' + (p.status === 'active' ? 'btn-primary' : 'btn-outline') }, p.status);
      statusToggle.onclick = async () => {
        try {
          await api('/admin/partners', { method: 'PUT', body: { id: p.id, status: p.status === 'active' ? 'inactive' : 'active' } });
          renderApp();
        } catch (e) {
          toast(e.message, true);
        }
      };
      const del = el('button', { class: 'btn btn-outline btn-sm' }, 'Delete');
      del.onclick = async () => {
        if (confirm(`Delete delivery partner "${p.name}"?`)) {
          try {
            await api('/admin/partners', { method: 'DELETE', body: { id: p.id } });
            toast('Partner deleted');
            renderApp();
          } catch (e) {
            toast(e.message, true);
          }
        }
      };
      return [p.name, p.phone, p.zones?.name || '—', statusToggle, del];
    })
  ));
}

// ── Exceptions ──────────────────────────────────────────────────────
async function renderExceptions(main) {
  const { exceptions } = await api('/admin/exceptions');
  main.innerHTML = '';
  main.appendChild(el('h1', {}, 'Exceptions Log'));
  main.appendChild(dataTable(
    ['Date', 'Customer', 'Zone', 'Reason'],
    exceptions.map((e) => [e.date, e.customers?.name || e.customers?.phone || '—', e.zones?.name || '—', e.reason])
  ));
}

boot();
