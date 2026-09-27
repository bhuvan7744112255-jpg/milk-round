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

  // Runs an async screen-render function safely. This is the fix for the
  // "app just hangs on a spinner forever" bug: every screen fetch used to be
  // called fire-and-forget, so any failure — a bad session, a network blip,
  // a bug — became a silently swallowed promise rejection with nothing on
  // screen and nothing in the console. Now every screen goes through here:
  // errors are logged, shown, and recoverable with one tap instead of a
  // forced app restart.
  function runScreen(container, renderFn) {
    container.innerHTML = '<div class="center-fill"><div class="spinner"></div></div>';
    Promise.resolve()
      .then(() => renderFn(container))
      .catch((err) => {
        console.error('Screen failed to load:', err);
        container.innerHTML = '';
        container.appendChild(
          el('div', { class: 'load-error' }, [
            el('h3', {}, 'Something didn\u2019t load'),
            el('p', {}, err.message || 'Please try again.'),
            el('button', { class: 'btn btn-primary', style: 'width:auto;padding:11px 24px;', onclick: () => runScreen(container, renderFn) }, 'Retry'),
          ])
        );
      });
  }

  // Shared OTP login flow used by both the Customer and Partner apps (the
  // only difference is role/copy) so a fix here never has to be repeated.
  // Redesigned deliberately away from the generic "centered card on empty
  // background" template: a bold color panel anchors the brand immediately,
  // a rising sheet holds the actual input.
  function authFlow({ role, appName, tagline, markIcon, onSuccess }) {
    let step = 'phone';
    let phone = '';

    function render(root) {
      root.innerHTML = '';
      const hero = el('div', { class: 'auth-hero' }, [
        el('div', { class: 'auth-mark', html: markIcon }),
        el('h1', {}, step === 'phone' ? appName : 'Check your phone'),
        el('p', {}, step === 'phone' ? tagline : `We texted a code to ${phone}`),
      ]);
      const sheet = el('div', { class: 'auth-sheet' });

      if (step === 'phone') {
        const label = el('div', { class: 'auth-label' }, 'MOBILE NUMBER');
        const input = el('input', { class: 'auth-underline', type: 'tel', placeholder: '98765 43210', maxlength: '10', inputmode: 'numeric', autofocus: '' });
        const actions = el('div', { class: 'auth-actions' });
        const btn = el('button', { class: 'btn btn-primary' }, 'Send code');
        btn.onclick = async () => {
          const val = input.value.replace(/\D/g, '');
          if (val.length !== 10) return toast('Enter a valid 10-digit number', true);
          btn.disabled = true;
          btn.textContent = 'Sending…';
          try {
            await api('/otp/send', { method: 'POST', body: { phone: val, role } });
            phone = val;
            step = 'otp';
            render(root);
          } catch (e) {
            toast(e.message, true);
            btn.disabled = false;
            btn.textContent = 'Send code';
          }
        };
        actions.appendChild(btn);
        sheet.append(label, input, actions);
      } else {
        const label = el('div', { class: 'auth-label' }, '6-DIGIT CODE');
        const otpInput = el('input', { class: 'auth-underline otp-input', type: 'tel', maxlength: '6', inputmode: 'numeric', placeholder: '••••••', autofocus: '' });
        const nameInput = el('input', { type: 'text', placeholder: role === 'customer' ? 'Your name (optional)' : 'Your name', style: 'margin-top:16px;' });
        const actions = el('div', { class: 'auth-actions' });
        const btn = el('button', { class: 'btn btn-primary' }, 'Verify & continue');
        const back = el('button', { class: 'auth-link-btn' }, 'Use a different number');
        back.onclick = () => { step = 'phone'; render(root); };
        btn.onclick = async () => {
          if (otpInput.value.length < 4) return toast('Enter the code', true);
          btn.disabled = true;
          btn.textContent = 'Verifying…';
          try {
            const res = await api('/otp/verify', { method: 'POST', body: { phone, otp: otpInput.value, role, name: nameInput.value || undefined } });
            onSuccess(res.profile);
          } catch (e) {
            toast(e.message, true);
            btn.disabled = false;
            btn.textContent = 'Verify & continue';
          }
        };
        actions.append(btn, back);
        sheet.append(label, otpInput, nameInput, actions);
      }
      root.append(hero, sheet);
    }
    return render;
  }

  window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled error:', e.reason);
    toast((e.reason && e.reason.message) || 'Something went wrong', true);
  });

  return { api, toast, rupees, timeAgo, el, payWithRazorpay, runScreen, authFlow };
})();
