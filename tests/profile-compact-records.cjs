const assert = require('node:assert/strict');
const profile = require('../Js/dart-profile-records.js');

assert.equal(profile.orderPieceCount({ items: ['I-1', 'I-2'] }), 2, 'order items should count physical pieces');
assert.equal(profile.orderPieceCount({ priceSnapshot: [{ quantity: 2 }, { quantity: 1 }] }), 3, 'order snapshot quantities should be a fallback');
assert.equal(profile.returnPieceCount({ itemCode: 'I-1' }), 1, 'single-item return should show one piece');
assert.equal(profile.returnPieceCount({ returnLines: [{ quantity: 2 }, { quantity: 1 }] }), 3, 'multi-line return should sum quantities');

const order = profile.orderSummary({ orderId: 'ORD-10', status: 'Delivered', date: '03/10/2026', items: ['A', 'B'] });
assert.deepEqual(order, { id: 'ORD-10', status: 'Delivered', date: '03/10/2026', pieces: 2 });
assert.equal('image' in order, false, 'order summary must not expose an image');
assert.equal('price' in order, false, 'order summary must not expose price');

const returned = profile.returnSummary({ returnId: 'RET-4', orderId: 'ORD-10', status: 'Pending Request', date: '02/10/2026', itemCode: 'A' });
assert.equal(returned.id, 'RET-4', 'return row must use return number, not order number');
assert.equal(returned.pieces, 1);
assert.equal('image' in returned, false, 'return summary must not expose an image');

const waiting = profile.waitingSummary({ id: 'W-1', modelName: 'Wide Leg', size: 'M', color: 'Black', requestedAt: '2026-10-03T10:00:00+03:00', status: 'waiting' });
assert.equal(waiting.design, 'Wide Leg');
assert.equal(waiting.size, 'M');
assert.equal(waiting.color, 'Black');
assert.equal(waiting.status, 'waiting');

assert.equal(profile.statusTone('Delivered'), 'success');
assert.equal(profile.statusTone('Cancelled'), 'danger');
assert.equal(profile.statusTone('Reserved for you'), 'active');
assert.equal(profile.statusTone('Notified'), 'warning');

console.log('profile compact records tests: ok');
