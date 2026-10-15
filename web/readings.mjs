/* WaffleWealth on the web: the readings of the line, worked out here exactly as the app works
   them out.

   Each is a port of one of the app's readings (WaffleWealthCore/Projection), kept to the letter
   and run on the same engine (projection.mjs): when the line reaches a target, when income
   stopping would run the money out, when a debt clears, when the money is enough to live on
   (FIRE), what reaching a target by a month would take, which assumption the line turns on,
   what the change is made of (Breakdown), each account on its own terms, the sum behind the
   net worth figure, the share in each currency, a group of accounts as a line, and what lands
   in the next thirty days. Nothing is stored: the page works them out again every time.

   web/tests/readings.test.mjs holds them to a corpus the app itself worked out
   (web/tests/readings-corpus.json, made by the app's ReadingsCorpusTests). */
import {
  Dec, dec, project, convert, minorOf, occurrences, signedAmount, addMonthsToMonth, monthsSince,
  unlockMonth, birthOf, ratePayment, pays, ProjectionError, INT64_MAX, INT64_MIN,
} from './projection.mjs?v=24';

export const MONTH_CAP = 600;
export const TREND_WINDOW = 12;
const abs = (v) => (v < 0n ? -v : v);

// ---------------------------------------------------------------------------------------------
// Crossing: the first month a quantity crosses a threshold (Crossing.firstCrossing)

/** values, thresholds: BigInt arrays (a threshold may be one BigInt). 'up' or 'down'.
    → { kind: 'alreadyPast' | 'crosses' | 'beyondCap' | 'notApproaching', offset } */
export function firstCrossing(values, thresholds, direction) {
  const t = Array.isArray(thresholds) ? thresholds : values.map(() => thresholds);
  if (!values.length || t.length !== values.length) return { kind: 'notApproaching' };
  const past = (i) => (direction === 'up' ? values[i] >= t[i] : values[i] <= t[i]);
  if (past(0)) return { kind: 'alreadyPast' };
  for (let i = 1; i < values.length; i++) if (past(i)) return { kind: 'crosses', offset: i };
  const gap = (i) => (direction === 'up' ? t[i] - values[i] : values[i] - t[i]);
  const last = values.length - 1;
  return { kind: gap(last) < gap(Math.max(0, last - TREND_WINDOW)) ? 'beyondCap' : 'notApproaching' };
}

/** Which of a month's figures a target is read against (TargetReading.value). */
export function basisValue(month, basis) {
  switch (basis) {
    case 'INVESTED': return month.invested;
    case 'CASH': return month.cash;
    case 'AVAILABLE': return month.available;
    default: return month.netWorth;
  }
}

const withAssumptions = (ctx, change) => ({ ...ctx, assumptions: { ...ctx.assumptions, ...change } });

// ---------------------------------------------------------------------------------------------
// Target, runway, a debt clearing

/** → { kind: 'alreadyMet' | 'reached' | 'beyondCap' | 'notRising', offset, month } */
export function target(ctx, today, targetMinor, basis) {
  const p = project(ctx, today, MONTH_CAP);
  const c = firstCrossing(p.months.map((m) => basisValue(m, basis)), BigInt(targetMinor), 'up');
  switch (c.kind) {
    case 'alreadyPast': return { kind: 'alreadyMet' };
    case 'crosses': return { kind: 'reached', offset: c.offset, month: p.months[c.offset].month };
    case 'beyondCap': return { kind: 'beyondCap' };
    default: return { kind: 'notRising' };
  }
}

/** If income stopped today, the month the money that can be reached runs out.
    → { kind: 'alreadyOut' | 'runsOut' | 'never' | 'beyondCap', offset, month } */
export function runway(ctx, today) {
  const p = project(withAssumptions(ctx, { incomeMinor: 0 }), today, MONTH_CAP);
  const c = firstCrossing(p.months.map((m) => m.available), 0n, 'down');
  switch (c.kind) {
    case 'alreadyPast': return { kind: 'alreadyOut' };
    case 'crosses': return { kind: 'runsOut', offset: c.offset, month: p.months[c.offset].month };
    case 'notApproaching': return { kind: 'never' };
    default: return { kind: 'beyondCap' };
  }
}

/** When a debt's balance reaches zero under its own payment, in its own currency.
    → { kind: 'alreadyClear' | 'clears' | 'neverAtThisPayment' | 'growing' | 'beyondCap' | 'cannotSay', offset, month } */
export function debtClearance(balanceMinor, income, today) {
  if (BigInt(balanceMinor) <= 0n) return { kind: 'alreadyClear' };
  if (!income) return { kind: 'cannotSay' };
  if (income.basis === 'RATE' && !income.reinvested) return { kind: 'neverAtThisPayment' };
  let balance = Dec.int(balanceMinor);
  const max = Dec.int(INT64_MAX), min = Dec.int(INT64_MIN);
  const clamped = (v) => {
    if (v.cmp(max) >= 0) return INT64_MAX;
    if (v.cmp(min) <= 0) return INT64_MIN;
    return v.round(0).exactInt64() ?? (v.sign() > 0 ? INT64_MAX : INT64_MIN);
  };
  const values = [BigInt(balanceMinor)];
  for (let m = 1; m <= MONTH_CAP; m++) {
    if (pays(income, m)) {
      if (income.basis === 'AMOUNT') balance = income.reinvested ? balance.add(Dec.int(income.amountMinor)) : balance.sub(Dec.int(income.amountMinor));
      else if (income.reinvested) balance = balance.add(ratePayment(income, balance));
    }
    values.push(clamped(balance));
  }
  const c = firstCrossing(values, 0n, 'down');
  switch (c.kind) {
    case 'alreadyPast': return { kind: 'alreadyClear' };
    case 'crosses': return { kind: 'clears', offset: c.offset, month: addMonthsToMonth(today.slice(0, 7), c.offset) };
    case 'beyondCap': return { kind: 'beyondCap' };
    default: return { kind: values[values.length - 1] > values[0] ? 'growing' : 'neverAtThisPayment' };
  }
}

// ---------------------------------------------------------------------------------------------
// Enough: the month the money covers the year ahead's spending at a withdrawal rate (FIRE)

export const ENOUGH_WINDOW = 12;

/** `year × 100 / pct`, rounded half away from zero, Int64.max where it won't fit (EnoughReading.Divisor). */
export function potCovering(year, withdrawalPct) {
  const pct = dec(withdrawalPct);
  const scaled = pct.mul(Dec.int(100)).exactInt64();
  if (scaled != null && scaled > 0n && year >= 0n) {
    const n = year * 10000n;
    const q = n / scaled, r = n % scaled;
    let out = r * 2n >= scaled ? q + 1n : q;
    return out > INT64_MAX ? INT64_MAX : out;
  }
  const amount = Dec.int(year).mul(Dec.int(100)).div(pct).round(0);
  return amount.exactInt64() ?? INT64_MAX;
}

function covering(spending, index, withdrawalPct) {
  if (!spending.length) return 0n;
  const last = spending.length - 1;
  let year = 0n;
  for (let step = 1; step <= ENOUGH_WINDOW; step++) year += spending[Math.min(index + step, last)];
  return potCovering(year, withdrawalPct);
}

/** → { kind: 'alreadyEnough' | 'reached' | 'beyondCap' | 'notClosing' | 'noSpending', offset, month, covering } */
export function enough(ctx, today, withdrawalPct, basis = 'AVAILABLE') {
  if (dec(withdrawalPct).sign() <= 0) return { kind: 'notClosing' };
  const p = project(ctx, today, MONTH_CAP);
  const spending = p.months.map((m) => m.spending);
  if (!spending.some((v) => v > 0n)) return { kind: 'noSpending' };
  const values = p.months.map((m) => basisValue(m, basis));
  const thresholds = p.months.map((_, i) => covering(spending, i, withdrawalPct));
  const c = firstCrossing(values, thresholds, 'up');
  switch (c.kind) {
    case 'alreadyPast': return { kind: 'alreadyEnough' };
    case 'crosses': return { kind: 'reached', offset: c.offset, month: p.months[c.offset].month, covering: thresholds[c.offset] };
    case 'beyondCap': return { kind: 'beyondCap' };
    default: return { kind: 'notClosing' };
  }
}

/** The same question asked of the record: adding what months have actually added (RealisedPace). */
export function enoughAtPace(ctx, today, withdrawalPct, perMonthMinor, basis = 'AVAILABLE') {
  return enough(withAssumptions(ctx, {
    incomeMinor: BigInt(ctx.assumptions.spendingMinor) + BigInt(perMonthMinor), returnPct: '0', raisePct: '0',
  }), today, withdrawalPct, basis);
}

/** A context holding nothing but figures typed on the FIRE screen (FireScenario.context). */
export function scenarioContext(ctx, s) {
  const pot = BigInt(s.potMinor), spend = BigInt(s.monthlySpendingMinor), save = BigInt(s.monthlySavingMinor);
  const income = spend + save;
  return {
    ...ctx,
    accounts: [{ id: 'fire-scenario', name: 'Pot', kind: 'ASSET', currency: ctx.base, invested: true,
      latestMinor: pot > 0n ? pot : 0n, income: null, availableFromAge: null, availableFromMonth: null }],
    planned: [],
    assumptions: { ...ctx.assumptions, incomeMinor: income > 0n ? income : 0n, spendingMinor: spend,
      returnPct: s.annualReturnPct, spendingGrowthPct: s.annualSpendingGrowthPct, raisePct: '0',
      fireInterestPct: null, fireGrowthPct: null },
  };
}

/** What the position looks like in the month the money is enough (EnoughReading.flow). */
export function enoughFlow(ctx, today, withdrawalPct, monthOffset, basis = 'AVAILABLE') {
  const pct = dec(withdrawalPct);
  if (monthOffset < 0 || pct.sign() <= 0) return null;
  const p = project(ctx, today, monthOffset + ENOUGH_WINDOW);
  const months = p.months;
  if (monthOffset >= months.length) return null;
  const at = (step) => months[Math.min(monthOffset + step, months.length - 1)];
  const pot = basisValue(months[monthOffset], basis);
  let yearAhead = 0n, earnedInYear = 0n;
  for (let step = 1; step <= ENOUGH_WINDOW; step++) {
    yearAhead += at(step).spending;
    earnedInYear += at(step).growth + at(step).interest;
  }
  const withdrawal = Dec.int(pot).mul(pct).div(Dec.int(100)).round(0).exactInt64() ?? 0n;
  const flow = { month: months[monthOffset].month, pot, growing: months[monthOffset].invested, yearOfSpending: yearAhead,
    yearlyWithdrawal: withdrawal, yearlyReturn: earnedInYear, fireInterest: null, fireGrowth: null };
  const a = ctx.assumptions;
  if (a.fireInterestPct != null && a.fireGrowthPct != null) {
    const share = (rate) => {
      const v = Dec.int(pot).mul(dec(rate)).div(Dec.int(100)).round(0).exactInt64();
      if (v == null) throw new ProjectionError('overflow');
      return v;
    };
    flow.fireInterest = share(a.fireInterestPct);
    flow.fireGrowth = share(a.fireGrowthPct);
    flow.yearlyReturn = flow.fireInterest + flow.fireGrowth;
  }
  flow.yearlyBalance = flow.yearlyReturn - flow.yearlyWithdrawal;
  flow.earnedPct = pot === 0n ? null : Dec.int(flow.yearlyReturn).mul(Dec.int(100)).div(Dec.int(abs(pot))).round(1).toString();
  return flow;
}

// ---------------------------------------------------------------------------------------------
// Requirements: what reaching a target by a month would take, one thing at a time

const ITERATION_BOUND = 96;
const RATE_TOLERANCE = Dec.of('0.01');
const RATE_LOW = Dec.int(-99), RATE_HIGH = Dec.int(1000);

function valueAt(ctx, today, basis, months) {
  try {
    const p = project(ctx, today, months);
    return basisValue(p.months[Math.min(months, p.months.length - 1)], basis);
  } catch (error) {
    if (error instanceof ProjectionError && error.kind === 'overflow') return INT64_MAX;
    throw error;
  }
}

function saving(ctx, extra, today) {
  const next = addMonthsToMonth(today.slice(0, 7), 1);
  return { ...ctx, planned: [...ctx.planned, { id: 'requirements-solver', name: '', direction: 'IN', amountMinor: extra,
    currency: null, firstDate: `${next}-01`, frequency: 'MONTHLY', endsOn: null, growthPct: '0' }] };
}

/** → { kind: 'alreadyMet' | 'requires' | 'cannotBeDone', extraMonthlyMinor } */
export function requiredSaving(ctx, today, targetMinor, basis, deadline) {
  const goal = BigInt(targetMinor);
  const span = monthsSince(deadline, today.slice(0, 7));
  if (span <= 0) return valueAt(ctx, today, basis, Math.max(span, 0)) >= goal ? { kind: 'alreadyMet' } : { kind: 'cannotBeDone' };
  const atRest = valueAt(ctx, today, basis, span);
  if (atRest >= goal) return { kind: 'alreadyMet' };
  const gap = goal - atRest;
  let hi = gap > INT64_MAX ? 1n : (gap / BigInt(span) + 1n > 1n ? gap / BigInt(span) + 1n : 1n);
  let atHi = valueAt(saving(ctx, hi, today), today, basis, span);
  while (atHi < goal && hi < 1_000_000_000_000_000n) {
    hi *= 2n;
    atHi = valueAt(saving(ctx, hi, today), today, basis, span);
  }
  if (atHi < goal) return { kind: 'cannotBeDone' };
  let lo = 0n, atLo = atRest, iterations = 0;
  while (hi - lo > 1n && iterations < ITERATION_BOUND) {
    const mid = interpolate(lo, atLo, hi, atHi, goal);
    const atMid = valueAt(saving(ctx, mid, today), today, basis, span);
    if (atMid >= goal) { hi = mid; atHi = atMid; } else { lo = mid; atLo = atMid; }
    iterations += 1;
  }
  return { kind: 'requires', extraMonthlyMinor: hi };
}

function interpolate(lo, atLo, hi, atHi, goal) {
  const midpoint = lo + (hi - lo) / 2n;
  if (!(atHi > atLo)) return midpoint;
  const fraction = Dec.int(goal).sub(Dec.int(atLo)).div(Dec.int(atHi).sub(Dec.int(atLo)));
  const point = Dec.int(lo).add(fraction.mul(Dec.int(hi - lo))).round(0, 'up').exactInt64();
  if (point == null) return midpoint;
  const floor = lo + 1n, ceiling = hi - 1n;
  return point < floor ? floor : point > ceiling ? ceiling : point;
}

/** → { kind: 'alreadyMet' | 'requires' | 'cannotBeDone', annualPct (string) } */
export function requiredReturn(ctx, today, targetMinor, basis, deadline) {
  const goal = BigInt(targetMinor);
  const span = monthsSince(deadline, today.slice(0, 7));
  const reaches = (c, months) => valueAt(c, today, basis, months) >= goal;
  const returning = (pct) => withAssumptions(ctx, { returnPct: pct });
  if (span <= 0) return reaches(ctx, Math.max(span, 0)) ? { kind: 'alreadyMet' } : { kind: 'cannotBeDone' };
  if (reaches(ctx, span)) return { kind: 'alreadyMet' };
  if (!reaches(returning(RATE_HIGH), span)) return { kind: 'cannotBeDone' };
  let lo = RATE_LOW, hi = RATE_HIGH, iterations = 0;
  while (hi.sub(lo).cmp(RATE_TOLERANCE) > 0 && iterations < ITERATION_BOUND) {
    const mid = lo.add(hi).div(Dec.int(2)).round(4);
    if (reaches(returning(mid), span)) hi = mid; else lo = mid;
    iterations += 1;
  }
  let grid = hi.div(RATE_TOLERANCE).round(0, 'up').mul(RATE_TOLERANCE);
  if (hi.sub(lo).cmp(RATE_TOLERANCE.mul(Dec.int(2))) <= 0) {
    while (grid.sub(RATE_TOLERANCE).cmp(lo) > 0 && reaches(returning(grid.sub(RATE_TOLERANCE)), span)) grid = grid.sub(RATE_TOLERANCE);
  }
  return { kind: 'requires', annualPct: grid.toString() };
}

// ---------------------------------------------------------------------------------------------
// Sensitivity: which assumption the line turns on

/** Every lever, largest movement of the horizon figure first: [{ kind, deltaMinor }]. */
export function levers(ctx, today) {
  const horizon = ctx.assumptions.horizonMonths;
  const atHorizon = (c) => { const p = project(c, today, horizon); return p.months[p.months.length - 1].netWorth; };
  const baseline = atHorizon(ctx);
  const delta = (change) => atHorizon(withAssumptions(ctx, change)) - baseline;
  const grown = (v) => Dec.int(v).mul(Dec.int(1).add(Dec.of('0.01'))).round(0).exactInt64() ?? BigInt(v);
  const a = ctx.assumptions;
  const one = Dec.int(1);
  const list = [
    { kind: 'investmentReturn', deltaMinor: delta({ returnPct: dec(a.returnPct).add(one) }) },
    { kind: 'raise', deltaMinor: delta({ raisePct: dec(a.raisePct).add(one) }) },
    { kind: 'spendingGrowth', deltaMinor: delta({ spendingGrowthPct: dec(a.spendingGrowthPct).add(one) }) },
    { kind: 'income', deltaMinor: delta({ incomeMinor: grown(a.incomeMinor) }) },
    { kind: 'spending', deltaMinor: delta({ spendingMinor: grown(a.spendingMinor) }) },
  ];
  return list.sort((x, y) => (abs(y.deltaMinor) > abs(x.deltaMinor) ? 1 : abs(y.deltaMinor) < abs(x.deltaMinor) ? -1 : 0));
}

// ---------------------------------------------------------------------------------------------
// One account on its own terms (AccountProjection), in its own currency

export function accountLine({ balanceMinor, currency, invested, income, returnPct, today, months: monthCount }) {
  const start = today.slice(0, 7);
  const monthlyReturn = dec(returnPct).div(Dec.int(100)).div(Dec.int(12));
  const opening = BigInt(balanceMinor);
  const rounded = (v) => v.round(0).exactInt64() ?? 0n;
  const sign = opening < 0n ? Dec.int(-1) : Dec.int(1);
  let basis = Dec.int(opening);
  let previous = opening;
  let simple = Dec.int(0);
  const out = [{ offset: 0, month: start, value: opening, growth: 0n, paid: 0n, retained: 0n, change: 0n }];
  for (let m = 1; m <= monthCount; m++) {
    const growth = invested ? basis.mul(monthlyReturn) : Dec.int(0);
    basis = basis.add(growth);
    let paid = Dec.int(0), retained = Dec.int(0);
    if (income && pays(income, m)) {
      paid = income.basis === 'AMOUNT' ? Dec.int(income.amountMinor).mul(sign) : ratePayment(income, basis);
      simple = simple.add(income.basis === 'AMOUNT' ? Dec.int(income.amountMinor).mul(sign) : ratePayment(income, Dec.int(opening)));
      if (income.reinvested) { basis = basis.add(paid); retained = paid; }
    }
    const value = rounded(basis);
    out.push({ offset: m, month: addMonthsToMonth(start, m), value, growth: rounded(growth), paid: rounded(paid),
      retained: rounded(retained), change: value - previous });
    previous = value;
  }
  const now = out[0].value, atHorizon = out[out.length - 1].value;
  const totalChange = atHorizon - now;
  const allKept = out.every((m) => m.paid === m.retained);
  const totalPaid = !invested && allKept ? totalChange : out.reduce((t, m) => t + m.paid, 0n);
  const totalRetained = !invested ? totalChange : out.reduce((t, m) => t + m.retained, 0n);
  const totalGrowth = !invested ? 0n : totalChange - totalRetained;
  const simpleInterest = rounded(simple);
  return {
    currency, appreciates: Boolean(invested), months: out, now, atHorizon, totalChange, totalPaid, totalRetained, totalGrowth,
    simpleInterest, compoundedInterest: totalPaid - simpleInterest,
    changePercent: now === 0n ? null : Dec.int(totalChange).div(Dec.int(abs(now))).shift(2).toString(),
    isFlat: out.every((m) => m.growth === 0n && m.paid === 0n),
  };
}

const signedLatest = (acct) => {
  const v = BigInt(acct.latestMinor);
  return acct.kind === 'ASSET' ? v : -v;
};

/** A signed minor figure in an account's currency, in the base, rounded once. */
function inBase(ctx, minor, code) {
  const value = minorOf(convert(ctx, Dec.int(abs(minor)), code));
  return minor < 0n ? -value : value;
}

const lineFor = (ctx, acct, today, months) => accountLine({
  balanceMinor: signedLatest(acct), currency: acct.currency, invested: acct.invested, income: acct.income,
  returnPct: ctx.assumptions.returnPct, today, months,
});

// ---------------------------------------------------------------------------------------------
// Breakdown: what the change between today and the horizon is made of

export function breakdown(ctx, projection, today) {
  const horizon = projection.months.length - 1;
  const sum = (key) => projection.months.slice(1).reduce((t, m) => t + m[key], 0n);
  const planned = [];
  for (const item of ctx.planned) {
    const code = item.currency || ctx.base;
    const dates = occurrences(item, today, horizon);
    if (!dates.length) continue;
    let total = 0n;
    for (const date of dates) {
      const signed = BigInt(signedAmount(item, date));
      const minor = minorOf(convert(ctx, Dec.int(abs(signed)), code));
      total += signed < 0n ? -minor : minor;
    }
    planned.push({ id: item.id, name: item.name, total, times: dates.length });
  }
  planned.sort((a, b) => (abs(b.total) > abs(a.total) ? 1 : abs(b.total) < abs(a.total) ? -1 : 0));

  const accounts = [];
  for (const acct of ctx.accounts) {
    if (acct.latestMinor == null) continue;
    const line = lineFor(ctx, acct, today, horizon);
    const rest = line.months.slice(1);
    const now = inBase(ctx, line.now, acct.currency), then = inBase(ctx, line.atHorizon, acct.currency);
    accounts.push({
      id: acct.id, name: acct.name, kind: acct.kind, now, then, change: then - now,
      growth: inBase(ctx, rest.reduce((t, m) => t + m.growth, 0n), acct.currency),
      paid: inBase(ctx, rest.reduce((t, m) => t + m.paid, 0n), acct.currency),
      retained: inBase(ctx, rest.reduce((t, m) => t + m.retained, 0n), acct.currency),
    });
  }
  accounts.sort((a, b) => {
    const l = abs(a.change), r = abs(b.change);
    if (l !== r) return l > r ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
  return {
    horizonMonths: horizon, income: sum('income'), spending: sum('spending'), growth: sum('growth'), interest: sum('interest'),
    interestEarned: sum('earned'), interestCharged: sum('charged'), planned, accounts,
    plannedTotal: planned.reduce((t, p) => t + p.total, 0n),
  };
}

/** What is owned at the horizon, account by account, and the rest of the line in no account. */
export function horizonHoldings(b, ctx, projection) {
  const month = projection.months[projection.months.length - 1].month;
  const birth = birthOf(ctx.assumptions);
  const byId = new Map(ctx.accounts.map((a) => [a.id, a]));
  const accounts = b.accounts.reduce((t, a) => t + a.then, 0n);
  const holdings = b.accounts.filter((a) => a.kind === 'ASSET' && a.then > 0n).map((a) => {
    const acct = byId.get(a.id);
    const unlock = acct ? unlockMonth(acct, birth) : null;
    return { id: a.id, name: a.name, value: a.then, reachable: !(unlock && month < unlock) };
  });
  return { month, holdings, unassigned: projection.months[projection.months.length - 1].netWorth - accounts,
    hasLocked: holdings.some((h) => !h.reachable) };
}

/** How the net worth figure is made: every account in the base, owned, owed (NetWorthSum). */
export function netWorthSum(ctx) {
  const assets = [], debts = [];
  let owned = 0n, owed = 0n;
  for (const acct of ctx.accounts) {
    if (acct.latestMinor == null) continue;
    const own = BigInt(acct.latestMinor);
    const value = own === 0n ? 0n : minorOf(convert(ctx, Dec.int(own), acct.currency));
    const line = { id: acct.id, name: acct.name, currency: acct.currency, own: abs(own), inBase: value,
      rate: acct.currency === ctx.base ? null : String(ctx.rates[acct.currency]) };
    if (acct.kind === 'ASSET') { assets.push(line); owned += value; } else { debts.push(line); owed += value; }
  }
  return { base: ctx.base, assets, debts, owned, owed, netWorth: owned - owed };
}

/** The share of net worth in each currency, signed (CurrencyExposure.stakes). */
export function currencyStakes(ctx) {
  const by = new Map();
  for (const acct of ctx.accounts) {
    if (acct.latestMinor == null) continue;
    const magnitude = convert(ctx, Dec.int(acct.latestMinor), acct.currency);
    const signed = acct.kind === 'ASSET' ? magnitude : magnitude.negate();
    by.set(acct.currency, (by.get(acct.currency) || Dec.int(0)).add(signed));
  }
  const total = [...by.values()].reduce((t, v) => t.add(v), Dec.int(0));
  return [...by.entries()].map(([code, amount]) => ({
    code, minorInBase: minorOf(amount),
    share: total.isZero() ? null : amount.div(total).shift(2).round(1).toString(),
  })).sort((a, b) => (abs(b.minorInBase) > abs(a.minorInBase) ? 1 : abs(b.minorInBase) < abs(a.minorInBase) ? -1 : 0));
}

/** Today's net worth were one currency to move against the base by a percentage. */
export function shockedNetWorth(ctx, code, movePct, today) {
  if (ctx.rates[code] == null) throw new ProjectionError('missingRate', code);
  const rate = dec(ctx.rates[code]).mul(Dec.int(1).add(dec(movePct).div(Dec.int(100))));
  return project({ ...ctx, rates: { ...ctx.rates, [code]: rate } }, today, 0).months[0].netWorth;
}

/** A group of accounts as a line: each member's own projection, in the base, month by month. */
export function groupLine(accountIds, ctx, projection, today) {
  const wanted = new Set(accountIds);
  const totals = projection.months.map(() => 0n);
  for (const acct of ctx.accounts) {
    if (!wanted.has(acct.id) || acct.latestMinor == null) continue;
    const line = lineFor(ctx, acct, today, projection.months.length - 1);
    line.months.forEach((m, i) => { if (i < totals.length) totals[i] += inBase(ctx, m.value, acct.currency); });
  }
  return totals;
}

/** Planned money landing in the next thirty days, soonest first (ComingUp.landings). */
export function comingUp(ctx, today, days = 30) {
  const out = [];
  const months = Math.floor(days / 28) + 2;
  const t = Date.parse(`${today}T00:00:00Z`);
  for (const item of ctx.planned) {
    const code = item.currency || ctx.base;
    for (const date of occurrences(item, today, months)) {
      const ahead = Math.round((Date.parse(`${date}T00:00:00Z`) - t) / 86400000);
      if (ahead < 1 || ahead > days) continue;
      const signed = BigInt(signedAmount(item, date));
      const minor = minorOf(convert(ctx, Dec.int(abs(signed)), code));
      out.push({ itemId: item.id, name: item.name, date, amount: signed < 0n ? -minor : minor });
    }
  }
  return out.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : abs(b.amount) > abs(a.amount) ? 1 : abs(b.amount) < abs(a.amount) ? -1 : 0));
}

/** Months since the newest balance on any account in use, or null with none (BalanceAge). */
export function monthsSinceNewestBalance(ctx, today) {
  const dates = ctx.accounts.map((a) => a.latestDate).filter(Boolean).sort();
  if (!dates.length) return null;
  return Math.max(0, monthsSince(today.slice(0, 7), dates[dates.length - 1].slice(0, 7)));
}

/** Next month's savings as a share of income, or null with no income (Projection.savingsRate). */
export function savingsRate(projection, incomeMinor) {
  if (!(BigInt(incomeMinor) > 0n)) return null;
  const savings = projection.months.length > 1 ? projection.months[1].savings : 0n;
  return Dec.int(savings).div(Dec.int(incomeMinor)).shift(2);
}

/** Change over the horizon as a share of today's magnitude, or null at zero. */
export function changePercent(projection) {
  const now = projection.months[0].netWorth, then = projection.months[projection.months.length - 1].netWorth;
  if (now === 0n) return null;
  return Dec.int(then - now).div(Dec.int(abs(now))).shift(2);
}
