// node --test 'web/tests/*.test.mjs'
// Amounts are whole minor units and never pass through a float.
import { test } from 'node:test';
import assert from 'node:assert/strict';
await import('../money.js');
const M = globalThis.WWMoney;

test('a typed amount becomes minor units', () => {
  assert.deepEqual(M.parseAmount('1,234.5', 'USD'), { ok: true, minor: 123450 });
  assert.deepEqual(M.parseAmount('1250', 'JPY'), { ok: true, minor: 1250 });
  assert.deepEqual(M.parseAmount('1.250', 'KWD'), { ok: true, minor: 1250 });
  assert.deepEqual(M.parseAmount('0.1', 'USD'), { ok: true, minor: 10 });
});

test('more decimals than the currency has is refused, not rounded', () => {
  assert.equal(M.parseAmount('1.005', 'USD').ok, false);
  assert.match(M.parseAmount('1.5', 'JPY').reason, /no decimals/);
  assert.equal(M.parseAmount('-5', 'USD').ok, false);
  assert.equal(M.parseAmount('', 'USD').reason, 'empty');
  assert.equal(M.parseAmount('abc', 'USD').ok, false);
});

test('figures are written as the app writes them', () => {
  assert.equal(M.format(123450, 'USD'), 'USD 1,234.50');
  assert.equal(M.format(-5, 'USD'), '−USD 0.05');
  assert.equal(M.formatSigned(100, 'AED'), '+AED 1.00');
  assert.equal(M.format(1250, 'JPY'), 'JPY 1,250');
  assert.equal(M.editable(-125050, 'GBP'), '1,250.50');
});

test('days are calendar days', () => {
  assert.equal(M.isDay('2026-02-29'), false);
  assert.equal(M.isDay('2028-02-29'), true);
  assert.equal(M.dayLabel('2026-09-03'), '3 Sep 2026');
  assert.equal(M.monthLabel('2026-09'), 'September 2026');
});

test('categories match the app', () => {
  assert.equal(M.categoryName('P_RENT'), 'Rent');
  assert.equal(M.categories.in.length, 10);
  assert.equal(M.categories.out.length, 16);
});
