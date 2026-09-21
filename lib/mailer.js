'use strict';

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

/**
 * Order confirmation email.
 *
 * With SMTP_HOST set it sends for real. Without it, the message is written
 * to data/emails/<ref>.eml so the confirmation step can still be seen and
 * checked before a mail provider is connected. Same template either way -
 * what you review offline is exactly what goes out live.
 */

const MAILDIR = path.join(__dirname, '..', 'data', 'emails');

const host = (process.env.SMTP_HOST || '').trim();

const transport = host
  ? nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || '') === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined
    })
  : nodemailer.createTransport({ streamTransport: true, newline: 'unix', buffer: true });

function mode() {
  return host ? `smtp (${host})` : 'file (data/emails/*.eml)';
}

async function sendOrderConfirmation(order, content) {
  const from =
    process.env.MAIL_FROM || `${content.brand.name} <${content.brand.supportEmail}>`;

  const msg = {
    from,
    to: order.email,
    replyTo: content.brand.supportEmail,
    subject: `Order ${order.ref} confirmed — ${content.product.name}`,
    text: textBody(order, content),
    html: htmlBody(order, content)
  };

  const info = await transport.sendMail(msg);

  if (!host) {
    fs.mkdirSync(MAILDIR, { recursive: true });
    fs.writeFileSync(path.join(MAILDIR, `${order.ref}.eml`), info.message);
    console.log(`[mail] wrote data/emails/${order.ref}.eml (no SMTP configured)`);
  } else {
    console.log(`[mail] sent ${order.ref} to ${order.email} (${info.messageId})`);
  }

  return info;
}

const fmt = (minor, sym) => `${sym}${(minor / 100).toFixed(2)}`;

// Some currencies use their ISO code as the symbol (AED, CHF...). Appending
// the code again would read "AED 94.99 AED".
const codeSuffix = (o) =>
  String(o.currencySymbol).trim().toUpperCase() === o.currency ? '' : ' ' + o.currency;

function textBody(o, c) {
  const lines = [
    `Thanks — your order is confirmed.`,
    ``,
    `Order reference: ${o.ref}`,
    `Placed: ${new Date(o.placedAt).toUTCString()}`,
    ``,
    `${o.qty} x ${o.productName} (${c.product.spec})`,
    `Subtotal      ${fmt(o.subtotalMinor, o.currencySymbol)}`
  ];
  if (o.discountMinor) lines.push(`Discount     -${fmt(o.discountMinor, o.currencySymbol)}`);
  lines.push(
    `Delivery      ${o.shippingMinor ? fmt(o.shippingMinor, o.currencySymbol) : 'Free'}`,
    `Total         ${fmt(o.totalMinor, o.currencySymbol)}${codeSuffix(o)}`,
    ``
  );
  if (o.address) lines.push(`Delivering to:`, o.address, ``);
  if (o.mode === 'demo') {
    lines.push(
      `--- DEMO ORDER: no payment was taken and nothing will be dispatched. ---`,
      ``
    );
  } else if (o.mode === 'test') {
    lines.push(`--- STRIPE TEST MODE: no real payment was taken. ---`, ``);
  }
  lines.push(
    `Questions? Reply to this email or write to ${c.brand.supportEmail}.`,
    ``,
    `${c.brand.name}`,
    c.brand.tagline
  );
  return lines.join('\n');
}

function htmlBody(o, c) {
  const sym = o.currencySymbol;
  const banner =
    o.mode === 'demo'
      ? `<p style="margin:0 0 24px;padding:12px 16px;background:#EAF2FE;border:1px solid #B9D3F7;border-radius:4px;font:500 13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#0B4FA8;">DEMO ORDER — no payment was taken and nothing will be dispatched.</p>`
      : o.mode === 'test'
        ? `<p style="margin:0 0 24px;padding:12px 16px;background:#EAF2FE;border:1px solid #B9D3F7;border-radius:4px;font:500 13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#0B4FA8;">STRIPE TEST MODE — no real payment was taken.</p>`
        : '';

  const row = (label, value, strong) => `
    <tr>
      <td style="padding:8px 0;font:${strong ? '600' : '400'} 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#121316;">${label}</td>
      <td align="right" style="padding:8px 0;font:${strong ? '600' : '400'} 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#121316;">${value}</td>
    </tr>`;

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F1F1EF;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F1EF;padding:40px 16px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #D8D9D6;border-radius:6px;padding:40px;">
    <tr><td>
      <p style="margin:0 0 32px;font:500 12px/1 -apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#767A82;">${esc(c.brand.name)}</p>
      ${banner}
      <h1 style="margin:0 0 8px;font:400 30px/1.15 Georgia,'Times New Roman',serif;color:#121316;">Thanks — your order is confirmed.</h1>
      <p style="margin:0 0 28px;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#767A82;">Reference <strong style="color:#121316;">${esc(o.ref)}</strong> · ${new Date(o.placedAt).toUTCString()}</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #D8D9D6;border-bottom:1px solid #D8D9D6;margin:0 0 28px;">
        ${row(`${o.qty} × ${esc(o.productName)}`, fmt(o.subtotalMinor, sym))}
        ${o.discountMinor ? row('Discount', '−' + fmt(o.discountMinor, sym)) : ''}
        ${row('Delivery', o.shippingMinor ? fmt(o.shippingMinor, sym) : 'Free')}
        ${row('Total', fmt(o.totalMinor, sym) + esc(codeSuffix(o)), true)}
      </table>

      ${
        o.address
          ? `<p style="margin:0 0 28px;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#767A82;"><span style="display:block;color:#121316;font-weight:600;margin-bottom:4px;">Delivering to</span>${esc(o.address).replace(/\n/g, '<br>')}</p>`
          : ''
      }

      <p style="margin:0;font:400 13px/1.7 -apple-system,Segoe UI,Roboto,sans-serif;color:#767A82;">Questions? Just reply to this email, or write to <a href="mailto:${esc(c.brand.supportEmail)}" style="color:#0B5FD0;">${esc(c.brand.supportEmail)}</a>.</p>
    </td></tr>
  </table>
  <p style="margin:20px 0 0;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#9DA2AA;">${esc(c.brand.name)} — ${esc(c.brand.tagline)}</p>
</td></tr>
</table>
</body></html>`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sendOrderConfirmation, mode };
