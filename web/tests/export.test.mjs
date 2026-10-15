// node --test web/tests/export.test.mjs — the app's three export formats, made here. Made-up figures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, pbkdf2Sync, createDecipheriv } from 'node:crypto';
import { snapshot, csv, json, seal, quoted, plainAmount } from '../export.mjs';

const records = [
  { name: 'assumptions-1', type: 'Assumptions', f: { base_currency_code: 'USD', monthly_income_minor: 500000, monthly_spending_minor: 300000, annual_raise_pct: '3', raise_effective_month: 4,
    annual_spending_growth_pct: '2', annual_return_pct: '6', annual_withdrawal_pct: '4', horizon_months: 24, updated_at: '2026-10-01T00:00:00.000Z' } },
  { name: 'a1', type: 'Account', f: { name: '=Sneaky, "quoted"', kind: 'ASSET', currency_code: 'JPY', is_invested: 0, display_order: 1, created_at: '2026-01-01T00:00:00.000Z', income_basis: 'AMOUNT', income_amount_minor: 1500, income_frequency: 'ANNUAL', income_reinvested: 1 } },
  { name: 'a0', type: 'Account', f: { name: 'Current', kind: 'ASSET', currency_code: 'USD', is_invested: 1, display_order: 0, created_at: '2026-01-01T00:00:00.000Z', category: 'CURRENT', income_reinvested: 0 } },
  { name: 'b1', type: 'Balance', f: { account_id: 'a0', value_minor: -1250, as_of_date: '2026-09-01', source: 'STATEMENT', created_at: '2026-09-02T00:00:00.000Z' } },
  { name: 'b2', type: 'Balance', f: { account_id: 'a0', value_minor: 98765, as_of_date: '2026-10-01', source: 'MANUAL', created_at: '2026-10-02T00:00:00.000Z' } },
  { name: 'b3', type: 'Balance', f: { account_id: 'a1', value_minor: 500000, as_of_date: '2026-10-01', source: 'MANUAL', created_at: '2026-10-02T00:00:00.000Z' } },
  { name: 'b4', type: 'Balance', f: { account_id: 'a1', value_minor: 1, as_of_date: '2026-10-03', source: 'MANUAL', created_at: '2026-10-03T00:00:00.000Z' } },
  { name: 'withdrawal-b4', type: 'BalanceWithdrawal', f: { withdrawn_at: '2026-10-04T00:00:00.000Z' } },
  { name: 'rate-JPY', type: 'FXRate', f: { rate: '0.0068', source: 'AUTO', updated_at: '2026-10-01T00:00:00.000Z' } },
];
const opts = { now: '2026-10-16T00:00:00.000Z', scaleOf: (c) => (c === 'JPY' ? 0 : 2), nameOf: (c) => c };

test('the snapshot: the app\'s keys and order, a withdrawn balance left out', () => {
  const s = snapshot(records, opts);
  assert.equal(s.format, 'wafflewealth'); assert.equal(s.version, 5);
  assert.deepEqual(s.accounts.map((a) => a.id), ['a0', 'a1']);
  assert.deepEqual(s.balances.map((b) => b.id), ['b2', 'b1', 'b3']);
  assert.equal(s.accounts[0].is_invested, true);
  assert.deepEqual(s.fx_rates, [{ quote_code: 'JPY', rate: '0.0068', source: 'AUTO', updated_at: '2026-10-01T00:00:00.000Z' }]);
  assert.equal(s.target, null);
});

test('the spreadsheet: CRLF, a formula guarded, quotes doubled, amounts plain', () => {
  const text = csv(snapshot(records, opts), (k) => (k === 'CURRENT' ? 'Current account' : null));
  const lines = text.split('\r\n');
  assert.equal(lines[0].split(',').length, 17);
  assert.equal(lines[1], 'Current,ASSET,Current account,USD,true,,,,,,,,,987.65,2026-10-01,MANUAL,2026-10-02T00:00:00.000Z');
  assert.equal(lines[2].split(',').slice(-4)[0], "'-12.50", 'a negative amount is guarded too');
  assert.ok(lines[3].startsWith(`"'=Sneaky, ""quoted"""`), lines[3]);
  assert.ok(lines[3].includes(',AMOUNT,,1500,ANNUAL,true,'), lines[3]);
  assert.ok(text.endsWith('\r\n'));
  assert.equal(quoted('plain'), 'plain');
  assert.equal(plainAmount(5n, 2), '0.05');
});

test('JSON as the app writes it: sorted keys, " : ", two spaces', () => {
  assert.equal(json({ b: 1, a: [true, null], c: { z: 'x/y' } }), '{\n  "a" : [\n    true,\n    null\n  ],\n  "b" : 1,\n  "c" : {\n    "z" : "x/y"\n  }\n}');
});

test('the encrypted copy opens with the app\'s own steps', async () => {
  const bytes = await seal('{"made":"up"}', 'correct horse', { subtle: webcrypto.subtle, random: (n) => webcrypto.getRandomValues(new Uint8Array(n)), rounds: 10_000 });
  const buf = Buffer.from(bytes);
  assert.equal(buf.subarray(0, 4).toString(), 'WWBK');
  assert.equal(buf[4], 1);
  const rounds = buf.readUInt32BE(5);
  assert.equal(rounds, 10_000);
  const salt = buf.subarray(9, 25), nonce = buf.subarray(25, 37), body = buf.subarray(37, buf.length - 16), tag = buf.subarray(buf.length - 16);
  const key = pbkdf2Sync('correct horse', salt, rounds, 32, 'sha256');
  const d = createDecipheriv('aes-256-gcm', key, nonce); d.setAuthTag(tag);
  assert.equal(Buffer.concat([d.update(body), d.final()]).toString(), '{"made":"up"}');
  await assert.rejects(() => seal('x', 'short'));
});
