// node --test web/tests/statement-save.test.mjs
// A statement confirmed on the website becomes the records the app's StatementStore.save makes.
// Every statement here is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { balancePoints, includedByDefault, needsBalance, accountToSave, recordsForStatement, fingerprint, linkedAccount, typedIntoRead } from '../statement-save.mjs';

const line = (date, amount, description = 'Made up', extra = {}) => ({ date, madeOn: null, description, amount, running: null, ref: null, foreign: null, label: amount >= 0 ? 'in' : 'out', ...extra });

const current = () => ({
  ref: 'SG-UOB:1234567890', name: 'Made-up Bank current ·· 7890', type: 'current', owed: false, currency: 'SGD',
  ratePct: null, closes: null, closed: false, opening: 100_000, closing: 95_000,
  lines: [line('2026-08-20', -10_000), line('2026-09-03', 7_000), line('2026-09-15', -2_000)],
});

function run(statement, choices, known = {}) {
  let n = 0;
  return recordsForStatement({
    statement, choices, sha256: 'f'.repeat(64),
    known: { accountByRef: () => null, nextDisplayOrder: 4, ...known },
    uuid: () => `id-${++n}`, now: '2026-10-15T10:00:00.000Z', today: '2026-10-15',
  });
}

test('balances: each month end inside the statement, then its last day', () => {
  assert.deepEqual(balancePoints(current(), '2026-09-30'), [
    { date: '2026-08-31', value: 90_000 },
    { date: '2026-09-30', value: 95_000 },
  ]);
});

test('balances: a card is the opening owed less what was paid, and in credit owes nothing', () => {
  const card = { owed: true, opening: 5_000, closing: -300, lines: [line('2026-08-28', 1_000), line('2026-09-02', 4_300)] };
  assert.deepEqual(balancePoints(card, '2026-09-10'), [
    { date: '2026-08-31', value: 4_000 },
    { date: '2026-09-10', value: 0 },
  ]);
});

test('balances: no opening balance, only the closing one; February and a year end', () => {
  assert.deepEqual(balancePoints({ owed: false, opening: null, closing: 7, lines: [line('2026-01-05', 1)] }, '2026-03-31'),
    [{ date: '2026-03-31', value: 7 }]);
  const feb = balancePoints({ owed: false, opening: 0, closing: 3, lines: [line('2025-12-30', 1), line('2028-02-10', 2)] }, '2028-03-01');
  assert.deepEqual(feb.map((p) => p.date).slice(0, 2), ['2025-12-31', '2026-01-31']);
  assert.ok(feb.some((p) => p.date === '2028-02-29'), 'a leap February ends on the 29th');
});

test('a new account: the account, its balances, the bank link, every line, in that order', () => {
  const statement = { reader: 'SG-UOB', institution: 'Made-up Bank', fileName: 'Aug.pdf', period: { from: '2026-08-01', to: '2026-09-30' }, accounts: [current()] };
  const saved = run(statement, [{ include: true, name: '  Everyday  ' }]);
  const types = saved.records.map((r) => r.type);
  assert.deepEqual(types, ['Statement', 'Account', 'Balance', 'Balance', 'StatementAccount', 'StatementLine', 'StatementLine', 'StatementLine']);
  const [st, acct, b1, b2, link, l0] = saved.records;
  assert.deepEqual(st.f, { reader: 'SG-UOB', institution: 'Made-up Bank', file_name: 'Aug.pdf', file_sha256: 'f'.repeat(64),
    period_from: '2026-08-01', period_to: '2026-09-30', read_at: '2026-10-15T10:00:00.000Z' });
  assert.equal(acct.f.name, 'Everyday', 'trimmed as the app trims');
  assert.equal(acct.f.kind, 'ASSET');
  assert.equal(acct.f.display_order, 4);
  assert.equal(acct.f.income_basis, null);
  assert.deepEqual([b1.f.as_of_date, b1.f.value_minor, b1.f.source, b1.f.account_id], ['2026-08-31', 90_000, 'STATEMENT', acct.name]);
  assert.equal(b2.f.value_minor, 95_000);
  assert.equal(link.name, `statement-account-${acct.name}`);
  assert.deepEqual(link.f, { ref: 'SG-UOB:1234567890', created_at: '2026-10-15T10:00:00.000Z' });
  assert.deepEqual(l0.f, { statement_id: st.name, account_id: acct.name, position: 0, posted_on: '2026-08-20', made_on: null,
    description: 'Made up', amount_minor: -10_000, running_minor: null, ref: null, line_kind: 'out', foreign_currency: null, foreign_minor: null });
  assert.deepEqual([saved.created, saved.balances, saved.lines], [['Everyday'], 2, 3]);
});

test('an account found by its bank reference gets balances and lines, and no second account', () => {
  const existing = { name: 'acc-1', type: 'Account', f: { name: 'My UOB' } };
  const statement = { reader: 'SG-UOB', period: { from: '2026-08-01', to: '2026-09-30' }, accounts: [current()] };
  const saved = run(statement, [{ include: true, name: 'ignored' }], { accountByRef: (ref) => (ref === 'SG-UOB:1234567890' ? existing : null) });
  assert.ok(!saved.records.some((r) => r.type === 'Account' || r.type === 'StatementAccount'));
  assert.ok(saved.records.filter((r) => r.type !== 'Statement').every((r) => r.f.account_id === 'acc-1'));
  assert.deepEqual(saved.updated, ['My UOB']);
});

test('a deposit: its rate paid yearly, out of reach until it ends; a card is owed; left out means nothing', () => {
  const deposit = { ...current(), ref: 'UAE-Wio:9', type: 'deposit', ratePct: '4.250', closes: '2027-03-01', lines: [], opening: null, closing: 500_000 };
  const card = { ...current(), ref: 'X:1', type: 'card', owed: true, ratePct: '30', opening: null, closing: 1_000, lines: [] };
  const skipped = { ...current(), ref: 'X:2' };
  const saved = run({ reader: 'UAE-Wio', period: { from: '2026-09-01', to: '2026-09-30' }, accounts: [deposit, card, skipped] },
    [{ include: true, name: 'Deposit' }, { include: true, name: 'Card' }, { include: false, name: 'No' }]);
  const accounts = saved.records.filter((r) => r.type === 'Account');
  assert.equal(accounts.length, 2);
  assert.deepEqual([accounts[0].f.income_basis, accounts[0].f.income_rate_pct, accounts[0].f.income_frequency, accounts[0].f.available_from_month],
    ['RATE', '4.25', 'ANNUAL', '2027-03']);
  assert.deepEqual([accounts[1].f.kind, accounts[1].f.income_basis, accounts[1].f.available_from_month], ['LIABILITY', null, null]);
  assert.deepEqual(accounts.map((a) => a.f.display_order), [4, 5]);
  assert.ok(!saved.records.some((r) => r.f.account_id && !accounts.some((a) => a.name === r.f.account_id)), 'nothing for the account left out');
});

test('kept by default: a closing balance or lines, not a closed deposit, not an empty nothing (the app’s includedByDefault)', () => {
  assert.equal(includedByDefault(current()), true);
  assert.equal(includedByDefault({ ...current(), closing: null }), true, 'lines and no balance: kept, waiting for the balance');
  assert.equal(includedByDefault({ ...current(), closing: null, lines: [] }), false, 'an empty Wise currency: nothing to add');
  assert.equal(includedByDefault({ ...current(), closed: true }), false);
  assert.equal(includedByDefault({ ...current(), closing: 0, lines: [] }), false);
});

test('lines and no balance (a QIF file, many banks’ CSVs): the balance typed on the last day, the opening worked back', () => {
  const noBalance = { ...current(), opening: null, closing: null };
  assert.equal(needsBalance(current()), false);
  assert.equal(needsBalance(noBalance), true);
  assert.equal(needsBalance({ ...noBalance, lines: [] }), false);
  // The lines come to -5,000: typed 95,000 on the last day, so 100,000 before the first line.
  const filled = accountToSave(noBalance, { closing: 95_000 });
  assert.deepEqual([filled.opening, filled.closing, filled.openingWorkedOut, filled.belowZero], [100_000, 95_000, true, false]);
  assert.equal(noBalance.closing, null, 'the account read is left as it was');
  // Not typed yet: as read, and nothing is saved for it.
  assert.equal(accountToSave(noBalance).closing, null);
  const statement = { reader: 'QIF', period: { from: '2026-08-01', to: '2026-09-30' }, accounts: [noBalance] };
  assert.throws(() => run(statement, [{ include: true, name: 'Mine' }]), (e) => e.code === 'needsBalance' && /balance/.test(e.reason));
  assert.equal(run(statement, [{ include: false, name: 'Mine' }]).records.length, 1, 'left out: the statement alone');
  // Typed: the same balances the app keeps, a month end inside the statement and its last day.
  const saved = run({ ...statement, accounts: [filled] }, [{ include: true, name: 'Mine' }]);
  assert.deepEqual(saved.records.filter((r) => r.type === 'Balance').map((b) => [b.f.as_of_date, b.f.value_minor]),
    [['2026-08-31', 90_000], ['2026-09-30', 95_000]]);
});

test('a card with no balance in its file: the typed amount owed, the opening owed worked back', () => {
  // Spent 4,000 and paid 1,500: owing 7,500 at the end means 5,000 owed before the first line.
  const card = { ...current(), ref: null, type: 'card', owed: true, opening: null, closing: null,
    lines: [line('2026-09-02', -4_000), line('2026-09-20', 1_500)] };
  const filled = accountToSave(card, { closing: 7_500 });
  assert.deepEqual([filled.opening, filled.closing, filled.belowZero], [5_000, 7_500, false]);
});

test('typed below zero: an account you own was overdrawn, and Keep it below zero is asked', () => {
  const noBalance = { ...current(), opening: null, closing: null };
  const filled = accountToSave(noBalance, { closing: -1_000 });
  assert.equal(filled.belowZero, true);
  const statement = { reader: 'CSV', period: { from: '2026-08-01', to: '2026-09-30' }, accounts: [filled] };
  assert.throws(() => run(statement, [{ include: true, name: 'Mine' }]), (e) => e.code === 'belowZeroNotConfirmed');
  assert.ok(run(statement, [{ include: true, name: 'Mine', keepBelowZero: true }]).records.some((r) => r.type === 'Balance' && r.f.value_minor === -1_000));
});

test('no currency in the file (a QIF file, many banks’ CSVs): the one chosen in the review, the main one unless changed', () => {
  const noCurrency = { ...current(), currency: null };
  assert.equal(accountToSave(noCurrency, { currency: 'GBP' }).currency, 'GBP');
  assert.equal(accountToSave(current(), { currency: 'GBP' }).currency, 'SGD', 'a currency the file names stays');
  const statement = { reader: 'CSV', period: { from: '2026-08-01', to: '2026-09-30' }, accounts: [noCurrency] };
  assert.throws(() => run(statement, [{ include: true, name: 'Mine' }]), (e) => e.code === 'needsCurrency');
  const saved = run({ ...statement, accounts: [accountToSave(noCurrency, { currency: 'GBP' })] }, [{ include: true, name: 'Mine' }]);
  assert.equal(saved.records.find((r) => r.type === 'Account').f.currency_code, 'GBP');
});

test('fingerprint: the bytes, and for a CSV its name first, as the app makes it', async () => {
  const bytes = new TextEncoder().encode('a,b\n1,2\n');
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  assert.equal(await fingerprint('x.pdf', bytes, webcrypto.subtle), sha(bytes));
  assert.equal(await fingerprint('USD.csv', bytes, webcrypto.subtle), sha(Buffer.concat([Buffer.from('USD.csv'), Buffer.from(bytes)])));
});

test('below zero: clamped to nothing unless confirmed, refused unconfirmed, a card never negative', () => {
  const over = { ...current(), belowZero: true, closing: -3_000, lines: [line('2026-08-20', -10_000), line('2026-09-03', -93_000)] };
  assert.deepEqual(balancePoints(over, '2026-09-30').map((p) => p.value), [90_000, 0]);
  assert.deepEqual(balancePoints(over, '2026-09-30', true).map((p) => p.value), [90_000, -3_000]);
  const statement = { reader: 'SG-UOB', period: { from: '2026-08-01', to: '2026-09-30' }, accounts: [over] };
  assert.throws(() => run(statement, [{ include: true, name: 'Over' }]), (e) => e.code === 'belowZeroNotConfirmed');
  const kept = run(statement, [{ include: true, name: 'Over', keepBelowZero: true }]);
  assert.deepEqual(kept.records.filter((r) => r.type === 'Balance').map((r) => r.f.value_minor), [90_000, -3_000]);
  assert.equal(run(statement, [{ include: false, name: 'Over' }]).records.length, 1, 'left out, nothing but the statement');
  const card = { owed: true, opening: 5_000, closing: -300, lines: [line('2026-08-28', 1_000), line('2026-09-02', 4_300)] };
  assert.deepEqual(balancePoints(card, '2026-09-10', true).map((p) => p.value), [4_000, 0]);
});

test('the first statement goes into an account made by hand, and links it', () => {
  const mine = { name: 'acc-9', type: 'Account', f: { name: 'UOB savings' } };
  const statement = { reader: 'SG-UOB', period: { from: '2026-08-01', to: '2026-09-30' }, accounts: [current()] };
  const saved = run(statement, [{ include: true, name: 'ignored', accountId: 'acc-9' }], { choosable: () => [mine] });
  assert.ok(!saved.records.some((r) => r.type === 'Account'), 'no second account');
  const link = saved.records.find((r) => r.type === 'StatementAccount');
  assert.equal(link.name, 'statement-account-acc-9');
  assert.equal(link.f.ref, 'SG-UOB:1234567890');
  assert.ok(saved.records.filter((r) => r.type === 'Balance' || r.type === 'StatementLine').every((r) => r.f.account_id === 'acc-9'));
  assert.deepEqual(saved.updated, ['UOB savings']);
  // Without a bank reference it still goes there, but nothing is linked.
  const noRef = { ...current(), ref: null };
  const plain = run({ ...statement, accounts: [noRef] }, [{ include: true, name: 'x', accountId: 'acc-9' }], { choosable: () => [mine] });
  assert.ok(!plain.records.some((r) => r.type === 'StatementAccount' || r.type === 'Account'));
});

test('a linked bank reference wins over the account chosen', () => {
  const linked = { name: 'acc-1', type: 'Account', f: { name: 'My UOB' } };
  const statement = { reader: 'SG-UOB', period: { from: '2026-08-01', to: '2026-09-30' }, accounts: [current()] };
  const saved = run(statement, [{ include: true, name: 'x', accountId: 'acc-9' }], { accountByRef: () => linked, choosable: () => [] });
  assert.deepEqual(saved.updated, ['My UOB']);
  assert.ok(!saved.records.some((r) => r.type === 'StatementAccount'));
});

test('only an account that can be chosen, and each once', () => {
  const statement = { reader: 'SG-UOB', period: { from: '2026-08-01', to: '2026-09-30' }, accounts: [current(), { ...current(), ref: 'SG-UOB:2' }] };
  assert.throws(() => run(statement, [{ include: true, name: 'x', accountId: 'acc-9' }, { include: false }], { choosable: () => [] }),
    (e) => e.code === 'accountNotChoosable');
  const mine = { name: 'acc-9', type: 'Account', f: { name: 'UOB savings' } };
  assert.throws(() => run(statement, [{ include: true, name: 'x', accountId: 'acc-9' }, { include: true, name: 'y', accountId: 'acc-9' }], { choosable: () => [mine] }),
    (e) => e.code === 'sameAccountTwice');
});

test('no dates: an account whose lines have none and whose statement has no last day is refused, and says so', () => {
  const account = { ...current(), lines: [line(null, -10_000), line(null, 7_000)], opening: 100_000, closing: 97_000 };
  const statement = { reader: 'CSV', fileName: 'export.csv', period: { from: null, to: null }, accounts: [account] };
  assert.throws(() => run(statement, [{ include: true, name: 'Mine' }]),
    (e) => e.code === 'noDates' && e.reason === "Mine: no dates were read from this file, so it can't be added.");
  // Left out, nothing is asked of it.
  assert.equal(run(statement, [{ include: false, name: 'Mine' }]).records.length, 1);
  // A last day from the lines is enough.
  const dated = { ...statement, accounts: [{ ...account, lines: [line('2026-09-03', -3_000)] }] };
  assert.ok(run(dated, [{ include: true, name: 'Mine' }]).balances >= 1);
});

// A file that named no currency: its figures were read at `readDigits` decimals (Addendum 2: V1#2, V2#6, V3#1).
const unnamed = (readDigits, lines, extra = {}) => ({
  ref: null, name: 'Account', type: 'current', owed: false, currency: null, readDigits, opening: null, closing: null,
  lines, notes: [], ...extra,
});

test('figures read before the currency was known are put into the currency chosen, exactly', () => {
  const read = unnamed(3, [line('2026-09-02', -765_440, 'Transfer', { running: -765_440 }), line('2026-09-11', -45_200, 'Shop', { running: -810_640 })],
    { opening: 0, closing: -810_640, check: { ok: true, checked: true, sum: -810_640, expected: -810_640, messages: [{ kind: 'line', index: 1, expected: -810_640, got: -810_600 }] } });
  const usd = accountToSave(read, { currency: 'USD' });
  assert.deepEqual(usd.lines.map((l) => [l.amount, l.running]), [[-76_544, -76_544], [-4_520, -81_064]]);
  assert.deepEqual([usd.opening, usd.closing, usd.readDigits, usd.tooManyDecimals], [0, -81_064, 2, undefined]);
  assert.deepEqual([usd.check.sum, usd.check.messages[0].got], [-81_064, -81_060]);
  // Dinars have three: as read. Yen have none: cents can't be held, so nothing is divided and it says so.
  assert.deepEqual(accountToSave(read, { currency: 'KWD' }).lines.map((l) => l.amount), [-765_440, -45_200]);
  const yen = accountToSave(read, { currency: 'JPY' });
  assert.equal(yen.tooManyDecimals, true);
  assert.deepEqual(yen.lines.map((l) => l.amount), [-765_440, -45_200]);
  // Read at two (a main currency in cents), into dinars: ten times, exactly; whole yen into yen.
  assert.deepEqual(accountToSave(unnamed(2, [line('2026-09-01', 1_250)]), { currency: 'KWD' }).lines.map((l) => l.amount), [12_500]);
  assert.deepEqual(accountToSave(unnamed(2, [line('2026-09-01', 250_000), line('2026-09-02', -4_500)]), { currency: 'JPY' }).lines.map((l) => l.amount), [2_500, -45]);
  // A typed balance is in the currency chosen; the opening is worked back from the lines as they are saved.
  const typed = accountToSave(unnamed(3, [line('2026-09-01', 2_500_000), line('2026-09-02', -45_200)]), { currency: 'USD', closing: 300_000 });
  assert.deepEqual([typed.closing, typed.opening, ...typed.lines.map((l) => l.amount)], [300_000, 54_520, 250_000, -4_520]);
});

test('an account whose figures its currency can’t hold isn’t saved, and says why', () => {
  const read = accountToSave(unnamed(3, [line('2026-09-02', -45_200)], { closing: 100_000, opening: 145_200 }), { currency: 'JPY' });
  const statement = { reader: 'CSV', fileName: 'export.csv', period: { from: '2026-09-01', to: '2026-09-30' }, accounts: [read] };
  assert.throws(() => run(statement, [{ include: true, name: 'Joint' }]),
    (e) => e.code === 'tooManyDecimals' && e.reason === 'Joint: its amounts have more decimal places than JPY has. Choose the currency this account is in.');
});

test('a typed correction goes into the account at the decimals its file was read at', () => {
  assert.deepEqual(typedIntoRead(unnamed(3, []), -4_520, 'USD'), { ok: true, minor: -45_200 });
  assert.deepEqual(typedIntoRead(unnamed(2, []), 1_250, 'KWD'), { ok: true, minor: 125 });
  assert.equal(typedIntoRead(unnamed(2, []), 1_255, 'KWD').ok, false);
  assert.deepEqual(typedIntoRead({ ...current() }, -10_000, 'SGD'), { ok: true, minor: -10_000 });
});

test('a bank reference linked to another kind of account, or another currency, is not followed (V1#1)', () => {
  const checking = { name: 'acc-checking', type: 'Account', f: { name: 'Chase checking', kind: 'ASSET', currency_code: 'USD' } };
  const card = { ...current(), ref: 'CSV:Chase:2026', name: 'Chase card', type: 'card', owed: true, currency: 'USD', opening: 50_000, closing: 120_000 };
  assert.equal(linkedAccount(card, checking), null);
  assert.equal(linkedAccount({ ...card, owed: false }, checking), checking);
  assert.equal(linkedAccount({ ...card, owed: false, currency: 'EUR' }, checking), null);
  const statement = { reader: 'CSV', period: { from: '2026-08-01', to: '2026-09-30' }, accounts: [card] };
  const saved = run(statement, [{ include: true, name: 'Chase card' }], { accountByRef: (ref) => (ref === 'CSV:Chase:2026' ? checking : null) });
  assert.deepEqual([saved.updated, saved.created], [[], ['Chase card']]);
  const made = saved.records.find((r) => r.type === 'Account');
  assert.equal(made.f.kind, 'LIABILITY');
  assert.ok(saved.records.filter((r) => r.type === 'Balance').every((r) => r.f.account_id === made.name), 'nothing written into the checking account');
  assert.ok(!saved.records.some((r) => r.type === 'StatementAccount'), 'the reference stays the checking account’s');
});
