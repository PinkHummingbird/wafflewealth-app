// node --test web/tests/readings.test.mjs
// Every reading worked out here agrees with the app's, to the minor unit, on a corpus the app
// itself worked out (the app's ReadingsCorpusTests, WW_READINGS_CORPUS). Every file is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { project } from '../projection.mjs?v=21';
import * as R from '../readings.mjs?v=21';

const corpus = JSON.parse(readFileSync(new URL('./readings-corpus.json', import.meta.url)));
const str = (v) => (v == null ? null : typeof v === 'bigint' ? String(v) : v);
const kindOnly = (a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, str(v)]));

function contextOf(c) {
  const ctx = structuredClone(c.context);
  for (const a of ctx.accounts) {
    a.latestMinor = a.latestMinor == null ? null : BigInt(a.latestMinor);
    if (a.income) a.income.amountMinor = BigInt(a.income.amountMinor);
  }
  for (const p of ctx.planned) p.amountMinor = BigInt(p.amountMinor);
  ctx.assumptions.incomeMinor = BigInt(ctx.assumptions.incomeMinor);
  ctx.assumptions.spendingMinor = BigInt(ctx.assumptions.spendingMinor);
  return ctx;
}

const check = (name, fn) => test(name, () => {
  let failures = 0;
  for (const c of corpus.cases) {
    try { fn(c, contextOf(c)); } catch (error) {
      failures += 1;
      if (failures <= 3) console.log(`${name} · ${c.name}: ${error.message.slice(0, 600)}`);
    }
  }
  assert.equal(failures, 0, `${failures} of ${corpus.cases.length} files disagree`);
});

check('target', (c, ctx) => assert.deepEqual(kindOnly(R.target(ctx, c.today, c.ask.targetMinor, c.ask.basis)), c.target));
check('runway', (c, ctx) => assert.deepEqual(kindOnly(R.runway(ctx, c.today)), c.runway));
check('a debt clearing', (c, ctx) => {
  const debts = ctx.accounts.filter((a) => a.kind === 'LIABILITY');
  assert.deepEqual(debts.map((a) => kindOnly(R.debtClearance(a.latestMinor ?? 0n, a.income, c.today))), c.debts);
});
check('enough', (c, ctx) => assert.deepEqual(kindOnly(R.enough(ctx, c.today, ctx.assumptions.withdrawalPct, c.ask.basis)), c.enough));
check('enough, at the pace', (c, ctx) => assert.deepEqual(kindOnly(R.enoughAtPace(ctx, c.today, ctx.assumptions.withdrawalPct, c.ask.pace, c.ask.basis)), c.enoughAtPace));
check('enough, a scenario', (c, ctx) => assert.deepEqual(kindOnly(R.enough(R.scenarioContext(ctx, c.ask.scenario), c.today, ctx.assumptions.withdrawalPct, c.ask.basis)), c.enoughScenario));
check('the month it is enough', (c, ctx) => {
  const f = R.enoughFlow(ctx, c.today, ctx.assumptions.withdrawalPct, c.flowAt, c.ask.basis);
  assert.deepEqual(f && kindOnly(f), c.flow);
});
check('required saving', (c, ctx) => assert.deepEqual(kindOnly(R.requiredSaving(ctx, c.today, c.ask.targetMinor, c.ask.basis, c.ask.deadline)), c.saving));
check('required return', (c, ctx) => assert.deepEqual(kindOnly(R.requiredReturn(ctx, c.today, c.ask.targetMinor, c.ask.basis, c.ask.deadline)), c.return));
check('levers', (c, ctx) => assert.deepEqual(R.levers(ctx, c.today).map(kindOnly), c.levers));
check('breakdown', (c, ctx) => {
  const p = project(ctx, c.today);
  const b = R.breakdown(ctx, p, c.today);
  assert.deepEqual({
    income: str(b.income), spending: str(b.spending), growth: str(b.growth), interest: str(b.interest),
    interestEarned: str(b.interestEarned), interestCharged: str(b.interestCharged), plannedTotal: str(b.plannedTotal),
    planned: b.planned.map((x) => ({ id: x.id, total: str(x.total), times: x.times })),
    accounts: b.accounts.map((x) => ({ id: x.id, now: str(x.now), then: str(x.then), growth: str(x.growth), paid: str(x.paid), retained: str(x.retained) })),
  }, c.breakdown);
  const h = R.horizonHoldings(b, ctx, p);
  assert.deepEqual({ month: h.month, unassigned: str(h.unassigned), holdings: h.holdings.map((x) => ({ id: x.id, value: str(x.value), reachable: x.reachable })) }, c.holdings);
});
check('the sum behind net worth', (c, ctx) => {
  const s = R.netWorthSum(ctx);
  assert.deepEqual({ owned: str(s.owned), owed: str(s.owed), assets: s.assets.map((x) => [x.id, str(x.own), str(x.inBase)]),
    debts: s.debts.map((x) => [x.id, str(x.own), str(x.inBase)]) }, c.sum);
});
check('currencies', (c, ctx) => {
  const stakes = R.currencyStakes(ctx).map((x) => ({ code: x.code, minorInBase: str(x.minorInBase), share: x.share })).sort((a, b) => (a.code < b.code ? -1 : 1));
  assert.deepEqual(stakes, c.stakes);
  if (c.shock) assert.equal(str(R.shockedNetWorth(ctx, c.shock.code, c.shock.movePct, c.today)), c.shock.netWorth);
});
check('a group as a line', (c, ctx) => assert.deepEqual(R.groupLine(c.group.ids, ctx, project(ctx, c.today), c.today).map(str), c.group.line));
check('coming up', (c, ctx) => assert.deepEqual(R.comingUp(ctx, c.today).map((x) => ({ itemId: x.itemId, date: x.date, amount: str(x.amount) })), c.comingUp));
check('each account on its own', (c, ctx) => {
  const lines = ctx.accounts.map((a) => {
    const l = R.accountLine({ balanceMinor: (a.latestMinor ?? 0n) * (a.kind === 'ASSET' ? 1n : -1n), currency: a.currency, invested: a.invested,
      income: a.income, returnPct: ctx.assumptions.returnPct, today: c.today, months: 24 });
    return { id: a.id, values: l.months.map((m) => str(m.value)), totalPaid: str(l.totalPaid), totalRetained: str(l.totalRetained),
      totalGrowth: str(l.totalGrowth), simpleInterest: str(l.simpleInterest), compounded: str(l.compoundedInterest),
      changePercent: l.changePercent, isFlat: l.isFlat };
  });
  assert.deepEqual(lines, c.accountLines);
});
check('small readings', (c, ctx) => {
  const p = project(ctx, c.today);
  assert.equal(R.monthsSinceNewestBalance(ctx, c.today), c.balanceAge);
  assert.equal(R.savingsRate(p, ctx.assumptions.incomeMinor)?.toString() ?? null, c.savingsRate);
  assert.equal(R.changePercent(p)?.toString() ?? null, c.changePercent);
});
