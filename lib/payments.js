'use strict';

const crypto = require('crypto');
const { totalsFor } = require('./pricing');

/**
 * Stripe Checkout.
 *
 * Card details are entered on Stripe's own hosted page and never reach this
 * server, so the site stays out of PCI scope. We send Stripe a price we
 * calculated here from content/product.json; we never accept an amount from
 * the browser.
 *
 * With no STRIPE_SECRET_KEY set the module runs in "demo" mode: the order ->
 * confirmation -> email path still works end to end so the flow can be shown
 * and tested, but no payment is taken and no card field is ever presented.
 */

const secret = (process.env.STRIPE_SECRET_KEY || '').trim();
const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();

const stripe = secret ? require('stripe')(secret) : null;

function mode() {
  if (!stripe) return 'demo';
  return secret.startsWith('sk_live_') ? 'live' : 'test';
}

function refFromSessionId(id) {
  return 'ALC-' + id.slice(-8).toUpperCase();
}

async function createCheckout({ qty, content, origin }) {
  const p = content.product;
  const totals = totalsFor(qty, p);

  if (!stripe) {
    return `/checkout/demo?qty=${qty}`;
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        quantity: qty,
        price_data: {
          currency: p.currency,
          unit_amount: p.priceMinor, // server-side price, always
          product_data: {
            name: `${p.name} — ${p.subtitle}`,
            description: `${p.volume}. ${p.shortDescription}`.slice(0, 500),
            metadata: { sku: p.sku }
          }
        }
      }
    ],
    shipping_options: totals.shippingMinor
      ? [
          {
            shipping_rate_data: {
              type: 'fixed_amount',
              fixed_amount: { amount: totals.shippingMinor, currency: p.currency },
              display_name: 'Standard delivery'
            }
          }
        ]
      : [
          {
            shipping_rate_data: {
              type: 'fixed_amount',
              fixed_amount: { amount: 0, currency: p.currency },
              display_name: 'Free delivery'
            }
          }
        ],
    shipping_address_collection: { allowed_countries: shippingCountries() },
    billing_address_collection: 'auto',
    phone_number_collection: { enabled: false },
    allow_promotion_codes: true,
    metadata: { sku: p.sku, qty: String(qty) },
    success_url: `${origin}/order/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/order/cancelled`
  });

  return session.url;
}

function shippingCountries() {
  const raw = (process.env.SHIPPING_COUNTRIES || 'US,CA,GB,AU,NZ,IE,DE,FR,ES,IT,NL,SE,NO,DK,FI,IN,AE,SG')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return [...new Set(raw)];
}

function constructWebhookEvent(rawBody, signature) {
  if (!stripe) throw new Error('Stripe is not configured');
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

/** Build our order record from a completed Stripe Checkout Session. */
async function orderFromSession(sessionId, content) {
  if (!stripe) return null;

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items', 'customer_details']
  });

  if (session.payment_status !== 'paid') return null;

  const qty = session.line_items?.data?.[0]?.quantity || Number(session.metadata?.qty) || 1;
  const d = session.customer_details || {};
  const ship = session.shipping_details || session.shipping || {};

  return {
    ref: refFromSessionId(session.id),
    mode: mode(),
    sessionId: session.id,
    paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    email: d.email || '',
    name: ship.name || d.name || '',
    qty,
    currency: (session.currency || content.product.currency).toUpperCase(),
    currencySymbol: content.product.currencySymbol || '',
    subtotalMinor: session.amount_subtotal ?? content.product.priceMinor * qty,
    shippingMinor: session.total_details?.amount_shipping ?? 0,
    discountMinor: session.total_details?.amount_discount ?? 0,
    totalMinor: session.amount_total ?? 0,
    address: formatAddress(ship.address || d.address),
    productName: `${content.product.name} — ${content.product.subtitle}`,
    sku: content.product.sku,
    placedAt: new Date(session.created * 1000).toISOString()
  };
}

/** The no-gateway equivalent, used only when Stripe keys are absent. */
function demoOrder({ qty, email, body, content }) {
  const p = content.product;
  const totals = totalsFor(qty, p);
  const ref = 'DEMO-' + crypto.randomBytes(4).toString('hex').toUpperCase();

  return {
    ref,
    mode: 'demo',
    sessionId: null,
    paymentIntent: null,
    email,
    name: String(body.name || '').slice(0, 120),
    qty,
    currency: p.currency.toUpperCase(),
    currencySymbol: p.currencySymbol || '',
    subtotalMinor: totals.subtotalMinor,
    shippingMinor: totals.shippingMinor,
    discountMinor: 0,
    totalMinor: totals.totalMinor,
    address: formatAddress({
      line1: body.line1,
      line2: body.line2,
      city: body.city,
      postal_code: body.postcode,
      country: body.country
    }),
    productName: `${p.name} — ${p.subtitle}`,
    sku: p.sku,
    placedAt: new Date().toISOString()
  };
}

function formatAddress(a) {
  if (!a) return '';
  return [a.line1, a.line2, a.city, a.state, a.postal_code, a.country]
    .map((s) => (s || '').toString().trim())
    .filter(Boolean)
    .join('\n');
}

module.exports = {
  mode,
  createCheckout,
  constructWebhookEvent,
  orderFromSession,
  demoOrder
};
