'use strict';

/**
 * All money is handled in minor units (cents) as integers. Floats are never
 * used for a currency amount - 0.1 + 0.2 problems belong nowhere near a
 * checkout.
 */

function money(minor, product) {
  const symbol = product.currencySymbol || '';
  return symbol + (minor / 100).toFixed(2);
}

function totalsFor(qty, product) {
  const unit = product.priceMinor;
  const subtotal = unit * qty;

  const freeOver = product.freeShippingOverMinor;
  const shipping =
    typeof freeOver === 'number' && freeOver > 0 && subtotal >= freeOver
      ? 0
      : product.shippingMinor || 0;

  return {
    unitMinor: unit,
    subtotalMinor: subtotal,
    shippingMinor: shipping,
    totalMinor: subtotal + shipping,
    freeShipping: shipping === 0 && (product.shippingMinor || 0) > 0,
    // How much more they would need to spend to clear the free-shipping bar.
    toFreeShippingMinor:
      typeof freeOver === 'number' && freeOver > subtotal ? freeOver - subtotal : 0
  };
}

module.exports = { money, totalsFor };
