'use strict';

const fs = require('fs');
const path = require('path');

/**
 * A deliberately small order store: one JSON file, append-only in practice.
 * It exists for two reasons - to render the confirmation page, and to make
 * the confirmation email idempotent so a Stripe webhook retry (or the
 * customer refreshing the success page) cannot send it twice.
 *
 * Swap this module for a real database later; nothing else needs to change.
 */

const DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'orders.json');

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeAll(all) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, FILE); // atomic - never leaves a half-written orders.json
}

/** Returns true if this is the first time we have seen this order ref. */
function save(order) {
  const all = readAll();
  if (all[order.ref]) return false;
  all[order.ref] = { ...order, storedAt: new Date().toISOString(), emailed: false };
  writeAll(all);
  return true;
}

function markEmailed(ref) {
  const all = readAll();
  if (!all[ref]) return;
  all[ref].emailed = true;
  all[ref].emailedAt = new Date().toISOString();
  writeAll(all);
}

function get(ref) {
  return readAll()[ref] || null;
}

module.exports = { save, get, markEmailed, FILE };
