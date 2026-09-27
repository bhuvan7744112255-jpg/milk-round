// Shared across all three apps. Plain global `MR` namespace — no bundler,
// no modules, so any of the three index.html files can just <script src>
// this file directly (see §7 of the spec: "no build step, no npm deps").
const MR = (() => {
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* empty body */
    }
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function toast(message, isError) {
    let root = document.getElementById('toast-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'toast-root';
      document.body.appendChild(root);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function rupees(n) {
    const v = Number(n || 0);
    return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }

  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  // Loads a Razorpay Checkout popup and resolves with the payment proof, or
  // rejects if the user cancels. Requires checkout.js to already be loaded
  // (see the <script> tag in each app's index.html).
  function payWithRazorpay({ key_id, order_id, amount, name, description, prefillPhone }) {
    return new Promise((resolve, reject) => {
      if (!window.Razorpay) return reject(new Error('Razorpay checkout script not loaded'));
      const rzp = new window.Razorpay({
        key: key_id,
        order_id,
        amount,
        currency: 'INR',
        name: name || 'Milk Round',
        description: description || '',
        prefill: { contact: prefillPhone || '' },
        theme: { color: '#4F8F5B' },
        handler: (response) => resolve(response),
        modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
      });
      rzp.on('payment.failed', () => reject(new Error('Payment failed')));
      rzp.open();
    });
  }

  return { api, toast, rupees, timeAgo, el, payWithRazorpay };
})();
