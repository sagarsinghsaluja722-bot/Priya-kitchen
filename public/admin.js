// Priya Kitchen — admin dashboard (orders, menu, settings)
(function () {
  'use strict';

  var root = document.getElementById('admin');
  var state = { tab: 'orders', scope: 'active', orders: [], today: { count: 0, revenue: 0 }, menu: [], settings: null, fresh: {}, stream: null, info: null };

  var FLOW = ['placed', 'accepted', 'preparing', 'out_for_delivery', 'delivered'];
  var LABEL = { payment_submitted: 'Check payment', placed: 'New order', accepted: 'Accepted', preparing: 'Preparing', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' };
  var NEXT = { payment_submitted: ['accepted', 'Payment received — accept order'], placed: ['accepted', 'Accept order'], accepted: ['preparing', 'Start preparing'], preparing: ['out_for_delivery', 'Out for delivery'], out_for_delivery: ['delivered', 'Mark delivered'] };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function rupees(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 3500);
  }
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'Something went wrong.'); e.status = r.status; throw e; }
        return j;
      });
    });
  }

  // ---------- alert sound for new orders ----------
  var audioCtx = null;
  function unlockAudio() {
    try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) { /* ignore */ }
  }
  document.addEventListener('click', unlockAudio);
  function ding() {
    if (!audioCtx) return;
    [0, 0.25, 0.5].forEach(function (t) {
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.frequency.value = 880;
      o.connect(g); g.connect(audioCtx.destination);
      var s = audioCtx.currentTime + t;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.3, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.2);
      o.start(s); o.stop(s + 0.22);
    });
  }
  var baseTitle = document.title;
  var titleTimer = null;
  function flashTitle(text) {
    clearInterval(titleTimer);
    var on = false;
    titleTimer = setInterval(function () { document.title = (on = !on) ? text : baseTitle; }, 1000);
    setTimeout(function () { clearInterval(titleTimer); document.title = baseTitle; }, 30000);
  }

  // ---------- login ----------
  function viewLogin() {
    document.getElementById('logoutBtn').classList.add('hidden');
    root.innerHTML = '<div class="narrow"><div class="panel"><h1>Admin login</h1><p class="muted">Manage orders, menu and settings.</p>' +
      '<form id="loginForm" style="display:flex;flex-direction:column;gap:12px"><div class="field"><label for="pw">Password</label><input id="pw" class="input" type="password" autocomplete="current-password" required></div>' +
      '<button class="btn btn-primary btn-block" type="submit">Log in</button></form></div></div>';
    document.getElementById('pw').focus();
    document.getElementById('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      unlockAudio();
      api('/api/admin/login', { method: 'POST', body: { password: document.getElementById('pw').value } })
        .then(start)
        .catch(function (err) { toast(err.message); });
    });
  }

  // ---------- shell ----------
  function render() {
    document.getElementById('logoutBtn').classList.remove('hidden');
    var tabs = [['orders', 'Orders'], ['menu', 'Menu'], ['settings', 'Settings']];
    var html = '<div class="medium" style="max-width:1000px">' +
      '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;align-items:center"><h1>Dashboard</h1><span class="live">Live</span></div>' +
      '<div class="tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" class="pill" role="tab" data-tab="' + t[0] + '" aria-pressed="' + (state.tab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (state.info && state.info.whatsapp === 'none') html += '<div class="notice notice-warn">WhatsApp alerts are not set up yet. Set WHATSAPP_PROVIDER in your settings (see README). New orders still appear here with a sound.</div>';
    if (state.info && state.info.demo) html += '<div class="notice notice-warn">DEMO MODE is on. Turn it off before going live.</div>';
    if (state.tab === 'orders') html += ordersHtml();
    else if (state.tab === 'menu') html += menuHtml();
    else html += settingsHtml();
    root.innerHTML = html + '</div>';
  }

  function ordersHtml() {
    var h = '<div class="stats"><div class="stat"><b>' + state.today.count + '</b><span>Paid orders today</span></div><div class="stat"><b>' + rupees(state.today.revenue) + '</b><span>Collected today</span></div>' +
      '<div class="stat"><b>' + state.orders.filter(function (o) { return o.status === 'placed' || o.status === 'payment_submitted'; }).length + '</b><span>Waiting for you</span></div></div>' +
      '<div class="tabs"><button type="button" class="pill" data-scope="active" aria-pressed="' + (state.scope === 'active') + '">Active orders</button><button type="button" class="pill" data-scope="all" aria-pressed="' + (state.scope === 'all') + '">All orders</button></div>';
    if (!state.orders.length) return h + '<div class="panel"><p class="muted">' + (state.scope === 'active' ? 'No active orders. New paid orders will pop up here with a sound — keep this page open.' : 'No orders yet.') + '</p></div>';
    return h + state.orders.map(function (o) {
      var next = NEXT[o.status];
      var badge = o.status === 'delivered' ? 'badge done' : o.status === 'cancelled' ? 'badge cancel' : 'badge';
      var btns = '';
      if (next) btns += '<button type="button" class="btn btn-primary" data-status="' + next[0] + '" data-id="' + o.id + '">' + next[1] + '</button>';
      // WhatsApp the customer that the order is placed (sent automatically when the WhatsApp Business API is set up)
      if (o.status !== 'payment_submitted' && o.status !== 'cancelled') {
        btns += o.customerNotified
          ? '<span class="btn btn-outline" style="cursor:default;border-color:#2E9B5F;color:#1F4D3A">✓ WhatsApp sent</span>'
          : '<a class="btn btn-wa" target="_blank" rel="noopener" href="https://wa.me/91' + esc(o.phone) + '?text=' + encodeURIComponent(o.waText || '') + '">Send WhatsApp to customer</a>';
      }
      var checking = o.status === 'payment_submitted';
      var cod = o.payMethod === 'cod';
      var methodName = { cod: 'Cash on delivery', gpay: 'Google Pay', phonepe: 'PhonePe', paytm: 'Paytm', upi: 'UPI', razorpay: 'Online (Razorpay)', demo: 'Test' }[o.payMethod] || 'Online';
      if (o.status !== 'cancelled' && o.status !== 'delivered') btns += '<button type="button" class="btn btn-danger" data-status="cancelled" data-id="' + o.id + '">' + (checking ? 'Payment not received' : 'Cancel') + '</button>';
      return '<article class="admin-order' + (state.fresh[o.id] ? ' fresh' : '') + '">' +
        (checking ? '<div class="notice notice-warn">Check your UPI / bank app for <strong>' + rupees(o.total) + '</strong> from ' + esc(o.name) + (o.utr ? ' (reference <strong>' + esc(o.utr) + '</strong>)' : '') + '. If it arrived, tap “Payment received”.</div>' : '') +
        (state.info && state.info.payMode === 'razorpay' && !cod && !o.utr && o.paidAt && o.status === 'placed' ? '<div class="notice notice-ok"><strong>Payment received: ' + rupees(o.total) + '</strong> by ' + esc(methodName) + ' — confirmed automatically by Razorpay. Accept the order to start cooking.</div>' : '') +
        (cod && o.status !== 'delivered' && o.status !== 'cancelled' ? '<div class="notice notice-warn"><strong>Cash on delivery</strong> — collect <strong>' + rupees(o.total) + '</strong> when you deliver.</div>' : '') +
        '<div class="order-head"><div><div class="order-code">#' + esc(o.code) + ' · ' + rupees(o.total) + ' <span class="muted" style="font-weight:500;font-size:14px">' + (checking ? 'to check' : cod ? (o.status === 'delivered' ? 'cash collected' : 'cash on delivery') : 'paid') + '</span></div><div class="muted" style="font-size:14px">' + when(o.paidAt || o.createdAt) + '</div></div><span class="' + badge + '">' + esc(LABEL[o.status] || o.status) + '</span></div>' +
        '<dl><dt>Customer</dt><dd>' + esc(o.name) + ' · <a href="tel:+91' + esc(o.phone) + '">+91 ' + esc(o.phone) + '</a> · <a href="https://wa.me/91' + esc(o.phone) + '" target="_blank" rel="noopener">WhatsApp</a></dd>' +
        '<dt>Items</dt><dd>' + o.items.map(function (l) { return esc(l.qty + ' × ' + l.name); }).join('<br>') + '</dd>' +
        '<dt>Address</dt><dd>' + esc(o.address) + '</dd>' +
        '<dt>Payment</dt><dd>' + esc(methodName) + '</dd>' +
        (o.utr ? '<dt>UPI ref</dt><dd>' + esc(o.utr) + '</dd>' : '') +
        (o.note ? '<dt>Note</dt><dd>' + esc(o.note) + '</dd>' : '') + '</dl>' +
        (btns ? '<div class="status-btns">' + btns + '</div>' : '') + '</article>';
    }).join('');
  }

  function menuHtml() {
    var rows = state.menu.map(function (m) { return menuRow(m); }).join('');
    return '<p class="muted">Changes show on the website right away. Untick “Available” to hide an item for today.</p>' + rows +
      '<h2 class="display" style="font-size:22px;margin-top:10px">Add a new item</h2>' + menuRow({ id: 'new', name: '', description: '', price: '', category: 'Tiffins', available: true, sort: state.menu.length });
  }

  function menuRow(m) {
    var id = m.id;
    return '<form class="menu-row" data-menu="' + id + '">' +
      '<div class="field"><label for="n' + id + '">Name</label><input id="n' + id + '" name="name" class="input" value="' + esc(m.name) + '" required></div>' +
      '<div class="field"><label for="p' + id + '">Price (₹)</label><input id="p' + id + '" name="price" class="input" type="number" min="1" step="1" value="' + esc(m.price) + '" required></div>' +
      '<div class="field"><label for="c' + id + '">Category</label><input id="c' + id + '" name="category" class="input" value="' + esc(m.category) + '"></div>' +
      '<div class="field"><label for="s' + id + '">Order on page</label><input id="s' + id + '" name="sort" class="input" type="number" step="1" value="' + esc(m.sort) + '"></div>' +
      '<div class="field wide"><label for="d' + id + '">Description</label><input id="d' + id + '" name="description" class="input" value="' + esc(m.description) + '"></div>' +
      '<label class="switch"><input type="checkbox" name="available"' + (m.available ? ' checked' : '') + '> Available</label>' +
      '<div class="status-btns"><button type="submit" class="btn btn-primary">' + (id === 'new' ? 'Add item' : 'Save') + '</button>' +
      (id === 'new' ? '' : '<button type="button" class="btn btn-danger" data-delete="' + id + '">Delete</button>') + '</div></form>';
  }

  function settingsHtml() {
    var s = state.settings || {};
    return '<form id="settingsForm" class="panel">' +
      '<label class="switch"><input type="checkbox" name="acceptingOrders"' + (s.acceptingOrders ? ' checked' : '') + '> Taking orders now (untick to pause the website)</label>' +
      '<label class="switch"><input type="checkbox" name="codEnabled"' + (s.codEnabled ? ' checked' : '') + '> Allow cash on delivery</label>' +
      '<div class="field"><label for="mins">Delivery time shown to customers (minutes)</label><input id="mins" name="deliveryMinutes" class="input" type="number" min="5" max="240" step="5" value="' + esc(s.deliveryMinutes) + '"></div>' +
      '<div class="field"><label for="fee">Delivery charge (₹)</label><input id="fee" name="deliveryFee" class="input" type="number" min="0" step="1" value="' + esc(s.deliveryFee) + '"></div>' +
      '<div class="field"><label for="free">Free delivery above (₹, 0 = never)</label><input id="free" name="freeDeliveryAbove" class="input" type="number" min="0" step="1" value="' + esc(s.freeDeliveryAbove) + '"></div>' +
      '<div class="field"><label for="min">Minimum order (₹, 0 = none)</label><input id="min" name="minOrder" class="input" type="number" min="0" step="1" value="' + esc(s.minOrder) + '"></div>' +
      '<button type="submit" class="btn btn-primary">Save settings</button></form>' +
      '<form id="pinForm" class="panel"><h2 class="display" style="font-size:22px">Reset a customer’s PIN</h2>' +
      '<p class="muted">If a customer forgets their login PIN, enter their mobile number. They can then create a new PIN when they log in.</p>' +
      '<div class="field"><label for="rphone">Customer mobile number</label><input id="rphone" name="phone" class="input" type="tel" inputmode="numeric" maxlength="10"></div>' +
      '<button type="submit" class="btn btn-outline">Reset PIN</button></form>' +
      (state.info && state.info.upiId ? '<div class="panel"><strong>Payments go to UPI ID</strong><span>' + esc(state.info.upiId) + '</span><span class="muted" style="font-size:14px">To change it, update UPI_ID in Railway variables.</span></div>' : '');
  }

  // ---------- data ----------
  function loadOrders() {
    return api('/api/admin/orders?scope=' + state.scope).then(function (r) { state.orders = r.orders; state.today = r.today; });
  }
  function loadMenu() { return api('/api/admin/menu').then(function (r) { state.menu = r.items; }); }
  function loadSettings() { return api('/api/admin/settings').then(function (r) { state.settings = r; }); }

  function connect() {
    if (state.stream) return;
    var es = new EventSource('/api/admin/stream');
    es.addEventListener('new_order', function (ev) {
      var o = JSON.parse(ev.data);
      state.fresh[o.id] = true;
      ding();
      flashTitle('🔔 New order #' + o.code);
      var paidOnline = o.paidAt && o.payMethod !== 'cod' && !o.utr;
      var what = paidOnline ? 'Payment received ' + rupees(o.total) : o.payMethod === 'cod' ? 'Cash on delivery ' + rupees(o.total) : rupees(o.total);
      toast('New order #' + o.code + ' — ' + what);
      if (window.Notification && Notification.permission === 'granted') {
        try { new Notification((paidOnline ? '💰 Payment received — order #' : 'New order #') + o.code, { body: o.name + ' · ' + what }); } catch (e) { /* ignore */ }
      }
      loadOrders().then(function () { if (state.tab === 'orders') render(); });
    });
    es.addEventListener('order', function () {
      loadOrders().then(function () { if (state.tab === 'orders') render(); });
    });
    es.onerror = function () { if (es.readyState === 2) { state.stream = null; setTimeout(connect, 5000); } };
    state.stream = es;
  }

  // ---------- events ----------
  root.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tab]');
    if (t) {
      state.tab = t.getAttribute('data-tab');
      var p = state.tab === 'orders' ? loadOrders() : state.tab === 'menu' ? loadMenu() : loadSettings();
      p.then(render).catch(function (err) { toast(err.message); });
      return;
    }
    var sc = e.target.closest('[data-scope]');
    if (sc) { state.scope = sc.getAttribute('data-scope'); loadOrders().then(render); return; }
    var st = e.target.closest('[data-status]');
    if (st) {
      var status = st.getAttribute('data-status');
      if (status === 'cancelled' && !confirm('Cancel this order? If the customer paid, send their money back from your UPI app.')) return;
      st.disabled = true;
      var id = st.getAttribute('data-id');
      delete state.fresh[id];
      api('/api/admin/orders/' + id + '/status', { method: 'POST', body: { status: status } })
        .then(function () { return loadOrders(); })
        .then(function () { render(); toast('Updated — the customer sees it live.'); })
        .catch(function (err) { st.disabled = false; toast(err.message); });
      return;
    }
    var del = e.target.closest('[data-delete]');
    if (del) {
      if (!confirm('Delete this menu item?')) return;
      api('/api/admin/menu/' + del.getAttribute('data-delete'), { method: 'DELETE', body: {} })
        .then(loadMenu).then(function () { render(); toast('Item deleted.'); })
        .catch(function (err) { toast(err.message); });
    }
  });

  root.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.id === 'settingsForm') {
      e.preventDefault();
      api('/api/admin/settings', { method: 'PUT', body: {
        acceptingOrders: f.acceptingOrders.checked,
        codEnabled: f.codEnabled.checked,
        deliveryMinutes: Number(f.deliveryMinutes.value || 30),
        deliveryFee: Number(f.deliveryFee.value || 0),
        freeDeliveryAbove: Number(f.freeDeliveryAbove.value || 0),
        minOrder: Number(f.minOrder.value || 0)
      } }).then(loadSettings).then(function () { render(); toast('Settings saved.'); }).catch(function (err) { toast(err.message); });
      return;
    }
    if (f.id === 'pinForm') {
      e.preventDefault();
      api('/api/admin/reset-pin', { method: 'POST', body: { phone: f.phone.value } })
        .then(function () { f.reset(); toast('PIN reset. The customer can now create a new PIN.'); })
        .catch(function (err) { toast(err.message); });
      return;
    }
    var mid = f.getAttribute('data-menu');
    if (mid) {
      e.preventDefault();
      var body = { name: f.name.value, price: Number(f.price.value), category: f.category.value, description: f.description.value, sort: Number(f.sort.value || 0), available: f.available.checked };
      var req = mid === 'new' ? api('/api/admin/menu', { method: 'POST', body: body }) : api('/api/admin/menu/' + mid, { method: 'PUT', body: body });
      req.then(loadMenu).then(function () { render(); toast(mid === 'new' ? 'Item added.' : 'Saved.'); }).catch(function (err) { toast(err.message); });
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', function () {
    api('/api/admin/logout', { method: 'POST', body: {} }).finally(function () {
      if (state.stream) { state.stream.close(); state.stream = null; }
      viewLogin();
    });
  });

  function start() {
    return api('/api/admin/me').then(function (info) {
      state.info = info;
      if (window.Notification && Notification.permission === 'default') { try { Notification.requestPermission(); } catch (e) { /* ignore */ } }
      return loadOrders();
    }).then(function () { render(); connect(); });
  }

  start().catch(function (e) { if (e.status === 401) viewLogin(); else toast(e.message); });
})();
