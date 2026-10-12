// node --test 'statements/tests/*.test.mjs'
// Every statement here is made up: invented names, numbers and amounts laid out the way each
// bank lays out its page. No real statement belongs in this repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rowsFromItems, parseAmount, parseDate, readStatement, labelLines, monthly, check,
} from '../readers.js';

// A page from rows of [x, text] cells, top down, 20 points apart. Each cell becomes one item,
// wide enough for its text, so cells stay apart unless they are written as one.
const page = (rows, { top = 760, step = 20, size = 8 } = {}) =>
  rowsFromItems(rows.flatMap((cells, i) =>
    cells.map(([x, s]) => ({ x, y: top - i * step, w: s.length * size * 0.5, h: size, s }))));

test('rows: letters drawn one by one join into words, Arabic-only cells drop', () => {
  const letters = [...'Page 2'].map((ch, i) => ({ x: 100 + i * 4, y: 700, w: ch === ' ' ? 0 : 4, h: 8, s: ch }));
  const rows = rowsFromItems([...letters, { x: 300, y: 700.6, w: 30, h: 8, s: 'كشف الحساب' }, { x: 400, y: 700, w: 20, h: 8, s: '12.00' }]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].cells.map((c) => c.s), ['Page 2', '12.00']);
});

test('amounts: separators, brackets, minus, CR, whole numbers, currency after', () => {
  assert.equal(parseAmount('2,468.10'), 246810);
  assert.equal(parseAmount('(318.40)'), -31840);
  assert.equal(parseAmount('-318.40'), -31840);
  assert.equal(parseAmount('102.00CR'), -10200);
  assert.equal(parseAmount('350.8'), 35080);
  assert.equal(parseAmount('100,000 AED'), 10000000);
  assert.equal(parseAmount('7,760', 0), 7760);
  assert.equal(parseAmount('1.234', 3), 1234);
  assert.equal(parseAmount('Total'), null);
});

test('dates: day first, month names, no year, the turn of the year', () => {
  assert.equal(parseDate('05/09/2026'), '2026-09-05');
  assert.equal(parseDate('31st Aug 2026'), '2026-08-31');
  assert.equal(parseDate('September 20, 2026'), '2026-09-20');
  assert.equal(parseDate('22 AUG', { year: 2026, before: '2026-09-20' }), '2026-08-22');
  assert.equal(parseDate('28 DEC', { year: 2027, before: '2027-01-20' }), '2026-12-28');
});

// ---------------------------------------------------------------------------------------------

function wio({ tamper = false } = {}) {
  const footer = [[23, 'to raise a complaint, contact Wio Bank customer service at .']];
  const head = (type, name, number, currency, rate, opened, opening, closing, closes) => [
    [[299, 'ACCOUNT HOLDER NAME'], [423, 'CURRENCY'], [538, 'INTEREST RATE']],
    [[23, 'ACCOUNT STATEMENT'], [299, 'Alex Quinn Example'], [427, currency], [559, rate]],
    [[23, 'FROM 01/03/2026 TO 31/03/2026']],
    [[298, 'ACCOUNT TYPE']], [[298, type]],
    [[298, 'ACCOUNT NAME']], [[298, name]],
    [[298, 'ACCOUNT NUMBER']], [[298, number]],
    [[298, 'ACCOUNT OPENED']], [[298, opened]],
    ...(closes ? [[[298, 'ACCOUNT CLOSURE']], [[298, closes]]] : []),
    [[422, 'OPENING BALANCE'], [532, 'CLOSING BALANCE']],
    [[458, opening], [568, closing]],
    [[23, 'Date'], [78, 'Ref. Number'], [160, 'Description'], [435, 'Amount']],
  ];
  return [
    page([[[23, 'ACCOUNT STATEMENT']], [[23, 'FROM 01/03/2026 TO 31/03/2026']], [[23, 'Alex Quinn Example']], footer]),
    page([
      ...head('CURRENT ACCOUNT', 'Alex Quinn Example', '1000000001', 'AED', '0%', '01/01/2025', '1,000', '1,500'),
      [[23, '02/03/2026'], [78, 'P100'], [160, 'SALARY From MADE UP TRADING LLC'], [435, '2,000'], [490, '3,000']],
      [[23, '03/03/2026'], [78, 'P101'], [160, 'Alex Quinn Example to Fixed Saving Space'], [435, tamper ? '-1,400' : '-1,500'], [490, '1,500']],
      footer,
    ]),
    page([
      ...head('FIXED DEPOSIT', 'Fixed Saving Space', '2000000002', 'AED', '6%', '03/03/2026', '0', '1,505', '03/04/2026'),
      [[23, '03/03/2026'], [78, 'P102'], [160, 'Alex Quinn Example to Fixed Saving Space'], [435, '1,500'], [490, '1,500']],
      [[23, '31/03/2026'], [78, 'P103'], [160, 'Interest credit'], [435, '5'], [490, '1,505']],
      footer,
    ]),
  ];
}

test('UAE-Wio: each account block, its lines and its check', () => {
  const s = readStatement(wio());
  assert.equal(s.reader, 'UAE-Wio');
  assert.deepEqual(s.period, { from: '2026-03-01', to: '2026-03-31' });
  assert.equal(s.holder, 'Alex Quinn Example');
  assert.equal(s.accounts.length, 2);
  const [current, deposit] = s.accounts;
  assert.equal(current.name, 'Wio AED');
  assert.equal(current.closing, 150000);
  assert.equal(current.lines.length, 2);
  assert.ok(current.check.ok);
  assert.equal(deposit.type, 'deposit');
  assert.equal(deposit.ratePct, '6');
  assert.equal(deposit.closes, '2026-04-03');
  assert.equal(deposit.closing, 150500);
  assert.ok(deposit.check.ok);
  labelLines([s]);
  assert.deepEqual(current.lines.map((l) => l.label), ['in', 'own']);
  assert.deepEqual(deposit.lines.map((l) => l.label), ['own', 'interest']);
});

test('a changed amount is caught, at the line and at the total', () => {
  const s = readStatement(wio({ tamper: true }));
  const c = s.accounts[0].check;
  assert.equal(c.ok, false);
  assert.ok(c.messages.some((m) => m.kind === 'total'));
  assert.ok(c.messages.some((m) => m.kind === 'line' && m.index === 1));
});

// ---------------------------------------------------------------------------------------------

test('UAE-Emirates-Islamic: card lines, money back, the year from the period', () => {
  const s = readStatement([page([
    [[377, 'Statement of Card Account']],
    [[42, 'ALEX'], [217, 'Card Account Number.: 5000 XXXX XXXX 1234']],
    [[42, 'QUINN EXAMPLE']],
    [[42, '9 MADE UP ROAD']],
    [[217, 'From: 31st Dec 2025']],
    [[217, 'To: 30th Jan 2026']],
    [[152, 'OPENING BALANCE'], [525, '10.00']],
    [[47, '29 DEC'], [103, '28 DEC'], [152, 'BOOKSHOP'], [262, 'DUBAI'], [330, 'ARE'], [516, '100.00']],
    [[47, '05 JAN'], [103, '04 JAN'], [152, 'BOOKSHOP'], [262, 'DUBAI'], [330, 'ARE'], [516, '40.00CR']],
    [[56, 'Card Limit'], [409, 'Profit/Other Charges (AED) Current Balance (AED)']],
    [[50, '5,000.00'], [437, '0.00'], [507, '70.00']],
    [[34, 'Emirates Islamic Bank (P.J.S.C.) is licensed by the Central Bank of the UAE']],
  ])]);
  assert.equal(s.reader, 'UAE-Emirates-Islamic');
  assert.equal(s.holder, 'ALEX QUINN EXAMPLE');
  const card = s.accounts[0];
  assert.equal(card.owed, true);
  assert.equal(card.name, 'Emirates Islamic card ·· 1234');
  assert.deepEqual(card.lines.map((l) => [l.date, l.amount]), [['2025-12-29', -10000], ['2026-01-05', 4000]]);
  assert.equal(card.closing, 7000);
  assert.ok(card.check.ok);
});

// ---------------------------------------------------------------------------------------------

function citi() {
  return [
    page([
      [[488, 'Citibank Singapore Ltd']],
      [[309, 'YOUR BILL SUMMARY']],
      [[54, '111111 0004000111122223333'], [309, 'Statement Date'], [447, 'March 20, 2026']],
      [[54, 'ALEX QUINN EXAMPLE'], [584, '7']],
      [[54, '9 MADE UP ROAD']],
    ]),
    page([
      [[51, 'CITI REWARDS WORLD MASTER 4000 1111 4444 5555'], [426, 'Payment Due Date: April 15, 2026']],
      [[51, 'DATE'], [106, 'DESCRIPTION'], [503, 'AMOUNT (SGD)']],
      [[106, 'BALANCE PREVIOUS STATEMENT'], [536, '-50.00']],
      [[106, 'SUB-TOTAL:'], [533, '(50.00)']],
      [[46, 'CITI REWARDS WORLD MASTER 4000 1111 4444 5555 - ALEX QUINN EXAMPLE']],
      [[46, '25 FEB'], [106, 'CAFE'], [202, 'TBILISI'], [242, 'GE'], [547, '20.00']],
      [[106, 'FOREIGN AMOUNT GEORGIAN LARI 40.00']],
      [[106, 'XXXX-XXXX-XXXX-9999']],
      [[46, '02 MAR'], [106, 'REFUND SHOP'], [542, '(5.00)']],
      [[46, '03 MAR'], [106, 'GROCER SINGAPORE SG'], [542, '135.00']],
      [[106, 'SUB-TOTAL:'], [530, '150.00']],
      [[106, 'GRAND TOTAL'], [530, '100.00']],
    ]),
  ];
}

test('SG-Citibank: foreign amounts join their line, brackets are money back, a card in credit', () => {
  const s = readStatement(citi());
  assert.equal(s.reader, 'SG-Citibank');
  assert.equal(s.period.to, '2026-03-20');
  assert.equal(s.holder, 'ALEX QUINN EXAMPLE');
  const card = s.accounts[0];
  assert.equal(card.name, 'Citi Rewards World Master ·· 5555');
  assert.equal(card.opening, -5000);
  assert.equal(card.closing, 10000);
  assert.deepEqual(card.lines.map((l) => l.amount), [-2000, 500, -13500]);
  assert.deepEqual(card.lines[0].foreign, { currency: 'GEL', amount: -4000 });
  assert.equal(card.lines[0].date, '2026-02-25');
  assert.ok(card.check.ok);
  assert.ok(card.numbers.includes('4000111122223333'));
});

// ---------------------------------------------------------------------------------------------

function uob() {
  return [
    page([
      [[351, 'Contact Us']],
      [[76, 'ALEX QUINN EXAMPLE @ALEX']],
      [[76, '9 MADE UP ROAD']],
      [[47, 'Statement of Account']],
      [[47, 'Period: 01 Mar 2026 to 31 Mar 2026']],
      [[53, 'Savings']],
      [[53, 'TX ACCOUNT'], [197, 'SGD'], [283, '0.00'], [366, '0.00'], [448, '-'], [521, '70.00']],
      [[53, '123-456-789-0']],
      [[37, 'United Overseas Bank Limited • Made up address']],
    ]),
    page([
      [[52, 'TX ACCOUNT'], [114, '123-456-789-0']],
      [[52, 'Date'], [120, 'Description'], [344, 'Withdrawals'], [435, 'Deposits'], [517, 'Balance']],
      [[52, '01 Mar'], [120, 'BALANCE B/F'], [526, '10.00']],
      [[52, '05 Mar'], [120, 'Inward Credit-FAST'], [442, '500.00'], [521, '510.00']],
      [[120, 'OTHR Other']],
      [[120, 'Alex Example']],
      [[52, '06 Mar'], [120, 'Bill Payment'], [362, '440.00'], [521, '70.00']],
      [[120, 'mBK-Citi CC']],
      [[120, '4000111122223333']],
      [[120, 'Total'], [359, '440.00'], [431, '500.00'], [518, '70.00']],
      [[47, '----- End of Transaction Details -----']],
    ]),
  ];
}

test('SG-UOB: descriptions run on, the column and the running balance give the sign', () => {
  const s = readStatement(uob());
  assert.equal(s.reader, 'SG-UOB');
  assert.equal(s.holder, 'ALEX QUINN EXAMPLE');
  const a = s.accounts[0];
  assert.equal(a.name, 'UOB TX Account ·· 7890');
  assert.equal(a.opening, 1000);
  assert.equal(a.closing, 7000);
  assert.deepEqual(a.lines.map((l) => l.amount), [50000, -44000]);
  assert.equal(a.lines[0].description, 'Inward Credit-FAST · OTHR Other · Alex Example');
  assert.ok(a.check.ok);
});

test('between your accounts: by name, and by an account number another statement carries', () => {
  const [bank, card] = labelLines([readStatement(uob()), readStatement(citi())]);
  assert.deepEqual(bank.accounts[0].lines.map((l) => l.label), ['own', 'own']);
  assert.deepEqual(card.accounts[0].lines.map((l) => l.label), ['out', 'in', 'out']);
  const alone = labelLines([readStatement(uob())])[0];
  assert.deepEqual(alone.accounts[0].lines.map((l) => l.label), ['own', 'out']);
  const months = monthly([bank, card]);
  const march = months.find((m) => m.month === '2026-03');
  assert.equal(march.in, 500);
  assert.equal(march.out, 13500);
});

// ---------------------------------------------------------------------------------------------

test('any other bank: a plain table, read by its columns and checked by its balance; margin print ignored', () => {
  const s = readStatement([page([
    [[40, 'Made Up Bank plc']],
    [[40, 'Statement 1 April 2026 to 30 April 2026'], [400, 'Currency GBP']],
    [[40, 'Date'], [110, 'Details'], [330, 'Paid out'], [400, 'Paid in'], [470, 'Balance']],
    [[40, '01/04/2026'], [110, 'Opening balance'], [480, '200.00']],
    [[40, '03/04/2026'], [110, 'Rent'], [335, '150.00'], [480, '50.00'], [585, '7']],
    [[110, 'Flat 2']],
    [[40, '28/04/2026'], [110, 'Pay'], [405, '1,000.00'], [474, '1,050.00']],
  ])]);
  assert.equal(s.reader, 'General');
  assert.equal(s.general, true);
  const a = s.accounts[0];
  assert.equal(a.currency, 'GBP');
  assert.equal(a.opening, 20000);
  assert.equal(a.closing, 105000);
  assert.deepEqual(a.lines.map((l) => l.amount), [-15000, 100000]);
  assert.equal(a.lines[0].description, 'Rent · Flat 2');
  assert.ok(a.check.ok);
});

test('a statement that is only a picture says so', () => {
  const s = readStatement([[], []]);
  assert.equal(s.picture, true);
  assert.equal(s.accounts.length, 0);
});

test('check: a card is owed, so money out raises what is owed', () => {
  const c = check({ owed: true, opening: 0, closing: 300, lines: [{ amount: -500 }, { amount: 200 }] });
  assert.ok(c.ok);
});
