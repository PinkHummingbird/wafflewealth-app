// node --test web/tests/statement-save.test.mjs
// A statement confirmed on the website becomes the records the app's StatementStore.save makes.
// Every statement here is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { balancePoints, includedByDefault, recordsForStatement, fingerprint } from '../statement-save.mjs';

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

test('kept by default: a closing balance, not a closed deposit, not an empty nothing', () => {
  assert.equal(includedByDefault(current()), true);
  assert.equal(includedByDefault({ ...current(), closing: null }), false);
  assert.equal(includedByDefault({ ...current(), closed: true }), false);
  assert.equal(includedByDefault({ ...current(), closing: 0, lines: [] }), false);
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
