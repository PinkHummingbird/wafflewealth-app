// node --test web/tests/account-match.test.mjs
// The guess of which account a statement goes into agrees with the app's on a corpus the app
// itself made (the app's MatchCorpusTests, WW_MATCH_CORPUS). Every account is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../account-match.mjs?v=25';

const corpus = JSON.parse(readFileSync(new URL('./match-corpus.json', import.meta.url)));

function answer(c) {
  const accounts = c.accounts;
  const list = M.candidates(c.account, c.statement, accounts);
  return {
    choosable: M.choosable(c.account, accounts).map((a) => a.id),
    ranked: list.map((x) => ({ id: x.account.id, score: x.score, reasons: x.reasons.map((r) => ({ ...r, text: M.reasonText(r) })) })),
    preselected: M.preselected(list),
  };
}

test('the corpus varies', () => {
  assert.ok(corpus.cases.length >= 200);
  assert.ok(corpus.cases.some((c) => c.preselected) && corpus.cases.some((c) => !c.preselected));
});

test('every guess is the app’s: the accounts offered, their order, scores, reasons and words', () => {
  let failures = 0;
  corpus.cases.forEach((c, i) => {
    const got = answer(c);
    const want = { choosable: c.choosable, ranked: c.ranked, preselected: c.preselected };
    try { assert.deepEqual(got, want); } catch (e) { if (failures++ < 3) console.log(`case ${i}`, JSON.stringify(got), JSON.stringify(want)); }
  });
  assert.equal(failures, 0);
});

test('one account is pre-selected for one statement account only', () => {
  const list = [{ account: { id: 'a' }, score: 5, reasons: [] }];
  assert.deepEqual(M.preselectedFor([list, list]), ['a', null]);
  assert.deepEqual(M.preselectedFor([[{ account: { id: 'a' }, score: 3 }, { account: { id: 'b' }, score: 2 }]]), [null]);
});
