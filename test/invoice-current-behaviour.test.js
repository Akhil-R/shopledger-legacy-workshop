var assert = require('node:assert/strict');
var test = require('node:test');

var inventory = require('../lib/inventory');
var invoice = require('../lib/invoice');
var orders = require('../lib/orders');
var pricing = require('../lib/pricing');

function makeBilledOrder(coupon) {
  // Matches the line item shape stored by routes/orders.js, without file I/O.
  var items = [{
    id: 1,
    sku: 'RICE-1',
    name: 'Rice',
    hsn: '1006',
    price: 500,
    qty: 1
  }];
  var totals = pricing.computeTotals(items, coupon || '');
  var db = { nextOrderId: 1001, orders: [] };

  return orders.add(db, {
    date: '15/11/2026',
    customer: 'Walk-in',
    paymentMode: 'cash',
    status: 'completed',
    items: items,
    coupon: coupon || '',
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    total: totals.total
  });
}

test('CURRENT BEHAVIOUR: pricing applies the HSN slab and coupon discount before tax', function () {
  var totals = pricing.computeTotals([
    { id: 1, name: 'Rice', hsn: '1006', price: 500, qty: 1 }
  ], 'SAVE10');

  assert.equal(totals.subtotal, 500);
  assert.equal(totals.discount, 50);
  assert.equal(totals.tax, 22.5);
  assert.equal(totals.total, 472.5);
});

test('invoice uses the stored order GST and HSN-specific line rate', function () {
  var order = makeBilledOrder('');
  var printed = invoice.computeInvoiceFigures(order);

  assert.equal(order.items[0].hsn, '1006');
  assert.equal(order.items[0].gstRate, undefined);
  assert.equal(order.tax, 25);
  assert.equal(order.total, 525);
  assert.equal(printed.rows[0].gstPercent, 5);
  assert.equal(printed.rows[0].lineTax, order.tax);
  assert.equal(printed.tax, order.tax);
  assert.equal(printed.total, order.total);
});

test('invoice figures match the HSN GST and total recorded when the order was billed', function () {
  var order = makeBilledOrder('SAVE10');
  var printed = invoice.computeInvoiceFigures(order);

  assert.equal(printed.rows[0].gstPercent, 5);
  assert.equal(printed.rows[0].lineTax, order.tax);
  assert.equal(printed.tax, order.tax);
  assert.equal(printed.discount, order.discount);
  assert.equal(printed.total, order.total);
});

test('rendered invoice shows billed total without a reconciliation warning', function () {
  var order = makeBilledOrder('SAVE10');
  var html = invoice.render(order);

  assert.match(html, /5%/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹472\.50/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('CURRENT BEHAVIOUR: stock check rejects a quantity equal to sellable stock', function () {
  var result = inventory.check(
    [{ id: 1, name: 'Rice', stock: 5, reserved: 0 }],
    [{ id: 1, qty: 5 }]
  );

  assert.equal(result.ok, false);
  assert.equal(result.msg, 'Rice is out of stock (5 sellable available)');
});

test('CURRENT BEHAVIOUR: cancelling id-only order lines leaves stock and reservations unchanged', function () {
  var product = { id: 1, stock: 4, reserved: 2 };
  var db = {
    products: [product],
    customers: [],
    orders: [{
      id: 1001,
      status: 'completed',
      items: [{ id: 1, qty: 1 }],
      paymentMode: 'cash',
      total: 10
    }]
  };

  var result = orders.cancel(db, 1001, 'test');

  assert.equal(result.ok, true);
  assert.equal(product.stock, 4);
  assert.equal(product.reserved, 2);
  assert.equal(result.order.status, 'cancelled');
});
