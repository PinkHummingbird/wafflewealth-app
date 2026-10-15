// node --test web/tests/groups.test.cjs
// The Activity list grouped by month and by account: the app's ActivityGroupsTests, figure for
// figure, so the website and the phone group alike. Made-up figures only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
globalThis.WWMoney = {};
require('../cloud.js');
const { Groups } = globalThis.WWCloud;

const e = (id, day, minor, account, currency = 'AED', between = false) => ({ id, day, minor, account, currency, between });
const entries = [
  e('oct-coffee', '2026-10-12', -1450, 'card'),
  e('oct-salary', '2026-10-01', 1800000, 'current'),
  e('oct-repay', '2026-10-01', -199978, 'current', 'AED', true),
  e('oct-repay-in', '2026-10-01', 199978, 'card', 'AED', true),
  e('oct-rent', '2026-10-01', -650000, 'current'),
  e('oct-lunch', '2026-10-01', -4250, null, 'USD'),
  e('sep-salary', '2026-09-28', 1800000, 'current'),
  e('sep-books', '2026-09-14', -3200, 'card'),
  e('sep-taxi', '2026-09-02', -1800, null),
];

test("each account's month adds up, moves between accounts apart", () => {
  const all = Groups.movements(entries, ['current', 'card']);
  const current = all.find((m) => m.account === 'current' && m.month === '2026-10');
  assert.deepEqual([current.in, current.out, current.between, current.net], [1800000, 650000, -199978, 1150000]);
  assert.deepEqual(current.entries.map((x) => x.id), ['oct-salary', 'oct-repay', 'oct-rent']);
  const card = all.find((m) => m.account === 'card' && m.month === '2026-10');
  assert.deepEqual([card.in, card.out, card.between], [0, 1450, 199978]);
  assert.equal(all.flatMap((m) => m.entries).length, entries.length);
});

test('no account is its own movement per currency, last', () => {
  const october = Groups.movements(entries, ['current', 'card']).filter((m) => m.month === '2026-10');
  assert.deepEqual(october.map((m) => m.account), ['current', 'card', null]);
  assert.equal(october.at(-1).currency, 'USD');
  assert.equal(october.at(-1).out, 4250);
});

test('by month: newest first, a movement per account', () => {
  const sections = Groups.byMonth(entries, ['current', 'card']);
  assert.deepEqual(sections.map((s) => s.month), ['2026-10', '2026-09']);
  assert.deepEqual(sections[1].movements.map((m) => m.net), [1800000, -3200, -1800]);
});

test("by account: the user's order, months newest first", () => {
  const sections = Groups.byAccount(entries, ['card', 'current']);
  assert.deepEqual(sections.map((s) => s.account), ['card', 'current', null]);
  assert.deepEqual(sections[0].movements.map((m) => m.net), [-1450, -3200]);
  assert.deepEqual(sections[2].movements.map((m) => m.currency), ['USD', 'AED']);
});

test('an account not in the order comes after the ones that are', () => {
  const more = [...entries, e('old', '2026-10-03', -500, 'archived-1')].sort((a, b) => (a.day < b.day ? 1 : -1));
  assert.deepEqual(Groups.byMonth(more, ['current', 'card'])[0].movements.map((m) => m.account), ['current', 'card', 'archived-1', null]);
});
