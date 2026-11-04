// node --test web/tests/statement-store.test.cjs
// A statement saved from the website is all there or not there at all: lines sent ahead of a
// request that fails are taken back, and lines without their statement are never shown.
// Made-up figures only, in the example store.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../money.js');
require('../cloud.js');
const { Store, MemoryBackend } = globalThis.WWCloud;

async function storeWithAccount() {
  const backend = new MemoryBackend();
  const store = new Store(backend);
  await store.load();
  const account = store.of('Account')[0];
  return { backend, store, account };
}

/** A statement of `count` lines into `account`: the Statement, one Balance, then its lines. */
function statementRecords(account, count, id = 'st-1') {
  const records = [
    { name: id, type: 'Statement', f: { reader: 'CSV', institution: null, file_name: 'made-up.csv', file_sha256: 'a'.repeat(64),
      period_from: '2026-08-01', period_to: '2026-09-30', read_at: '2026-10-15T10:00:00.000Z' } },
    { name: `${id}-bal`, type: 'Balance', f: { account_id: account.name, value_minor: 1000, as_of_date: '2026-09-30', source: 'STATEMENT', created_at: '2026-10-15T10:00:00.000Z' } },
  ];
  for (let n = 0; n < count; n++) {
    records.push({ name: `${id}-line-${n}`, type: 'StatementLine', f: {
      statement_id: id, account_id: account.name, position: n, posted_on: '2026-09-01', made_on: null,
      description: `Made-up line ${n}`, amount_minor: -100, running_minor: null, ref: null, line_kind: 'out',
      foreign_currency: null, foreign_minor: null } });
  }
  return records;
}

const linesOf = (rows, id) => [...rows.values()].filter((r) => r.type === 'StatementLine' && r.f.statement_id === id);

test('a long statement that fails on its last request leaves no lines, in iCloud or on the page', async () => {
  const { backend, store, account } = await storeWithAccount();
  const records = statementRecords(account, 400);
  // 400 lines go as 390 and 10; the third request, everything else, fails.
  const save = backend.save.bind(backend);
  let calls = 0;
  backend.save = async (batch, options) => { calls += 1; if (calls === 3) throw { reason: 'The connection was lost.' }; return save(batch, options); };
  await assert.rejects(store.saveStatement(records, null), (e) => e.reason === 'The connection was lost.');
  assert.equal(calls, 3);
  assert.equal(linesOf(backend.rows, 'st-1').length, 0, 'the lines sent ahead were taken back');
  assert.equal(linesOf(store.rows, 'st-1').length, 0);
  assert.equal(store.statementLines().filter((l) => l.f.statement_id === 'st-1').length, 0);
  assert.equal(store.statementRead('a'.repeat(64)), false, 'so the same file can be added again');
});

test('lines whose statement never arrived are not shown, even when taking them back failed too', async () => {
  const { backend, store, account } = await storeWithAccount();
  const records = statementRecords(account, 400);
  const save = backend.save.bind(backend);
  let calls = 0;
  backend.save = async (batch, options) => { calls += 1; if (calls === 3) throw { reason: 'The connection was lost.' }; return save(batch, options); };
  backend.remove = async () => { throw { reason: 'Still offline.' }; };
  await assert.rejects(store.saveStatement(records, null));
  // Left over in iCloud, as they can be after a phone or tab closes mid-save.
  assert.equal(linesOf(backend.rows, 'st-1').length, 400);
  await store.load();
  assert.equal(linesOf(store.rows, 'st-1').length, 400, 'the leftovers come back on the next load');
  assert.equal(store.statementLines().filter((l) => l.f.statement_id === 'st-1').length, 0, 'and are never shown');
});

test('a statement saved whole shows every dated line', async () => {
  const { backend, store, account } = await storeWithAccount();
  const before = store.statementLines().length;
  await store.saveStatement(statementRecords(account, 400), null);
  assert.equal(linesOf(backend.rows, 'st-1').length, 400);
  assert.equal(store.statementLines().length - before, 400);
  assert.equal(store.statementRead('a'.repeat(64)), true);
});
