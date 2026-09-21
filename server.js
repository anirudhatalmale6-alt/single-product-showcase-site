'use strict';

/**
 * Single-product showcase + store.
 *
 * Everything the client edits lives in content/product.json.
 * Everything that must not be editable from the browser - price, currency,
 * shipping, quantity limits - is read from that file ON THE SERVER at
 * checkout time. The browser never tells us what something costs.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const { loadContent, watchContent } = require('./lib/content');
const { money, totalsFor } = require('./lib/pricing');
const orders = require('./lib/orders');
const mailer = require('./lib/mailer');
const payments = require('./lib/payments');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

/* ---------------------------------------------------------------- content */

let content = loadContent();
watchContent((next) => {
  content = next;
  console.log('[content] product.json reloaded');
});

/* ------------------------------------------------------- stripe webhook --
 * Must be mounted BEFORE the JSON body parser: signature verification needs
 * the raw bytes, and express.json() would have already consumed them. */

app.post(
  '/webhook/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    let event;
    try {
      event = payments.constructWebhookEvent(req.body, req.headers['stripe-signature']);
    } catch (err) {
      console.error('[webhook] signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      try {
        const order = await payments.orderFromSession(event.data.object.id, content);
        if (order) await fulfil(order);
      } catch (err) {
        console.error('[webhook] fulfilment failed:', err.message);
        return res.status(500).send('fulfilment failed');
      }
    }

    res.json({ received: true });
  }
);

/* ------------------------------------------------------------ middleware */

app.use(compression());
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://js.stripe.com'],
        frameSrc: ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
        connectSrc: ["'self'", 'https://api.stripe.com'],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'", 'https://checkout.stripe.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false,
    hsts: process.env.NODE_ENV === 'production' ? undefined : false
  })
);
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

app.use(
  express.static(PUBLIC_DIR, {
    maxAge: process.env.NODE_ENV === 'production' ? '365d' : 0,
    etag: true,
    setHeaders(res, filePath) {
      // HTML is never long-cached; hashed-ish assets are.
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    }
  })
);

// Values every template needs.
app.use((req, res, next) => {
  res.locals.c = content;
  res.locals.money = (minor) => money(minor, content.product);
  res.locals.path = req.path;
  res.locals.paymentsMode = payments.mode();
  res.locals.year = new Date().getFullYear();
  next();
});

const checkoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many checkout attempts. Please wait a few minutes.' }
});

/* ----------------------------------------------------------------- pages */

app.get('/', (req, res) => {
  res.render('index', { title: `${content.brand.name} — ${content.product.name}` });
});

app.get('/features', (req, res) => {
  res.render('features', {
    title: `${content.product.name} — features, specifications & uses`
  });
});

app.get('/cart', (req, res) => {
  res.render('cart', { title: `Your bag — ${content.brand.name}` });
});

/* ------------------------------------------------------------ cart maths --
 * The browser asks "what would N cost?"; the server answers. The browser is
 * never the source of truth for a number that ends up on a card statement. */

app.post('/api/quote', (req, res) => {
  const qty = normaliseQty(req.body.qty, content.product.maxQty);
  if (qty === null) return res.status(400).json({ error: 'Invalid quantity' });
  res.json({ qty, ...totalsFor(qty, content.product) });
});

/* -------------------------------------------------------------- checkout */

app.post('/api/checkout', checkoutLimiter, async (req, res) => {
  const qty = normaliseQty(req.body.qty, content.product.maxQty);
  if (qty === null) return res.status(400).json({ error: 'Invalid quantity' });
  if (!content.product.inStock) return res.status(409).json({ error: 'Out of stock' });

  try {
    const url = await payments.createCheckout({ qty, content, origin: originOf(req) });
    res.json({ url });
  } catch (err) {
    console.error('[checkout]', err);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
});

/* --------------------------------------------------- demo checkout (no keys)
 * Only reachable when Stripe keys are absent. It collects NO card details -
 * it exists so the order -> confirmation -> email path can be demonstrated
 * end to end before the gateway is connected. */

app.get('/checkout/demo', (req, res) => {
  if (payments.mode() !== 'demo') return res.redirect('/cart');
  const qty = normaliseQty(req.query.qty, content.product.maxQty) ?? 1;
  res.render('checkout-demo', {
    title: `Checkout — ${content.brand.name}`,
    qty,
    totals: totalsFor(qty, content.product)
  });
});

app.post('/checkout/demo', checkoutLimiter, async (req, res, next) => {
  if (payments.mode() !== 'demo') return res.redirect('/cart');
  const qty = normaliseQty(req.body.qty, content.product.maxQty);
  const email = String(req.body.email || '').trim();
  if (qty === null) return res.redirect('/cart');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).render('checkout-demo', {
      title: `Checkout — ${content.brand.name}`,
      qty,
      totals: totalsFor(qty, content.product),
      error: 'Please enter a valid email address so we can send your confirmation.'
    });
  }

  try {
    const order = payments.demoOrder({ qty, email, body: req.body, content });
    await fulfil(order);
    res.redirect(`/order/complete?ref=${encodeURIComponent(order.ref)}`);
  } catch (err) {
    next(err);
  }
});

/* --------------------------------------------------------- confirmation */

app.get('/order/complete', async (req, res, next) => {
  try {
    let order = null;

    if (req.query.session_id) {
      order = await payments.orderFromSession(String(req.query.session_id), content);
      // Belt and braces: the webhook normally sends the email, but a demo
      // box often has no public webhook URL. fulfil() is idempotent, so
      // whichever path arrives first wins and the second is a no-op.
      if (order) await fulfil(order);
    } else if (req.query.ref) {
      order = orders.get(String(req.query.ref));
    }

    if (!order) return res.status(404).render('404', { title: 'Order not found' });

    res.render('success', {
      title: `Order ${order.ref} confirmed — ${content.brand.name}`,
      order
    });
  } catch (err) {
    next(err);
  }
});

app.get('/order/cancelled', (req, res) => {
  res.render('cancelled', { title: 'Checkout cancelled' });
});

/* ------------------------------------------------------------ fulfilment */

async function fulfil(order) {
  const fresh = orders.save(order); // returns false if this ref was already stored
  if (!fresh) return;
  try {
    await mailer.sendOrderConfirmation(order, content);
    orders.markEmailed(order.ref);
  } catch (err) {
    // A failed email must not lose the order.
    console.error('[mail] confirmation failed for', order.ref, err.message);
  }
}

/* --------------------------------------------------------------- plumbing */

app.get('/healthz', (req, res) => res.json({ ok: true, payments: payments.mode() }));

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${originOf(req)}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (req, res) => {
  const base = originOf(req);
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      ['/', '/features']
        .map((u) => `  <url><loc>${base}${u}</loc></url>\n`)
        .join('') +
      `</urlset>\n`
  );
});

app.use((req, res) => res.status(404).render('404', { title: 'Page not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Something went wrong' });
});

/* --------------------------------------------------------------- helpers */

function normaliseQty(raw, max) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > (max || 10)) return null;
  return n;
}

function originOf(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

app.listen(PORT, () => {
  console.log(`[server] ${content.brand.name} on http://localhost:${PORT}`);
  console.log(`[server] payments: ${payments.mode()}`);
  console.log(`[server] mail: ${mailer.mode()}`);
});

module.exports = app;
