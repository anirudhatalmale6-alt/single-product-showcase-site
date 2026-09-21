/* Bag, quantity and checkout kick-off.
 *
 * The bag holds a quantity and nothing else - there is one product. Prices
 * shown here are for display; the server recalculates every figure before it
 * reaches Stripe, so a tampered localStorage changes what you see and nothing
 * you pay.
 */
(function () {
  'use strict';

  var KEY = 'alchemy.bag.v1';
  var body = document.body;
  var PRICE = parseInt(body.dataset.price, 10) || 0;
  var MAXQTY = parseInt(body.dataset.maxqty, 10) || 10;
  var SYM = body.dataset.currency || '';

  /* ------------------------------------------------------------ storage */

  function read() {
    try {
      var n = parseInt(JSON.parse(localStorage.getItem(KEY)).qty, 10);
      return clamp(n);
    } catch (e) {
      return 0;
    }
  }

  function write(qty) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ qty: qty }));
    } catch (e) {
      /* private mode - the page still works, the bag just will not persist */
    }
    paintBag(qty);
  }

  function clamp(n) {
    if (!isFinite(n)) return 0;
    n = Math.round(n);
    if (n < 0) return 0;
    if (n > MAXQTY) return MAXQTY;
    return n;
  }

  var fmt = function (minor) { return SYM + (minor / 100).toFixed(2); };

  /* ------------------------------------------------------------ chrome */

  function paintBag(qty) {
    var counts = document.querySelectorAll('[data-bag-count]');
    for (var i = 0; i < counts.length; i++) counts[i].textContent = qty;
    var bags = document.querySelectorAll('[data-bag]');
    for (var j = 0; j < bags.length; j++) bags[j].dataset.empty = qty === 0 ? 'true' : 'false';
  }

  var toastEl = document.querySelector('[data-toast]');
  var toastTimer;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2600);
  }

  /* ------------------------------------------------- quantity steppers */

  // On product pages the stepper is a "how many shall I add" control and
  // starts at 1. On the cart page it IS the bag, so it reflects storage.
  var onCart = !!document.querySelector('[data-cart-full]');
  var localQty = onCart ? Math.max(read(), 1) : 1;

  function paintQty() {
    var outs = document.querySelectorAll('[data-qty-out]');
    for (var i = 0; i < outs.length; i++) outs[i].textContent = localQty;
    toggle('[data-qty-dec]', localQty <= 1);
    toggle('[data-qty-inc]', localQty >= MAXQTY);
  }

  function toggle(sel, disabled) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) els[i].disabled = disabled;
  }

  document.addEventListener('click', function (e) {
    var dec = e.target.closest ? e.target.closest('[data-qty-dec]') : null;
    var inc = e.target.closest ? e.target.closest('[data-qty-inc]') : null;
    if (!dec && !inc) return;
    localQty = clamp(localQty + (inc ? 1 : -1));
    if (localQty < 1) localQty = 1;
    paintQty();
    if (onCart) { write(localQty); refreshTotals(); }
  });

  /* ------------------------------------------------------- add to bag */

  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-add-to-bag]') : null;
    if (!btn) return;
    var add = btn.hasAttribute('data-use-qty') ? localQty : 1;
    var next = clamp(read() + add);
    if (next === read() && next === MAXQTY) {
      toast('That is the maximum of ' + MAXQTY + ' per order.');
      return;
    }
    write(next);
    toast(add + (add === 1 ? ' bottle' : ' bottles') + ' added — ' + next + ' in your bag');
  });

  /* -------------------------------------------------------- cart page */

  var full = document.querySelector('[data-cart-full]');
  var emptyEl = document.querySelector('[data-cart-empty]');

  function paintCartVisibility() {
    if (!full || !emptyEl) return;
    var has = read() > 0;
    full.hidden = !has;
    emptyEl.hidden = has;
  }

  // The server owns the arithmetic, even for a number we are only displaying.
  function refreshTotals() {
    if (!full) return;
    var qty = read();
    if (qty < 1) { paintCartVisibility(); return; }

    setText('[data-line-total]', fmt(PRICE * qty));

    fetch('/api/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty: qty })
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
      .then(function (t) {
        setText('[data-line-total]', fmt(t.subtotalMinor));
        setText('[data-sum-subtotal]', fmt(t.subtotalMinor));
        setText('[data-sum-shipping]', t.shippingMinor ? fmt(t.shippingMinor) : 'Free');
        setText('[data-sum-total]', fmt(t.totalMinor));
        var nudge = document.querySelector('[data-ship-nudge]');
        if (nudge) {
          if (t.toFreeShippingMinor > 0) {
            nudge.textContent = 'Add ' + fmt(t.toFreeShippingMinor) + ' more for free delivery';
            nudge.hidden = false;
          } else {
            nudge.hidden = true;
          }
        }
      })
      .catch(function () { /* keep the locally computed figures */ });
  }

  function setText(sel, val) {
    var el = document.querySelector(sel);
    if (el) el.textContent = val;
  }

  /* --------------------------------------------------------- checkout */

  var checkoutBtn = document.querySelector('[data-checkout]');
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', function () {
      var errEl = document.querySelector('[data-checkout-error]');
      if (errEl) errEl.hidden = true;
      checkoutBtn.disabled = true;
      checkoutBtn.textContent = 'Opening secure checkout…';

      fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty: read() })
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok || !res.j.url) throw new Error(res.j.error || 'Checkout unavailable');
          window.location.href = res.j.url;
        })
        .catch(function (err) {
          checkoutBtn.disabled = false;
          checkoutBtn.textContent = 'Checkout';
          if (errEl) { errEl.textContent = err.message; errEl.hidden = false; }
        });
    });
  }

  /* ------------------------------------------------------ scroll spy */

  var spies = document.querySelectorAll('[data-spy]');
  if (spies.length && 'IntersectionObserver' in window) {
    var sections = [];
    for (var s = 0; s < spies.length; s++) {
      var target = document.getElementById(spies[s].dataset.spy);
      if (target) sections.push(target);
    }
    var spyObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        for (var k = 0; k < spies.length; k++) {
          spies[k].classList.toggle('is-active', spies[k].dataset.spy === en.target.id);
        }
      });
    }, { rootMargin: '-15% 0px -70% 0px' });
    sections.forEach(function (sec) { spyObs.observe(sec); });
  }

  /* ---------------------------------------------------- rise on scroll */

  var rises = document.querySelectorAll('[data-rise]');
  if (rises.length) {
    if ('IntersectionObserver' in window) {
      var riseObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add('is-in');
            riseObs.unobserve(en.target);
          }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
      for (var r = 0; r < rises.length; r++) riseObs.observe(rises[r]);
    } else {
      for (var q = 0; q < rises.length; q++) rises[q].classList.add('is-in');
    }
  }

  /* ------------------------------------------------------------- boot */

  // The order is placed - the bag has served its purpose. Do this before the
  // first paint so the header never flashes a stale count.
  if (window.location.pathname === '/order/complete') {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  paintBag(read());
  paintQty();
  paintCartVisibility();
  refreshTotals();
})();
