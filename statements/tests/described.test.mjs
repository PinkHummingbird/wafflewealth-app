// node --test 'statements/tests/*.test.mjs'
// Banks described, not coded: one table engine told by profiles.js how each bank prints. Every
// statement here is made up, laid out the way each bank lays out its page, and is the same as
// the app's DescribedBankTests.swift, so the phone and the browser can't read a bank differently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsFromItems, readStatement, check, PROFILES, BANK_READERS } from '../readers.js';

const page = (rows, { top = 760, step = 20, size = 8 } = {}) =>
  rowsFromItems(rows.flatMap((cells, i) =>
    cells.map(([x, s]) => ({ x, y: top - i * step, w: s.length * size * 0.5, h: size, s }))));

export const chase = () => [page([
  [[40, 'CHASE']],
  [[40, 'JPMorgan Chase Bank, N.A.'], [330, 'December 20, 2025 through March 26, 2026']],
  [[330, 'Account Number:'], [420, '000000123456789']],
  [[40, 'CHECKING SUMMARY'], [200, 'Chase Total Checking']],
  [[330, 'AMOUNT']],
  [[40, 'Beginning Balance'], [330, '$1,000.00']],
  [[40, 'Deposits and Additions'], [330, '2,500.00']],
  [[40, 'ATM & Debit Card Withdrawals'], [330, '-300.00']],
  [[40, 'Electronic Withdrawals'], [330, '-1,200.00']],
  [[40, 'Fees'], [330, '-12.00']],
  [[40, 'Ending Balance'], [330, '$1,988.00']],
  [[40, 'TRANSACTION DETAIL']],
  [[40, 'DATE'], [90, 'DESCRIPTION'], [380, 'AMOUNT'], [470, 'BALANCE']],
  [[90, 'Beginning Balance'], [470, '$1,000.00']],
  [[40, '12/28'], [90, 'ATM Withdrawal 12/28 1 Example St'], [380, '-300.00'], [470, '700.00']],
  [[90, 'Springfield Card 1234']],
  [[40, '01/04'], [90, 'Payroll Example Co PPD'], [380, '2,500.00'], [470, '3,200.00']],
  [[40, '02/15'], [90, 'Online Payment To Example Utility'], [380, '-1,200.00'], [470, '2,000.00']],
  [[40, '03/26'], [90, 'Monthly Service Fee'], [380, '-12.00'], [470, '1,988.00']],
  [[90, 'Ending Balance'], [470, '$1,988.00']],
  [[400, 'Page 1 of 1']],
])];

test('US-Chase: read by its description, month-first dates across a year end', () => {
  const s = readStatement(chase());
  assert.equal(s.reader, 'US-Chase');
  assert.equal(s.institution, 'Chase');
  assert.equal(s.general, false);
  assert.deepEqual(s.period, { from: '2025-12-20', to: '2026-03-26' });
  const a = s.accounts[0];
  assert.equal(a.name, 'Chase Total Checking ·· 6789');
  assert.equal(a.ref, 'US-Chase:000000123456789');
  assert.equal(a.currency, 'USD');
  assert.equal(a.opening, 100000);
  assert.equal(a.closing, 198800);
  assert.deepEqual(a.lines.map((l) => l.amount), [-30000, 250000, -120000, -1200]);
  assert.deepEqual(a.lines.map((l) => l.date), ['2025-12-28', '2026-01-04', '2026-02-15', '2026-03-26']);
  assert.equal(a.lines[0].description, 'ATM Withdrawal 12/28 1 Example St · Springfield Card 1234');
  assert.ok(a.check.ok);
});

const HSBC_HEADER = [[40, 'Date'], [100, 'Payment type and details'], [330, '£ Paid out'], [410, '£ Paid in'], [490, '£ Balance']];
export const hsbcUK = () => [
  page([
    [[40, 'Your Statement'], [400, 'HSBC UK']],
    [[40, 'Account Summary']],
    [[40, 'Opening Balance'], [250, '1,000.00']],
    [[40, 'Payments In'], [250, '2,600.00']],
    [[40, 'Payments Out'], [250, '1,453.60']],
    [[40, 'Closing Balance'], [250, '2,146.40']],
    [[40, '13 June to 12 July 2026']],
    [[40, 'Sortcode'], [110, '12-34-56'], [200, 'Account Number'], [300, '12345678'], [400, 'Sheet Number'], [480, '101']],
    [[40, 'Your Bank Account details']],
    HSBC_HEADER,
    [[40, '12 Jun 26'], [100, 'BALANCE BROUGHT FORWARD'], [490, '1,000.00']],
    [[40, '13 Jun 26'], [100, 'ATM'], [130, 'CASH POSTOFF JUN13']],
    [[130, '164 EXAMPLE STREET@15:49'], [335, '300.00']],
    [[100, 'VIS'], [130, 'EXAMPLE GROCER'], [340, '53.60'], [490, '646.40']],
    [[40, '20 Jun 26'], [100, 'CR'], [130, 'EXAMPLE EMPLOYER LTD'], [415, '2,600.00'], [490, '3,246.40']],
    [[100, 'BALANCE CARRIED FORWARD'], [490, '3,246.40']],
  ]),
  page([
    HSBC_HEADER,
    [[40, '20 Jun 26'], [100, 'BALANCE BROUGHT FORWARD'], [490, '3,246.40']],
    [[40, '01 Jul 26'], [100, 'DD'], [130, 'EXAMPLE ENERGY CO'], [340, '100.00']],
    [[100, 'BP'], [130, 'S EXAMPLE'], [335, '1,000.00'], [490, '2,146.40']],
    [[100, 'BALANCE CARRIED FORWARD'], [490, '2,146.40']],
  ]),
];

test('UK-HSBC: a date a day, amounts on the row below, a balance on a day\'s last line', () => {
  const s = readStatement(hsbcUK());
  assert.equal(s.reader, 'UK-HSBC');
  assert.deepEqual(s.period, { from: '2026-06-13', to: '2026-07-12' });
  const a = s.accounts[0];
  assert.equal(a.name, 'HSBC UK ·· 5678');
  assert.equal(a.ref, 'UK-HSBC:12345678');
  assert.equal(a.currency, 'GBP');
  assert.equal(a.opening, 100000);
  assert.equal(a.closing, 214640, "the summary's closing balance, not page 1's carried forward");
  assert.deepEqual(a.lines.map((l) => l.amount), [-30000, -5360, 260000, -10000, -100000]);
  assert.deepEqual(a.lines.map((l) => l.date), ['2026-06-13', '2026-06-13', '2026-06-20', '2026-07-01', '2026-07-01']);
  assert.equal(a.lines[0].description, 'ATM CASH POSTOFF JUN13 · 164 EXAMPLE STREET@15:49');
  assert.deepEqual(a.lines.map((l) => l.running), [null, 64640, 324640, null, 214640]);
  assert.ok(a.check.ok);
});

test('plain table: US dates read month first without being told', () => {
  const s = readStatement([page([
    [[40, 'Example Credit Union']],
    [[40, 'Statement period 11/01/2026 - 11/30/2026'], [400, 'USD']],
    [[40, 'Date'], [110, 'Description'], [380, 'Amount'], [470, 'Balance']],
    [[40, '11/01/2026'], [110, 'Beginning balance'], [480, '500.00']],
    [[40, '11/03/2026'], [110, 'Coffee'], [385, '-4.50'], [480, '495.50']],
    [[40, '11/14/2026'], [110, 'Pay'], [380, '1,000.00'], [474, '1,495.50']],
  ])]);
  assert.equal(s.general, true);
  const a = s.accounts[0];
  assert.deepEqual(a.lines.map((l) => l.date), ['2026-11-03', '2026-11-14']);
  assert.equal(a.opening, 50000);
  assert.ok(a.check.ok);
});

test('plain table: a date a day, an amount on the row below, and a total row that is no line', () => {
  const s = readStatement([page([
    [[40, 'Northwind Example Bank']],
    [[40, 'Date'], [110, 'Details'], [330, 'Paid out'], [400, 'Paid in'], [470, 'Balance']],
    [[40, '01 Mar 26'], [110, 'Balance brought forward'], [478, '200.00']],
    [[40, '02 Mar 26'], [110, 'Card payment EXAMPLE CAFE']],
    [[110, 'LONDON'], [340, '5.00']],
    [[110, 'Card payment EXAMPLE BOOKS'], [335, '15.00'], [480, '180.00']],
    [[40, '05 Mar 26'], [110, 'Pay'], [405, '1,000.00'], [474, '1,180.00']],
    [[40, 'Total'], [335, '20.00'], [405, '1,000.00']],
  ])]);
  const a = s.accounts[0];
  assert.deepEqual(a.lines.map((l) => l.amount), [-500, -1500, 100000]);
  assert.deepEqual(a.lines.map((l) => l.date), ['2026-03-02', '2026-03-02', '2026-03-05']);
  assert.equal(a.lines[0].description, 'Card payment EXAMPLE CAFE · LONDON');
  assert.ok(a.check.ok);
});

test('every description loads, and its patterns compile', () => {
  assert.deepEqual(PROFILES.map((p) => p.id), ['UK-HSBC', 'US-Chase']);
  for (const p of PROFILES) {
    for (const re of [...p.recognise, p.period, p.account, p.product, ...(p.opening ?? []), ...(p.closing ?? []), ...(p.skip ?? []), ...(p.end ?? [])].filter(Boolean)) {
      assert.doesNotThrow(() => new RegExp(re, 'i'), `${p.id}: ${re}`);
    }
  }
  assert.ok(BANK_READERS.includes('US-Chase'));
});

test('check: a line with no balance of its own is still checked', () => {
  const r = check({
    owed: false, opening: 1000, closing: 700,
    lines: [{ amount: -100, running: null }, { amount: -200, running: 750 }],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.messages.find((m) => m.kind === 'line'), { kind: 'line', index: 1, expected: 700, got: 750 });
});
