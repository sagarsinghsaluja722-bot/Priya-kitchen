// Priya Kitchen — customer website
(function () {
  'use strict';

  var state = {
    config: null,
    menu: [],
    user: null,
    cart: loadCart(),
    cat: 'all',
    orders: null,
    stream: null,
    login: { step: 'phone', phone: '', demoOtp: '' },
    redirect: '#/',
    editAddress: false,
    paying: false
  };

  var STEPS = [
    ['placed', 'Order placed', 'Payment received'],
    ['accepted', 'Accepted by kitchen', 'Priya Kitchen confirmed your order'],
    ['preparing', 'Being prepared', 'Your tiffin is being packed fresh'],
    ['out_for_delivery', 'Out for delivery', 'On the way to you'],
    ['delivered', 'Delivered', 'Enjoy your meal!']
  ];

  var app = document.getElementById('app');

  // ---------- utils ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function rupees(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
  function when(isoStr) {
    if (!isoStr) return '';
    var d = new Date(isoStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 4000);
  }
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var e = new Error(j.error || 'Something went wrong. Please try again.');
          e.status = r.status;
          throw e;
        }
        return j;
      });
    }, function () { throw new Error('No internet connection. Please check and try again.'); });
  }
  function loadCart() {
    try { return JSON.parse(localStorage.getItem('pk_cart') || '{}') || {}; } catch (e) { return {}; }
  }
  function saveCart() {
    try { localStorage.setItem('pk_cart', JSON.stringify(state.cart)); } catch (e) { /* ignore */ }
    updateCartCount();
  }
  function cartLines() {
    var lines = [];
    state.menu.forEach(function (m) {
      var q = state.cart[m.id];
      if (q > 0) lines.push({ id: m.id, name: m.name, qty: q, amount: q * m.price });
    });
    return lines;
  }
  function totals() {
    var lines = cartLines();
    var subtotal = lines.reduce(function (a, l) { return a + l.amount; }, 0);
    var c = state.config || {};
    var fee = subtotal > 0 ? (c.deliveryFee || 0) : 0;
    if (c.freeDeliveryAbove > 0 && subtotal >= c.freeDeliveryAbove) fee = 0;
    return { lines: lines, subtotal: subtotal, fee: fee, total: subtotal + fee, count: lines.reduce(function (a, l) { return a + l.qty; }, 0) };
  }
  function updateCartCount() {
    document.getElementById('cartCount').textContent = totals().count;
  }
  function renderAccount() {
    var el = document.getElementById('account');
    if (state.user) {
      el.innerHTML = '<span class="hello">Hi, ' + esc((state.user.name || '').split(' ')[0] || 'there') + '</span>' +
        '<button type="button" class="linkish" data-action="logout">Logout</button>';
    } else {
      el.innerHTML = '<a href="#/login" class="btn-pill-outline">Login</a>';
    }
  }

  var ICON_TIFFIN = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="9" width="14" height="4" rx="1"/><rect x="5" y="13" width="14" height="4" rx="1"/><rect x="5" y="17" width="14" height="4" rx="1"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/></svg>';
  var ICON_CHECK = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';

  // ---------- views ----------
  function viewHome() {
    var cats = ['all'];
    state.menu.forEach(function (m) { if (cats.indexOf(m.category) < 0) cats.push(m.category); });
    if (cats.indexOf(state.cat) < 0) state.cat = 'all';
    var shown = state.menu.filter(function (m) { return state.cat === 'all' || m.category === state.cat; });

    var catHtml = cats.length > 2 ? '<div class="cats" role="group" aria-label="Categories">' + cats.map(function (c) {
      return '<button type="button" class="pill" data-action="cat" data-cat="' + esc(c) + '" aria-pressed="' + (state.cat === c) + '">' + (c === 'all' ? 'All' : esc(c)) + '</button>';
    }).join('') + '</div>' : '';

    var cards = shown.length ? '<div class="grid">' + shown.map(function (m) {
      var q = state.cart[m.id] || 0;
      var ctrl = q > 0
        ? '<div class="stepper"><button type="button" data-action="dec" data-id="' + m.id + '" aria-label="Remove one ' + esc(m.name) + '">−</button><span>' + q + '</span><button type="button" data-action="inc" data-id="' + m.id + '" aria-label="Add one ' + esc(m.name) + '">+</button></div>'
        : '<button type="button" class="add-btn" data-action="inc" data-id="' + m.id + '">Add to cart</button>';
      return '<div class="card"><div class="card-art">' + ICON_TIFFIN + '</div><div class="card-body"><div class="card-top"><h3>' + esc(m.name) + '</h3><span class="price">' + rupees(m.price) + '</span></div><p class="card-desc">' + esc(m.description) + '</p>' + ctrl + '</div></div>';
    }).join('') + '</div>' : '<div class="empty-menu">Today\'s menu will be up soon.</div>';

    app.innerHTML =
      '<section class="hero"><div class="wrap hero-in">' +
        '<div class="hero-copy"><span class="chip">Daily tiffin service · Fresh &amp; homemade</span>' +
        '<h1>Ghar ka khana,<br>in your tiffin.</h1>' +
        '<p>Choose your tiffin, pay online, and track your order live — from our kitchen to your door.</p>' +
        '<div class="hero-actions"><a href="#menu" class="btn btn-accent btn-lg">Order a tiffin</a></div></div>' +
        '<div class="hero-art"><div class="tile tile-a">Fresh every day</div><div class="tile tile-b">Packed with care</div>' +
        '<div class="tile tile-c"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#1F4D3A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span><strong>Easy payment.</strong> ' + payNote() + '.</span></div></div>' +
      '</div></section>' +
      '<section class="band"><div class="wrap section"><h2>How it works</h2><div class="steps">' +
        step(1, 'Log in with your phone', 'Quick login with your number. First time? Just add your name and address once.') +
        step(2, 'Pick your tiffin', 'Add tiffins and extras to your cart.') +
        step(3, 'Pay your way', payNote() + '. Your order reaches our kitchen on WhatsApp instantly.') +
        step(4, 'Fresh at your door', 'You get a WhatsApp message as soon as your order is placed — delivered within ' + ((state.config && state.config.deliveryMinutes) || 30) + ' minutes.') +
      '</div></div></section>' +
      '<section id="menu"><div class="wrap section"><div class="menu-layout">' +
        '<div class="menu-col"><h2>Today\'s tiffins</h2>' + catHtml + cards + '</div>' +
        '<aside class="cart" id="cart" aria-label="Your cart">' + cartHtml() + '</aside>' +
      '</div></div></section>';
  }

  function step(n, t, d) {
    return '<div class="step"><span class="step-n">' + n + '</span><h3>' + t + '</h3><p>' + d + '</p></div>';
  }

  function cartHtml() {
    var t = totals();
    var c = state.config || {};
    var h = '<h2>Your cart</h2>';
    if (!c.acceptingOrders) h += '<div class="notice notice-warn">We\'re not taking orders right now. Please check back soon.</div>';
    if (!t.lines.length) return h + '<p class="muted">Your cart is empty. Add a tiffin to get started.</p>';
    h += '<div class="lines">' + t.lines.map(function (l) {
      return '<div class="line"><span>' + l.qty + ' × ' + esc(l.name) + '</span><span>' + rupees(l.amount) + '</span></div>';
    }).join('') + '<div class="totals"><div><span class="muted">Subtotal</span><span>' + rupees(t.subtotal) + '</span></div>' +
      '<div><span class="muted">Delivery</span><span>' + (t.fee ? rupees(t.fee) : 'Free') + '</span></div>' +
      '<div class="grand"><span>Total</span><span>' + rupees(t.total) + '</span></div></div></div>';
    if (c.minOrder > 0 && t.subtotal < c.minOrder) h += '<div class="notice notice-warn">Minimum order is ' + rupees(c.minOrder) + '.</div>';

    var disabled = !c.acceptingOrders || (c.minOrder > 0 && t.subtotal < c.minOrder);
    return h + (state.user ? '' : '<p class="muted" style="font-size:14px">You\'ll log in with your mobile number on the next step.</p>') +
      '<button type="button" class="btn btn-accent btn-block btn-lg" data-action="go-checkout"' + (disabled ? ' disabled' : '') + '>Proceed to checkout · ' + rupees(t.total) + '</button>' +
      '<p class="small">' + payNote() + '</p>';
  }

  // Short line describing how customers can pay
  function payNote() {
    var ids = ((state.config && state.config.payMethods) || []).map(function (m) { return m.id; });
    var parts = [];
    if (ids.indexOf('gpay') >= 0) parts.push('GPay, PhonePe, Paytm or any UPI app');
    else if (ids.indexOf('razorpay') >= 0) parts.push('UPI, cards or net banking');
    if (ids.indexOf('cod') >= 0) parts.push('cash on delivery');
    return parts.length ? 'Pay by ' + parts.join(' — or ') : 'Pay online';
  }

  // ---------- checkout: items + delivery + payment method ----------
  var APP_BADGE = { gpay: ['G', '#1A73E8'], phonepe: ['Pe', '#5F259F'], paytm: ['P', '#00B9F1'], upi: ['UPI', '#1F4D3A'], razorpay: ['₹', '#1F4D3A'], cod: ['₹', '#2E7D32'], demo: ['T', '#6B4A00'] };

  function chosenMethod() {
    var list = (state.config && state.config.payMethods) || [];
    var ids = list.map(function (m) { return m.id; });
    if (ids.indexOf(state.method) < 0) state.method = ids[0] || '';
    return state.method;
  }

  var UPI_IDS = ['gpay', 'phonepe', 'paytm', 'upi'];
  var APP_NAME = { gpay: 'Google Pay', phonepe: 'PhonePe', paytm: 'Paytm', upi: 'UPI app' };

  function availableUpiApps() {
    return ((state.config && state.config.payMethods) || []).filter(function (m) { return UPI_IDS.indexOf(m.id) >= 0; });
  }

  function payBtnLabel(total) {
    var m = chosenMethod();
    if (state.paying) return 'Please wait…';
    if (m === 'cod') return 'Place order · Cash on delivery';
    if (m === 'gpay' || m === 'phonepe' || m === 'paytm') return 'Pay with ' + APP_NAME[m];
    if (m === 'upi') return 'Pay ' + rupees(total) + ' with UPI';
    if (m === 'demo') return 'Place test order · ' + rupees(total);
    return 'Pay ' + rupees(total);
  }

  // Bottom sheet listing the UPI apps (like big shopping apps)
  function upiIcon(id) {
    var b = APP_BADGE[id] || ['₹', '#1F4D3A'];
    return '<span class="pm-badge" style="background:' + b[1] + '" aria-hidden="true">' + b[0] + '</span>';
  }

  function openUpiSheet() {
    closeUpiSheet();
    var apps = availableUpiApps();
    var cur = chosenMethod();
    var wrap = document.createElement('div');
    wrap.id = 'upiSheet';
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = '<div class="sheet-backdrop" data-sheet="close"></div>' +
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">' +
        '<div class="sheet-head"><h2 id="sheetTitle">Your UPI apps</h2><button type="button" class="sheet-x" data-sheet="close" aria-label="Close">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
        '<div class="sheet-list">' + apps.map(function (a) {
          return '<button type="button" class="sheet-item' + (a.id === cur ? ' on' : '') + '" data-sheet-app="' + esc(a.id) + '">' +
            '<span class="sheet-radio" aria-hidden="true"></span><span class="sheet-name">' + esc(a.label) + '</span>' + upiIcon(a.id) + '</button>';
        }).join('') + '</div></div>';
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () { wrap.classList.add('open'); });
    var first = wrap.querySelector('.sheet-item.on') || wrap.querySelector('.sheet-item');
    if (first) first.focus();
    wrap.addEventListener('click', function (e) {
      var pick = e.target.closest('[data-sheet-app]');
      if (pick) {
        var n = document.getElementById('note');
        if (n) state.note = n.value;
        state.method = pick.getAttribute('data-sheet-app');
        state.upiApp = state.method;
        closeUpiSheet();
        viewCheckout();
        var btn = document.getElementById('payBtn');
        if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (e.target.closest('[data-sheet="close"]')) closeUpiSheet();
    });
    wrap.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeUpiSheet(); });
  }

  function closeUpiSheet() {
    var s = document.getElementById('upiSheet');
    if (s) s.remove();
    document.body.style.overflow = '';
  }

  function viewCheckout() {
    if (!state.user) { state.redirect = '#/checkout'; location.hash = '#/login'; return; }
    if (!state.user.profileComplete) { state.redirect = '#/checkout'; state.login.step = 'profile'; location.hash = '#/login'; return; }
    var t = totals();
    var c = state.config || {};
    if (!t.lines.length) {
      app.innerHTML = '<section class="page"><div class="narrow"><div class="panel" style="align-items:flex-start"><h1>Checkout</h1><p class="muted">Your cart is empty.</p><a href="#/" class="btn btn-primary">Browse the menu</a></div></div></section>';
      return;
    }
    var u = state.user;
    var method = chosenMethod();
    var items = '<div class="co-items">' + t.lines.map(function (l) {
      return '<div class="co-item"><div class="co-item-name"><strong>' + esc(l.name) + '</strong><span class="muted">' + rupees(l.amount / l.qty) + ' each</span></div>' +
        '<div class="stepper co-stepper"><button type="button" data-action="dec" data-id="' + l.id + '" aria-label="Remove one ' + esc(l.name) + '">−</button><span>' + l.qty + '</span><button type="button" data-action="inc" data-id="' + l.id + '" aria-label="Add one ' + esc(l.name) + '">+</button></div>' +
        '<span class="co-item-amt">' + rupees(l.amount) + '</span></div>';
    }).join('') + '</div>' +
      '<div class="totals"><div><span class="muted">Subtotal</span><span>' + rupees(t.subtotal) + '</span></div>' +
      '<div><span class="muted">Delivery</span><span>' + (t.fee ? rupees(t.fee) : 'Free') + '</span></div>' +
      '<div class="grand"><span>Total to pay</span><span>' + rupees(t.total) + '</span></div></div>';

    var addr = state.editAddress
      ? '<div class="field"><label for="addr">Delivery address</label><textarea id="addr" class="input" rows="3" maxlength="300">' + esc(u.address) + '</textarea></div>'
      : '<div class="deliver-box"><strong>' + esc(u.name) + ' · +91 ' + esc(u.phone) + '</strong><span class="muted">' + esc(u.address) + '</span>' +
        '<button type="button" class="btn-link" style="align-self:flex-start;padding:0;min-height:32px" data-action="edit-address">Change address</button></div>';

    // Payment choices: one "Pay by any UPI App" row (opens the app sheet), then cards and cash on delivery.
    var upiApps = availableUpiApps();
    var upiOn = UPI_IDS.indexOf(method) >= 0;
    var shownApp = upiOn ? method : (state.upiApp || (upiApps[0] && upiApps[0].id));
    var methods = '';
    if (upiApps.length) {
      methods += '<div class="pm pm-upi' + (upiOn ? ' on' : '') + '">' +
        '<label class="pm-row"><input type="radio" name="paymethod" value="' + esc(shownApp) + '"' + (upiOn ? ' checked' : '') + '>' +
        (upiOn ? upiIcon(method) : '<span class="pm-badge upi-mark" aria-hidden="true">UPI</span>') +
        '<span class="pm-text"><strong>Pay by any UPI App</strong><span class="muted">' + upiApps.filter(function (a) { return a.id !== 'upi'; }).map(function (a) { return a.label; }).join(', ') + ' and more</span></span></label>' +
        (upiOn ? '<button type="button" class="upi-chip" data-action="choose-upi">' + esc(APP_NAME[method] === 'UPI app' ? 'Other UPI app' : APP_NAME[method]) +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>' : '') +
        '</div>';
    }
    methods += (c.payMethods || []).filter(function (m) { return UPI_IDS.indexOf(m.id) < 0; }).map(function (m) {
      return '<label class="pm' + (m.id === method ? ' on' : '') + '"><input type="radio" name="paymethod" value="' + esc(m.id) + '"' + (m.id === method ? ' checked' : '') + '>' +
        upiIcon(m.id) + '<span class="pm-text"><strong>' + esc(m.label) + '</strong><span class="muted">' + esc(m.sub) + '</span></span></label>';
    }).join('');

    var blocked = !c.acceptingOrders ? 'We\'re not taking orders right now. Please check back soon.'
      : (c.minOrder > 0 && t.subtotal < c.minOrder) ? 'Minimum order is ' + rupees(c.minOrder) + '.' : '';

    var summary = '<div class="panel co-confirm">' +
      '<button type="button" id="payBtn" class="btn btn-accent btn-block btn-lg" data-action="pay"' + (blocked || state.paying ? ' disabled' : '') + '>' + payBtnLabel(t.total) + '</button>' +
      '<div class="totals" style="border-top:0;padding-top:0"><div><span>Items:</span><span>' + rupees(t.subtotal) + '</span></div>' +
      '<div><span>Delivery:</span><span>' + (t.fee ? rupees(t.fee) : 'Free') + '</span></div>' +
      '<div class="grand"><span>Order Total:</span><span>' + rupees(t.total) + '</span></div></div>' +
      (method === 'cod' ? '<p class="small" style="text-align:left">Pay ' + rupees(t.total) + ' in cash when your tiffin arrives.</p>' :
        upiOn ? '<p class="small" style="text-align:left">' + (method === 'upi' ? 'Your UPI app' : APP_NAME[method]) + ' will open with ' + rupees(t.total) + ' filled in. Choose your bank, enter your UPI PIN, and your order is placed.</p>' : '') +
      '</div>';

    app.innerHTML = '<section class="page"><div class="medium" style="max-width:640px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"><h1>Checkout</h1><a href="#/" class="btn-link">+ Add more items</a></div>' +
      '<div class="panel"><h2 class="co-h">Delivering to ' + esc(u.name) + '</h2>' + addr +
        '<div class="field"><label for="note">Note for the kitchen (optional)</label><input id="note" class="input" maxlength="200" placeholder="e.g. less spicy, ring the bell" value="' + esc(state.note || '') + '"></div></div>' +
      '<div class="panel"><h2 class="co-h">Your order</h2>' + items + '</div>' +
      '<div class="panel"><h2 class="co-h" id="pm-h">Payment method</h2><div class="pm-list" role="radiogroup" aria-labelledby="pm-h">' + methods + '</div></div>' +
      (blocked ? '<div class="notice notice-warn">' + blocked + '</div>' : '') +
      summary +
      (method === 'demo' ? '<div class="notice notice-warn">Test mode: no money is taken.</div>' : '') +
      '</div></section>';
  }

  function rerender() {
    if (currentRoute() === 'checkout') viewCheckout(); else viewHome();
  }

  function refreshCart() {
    var el = document.getElementById('cart');
    if (el) {
      var note = document.getElementById('note');
      var noteVal = note ? note.value : '';
      el.innerHTML = cartHtml();
      var n2 = document.getElementById('note');
      if (n2) n2.value = noteVal;
    }
  }

  function viewLogin() {
    var L = state.login;
    var body;
    if (L.step === 'phone') {
      body = '<p class="muted">' + (state.config.authMode === 'pin' ? 'Enter your mobile number to log in or create your account.' : 'We\'ll send a one-time code to your mobile number.') + '</p>' +
        '<form data-form="phone" class="field" novalidate><label for="phone">Mobile number</label>' +
        '<div class="phone-row"><span class="cc">+91</span><input id="phone" class="input" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="10" value="' + esc(L.phone) + '" required></div>' +
        '<button type="submit" class="btn btn-primary btn-block" style="margin-top:8px">' + (state.config.authMode === 'pin' ? 'Continue' : 'Send OTP') + '</button></form>';
    } else if (L.step === 'pin') {
      body = (L.hasPin
          ? '<p class="muted">Welcome back! Enter the 4-digit PIN you created for <strong>+91 ' + esc(L.phone) + '</strong>.</p>'
          : '<p class="muted">New here? Create a 4-digit PIN for <strong>+91 ' + esc(L.phone) + '</strong>. You\'ll use it to log in next time.</p>') +
        '<form data-form="pin" style="display:flex;flex-direction:column;gap:12px" novalidate>' +
        '<div class="field"><label for="pin">' + (L.hasPin ? 'Your PIN' : 'Create PIN') + '</label><input id="pin" class="input otp-input" type="password" inputmode="numeric" autocomplete="' + (L.hasPin ? 'current-password' : 'new-password') + '" maxlength="4" required></div>' +
        (L.hasPin ? '' : '<div class="field"><label for="pin2">Type the PIN again</label><input id="pin2" class="input otp-input" type="password" inputmode="numeric" autocomplete="new-password" maxlength="4" required></div>') +
        '<button type="submit" class="btn btn-primary btn-block">' + (L.hasPin ? 'Log in' : 'Create PIN &amp; continue') + '</button></form>' +
        (L.hasPin ? '<p class="muted" style="font-size:14px">Forgot your PIN? Message us on WhatsApp and we\'ll reset it.</p>' : '') +
        '<div class="row-actions"><button type="button" class="btn-link" data-action="change-phone">Change number</button></div>';
    } else if (L.step === 'otp') {
      body = '<p class="muted">Enter the 4-digit code sent to <strong>+91 ' + esc(L.phone) + '</strong>.</p>' +
        (L.demoOtp ? '<div class="notice notice-warn">Test mode — your OTP is <strong>' + esc(L.demoOtp) + '</strong>. On the live site it arrives by SMS.</div>' : '') +
        '<form data-form="otp" class="field" novalidate><label for="otp">OTP</label>' +
        '<input id="otp" class="input otp-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="4" required>' +
        '<button type="submit" class="btn btn-primary btn-block" style="margin-top:8px">Verify</button></form>' +
        '<div class="row-actions"><button type="button" class="btn-link" data-action="resend">Resend OTP</button><button type="button" class="btn-link" data-action="change-phone">Change number</button></div>';
    } else {
      body = '<p class="muted">Welcome! Tell us where to deliver your tiffin. You only need to do this once.</p>' +
        '<form data-form="profile" style="display:flex;flex-direction:column;gap:12px" novalidate>' +
        '<div class="field"><label for="pname">Your name</label><input id="pname" class="input" autocomplete="name" maxlength="60" value="' + esc(state.user && state.user.name) + '" required></div>' +
        '<div class="field"><label for="paddr">Delivery address</label><textarea id="paddr" class="input" rows="3" maxlength="300" placeholder="House no., street, area, landmark" required>' + esc(state.user && state.user.address) + '</textarea></div>' +
        '<button type="submit" class="btn btn-primary btn-block">Save &amp; continue</button></form>';
    }
    var title = L.step === 'profile' ? 'Your details' : 'Log in or sign up';
    app.innerHTML = '<section class="page"><div class="narrow"><div class="panel"><h1>' + title + '</h1>' + body + '</div></div></section>';
    var first = app.querySelector('input,textarea');
    if (first) first.focus();
  }

  // Shown right after an order is placed (paid automatically, or cash on delivery).
  function viewPlaced(code) {
    var p = state.lastPlaced && state.lastPlaced.code === code ? state.lastPlaced : {};
    var mins = (state.config && state.config.deliveryMinutes) || 30;
    var phone = state.user ? '+91 ' + state.user.phone : 'your number';
    var payLine = p.cod
      ? '<div class="notice notice-warn"><strong>Cash on delivery:</strong> please keep ' + (p.total ? '<strong>' + rupees(p.total) + '</strong>' : 'the amount') + ' ready.</div>'
      : p.checking
        ? '<div class="notice notice-warn">Priya Kitchen will confirm your payment shortly.</div>'
        : '<div class="notice notice-ok"><strong>Payment received' + (p.total ? ': ' + rupees(p.total) : '') + '.</strong> Thank you!</div>';
    app.innerHTML = '<section class="page"><div class="narrow" style="max-width:540px"><div class="panel" style="align-items:flex-start">' +
      '<span class="tick">' + ICON_CHECK + '</span><h1>Order placed!</h1>' +
      '<p style="font-size:17px">Your order <strong>#' + esc(code) + '</strong> will reach you within <strong>' + mins + ' minutes</strong>.</p>' +
      payLine +
      '<div class="deliver-box" style="flex-direction:row;gap:10px;align-items:center">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1F4D3A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><path d="M21 12a9 9 0 0 1-13.4 7.9L3 21l1.2-4.4A9 9 0 1 1 21 12z"/></svg>' +
        '<span>You\'ll get a WhatsApp message on <strong>' + esc(phone) + '</strong> confirming your order.</span></div>' +
      '<a href="#/" class="btn btn-primary">Back to menu</a>' +
      '</div></div></section>';
  }

  function viewSuccess(code) {
    app.innerHTML = '<section class="page"><div class="narrow" style="max-width:540px"><div class="panel" style="align-items:flex-start">' +
      '<span class="tick">' + ICON_CHECK + '</span><h1>Payment successful</h1>' +
      '<p>Your order <strong>#' + esc(code) + '</strong> has been placed.</p>' +
      '<div class="notice notice-ok">Priya Kitchen has received your order on WhatsApp. Track every step live under “Your orders”.</div>' +
      '<div class="row-actions"><a href="#/orders" class="btn btn-primary">Track your order</a><a href="#/" class="btn btn-outline">Back to menu</a></div>' +
      '</div></div></section>';
  }

  // ---------- direct UPI payment ----------
  function loadQr() {
    if (window.QRCode) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function viewPay(id, appName) {
    if (!state.user) { state.redirect = '#/pay/' + id; location.hash = '#/login'; return; }
    app.innerHTML = '<section class="page"><div class="narrow"><div class="spinner" aria-label="Loading"></div></div></section>';
    api('/api/orders/' + encodeURIComponent(id) + '/upi').then(function (r) {
      var o = r.order, u = r.upi;
      if (o.status !== 'pending_payment') { location.hash = '#/orders'; return; }
      var mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
      var appLink = (u.apps && u.apps[appName]) || u.link;
      var appLabel = APP_NAME[appName] && appName !== 'upi' ? APP_NAME[appName] : 'your UPI app';
      // Phone: the app has already been opened; this screen is what the customer comes back to.
      // Computer: show a QR code to scan with a phone.
      app.innerHTML = '<section class="page"><div class="narrow" style="max-width:520px"><div class="panel" style="align-items:stretch">' +
        (mobile
          ? '<div style="display:flex;align-items:center;gap:12px">' + upiIcon(appName || 'upi') + '<h1 style="font-size:26px">Pay ' + rupees(u.amount) + ' in ' + esc(appLabel) + '</h1></div>' +
            '<p class="muted">' + esc(appLabel.charAt(0).toUpperCase() + appLabel.slice(1)) + ' opens with ' + rupees(u.amount) + ' already filled in. Choose your bank, enter your UPI PIN, then come back here.</p>' +
            '<a href="' + esc(appLink) + '" class="btn btn-outline btn-block">' + esc(appLabel === 'your UPI app' ? 'Open UPI app' : 'Open ' + appLabel) + ' again</a>'
          : '<h1>Pay ' + rupees(u.amount) + '</h1><p class="muted">Scan this QR code with GPay, PhonePe, Paytm or any UPI app. The amount is filled in for you.</p>' +
            '<div style="display:flex;justify-content:center;padding:4px 0"><div id="qr" style="background:#fff;padding:10px;border:1px solid var(--line);border-radius:12px"></div></div>') +
        '<p class="muted" style="font-size:14px">Order #' + esc(o.code) + ' · ' + o.items.map(function (l) { return l.qty + ' × ' + esc(l.name); }).join(', ') + '</p>' +
        '<form data-form="utr" data-id="' + o.id + '" style="display:flex;flex-direction:column;gap:12px" novalidate>' +
          '<button type="submit" class="btn btn-accent btn-block btn-lg">I\'ve paid ' + rupees(u.amount) + ' — place my order</button>' +
          '<details class="utr-more"><summary>Add UPI reference number (optional)</summary>' +
            '<div class="field" style="margin-top:8px"><label for="utr">UPI reference / UTR number</label><input id="utr" class="input" inputmode="numeric" autocomplete="off" maxlength="22" placeholder="12 digits, from your payment details"></div></details>' +
        '</form>' +
        '<p class="small">Paying to ' + esc(u.payee) + ' (' + esc(u.upiId) + '). Priya Kitchen confirms your payment and sends you a WhatsApp message.</p>' +
        '</div></div></section>';
      if (mobile) return;
      loadQr().then(function () {
        var el = document.getElementById('qr');
        if (el && window.QRCode) new window.QRCode(el, { text: u.link, width: 200, height: 200, correctLevel: window.QRCode.CorrectLevel.M });
      }).catch(function () {
        var el = document.getElementById('qr');
        if (el) el.outerHTML = '<span class="muted">Pay to the UPI ID below.</span>';
      });
    }).catch(function (e) { toast(e.message); location.hash = '#/orders'; });
  }

  function viewSubmitted(code) {
    app.innerHTML = '<section class="page"><div class="narrow" style="max-width:540px"><div class="panel" style="align-items:flex-start">' +
      '<span class="tick">' + ICON_CHECK + '</span><h1>Order sent!</h1>' +
      '<p>Your order <strong>#' + esc(code) + '</strong> and payment details have been sent to Priya Kitchen.</p>' +
      '<div class="notice notice-ok">We\'re checking your UPI payment. Once confirmed, we start cooking — follow every step live under “Your orders”.</div>' +
      '<div class="row-actions"><a href="#/orders" class="btn btn-primary">Track your order</a><a href="#/" class="btn btn-outline">Back to menu</a></div>' +
      '</div></div></section>';
  }

  function statusLabel(status) {
    if (status === 'cancelled') return 'Cancelled';
    if (status === 'pending_payment') return 'Payment pending';
    if (status === 'payment_submitted') return 'Confirming payment';
    var s = STEPS.filter(function (x) { return x[0] === status; })[0];
    return s ? s[1] : status;
  }

  function orderHtml(o) {
    if (o.status === 'pending_payment') {
      return '<article class="order"><div class="order-head"><div><div class="order-code">Order #' + esc(o.code) + '</div><div class="muted" style="font-size:14px">' + when(o.createdAt) + ' · ' + rupees(o.total) + '</div></div><span class="badge">Payment pending</span></div>' +
        '<p style="color:var(--ink-2)">' + o.items.map(function (l) { return l.qty + ' × ' + esc(l.name); }).join(', ') + '</p>' +
        '<div class="notice notice-warn">This order is not placed yet — payment is not done.</div>' +
        '<a href="#/pay/' + o.id + '/' + esc(o.payMethod || 'upi') + '" class="btn btn-accent" style="align-self:flex-start">Complete payment</a></article>';
    }
    var cod = o.payMethod === 'cod';
    var sentByUpi = o.utr || o.status === 'payment_submitted' || (o.history || []).some(function (h) { return h.status === 'payment_submitted'; });
    var steps = sentByUpi
      ? [['payment_submitted', 'Payment sent', (o.utr ? 'UPI ref ' + o.utr : 'Paid by UPI') + (o.status === 'payment_submitted' ? ' · waiting for Priya Kitchen to confirm' : '')], ['placed', 'Payment confirmed', 'Priya Kitchen received your payment']].concat(STEPS.slice(1))
      : cod ? [['placed', 'Order placed', 'Cash on delivery — keep ' + rupees(o.total) + ' ready']].concat(STEPS.slice(1))
      : STEPS;
    var idx = -1;
    steps.forEach(function (s, i) { if (s[0] === o.status) idx = i; });
    var times = {};
    (o.history || []).forEach(function (h) { times[h.status] = h.at; });
    var badgeClass = o.status === 'delivered' ? 'badge done' : o.status === 'cancelled' ? 'badge cancel' : 'badge';
    var label = cod && o.status === 'placed' ? 'Order placed' : statusLabel(o.status);
    var items = o.items.map(function (l) { return l.qty + ' × ' + esc(l.name); }).join(', ');
    var track;
    if (o.status === 'cancelled') {
      track = '<div class="notice notice-err">This order was cancelled.' + (cod ? '' : ' If you paid, Priya Kitchen will return your money.') + ' For help, message us on WhatsApp.</div>';
    } else {
      track = '<div class="timeline">' + steps.map(function (s, i) {
        var cls = 'tl' + (i <= idx ? ' reached' : '') + (i < idx ? ' passed' : '') + (i === idx && o.status !== 'delivered' ? ' current' : '');
        var sub = i <= idx ? (times[s[0]] ? when(times[s[0]]) + ' · ' : '') + s[2] : 'Pending';
        return '<div class="' + cls + '"><div class="tl-rail"><span class="dot"></span><span class="rail"></span></div><div class="tl-text"><span class="tl-title">' + s[1] + '</span><span class="tl-sub">' + esc(sub) + '</span></div></div>';
      }).join('') + '</div>';
    }
    return '<article class="order"><div class="order-head"><div><div class="order-code">Order #' + esc(o.code) + '</div><div class="muted" style="font-size:14px">' + when(o.paidAt || o.createdAt) + ' · ' + rupees(o.total) + (cod ? (o.status === 'delivered' ? ' · paid in cash' : ' · cash on delivery') : o.status === 'payment_submitted' ? ' · payment being checked' : ' paid') + '</div></div><span class="' + badgeClass + '">' + esc(label) + '</span></div>' +
      '<p style="color:var(--ink-2)">' + items + '</p>' + track + '</article>';
  }

  function viewOrders() {
    var head = '<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px"><h1>Your orders</h1>' + (state.user ? '<span class="live">Live updates on</span>' : '') + '</div>';
    if (!state.user) {
      app.innerHTML = '<section class="page"><div class="medium">' + head + '<div class="panel" style="align-items:flex-start"><p class="muted">Log in to see and track your orders.</p><button type="button" class="btn btn-primary" data-action="login-orders">Log in</button></div></div></section>';
      return;
    }
    if (state.orders === null) {
      app.innerHTML = '<section class="page"><div class="medium">' + head + '<div class="spinner" aria-label="Loading"></div></div></section>';
      api('/api/orders').then(function (r) {
        state.orders = r.orders;
        if (currentRoute() === 'orders') viewOrders();
      }).catch(function (e) { toast(e.message); });
      return;
    }
    var list = state.orders.length
      ? state.orders.map(orderHtml).join('')
      : '<div class="panel" style="align-items:flex-start"><p class="muted">No orders yet. Your placed orders will show up here.</p><a href="#/" class="btn btn-primary">Order a tiffin</a></div>';
    var banner = state.justPlaced
      ? '<div class="notice notice-ok" role="status" style="display:flex;gap:10px;align-items:center;font-size:15px"><span class="tick" style="width:36px;height:36px;flex-shrink:0">' + ICON_CHECK + '</span><strong>' + esc(state.justPlaced.text) + '</strong></div>'
      : '';
    state.justPlaced = null;
    app.innerHTML = '<section class="page"><div class="medium">' + head + banner + list + '</div></section>';
  }

  // ---------- live order updates ----------
  function connectStream() {
    return;
    if (state.stream || !state.user || !window.EventSource) return;
    var es = new EventSource('/api/orders/stream');
    es.addEventListener('order', function (ev) {
      var o = JSON.parse(ev.data);
      if (state.orders) {
        var found = false;
        state.orders = state.orders.map(function (x) { if (x.id === o.id) { found = true; return o; } return x; });
        if (!found) state.orders.unshift(o);
      }
      if (currentRoute() === 'orders') viewOrders();
      else if (o.status !== 'payment_submitted') toast('Order #' + o.code + ': ' + (o.status === 'placed' && o.utr ? 'Payment confirmed' : statusLabel(o.status)));
    });
    es.onerror = function () {
      if (es.readyState === 2) { state.stream = null; setTimeout(connectStream, 5000); }
    };
    state.stream = es;
  }
  function disconnectStream() {
    if (state.stream) { state.stream.close(); state.stream = null; }
  }

  // ---------- payment ----------
  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load the payment page. Please check your internet and try again.')); };
      document.head.appendChild(s);
    });
  }

  function setPaying(on) {
    state.paying = on;
    var b = document.getElementById('payBtn');
    if (b) { b.disabled = on; b.textContent = payBtnLabel(totals().total); }
  }

  function isMobile() { return /Android|iPhone|iPad/i.test(navigator.userAgent); }

  function pay() {
    var t = totals();
    if (!t.lines.length || state.paying) return;
    var addrEl = document.getElementById('addr');
    var noteEl = document.getElementById('note');
    var address = addrEl ? addrEl.value.trim() : state.user.address;
    if (address.length < 10) { toast('Please enter your full delivery address.'); return; }
    var note = noteEl ? noteEl.value.trim() : '';
    var method = chosenMethod();
    if (!method) { toast('Please choose how you want to pay.'); return; }
    setPaying(true);
    api('/api/checkout', { method: 'POST', body: { items: t.lines.map(function (l) { return { id: l.id, qty: l.qty }; }), address: address, note: note, method: method } })
      .then(function (r) {
        state.user.address = address;
        state.editAddress = false;
        state.note = '';
        if (r.cod) {
          state.paying = false;
          state.cart = {};
          saveCart();
          state.orders = null;
          state.lastCod = { code: r.code, total: r.total };
          state.lastPlaced = { code: r.code, total: r.total, cod: true };
          location.hash = '#/placed/' + r.code;
          return;
        }
        if (r.upi) {
          state.paying = false;
          state.cart = {};
          saveCart();
          state.orders = null;
          location.hash = '#/pay/' + r.orderId + '/' + (r.method || 'upi');
          // Phones: jump straight into GPay / PhonePe / Paytm with the amount filled in.
          var appLink = r.upi.apps && r.upi.apps[r.method];
          if (isMobile()) window.location.href = appLink || r.upi.link;
          return;
        }
        if (r.demoPayment) {
          return api('/api/checkout/demo-pay', { method: 'POST', body: { orderId: r.orderId } }).then(function () { paid(r.code); });
        }
        return loadRazorpay().then(function () {
          // Live keys on Android: open the chosen UPI app directly with the amount filled in.
          // (Razorpay test keys never open real UPI apps, so test mode uses Razorpay's test screen.)
          var live = !/^rzp_test_/.test(r.razorpay.keyId);
          if (live && r.method !== 'razorpay' && r.method !== 'upi' && /Android/i.test(navigator.userAgent) && openUpiAppDirect(r)) return;
          openRazorpaySheet(r);
        });
      })
      .catch(function (e) {
        setPaying(false);
        if (e.status === 401) { state.user = null; renderAccount(); refreshCart(); }
        toast(e.message);
      });
  }

  var UPI_PKG = { gpay: 'com.google.android.apps.nbu.paisa.user', phonepe: 'com.phonepe.app', paytm: 'net.one97.paytm' };

  function verifyAndFinish(r, resp) {
    if (state.finished === r.orderId) return Promise.resolve();
    return api('/api/checkout/verify', { method: 'POST', body: resp })
      .then(function () { finishPaid(r); })
      .catch(function () { checkPaid(r); });
  }

  function finishPaid(r) {
    if (state.finished === r.orderId) return;
    state.lastTotal = r.total;
    state.finished = r.orderId;
    stopPolling();
    hideWaiting();
    paid(r.code);
  }

  // Ask the server (which asks Razorpay) whether this order is paid yet.
  function checkPaid(r) {
    return api('/api/orders/' + r.orderId + '/check').then(function (x) {
      if (x.order && x.order.status !== 'pending_payment' && x.order.status !== 'failed') finishPaid(r);
      return x.order;
    }).catch(function () { return null; });
  }

  // While the customer is paying, keep checking so the order is placed automatically.
  function startPolling(r) {
    stopPolling();
    var tries = 0;
    state.poll = setInterval(function () {
      tries += 1;
      if (tries > 200) { stopPolling(); return; }
      checkPaid(r);
    }, 3000);
    state.onVisible = function () { if (!document.hidden) checkPaid(r); };
    document.addEventListener('visibilitychange', state.onVisible);
  }

  function stopPolling() {
    if (state.poll) clearInterval(state.poll);
    state.poll = null;
    if (state.onVisible) document.removeEventListener('visibilitychange', state.onVisible);
    state.onVisible = null;
  }

  // Opens GPay / PhonePe / Paytm straight away (Razorpay UPI intent). Returns false if not possible.
  function openUpiAppDirect(r) {
    var pkg = UPI_PKG[r.method];
    if (!pkg) return false;
    var rz;
    try {
      rz = new window.Razorpay({ key: r.razorpay.keyId });
      if (typeof rz.createPayment !== 'function') return false;
      rz.on('payment.success', function (resp) { verifyAndFinish(r, resp); });
      rz.on('payment.error', function (resp) {
        // Double-check with the server before telling the customer it failed.
        checkPaid(r).then(function (o) {
          if (o && o.status !== 'pending_payment' && o.status !== 'failed') return;
          stopPolling();
          hideWaiting();
          setPaying(false);
          var msg = resp && resp.error && resp.error.description;
          toast(msg ? 'Payment not completed: ' + msg : 'Payment not completed. Please try again.');
        });
      });
      rz.createPayment({
        amount: r.razorpay.amount,
        currency: r.razorpay.currency,
        order_id: r.razorpay.orderId,
        contact: r.prefill && r.prefill.contact,
        email: 'void@razorpay.com',
        description: 'Order #' + r.code,
        method: 'upi',
        '_[flow]': 'intent',
        upi_app_package_name: pkg
      });
    } catch (e) {
      return false;
    }
    showWaiting(r);
    startPolling(r);
    return true;
  }

  // "Complete the payment in Google Pay" screen while the customer is in the UPI app
  function showWaiting(r) {
    hideWaiting();
    var el = document.createElement('div');
    el.id = 'payWait';
    el.className = 'sheet-wrap open';
    el.innerHTML = '<div class="sheet-backdrop"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="waitTitle" style="text-align:center;align-items:center">' +
      upiIcon(r.method) +
      '<h2 id="waitTitle">Complete payment in ' + esc(APP_NAME[r.method]) + '</h2>' +
      '<p class="muted">' + rupees(r.total) + ' for order #' + esc(r.code) + '. Choose your bank and enter your UPI PIN. Your order is placed automatically as soon as the payment goes through.</p>' +
      '<div class="spinner" style="margin:6px auto" aria-label="Waiting for payment"></div>' +
      '<button type="button" class="btn btn-outline btn-block" data-wait="other">' + esc(APP_NAME[r.method]) + ' didn\'t open? Pay another way</button></div>';
    document.body.appendChild(el);
    el.querySelector('[data-wait="other"]').addEventListener('click', function () { hideWaiting(); stopPolling(); openRazorpaySheet(r); });
  }

  function hideWaiting() {
    var el = document.getElementById('payWait');
    if (el) el.remove();
  }

  // Razorpay's own payment sheet (all UPI apps, cards, net banking)
  function openRazorpaySheet(r) {
    return loadRazorpay().then(function () {
          // Show the app the customer picked at the top of Razorpay's payment sheet.
          var APP = { gpay: ['google_pay', 'Google Pay'], phonepe: ['phonepe', 'PhonePe'], paytm: ['paytm', 'Paytm'] }[r.method];
          var live = !/^rzp_test_/.test(r.razorpay.keyId);
          var prefill = Object.assign({}, r.prefill);
          var config;
          if (UPI_IDS.indexOf(r.method) >= 0) prefill.method = 'upi';
          if (APP && live) {
            config = { display: {
              blocks: { chosen: { name: 'Pay with ' + APP[1], instruments: [{ method: 'upi', flows: ['intent'], apps: [APP[0]] }] } },
              sequence: ['block.chosen'],
              preferences: { show_default_blocks: true }
            } };
          }
          var opts = {
            key: r.razorpay.keyId,
            amount: r.razorpay.amount,
            currency: r.razorpay.currency,
            order_id: r.razorpay.orderId,
            name: 'Priya Kitchen',
            description: 'Order #' + r.code,
            prefill: prefill,
            theme: { color: '#1F4D3A' },
            handler: function (resp) { verifyAndFinish(r, resp); },
            modal: { ondismiss: function () {
              // Closed the sheet — make sure the payment really didn't go through before saying so.
              checkPaid(r).then(function (o) {
                if (o && o.status !== 'pending_payment' && o.status !== 'failed') return;
                stopPolling();
                setPaying(false);
                toast('Payment cancelled. Your order was not placed.');
              });
            } }
          };
          if (config) opts.config = config;
          var rz = new window.Razorpay(opts);
          rz.on('payment.failed', function (resp) {
            toast('Payment failed: ' + ((resp && resp.error && resp.error.description) || 'please try again.'));
          });
          rz.open();
          startPolling(r);
    }).catch(function (e) { setPaying(false); toast(e.message); });
  }

  function paid(code) {
    state.paying = false;
    state.cart = {};
    saveCart();
    state.orders = null;
    // Payment confirmed automatically → "Order placed" screen.
    state.lastPlaced = { code: code, total: state.lastTotal };
    location.hash = '#/placed/' + code;
  }

  // ---------- events ----------
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-action]');
    if (!b) return;
    var a = b.getAttribute('data-action');
    var id = Number(b.getAttribute('data-id'));
    if (a === 'inc' || a === 'dec') {
      var nEl = document.getElementById('note');
      if (nEl) state.note = nEl.value;
      if (a === 'inc') state.cart[id] = Math.min(50, (state.cart[id] || 0) + 1);
      else { state.cart[id] = (state.cart[id] || 0) - 1; if (state.cart[id] <= 0) delete state.cart[id]; }
      saveCart();
      var y = window.scrollY;
      rerender();
      window.scrollTo(0, y);
    }
    else if (a === 'cat') { state.cat = b.getAttribute('data-cat'); viewHome(); }
    else if (a === 'go-checkout') { location.hash = '#/checkout'; }
    else if (a === 'choose-upi') { var nt = document.getElementById('note'); if (nt) state.note = nt.value; openUpiSheet(); }
    else if (a === 'login-orders') { state.redirect = '#/orders'; location.hash = '#/login'; }
    else if (a === 'edit-address') {
      var n2 = document.getElementById('note');
      if (n2) state.note = n2.value;
      state.editAddress = true; viewCheckout();
      var ta = document.getElementById('addr'); if (ta) ta.focus();
    }
    else if (a === 'pay') pay();
    else if (a === 'change-phone') { state.login = { step: 'phone', phone: state.login.phone, demoOtp: '' }; viewLogin(); }
    else if (a === 'resend') sendOtp(state.login.phone);
    else if (a === 'copy-upi') {
      var v = b.getAttribute('data-upi');
      (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { toast('UPI ID copied'); }, function () { toast('UPI ID: ' + v); });
    }
  });

  document.getElementById('account').addEventListener('click', function (e) {
    if (e.target.closest('[data-action="logout"]')) {
      api('/api/auth/logout', { method: 'POST', body: {} }).finally(function () {
        state.user = null; state.orders = null; disconnectStream(); renderAccount(); route();
        toast('You have been logged out.');
      });
    }
  });

  // Picking a payment method on the checkout page
  app.addEventListener('change', function (e) {
    if (e.target.name !== 'paymethod') return;
    var n = document.getElementById('note');
    if (n) state.note = n.value;
    state.method = e.target.value;
    var y = window.scrollY;
    viewCheckout();
    window.scrollTo(0, y);
    // Choosing "Pay by any UPI App" opens the list of UPI apps.
    if (UPI_IDS.indexOf(state.method) >= 0) openUpiSheet();
  });

  app.addEventListener('submit', function (e) {
    var f = e.target.getAttribute('data-form');
    if (!f) return;
    e.preventDefault();
    var btn = e.target.querySelector('button[type=submit]');
    if (f === 'phone') {
      var phone = document.getElementById('phone').value.replace(/\D/g, '');
      if (!/^[6-9]\d{9}$/.test(phone)) { toast('Please enter a valid 10-digit mobile number.'); return; }
      if (state.config.authMode === 'pin') {
        btn.disabled = true;
        api('/api/auth/pin-check', { method: 'POST', body: { phone: phone } })
          .then(function (r) { state.login = { step: 'pin', phone: phone, hasPin: r.hasPin, demoOtp: '' }; viewLogin(); })
          .catch(function (err) { btn.disabled = false; toast(err.message); });
      } else sendOtp(phone, btn);
    } else if (f === 'pin') {
      var pin = document.getElementById('pin').value.replace(/\D/g, '');
      if (pin.length !== 4) { toast('Your PIN must be 4 digits.'); return; }
      var pin2El = document.getElementById('pin2');
      if (pin2El && pin2El.value !== pin) { toast('The two PINs don\'t match. Please try again.'); return; }
      btn.disabled = true;
      api('/api/auth/pin-login', { method: 'POST', body: { phone: state.login.phone, pin: pin } })
        .then(loggedIn)
        .catch(function (err) { btn.disabled = false; toast(err.message); });
    } else if (f === 'otp') {
      var code = document.getElementById('otp').value.replace(/\D/g, '');
      if (code.length !== 4) { toast('Please enter the 4-digit OTP.'); return; }
      btn.disabled = true;
      api('/api/auth/verify-otp', { method: 'POST', body: { phone: state.login.phone, code: code } })
        .then(loggedIn)
        .catch(function (err) { btn.disabled = false; toast(err.message); });
    } else if (f === 'utr') {
      var utr = document.getElementById('utr').value.replace(/\s/g, '');
      if (utr && !/^[A-Za-z0-9]{10,22}$/.test(utr)) { toast('That UPI reference number doesn\'t look right — it is usually 12 digits. Or leave it empty.'); return; }
      btn.disabled = true;
      var oid = e.target.getAttribute('data-id');
      api('/api/orders/' + oid + '/upi-paid', { method: 'POST', body: { utr: utr } })
        .then(function (r) {
          state.orders = null;
          state.lastPlaced = { code: r.order.code, total: r.order.total, checking: true };
          location.hash = '#/placed/' + r.order.code;
        })
        .catch(function (err) { btn.disabled = false; toast(err.message); });
    } else if (f === 'profile') {
      var name = document.getElementById('pname').value.trim();
      var addr = document.getElementById('paddr').value.trim();
      if (name.length < 2) { toast('Please enter your name.'); return; }
      if (addr.length < 10) { toast('Please enter your full delivery address.'); return; }
      btn.disabled = true;
      api('/api/me', { method: 'PUT', body: { name: name, address: addr } })
        .then(function (r) { state.user = r.user; renderAccount(); finishLogin(); })
        .catch(function (err) { btn.disabled = false; toast(err.message); });
    }
  });

  function sendOtp(phone, btn) {
    if (btn) btn.disabled = true;
    api('/api/auth/send-otp', { method: 'POST', body: { phone: phone } })
      .then(function (r) {
        state.login = { step: 'otp', phone: phone, demoOtp: r.demoOtp || '' };
        viewLogin();
        toast('OTP sent to +91 ' + phone);
      })
      .catch(function (err) { if (btn) btn.disabled = false; toast(err.message); });
  }

  function loggedIn(r) {
    state.user = r.user;
    state.orders = null;
    renderAccount();
    connectStream();
    if (!r.user.profileComplete) { state.login.step = 'profile'; viewLogin(); }
    else finishLogin();
  }

  function finishLogin() {
    state.login = { step: 'phone', phone: '', demoOtp: '' };
    var to = state.redirect || '#/';
    state.redirect = '#/';
    toast('Welcome, ' + (state.user.name || '').split(' ')[0] + '!');
    location.hash = to;
    if (location.hash === to) route();
  }

  // ---------- router ----------
  function currentRoute() {
    var h = location.hash.replace(/^#\/?/, '');
    return h.split('/')[0] || 'home';
  }

  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/');
    var r = parts[0] || 'home';
    if (h === 'menu') r = 'home';
    window.scrollTo(0, 0);
    if (r === 'login') {
      if (state.user && state.user.profileComplete && state.login.step !== 'profile') { location.hash = '#/'; return; }
      viewLogin();
    } else if (r === 'orders') { location.hash = '#/'; return; }
    else if (r === 'success') viewSuccess(parts[1] || '');
    else if (r === 'checkout') viewCheckout();
    else if (r === 'placed') viewPlaced(parts[1] || '');
    else if (r === 'pay') viewPay(parts[1] || '', parts[2] || '');
    else if (r === 'submitted') viewSubmitted(parts[1] || '');
    else {
      viewHome();
      if (r === 'cart') { var c = document.getElementById('cart'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      if (h === 'menu') { var m = document.getElementById('menu'); if (m) m.scrollIntoView({ behavior: 'smooth' }); }
    }
  }

  window.addEventListener('hashchange', route);
  // in-page "#menu" link from the hero
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href="#menu"]');
    if (a) { e.preventDefault(); var m = document.getElementById('menu'); if (m) m.scrollIntoView({ behavior: 'smooth' }); }
  });

  // ---------- start ----------
  Promise.all([api('/api/config'), api('/api/menu'), api('/api/me')])
    .then(function (res) {
      state.config = res[0];
      state.menu = res[1].items;
      state.user = res[2].user;
      if (state.config.ownerWhatsapp) {
        var w = document.getElementById('waLink');
        var n = state.config.ownerWhatsapp;
        w.href = 'https://wa.me/' + n;
        w.textContent = 'WhatsApp: +' + n.slice(0, 2) + ' ' + n.slice(2, 7) + ' ' + n.slice(7);
      }
      // drop cart items that are no longer on the menu
      var ids = {};
      state.menu.forEach(function (m) { ids[m.id] = 1; });
      Object.keys(state.cart).forEach(function (k) { if (!ids[k]) delete state.cart[k]; });
      saveCart();
      renderAccount();
      if (state.user && !state.user.profileComplete) state.login.step = 'profile';
      var ef = document.getElementById('etaFoot');
      if (ef) ef.textContent = 'Delivered within ' + (state.config.deliveryMinutes || 30) + ' minutes. Order updates on WhatsApp.';
      var pf = document.getElementById('payFoot');
      if (pf) pf.textContent = payNote() + '.';
      connectStream();
      route();
    })
    .catch(function (e) {
      app.innerHTML = '<section class="page"><div class="narrow"><div class="panel"><h1>Couldn\'t load</h1><p class="muted">' + esc(e.message) + '</p><button class="btn btn-primary" onclick="location.reload()">Try again</button></div></div></section>';
    });
})();
