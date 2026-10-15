// node --test web/tests/history.test.mjs
// History worked out here agrees with the app's on a corpus the app itself worked out (the app's
// HistoryCorpusTests, WW_HISTORY_CORPUS). Every record is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as H from '../history.mjs?v=21';

const corpus = JSON.parse(readFileSync(new URL('./history-corpus.json', import.meta.url)));
const str = (v) => (v == null ? null : typeof v === 'bigint' ? String(v) : v);
const vals = (m) => Object.fromEntries([...m.entries()].map(([k, v]) => [k, String(v)]));
const SCALES = { AED: 2, USD: 2, GBP: 2, JPY: 0, EUR: 2 };

function setUp(c) {
  const ctx = { base: c.base, scales: SCALES, rates: c.rates, accounts: [], planned: [],
    assumptions: { ...c.assumptions, incomeMinor: BigInt(c.assumptions.incomeMinor), spendingMinor: BigInt(c.assumptions.spendingMinor) } };
  const record = H.makeRecord(c.accounts, c.balances.map((b) => ({ ...b, valueMinor: BigInt(b.valueMinor) })));
  const byId = new Map(c.accounts.map((a) => [a.id, a]));
  return { ctx, record, byId };
}

const check = (name, fn) => test(name, () => {
  let failures = 0;
  for (const c of corpus.cases) {
    if (c.months == null) continue;
    try { fn(c, setUp(c)); } catch (error) {
      failures += 1;
      if (failures <= 3) console.log(`${name} · case: ${error.message.slice(0, 600)}`);
    }
  }
  assert.equal(failures, 0, `${failures} records disagree`);
});

check('month by month', (c, { ctx, record }) => {
  const r = H.derive(record, ctx, c.today);
  assert.deepEqual(r.months.map((m) => ({ month: m.month, netWorth: str(m.netWorth), values: vals(m.values), newest: m.newest })), c.months);
  assert.deepEqual(r.events, c.events);
});
check('day by day', (c, { ctx, record }) => {
  assert.deepEqual(H.days(record, ctx, c.today).map((d) => ({ date: d.date, netWorth: str(d.netWorth), values: vals(d.values) })), c.days);
});
check('at the marks', (c, { ctx, record }) => {
  assert.deepEqual(H.atMarkers(record, c.markers, ctx).map((m) => ({ id: m.id, netWorth: str(m.netWorth), values: vals(m.values) })), c.atMarkers);
});
check('which accounts did it', (c, { ctx, record, byId }) => {
  const r = H.derive(record, ctx, c.today);
  if (c.attribution) {
    const a = H.attribution(c.attribution.from, c.attribution.to, r, byId);
    assert.deepEqual({ from: a.from, to: a.to, totalChange: str(a.totalChange), moved: str(a.moved), learned: str(a.learned), left: str(a.left),
      contributions: a.contributions.map((x) => [x.accountId, str(x.amount), x.kind, a.share(x) == null ? '-' : String(a.share(x))]) }, c.attribution);
  }
  const p = H.realisedPace(r, byId);
  assert.deepEqual(p && { months: p.months, moved: str(p.moved), perMonth: str(p.perMonth), excluded: str(p.excludedLearning) }, c.pace);
});
check('side by side', (c, { ctx, record, byId }) => {
  const resolved = H.resolvedPoints(H.derive(record, ctx, c.today), H.days(record, ctx, c.today));
  const cmp = H.compare(c.comparePoints, resolved, byId);
  assert.deepEqual(cmp && {
    columns: cmp.columns.map((x) => ({ effective: x.effectiveDate, netWorth: str(x.netWorth), owned: str(x.owned), owed: str(x.owed), tracked: x.tracked })),
    rows: cmp.rows.map((x) => ({ id: x.accountId, values: x.values.map((v) => (v == null ? '-' : String(v))), change: x.change == null ? '-' : String(x.change), changePercent: x.changePercent ?? '-' })),
  }, c.compare);
});
check('like for like', (c) => {
  const dates = c.days.map((d) => d.date);
  for (const l of c.likeForLike) {
    const r = H.likeForLike(l.from, l.to, l.payDay, dates);
    assert.deepEqual({ from: r.from, to: r.to, payDay: l.payDay, days: r.days, inStep: r.inStep, wholeMonths: r.wholeMonths,
      start: r.daysAfterPayAtStart, end: r.daysAfterPayAtEnd, suggestion: r.suggestion }, l);
  }
});
check('each account recorded', (c, { record }) => {
  assert.deepEqual(c.accounts.map((a) => {
    const t = H.recordedTrack(record.byAccount.get(a.id) || [], a.kind);
    return { id: a.id, points: t.points.map((p) => [p.date, String(p.value), String(p.change), String(p.daysSincePrevious)]),
      totalChange: String(t.totalChange), changePercent: t.changePercent ?? '-', spanDays: t.spanDays };
  }), c.tracks);
});
check('the forecast made then', (c, { ctx, record }) => {
  const versions = c.versions.map((v) => ({ ...v, incomeMinor: BigInt(v.incomeMinor), spendingMinor: BigInt(v.spendingMinor) }));
  assert.deepEqual(H.availableStarts(versions, c.today), c.starts);
  if (!c.forecast) return;
  const planned = c.planned.map((p) => ({ ...p, amountMinor: BigInt(p.amountMinor) }));
  const inUse = c.accounts.filter((a) => !a.archivedAt);
  let r;
  try {
    r = H.forecastReview({ versions, rateVersions: c.rateVersions, plannedAll: planned, record, history: H.derive(record, ctx, c.today),
      ctx, today: c.today, from: c.forecast.from, inUse });
  } catch (error) {
    if (error.kind !== 'missingRate') throw error;
    return assert.deepEqual({ from: c.forecast.from, missingRate: error.code }, c.forecast);
  }
  if (!r.ok) return assert.deepEqual({ from: c.forecast.from, firstKnown: r.firstKnown }, c.forecast);
  assert.deepEqual({ from: r.from, points: r.points.map((p) => [p.month, String(p.expected), String(p.actual)]), edited: r.inputChanges.assumptionsEdited,
    joined: r.inputChanges.accountsJoined, left: r.inputChanges.accountsLeft, rates: r.inputChanges.ratesChanged, plannedAdded: r.inputChanges.plannedAdded }, c.forecast);
});
