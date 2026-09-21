# Single-product showcase + store

A one-product website: hero, a Features page (detailed description, technical
specifications, usage scenarios), and a working add-to-cart → checkout →
confirmation flow with an order confirmation email.

The product currently shown — an **FX-991EX scientific calculator at AED 79.99**
— is the placeholder example supplied for the build. The brand, **AXIOM
INSTRUMENTS**, is invented for the same reason. Replace both before the site
goes live. Section 2 below is the only file you have to touch to do that.

---

## 1. Running it

Requires Node 18 or newer.

```bash
npm install
cp .env.example .env     # then fill it in — see section 4
npm start                # http://localhost:3000
```

`npm run dev` does the same thing but restarts on file changes.

Out of the box, with no keys in `.env`, the site runs in **demo mode**: you can
walk the whole order → confirmation → email path, but no payment is taken and
no card field is ever shown. Confirmation emails are written to
`data/emails/<order-ref>.eml` instead of being sent, so you can open and read
them.

---

## 2. Editing the site

**Everything you will want to change lives in one file: `content/product.json`.**
Save it and refresh the browser. There is no build step and nothing to redeploy.

| What you want to change | Where in `content/product.json` |
| --- | --- |
| Brand name, tagline, support email | `brand.*` |
| Product name, subtitle, SKU | `product.*` |
| The short spec beside the price ("552 functions") | `product.spec` |
| **Price** | `product.priceMinor` |
| **Currency** | `product.currency` + `product.currencySymbol` |
| Crossed-out "was" price | `product.compareAtMinor` (`0` hides it) |
| Delivery charge | `product.shippingMinor` |
| Free-delivery threshold | `product.freeShippingOverMinor` |
| Max units per order | `product.maxQty` |
| "In stock" line | `product.inStock`, `product.stockNote` |
| Hero headline | `home.heroHeadlineHtml` |
| Hero paragraph | `product.heroSub` |
| Scrolling strip of words | `product.marquee` |
| The dark statement band | `home.statementHtml`, `home.statementNotes` |
| The three-column pillar row | `home.pillarsTitleHtml`, `home.pillarsLede`, `home.pillars` |
| The three description blocks | `features.detail.blocks` |
| The specification tables | `features.specs.groups` |
| The five usage scenarios | `features.usage.scenarios` |
| FAQ | `features.faq` |
| Reassurance lines by the buy button | `checkout.trustPoints` |

The three `…Html` fields are the only ones where markup is allowed, and only
`<br>` and `<em>` (the italic accent colour). Everything else on the site is
escaped, so a `<` in your copy is safe and will simply appear as a `<`.

### Prices are in minor units

`priceMinor` is **the smallest unit of your currency, as a whole number**.
`7999` is AED 79.99. `900` is AED 9.00. Never write `79.99` — floating point and
money do not mix, and the file is rejected on startup if you try.

`currency` must be the lower-case ISO code Stripe expects (`aed`, `usd`, `gbp`),
and `currencySymbol` is whatever you want printed in front of the number. If the
symbol is the code itself (`"AED "` — note the trailing space) the site is smart
enough not to print "AED 94.99 AED" on the receipt.

### Changing the images

Drop new files into `public/img/` and point `product.images.hero` at them.

- `src1x` / `src2x` — the product shot, ideally a PNG or WebP with a
  transparent background. Supply a 2× version for sharp phone screens.
- `fallback` — a PNG of the same image, for very old browsers.
- `width` / `height` — the **1× pixel dimensions**. Getting these right stops
  the page jumping around while the image loads.
- `alt` — a plain-English description, for screen readers and for Google.

The three images in `features.detail.blocks[].image` work the same way; each
has its own `imageWidth` / `imageHeight`.

> **On image quality:** the current shots are cut out of a marketplace listing
> screenshot, which is all that was available. They are sharp enough at the
> sizes used, but real product photography at 2000 px or more on the long edge
> will look noticeably better, especially on phones.

### If you break the JSON

A malformed edit will not take the site down. The server logs the parse error
and keeps serving the last good version. Fix the file, save, and it reloads.
(Usual culprits: a trailing comma, or a `"` inside a string that needs `\"`.)

---

## 3. What is where

```
server.js              routes, security headers, rate limiting
lib/content.js         loads + hot-reloads content/product.json
lib/pricing.js         all money arithmetic, in integer cents
lib/payments.js        Stripe Checkout; falls back to demo mode with no keys
lib/orders.js          order store (a JSON file) + email idempotency
lib/mailer.js          the confirmation email, text and HTML
views/                 page templates (EJS)
public/css/site.css    the entire stylesheet
public/js/cart.js      bag, quantity stepper, checkout button
public/fonts/          self-hosted fonts — no Google Fonts request at runtime
content/product.json   ← everything you edit
data/                  orders + sent emails; created at runtime, not in git
```

---

## 4. Connecting Stripe

1. Create a Stripe account and open
   **Developers → API keys**.
2. Start in **test mode**. Copy the secret key (`sk_test_…`) into `.env` as
   `STRIPE_SECRET_KEY`.
3. Set `PUBLIC_URL` in `.env` to the address customers actually see, e.g.
   `https://your-domain.com`. Stripe sends people back here after paying, so
   it has to be right.
4. **Developers → Webhooks → Add endpoint**:
   - URL: `https://your-domain.com/webhook/stripe`
   - Event: `checkout.session.completed`
   - Copy the signing secret (`whsec_…`) into `.env` as
     `STRIPE_WEBHOOK_SECRET`.
5. Restart the app. `npm start` prints `payments: test`.
6. Place a test order with card `4242 4242 4242 4242`, any future expiry, any
   CVC.
7. When you are happy, swap in the live keys (`sk_live_…` and a new webhook
   signing secret from live mode). The app prints `payments: live` so you can
   tell at a glance which mode you are in.

`SHIPPING_COUNTRIES` controls the country list on Stripe's address form.

### Why checkout is safe

Card details are entered on Stripe's own hosted page and never touch this
server, which keeps the site out of PCI scope. The amount charged is always
recalculated here from `content/product.json` — the browser can ask what
something costs, but it is never believed about it. Quantities are validated
server-side, checkout is rate-limited, and the webhook signature is verified
before anything is acted on.

---

## 5. Confirmation email

Set the `SMTP_*` values in `.env` and the confirmation sends for real. Any
provider works — your host's SMTP, Gmail with an app password, SendGrid,
Postmark, Mailgun.

```
SMTP_HOST=smtp.postmarkapp.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM="Your Brand <orders@your-domain.com>"
```

Leave `SMTP_HOST` blank and the email is written to `data/emails/` instead —
useful for checking the wording without sending anything.

The email goes out once per order, whether it is triggered by the Stripe
webhook or by the customer landing on the confirmation page, and a Stripe
webhook retry will not send a duplicate.

**Deliverability:** add SPF and DKIM records for your sending domain, or
confirmation emails will land in spam. Your mail provider will give you the
exact records.

---

## 6. Going live

```bash
npm ci --omit=dev
NODE_ENV=production npm start
```

Run it behind nginx or Caddy with HTTPS. A minimal Caddy config:

```
your-domain.com {
    reverse_proxy 127.0.0.1:3000
}
```

Keep it running with systemd, pm2 or Docker — whatever your host prefers. A
sample systemd unit:

```ini
[Unit]
Description=Single-product store
After=network.target

[Service]
WorkingDirectory=/var/www/store
ExecStart=/usr/bin/node server.js
Environment=NODE_ENV=production
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

### Before you take real money

- [ ] Replace the placeholder product, brand, copy and images with the real ones
- [ ] Replace **every** figure in the specifications table — they are marked
      `PLACEHOLDER` on the page for exactly this reason. The exam-suitability
      row in particular is a compliance claim and must not be guessed
- [ ] Set the real price, currency, delivery charge and free-delivery threshold
- [ ] Set `brand.supportEmail`, `brand.legalName` and `brand.address`
- [ ] Live Stripe keys in, `payments: live` confirmed in the logs
- [ ] SMTP configured, and a test order's confirmation email actually received
- [ ] Add your terms, returns and privacy pages and link them in the footer
- [ ] `data/` backed up, or `lib/orders.js` pointed at a real database

`data/` and `.env` are in `.gitignore`. Keep them that way — `.env` holds your
Stripe secret key.

---

## 7. Notes

- No CSS or JS framework, no build pipeline. Fonts are self-hosted, so the page
  makes no third-party requests at all.
- A Content Security Policy is set in `server.js`. It allows Stripe and nothing
  else — if you add an external script or font later, you must add it there or
  the browser will block it.
- Reduced-motion preferences are respected; the marquee and entrance
  animations switch off.
