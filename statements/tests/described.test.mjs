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
  assert.deepEqual(PROFILES.map((p) => p.id), ['ET-CBE', 'IN-KVB', 'UK-HSBC', 'US-BMO-Card', 'US-BofA', 'US-Chase', 'US-Chase-Card', 'US-TD', 'US-WellsFargo']);
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

// --- Seven more banks, each the same made-up statement as the app's DescribedBankTests.swift.
export const td = () => {
  const head = [[40, 'POSTING DATE'], [120, 'DESCRIPTION'], [470, 'AMOUNT']]
  return [page([
      [[40, 'TD Bank, N.A.']],
      [[40, 'STATEMENT OF ACCOUNT'], [350, 'Page: 1 of 1']],
      [[350, 'Statement Period: Dec 08 2025-Jan 07 2026']],
      [[350, 'Primary Account #: 123-4567890']],
      [[40, 'ACCOUNT SUMMARY']],
      [[40, 'Beginning Balance'], [250, '1,000.00']],
      [[40, 'Electronic Deposits'], [250, '500.00']],
      [[40, 'Electronic Payments'], [250, '84.16']],
      [[40, 'Other Withdrawals'], [250, '40.00']],
      [[40, 'Ending Balance'], [250, '1,375.84']],
      [[40, 'DAILY ACCOUNT ACTIVITY']],
      [[40, 'Electronic Deposits']],
      head,
      [[40, '12/15'], [120, 'CCD DEPOSIT, EXAMPLE PAYROLL'], [470, '500.00']],
      [[40, 'Subtotal:'], [470, '500.00']],
      [[40, 'Electronic Payments']],
      head,
      [[40, '12/20'], [120, 'DEBIT POS AP, *****1234, AUT 112125 DDA PURCHASE AP'], [475, '34.16']],
      [[120, 'EXAMPLE STORE 0860 SPRINGFIELD * FL']],
      [[40, '01/03'], [120, 'ELECTRONIC PMT-WEB, EXAMPLE UTILITY'], [475, '50.00']],
      [[40, 'Subtotal:'], [475, '84.16']],
      [[40, 'Other Withdrawals']],
      head,
      [[40, '01/05'], [120, 'ATM WITHDRAWAL, EXAMPLE ST'], [475, '40.00']],
      [[40, 'Subtotal:'], [475, '40.00']],
      [[40, 'DAILY BALANCE SUMMARY']],
      [[40, 'DATE'], [120, 'BALANCE'], [250, 'DATE'], [330, 'BALANCE']],
      [[40, '12/07'], [120, '1,000.00'], [250, '12/20'], [330, '1,465.84']],
      [[40, '12/15'], [120, '1,500.00'], [250, '01/05'], [330, '1,375.84']],
  ])]
};

export const cbe = () => [page([
            [[40, 'Commercial Bank of Ethiopia']],
            [[40, 'Branch: Example Branch'], [350, 'Account No. 1000012345678']],
            [[40, 'Currency :ETB'], [350, 'Account Type :Current Account with Overdraft']],
            [[40, 'Statement of Transactions For the period As on 30 APR 2026']],
            [[40, 'Date'], [90, 'Particulars'], [180, 'Reference'], [245, 'Narrative'], [330, 'Value Date'], [390, 'Debit'], [450, 'Credit'], [510, 'Balances']],
            [[40, '01 04 2026'], [90, 'Balance B/F'], [515, '-1,000.00']],
            [[40, '02 04 2026'], [90, 'Transfer to'], [180, 'FT26092ABC12'], [245, 'EXAMPLE TRADING'], [330, '02 04 2026'], [385, '-500.00'], [455, '.00'], [510, '-1,500.00']],
            [[90, 'Example Supplier']],
            [[40, '15 04 2026'], [90, 'Cash Deposit'], [180, 'TT26105XYZ34'], [245, 'DEPOSIT'], [330, '15 04 2026'], [390, '.00'], [450, '2,000.00'], [515, '500.00']],
            [[40, '30 04 2026'], [90, 'Debit Interest'], [180, 'IN26120'], [330, '30 04 2026'], [390, '-12.50'], [455, '.00'], [515, '487.50']],
            [[90, 'Balance C/F'], [385, '-512.50'], [450, '2,000.00'], [515, '487.50']],
        ])];

export const kvb = () => [page([
            [[40, 'Karur Vysya Bank']],
            [[40, 'Acc.No. : 1234567890123456'], [330, 'Customer ID : 12345678']],
            [[40, 'Acc.Type : SB - RESIDENT'], [330, 'St.Date : 15/07/2026']],
            [[40, 'St.Period : 01/07/2026 to 15/07/2026']],
            [[40, 'Account Summary']],
            [[40, 'Opening Balance'], [150, 'Total Credit Amount'], [280, 'Total Debit Amount'], [410, 'Closing Balance']],
            [[40, '1,000.00'], [150, '500.00'], [280, '300.00'], [410, '1,200.00']],
            [[40, 'Txn Date'], [95, 'Value Date'], [150, 'Brn Code'], [195, 'Particulars'], [300, 'Ref. No'], [390, 'Debit'], [445, 'Credit'], [505, 'Balance']],
            [[40, '02/07/2026'], [95, '02/07/2026'], [150, '1234'], [195, 'UPI-DR-123456789012-EXAMPLE STORE-PYTM-'], [300, '512345678901'], [395, '200.00'], [510, '800.00']],
            [[40, '05/07/2026'], [95, '05/07/2026'], [150, '1234'], [195, 'UPI-CR-123456789013-EXAMPLE EMPLOYER-'], [300, '512345678902'], [450, '500.00'], [505, '1,300.00']],
            [[40, '10/07/2026'], [95, '10/07/2026'], [150, '1234'], [195, 'UPI-DR-123456789014-EXAMPLE CAFE-PYTM-'], [300, '512345678903'], [395, '100.00'], [505, '1,200.00']],
        ])];

export const bofa = () => {
  const top = [[40, 'EXAMPLE COMPANY LLC ! Account # 1234 5678 9012 ! July 1, 2026 to July 31, 2026']]
  const head = [[40, 'Date'], [100, 'Description'], [450, 'Amount']]
  return [
      page([
          [[40, 'Bank of America']],
          top,
          [[40, 'Your checking account']],
          [[40, 'Beginning balance on July 1, 2026'], [450, '$2,000.00']],
          [[40, 'Ending balance on July 31, 2026'], [450, '$2,250.00']],
          [[40, 'Deposits and other credits']],
          head,
          [[40, '07/05/26'], [100, 'EXAMPLE CLIENT DES:PAYMENT ID:123'], [450, '1,000.00']],
          [[40, 'Total deposits and other credits'], [445, '$1,000.00']],
          [[40, 'Withdrawals and other debits']],
          head,
          [[40, 'Card account # XXXX XXXX XXXX 1234']],
          [[40, '07/12/26'], [100, 'CHECKCARD 0711 EXAMPLE SUPPLIES'], [450, '-200.00']],
          [[100, 'CKCD 5311 XXXXXXXXXXXX1234']],
          [[40, 'Subtotal for card account # XXXX XXXX XXXX 1234'], [450, '-200.00']],
          [[400, 'continued on the next page']],
      ]),
      page([
          top,
          [[40, 'Withdrawals and other debits - continued']],
          head,
          [[40, '07/20/26'], [100, 'ONLINE TRANSFER TO EXAMPLE SAVINGS'], [450, '-500.00']],
          [[40, 'Total withdrawals and other debits'], [440, '-$700.00']],
          [[40, 'Checks']],
          [[40, 'Date'], [100, 'Check #'], [450, 'Amount']],
          [[40, '07/25/26'], [100, '1001'], [450, '-35.00']],
          [[40, 'Total checks'], [445, '-$35.00']],
          [[40, 'Service fees']],
          [[40, 'Date'], [100, 'Transaction description'], [450, 'Amount']],
          [[40, '07/31/26'], [100, 'Monthly Fee Business Adv Fundamentals'], [450, '-15.00']],
          [[40, 'Total service fees'], [445, '-$15.00']],
      ]),
  ]
};

export const wellsFargo = () => [page([
            [[40, 'Wells Fargo Business Choice Checking']],
            [[40, 'March 31, 2026 ■ Page 1 of 1']],
            [[40, 'Account number: 1234567890']],
            [[40, 'Statement period activity summary']],
            [[40, 'Beginning balance on 3/1'], [300, '$1,000.00']],
            [[40, 'Deposits/Credits'], [300, '500.00']],
            [[40, 'Withdrawals/Debits'], [300, '- 300.00']],
            [[40, 'Ending balance on 3/31'], [300, '$1,200.00']],
            [[40, 'Transaction history']],
            [[40, 'Date'], [80, 'Check Number'], [150, 'Description'], [330, 'Deposits/Credits'], [410, 'Withdrawals/Debits'], [490, 'Ending daily balance']],
            [[40, '3/1'], [150, 'RTP From Example on 03/01'], [345, '500.00']],
            [[150, 'Ref#20260301ABC']],
            [[40, '3/1'], [150, 'Example Utility Bill Pay'], [425, '100.00'], [500, '1,400.00']],
            [[40, '3/15'], [80, '1001'], [150, 'Check'], [425, '200.00'], [500, '1,200.00']],
            [[40, 'Ending balance on 3/31'], [500, '1,200.00']],
            [[40, 'Totals'], [345, '$500.00'], [425, '$300.00']],
            [[40, 'Summary of checks written']],
            [[40, '1001'], [120, '3/15'], [200, '200.00']],
        ])];

export const bmoCard = () => [page([
            [[40, 'BMO']],
            [[40, 'Account Number: XXXX XXXX XXXX 4321'], [330, 'Statement Date (MM/DD/YYYY)'], [470, '10/14/2026']],
            [[40, 'Currency: U.S. DOLLAR']],
            [[40, 'Statement Summary']],
            [[40, 'Previous Balance'], [300, '$500.00']],
            [[40, 'Payments'], [300, '-$500.00']],
            [[40, 'Net Purchases'], [300, '$100.50']],
            [[40, 'New Account Balance'], [300, '$100.50']],
            [[40, 'Transaction Summary']],
            [[40, 'Trans Date'], [90, 'Posting Date'], [150, 'Description'], [330, 'Pre-Tax Amount'], [410, 'Total Tax'], [480, 'Trans Amount']],
            [[40, '09/20'], [90, '09/21'], [150, 'PAYMENT RECEIVED - THANK YOU'], [480, '-$ 500.00']],
            [[90, 'TRANS ID 0001']],
            [[40, '09/25'], [90, '09/26'], [150, 'EXAMPLE HARDWARE STORE'], [330, '$ 91.20'], [410, '$ 4.65 (e)'], [480, '$ 95.85']],
            [[90, 'TRANS ID 0002'], [330, 'AUTH # 123456']],
            [[40, '10/02'], [90, '10/03'], [150, 'EXAMPLE COFFEE'], [330, '$ 4.65'], [480, '$ 4.65']],
        ])];

export const chaseCard = () => [page([
            [[40, 'ACCOUNT SUMMARY']],
            [[40, 'Account Number: XXXX XXXX XXXX 9876']],
            [[40, 'Previous Balance'], [300, '$300.00']],
            [[40, 'Payment, Credits'], [300, '-$162.00']],
            [[40, 'Purchases'], [300, '+$250.40']],
            [[40, 'New Balance'], [300, '$388.40']],
            [[40, 'Opening/Closing Date'], [200, '12/04/25 - 01/03/26']],
            [[40, 'ACCOUNT ACTIVITY']],
            [[40, 'Date of Transaction'], [130, 'Merchant Name or Transaction Description'], [470, '$ Amount']],
            [[40, 'PAYMENTS AND OTHER CREDITS']],
            [[40, '12/15'], [130, 'Payment Thank You - Web'], [470, '-162.00']],
            [[40, 'PURCHASE']],
            [[40, '12/20'], [130, 'EXAMPLE BOOKSTORE'], [475, '45.40']],
            [[130, 'Order Number 123-1234567-1234567']],
            [[40, '01/02'], [130, 'EXAMPLE AIRLINES'], [470, '205.00']],
            [[130, 'PASSENGER: EXAMPLE TRAVELLER']],
            [[130, 'FROM: AAA TO: BBB']],
            [[40, '2026 Totals Year-to-Date']],
            [[40, 'Total fees charged in 2026'], [470, '$0.00']],
        ])];

const amounts = (a) => a.lines.map((l) => l.amount);
const dates = (a) => a.lines.map((l) => l.date);

test('US-TD: each line signed by its section, across a year end', () => {
  const s = readStatement(td());
  assert.equal(s.reader, 'US-TD');
  assert.equal(s.period.from, '2025-12-08');
  const a = s.accounts[0];
  assert.equal(a.name, 'TD Bank ·· 7890');
  assert.equal(a.ref, 'US-TD:1234567890');
  assert.deepEqual(amounts(a), [50000, -3416, -5000, -4000]);
  assert.deepEqual(dates(a), ['2025-12-15', '2025-12-20', '2026-01-03', '2026-01-05']);
  assert.equal(a.lines[1].description, 'DEBIT POS AP, *****1234, AUT 112125 DDA PURCHASE AP · EXAMPLE STORE 0860 SPRINGFIELD * FL');
  assert.equal(a.opening, 100000);
  assert.equal(a.closing, 137584);
  assert.ok(a.check.ok);
});

test('ET-CBE: spaced dates, value dates aside, and an overdraft said', () => {
  const s = readStatement(cbe());
  assert.equal(s.reader, 'ET-CBE');
  assert.equal(s.period.to, '2026-04-30');
  const a = s.accounts[0];
  assert.equal(a.name, 'CBE ·· 5678');
  assert.equal(a.currency, 'ETB');
  assert.equal(a.opening, -100000);
  assert.equal(a.closing, 48750);
  assert.deepEqual(amounts(a), [-50000, 200000, -1250]);
  assert.deepEqual(dates(a), ['2026-04-02', '2026-04-15', '2026-04-30']);
  assert.equal(a.lines[0].description, 'Transfer to FT26092ABC12 EXAMPLE TRADING · Example Supplier');
  assert.ok(a.check.ok);
  assert.equal(a.belowZero, true);
});

test('IN-KVB: debit and credit columns, day first', () => {
  const s = readStatement(kvb());
  assert.equal(s.reader, 'IN-KVB');
  assert.deepEqual(s.period, { from: '2026-07-01', to: '2026-07-15' });
  const a = s.accounts[0];
  assert.equal(a.name, 'KVB ·· 3456');
  assert.equal(a.type, 'savings');
  assert.equal(a.currency, 'INR');
  assert.deepEqual(amounts(a), [-20000, 50000, -10000]);
  assert.deepEqual(dates(a), ['2026-07-02', '2026-07-05', '2026-07-10']);
  assert.ok(a.lines[0].description.includes('UPI-DR-123456789012-EXAMPLE STORE-PYTM-'));
  assert.equal(a.opening, 100000);
  assert.equal(a.closing, 120000);
  assert.ok(a.check.ok);
});

test('US-BofA: sections across pages, a card sub-heading, checks by number', () => {
  const s = readStatement(bofa());
  assert.equal(s.reader, 'US-BofA');
  const a = s.accounts[0];
  assert.equal(a.name, 'Bank of America ·· 9012');
  assert.equal(a.ref, 'US-BofA:123456789012');
  assert.deepEqual(amounts(a), [100000, -20000, -50000, -3500, -1500]);
  assert.deepEqual(dates(a), ['2026-07-05', '2026-07-12', '2026-07-20', '2026-07-25', '2026-07-31']);
  assert.equal(a.lines[1].description, 'CHECKCARD 0711 EXAMPLE SUPPLIES · CKCD 5311 XXXXXXXXXXXX1234');
  assert.equal(a.lines[3].description, '1001');
  assert.equal(a.opening, 200000);
  assert.equal(a.closing, 225000);
  assert.ok(a.check.ok);
});

test('US-WellsFargo: a balance at the end of each day; totals and checks written are no lines', () => {
  const s = readStatement(wellsFargo());
  assert.equal(s.reader, 'US-WellsFargo');
  assert.equal(s.period.to, '2026-03-31');
  const a = s.accounts[0];
  assert.equal(a.name, 'Wells Fargo ·· 7890');
  assert.deepEqual(amounts(a), [50000, -10000, -20000]);
  assert.deepEqual(a.lines.map((l) => l.running), [null, 140000, 120000]);
  assert.equal(a.lines[0].description, 'RTP From Example on 03/01 · Ref#20260301ABC');
  assert.equal(a.opening, 100000);
  assert.equal(a.closing, 120000);
  assert.ok(a.check.ok);
});

test('US-BMO-Card: owed, the trans amount only, posting dates kept', () => {
  const s = readStatement(bmoCard());
  assert.equal(s.reader, 'US-BMO-Card');
  const a = s.accounts[0];
  assert.equal(a.name, 'BMO card ·· 4321');
  assert.equal(a.owed, true);
  assert.equal(a.type, 'card');
  assert.deepEqual(amounts(a), [50000, -9585, -465]);
  assert.deepEqual(dates(a), ['2026-09-20', '2026-09-25', '2026-10-02']);
  assert.deepEqual(a.lines.map((l) => l.madeOn), ['2026-09-21', '2026-09-26', '2026-10-03']);
  assert.equal(a.opening, 50000);
  assert.equal(a.closing, 10050);
  assert.ok(a.check.ok);
});

test('US-Chase-Card: owed, across a year end, not the checking description', () => {
  const s = readStatement(chaseCard());
  assert.equal(s.reader, 'US-Chase-Card');
  assert.deepEqual(s.period, { from: '2025-12-04', to: '2026-01-03' });
  const a = s.accounts[0];
  assert.equal(a.name, 'Chase card ·· 9876');
  assert.equal(a.owed, true);
  assert.deepEqual(amounts(a), [16200, -4540, -20500]);
  assert.deepEqual(dates(a), ['2025-12-15', '2025-12-20', '2026-01-02']);
  assert.equal(a.lines[2].description, 'EXAMPLE AIRLINES · PASSENGER: EXAMPLE TRAVELLER · FROM: AAA TO: BBB');
  assert.equal(a.opening, 30000);
  assert.equal(a.closing, 38840);
  assert.ok(a.check.ok);
});
