import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReceiptText } from './receipt-parser.mjs';

const modes = ['Cash', 'UPI', 'Debit Card', 'Credit Card', 'Net Banking'];

test('prefers a labeled grand total over subtotal and taxes', () => {
  const result = parseReceiptText([
    'Fresh Market',
    'Subtotal 1,250.00',
    'GST 62.50',
    'Grand Total',
    '₹ 1,312.50',
    'Date: 31/10/2026',
    'Paid via UPI'
  ].join('\n'), modes);

  assert.equal(result.amount, 1312.5);
  assert.equal(result.date, '2026-10-31');
  assert.equal(result.description, 'Fresh Market');
  assert.equal(result.paymentMode, 'UPI');
});

test('parses Indian comma grouping and named English dates', () => {
  const result = parseReceiptText('Shop: Corner Store\nTotal payable Rs. 1,23,456\nOct 31, 2026', modes);
  assert.equal(result.amount, 123456);
  assert.equal(result.date, '2026-10-31');
  assert.equal(result.description, 'Corner Store');
});

test('recognizes Hindi digits, total labels and dates', () => {
  const result = parseReceiptText('श्री दुकान\nकुल राशि १,२३४.५०\nदिनांक ०१/११/२०२६', modes);
  assert.equal(result.amount, 1234.5);
  assert.equal(result.date, '2026-11-01');
  assert.equal(result.description, 'श्री दुकान');
});

test('does not guess between multiple card payment modes', () => {
  const result = parseReceiptText('Total: 500.00\nPaid by card', modes);
  assert.equal(result.amount, 500);
  assert.equal(result.paymentMode, null);
});

test('matches payment modes only when a configured mode is identifiable', () => {
  assert.equal(parseReceiptText('Total: 50\nPaid in नकद', modes).paymentMode, 'Cash');
  assert.equal(parseReceiptText('Total: 50\nUPI payment via PhonePe', modes).paymentMode, 'UPI');
  assert.equal(parseReceiptText('Total: 50\nPaid by credit card', modes).paymentMode, 'Credit Card');
});

test('ignores invalid dates and returns empty values when no fields are clear', () => {
  const result = parseReceiptText('Date: 31/02/2026\nGST 18.00', modes);
  assert.equal(result.amount, null);
  assert.equal(result.date, null);
  assert.equal(result.description, '');
  assert.equal(result.paymentMode, null);
});
