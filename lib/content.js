'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'content', 'product.json');

function loadContent() {
  const raw = fs.readFileSync(FILE, 'utf8');
  const c = JSON.parse(raw);
  assertShape(c);
  return c;
}

/**
 * Re-read product.json whenever it changes so the client can edit copy and
 * see it immediately. A broken edit logs the parse error and keeps serving
 * the last good version rather than taking the site down.
 */
function watchContent(onChange) {
  let timer = null;
  try {
    fs.watch(FILE, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          onChange(loadContent());
        } catch (err) {
          console.error('[content] product.json is invalid, keeping previous version:', err.message);
        }
      }, 120);
    });
  } catch {
    // Some filesystems (certain containers, network mounts) do not support
    // fs.watch. Not fatal - it just means a restart is needed after an edit.
    console.warn('[content] live reload unavailable on this filesystem');
  }
}

function assertShape(c) {
  const need = [
    ['brand.name', c?.brand?.name],
    ['product.name', c?.product?.name],
    ['product.priceMinor', c?.product?.priceMinor],
    ['product.currency', c?.product?.currency]
  ];
  for (const [key, val] of need) {
    if (val === undefined || val === null || val === '') {
      throw new Error(`product.json is missing "${key}"`);
    }
  }
  if (!Number.isInteger(c.product.priceMinor) || c.product.priceMinor < 0) {
    throw new Error('product.priceMinor must be a whole number of cents, e.g. 1290 for $12.90');
  }
}

module.exports = { loadContent, watchContent, FILE };
