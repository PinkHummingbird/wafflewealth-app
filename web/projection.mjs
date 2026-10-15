/* WaffleWealth on the web: the projection, worked out here exactly as the app works it out.

   A port of the app's ProjectionEngine, kept to the letter: two pools (invested and cash),
   income and spending as step functions (the raise in its month, spending growth by projection
   year), the return on the invested pool only, planned items in the month they land with their
   yearly rise, accounts that pay interest followed one by one, and money that can't be reached
   yet. Nothing here is stored: like the app, the page works it out again every time it is shown.

   **The arithmetic is the app's.** The app keeps its pools as Foundation `Decimal` (a mantissa
   that fits in 128 bits, so 38 or 39 significant digits) and rounds to minor units once per
   month, halves away from zero. `Dec` below does the same with BigInt, so the two agree to the
   minor unit; web/tests/projection.test.mjs holds the app's own fixture and a corpus of
   projections the app itself worked out (web/tests/projection-corpus.json). */

// ---------------------------------------------------------------------------------------------
// Decimal, as Foundation's

/* A port of the Decimal arithmetic macOS 15 ships (swift-foundation 6.1,
   FoundationEssentials/Decimal/Decimal+Math.swift), step for step, because "close" is not good
   enough: the app's pools are carried unrounded and a value that sits on a half is rounded the
   way these steps leave it. What it does, and what this copies:
   - a value is a sign, a mantissa of at most eight 16-bit words, and an exponent, and every
     result is compacted (trailing zero digits moved into the exponent);
   - a mantissa too long for eight words is cut down, four digits at a time while it is over
     nine words and then one at a time, and the digits are dropped: the routine works out a
     rounded value and then returns the unrounded one, so the effect is truncation;
   - adding first brings the exponents together (NSDecimalNormalize): the operand with the
     larger exponent is scaled down exactly if it fits, and otherwise by an estimate of its
     headroom, floor((8 − words) × 4.81647993) digits, the other operand's digits beyond that
     being cut off (and if that leaves it zero, it is dropped and nothing is scaled);
   - dividing multiplies the dividend by 10^38, divides as integers, and cuts the quotient down;
   - powers are taken by Foundation's own sequence of squarings.
   Rounding to a number of decimal places (`round`) rounds halves away from zero, as it should. */

const TEN = 10n;
const pow10 = (n) => TEN ** BigInt(n);
const MAX_WORDS = 8;
const words = (mag) => (mag === 0n ? 0 : Math.ceil(mag.toString(2).length / 16));

/** Truncating fit to eight words: [mantissa, digits dropped]. */
function fitMantissa(mag) {
  let k = 0;
  while (words(mag) > MAX_WORDS + 1) { mag /= 10000n; k += 4; }
  while (words(mag) > MAX_WORDS) { mag /= TEN; k += 1; }
  return [mag, k];
}

export class Dec {
  /** From a sign, a magnitude and an exponent, compacted as every Foundation result is. */
  constructor(neg, mag, e) {
    mag = BigInt(mag);
    if (mag === 0n) { this.neg = false; this.mag = 0n; this.e = 0; return; }
    while (mag % TEN === 0n) { mag /= TEN; e += 1; }
    this.neg = Boolean(neg); this.mag = mag; this.e = e;
  }

  static int(n) { const v = BigInt(n); return new Dec(v < 0n, v < 0n ? -v : v, 0); }

  /** Plain notation: "5", "-3.25". */
  static of(text) {
    const s = String(text).trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`not a plain decimal: ${text}`);
    const [whole, frac = ''] = s.replace('-', '').split('.');
    return new Dec(s.startsWith('-'), BigInt(whole + frac), -frac.length);
  }

  isZero() { return this.mag === 0n; }
  sign() { return this.mag === 0n ? 0 : this.neg ? -1 : 1; }
  negate() { return this.mag === 0n ? this : new Dec(!this.neg, this.mag, this.e); }

  /** NSDecimalNormalize: returns [a, b] with one exponent, as plain records (not compacted). */
  static normalize(a, b) {
    let x = { neg: a.neg, mag: a.mag, e: a.e };
    let y = { neg: b.neg, mag: b.mag, e: b.e };
    let diff = x.e - y.e;
    if (diff === 0) return [x, y];
    let swapped = false;
    if (diff < 0) { [x, y] = [y, x]; diff = -diff; swapped = true; }
    // x has the larger exponent: scale it down to y's, exactly, if that fits.
    const exact = x.mag * pow10(diff);
    if (words(exact) <= MAX_WORDS) {
      x.mag = exact; x.e = y.e;
    } else {
      const maxPower = Math.floor((MAX_WORDS - words(x.mag)) * 4.81647993);
      const p = maxPower - diff;
      y.mag = p < 0 ? y.mag / pow10(-p) : y.mag * pow10(p);
      y.e -= p;
      if (y.mag !== 0n) { x.mag *= pow10(maxPower); x.e -= maxPower; } else { y.e = x.e; }
    }
    return swapped ? [y, x] : [x, y];
  }

  add(o) {
    if (this.mag === 0n) return o;
    if (o.mag === 0n) return this;
    const [a, b] = Dec.normalize(this, o);
    if (a.mag === 0n) return new Dec(b.neg, b.mag, b.e);
    if (b.mag === 0n) return new Dec(a.neg, a.mag, a.e);
    if (a.neg === b.neg) {
      let [mag, k] = [a.mag + b.mag, 0];
      if (words(mag) > MAX_WORDS) [mag, k] = fitMantissa(mag);
      return new Dec(a.neg, mag, a.e + k);
    }
    if (a.mag === b.mag) return Dec.int(0);
    return a.mag > b.mag ? new Dec(a.neg, a.mag - b.mag, a.e) : new Dec(b.neg, b.mag - a.mag, a.e);
  }

  sub(o) { return this.add(o.negate()); }

  mul(o) {
    if (this.mag === 0n || o.mag === 0n) return Dec.int(0);
    let [mag, k] = [this.mag * o.mag, 0];
    if (words(mag) > MAX_WORDS) [mag, k] = fitMantissa(mag);
    return new Dec(this.neg !== o.neg, mag, this.e + o.e + k);
  }

  div(o) {
    if (o.mag === 0n) throw new Error('division by zero');
    if (this.mag === 0n) return Dec.int(0);
    let a = { neg: this.neg, mag: this.mag, e: this.e };
    let b = { neg: o.neg, mag: o.mag, e: o.e };
    if (a.e - b.e >= 19) {
      const [na, nb] = Dec.normalize(this, o);
      if (na.mag !== 0n && nb.mag !== 0n) { a = na; b = nb; }
    }
    const [mag, k] = fitMantissa((a.mag * pow10(38)) / b.mag);
    return new Dec(a.neg !== b.neg, mag, a.e - b.e - 38 + k);
  }

  /** Foundation's _power, its own order of squarings. */
  pow(n) {
    if (n === 0) return Dec.int(1);
    if (this.mag === 0n) return Dec.int(0);
    let power = n;
    let result = this;
    let temporary = Dec.int(1);
    while (power > 1) {
      if (power & 1) { temporary = temporary.mul(result); power -= 1; }
      if (power !== 0) { result = result.mul(result); power = Math.floor(power / 2); }
    }
    return temporary.mul(result);
  }

  /** × 10^power, exact. */
  shift(power) { return this.mag === 0n ? this : new Dec(this.neg, this.mag, this.e + power); }

  /** Rounded to `scale` fractional digits, halves away from zero. */
  round(scale = 0) {
    const s = scale + this.e;
    if (s >= 0) return this;
    const d = pow10(-s);
    let q = this.mag / d;
    if (2n * (this.mag % d) >= d) q += 1n;
    return new Dec(this.neg, q, -scale);
  }

  /** The exact integer, as BigInt, once rounded to scale 0. */
  toBigInt() {
    const r = this.round(0);
    const v = r.e >= 0 ? r.mag * pow10(r.e) : r.mag / pow10(-r.e);
    return r.neg ? -v : v;
  }
}

const ZERO = Dec.int(0);

// ---------------------------------------------------------------------------------------------
// Months and days

const monthIndex = (ym) => { const [y, m] = ym.split('-').map(Number); return y * 12 + (m - 1); };
const monthOf = (index) => `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
export const addMonthsToMonth = (ym, n) => monthOf(monthIndex(ym) + n);
const monthsSince = (a, b) => monthIndex(a) - monthIndex(b);

function addMonthsToDay(day, n) {
  const target = addMonthsToMonth(day.slice(0, 7), n);
  const [y, m] = target.split('-').map(Number);
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${target}-${String(Math.min(Number(day.slice(8, 10)), length)).padStart(2, '0')}`;
}

const STEP = { ONCE: 0, MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 };
const PAY_MONTHS = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 };

/** Every date a planned item lands on, after today and to the end of `horizon` months. */
export function occurrences(item, today, horizon) {
  if (horizon <= 0) return [];
  const last = addMonthsToMonth(today.slice(0, 7), horizon);
  const step = STEP[item.frequency] || 0;
  if (!step) return item.firstDate > today && item.firstDate.slice(0, 7) <= last ? [item.firstDate] : [];
  const behind = monthsSince(today.slice(0, 7), item.firstDate.slice(0, 7));
  let index = behind > 0 ? Math.floor(behind / step) : 0;
  const dates = [];
  for (;;) {
    const date = addMonthsToDay(item.firstDate, index * step);
    if (date.slice(0, 7) > last) break;
    if (item.endsOn && date > item.endsOn) break;
    if (date > today) dates.push(date);
    index += 1;
  }
  return dates;
}

/** One occurrence's amount: grown by the yearly rise for each full year since the first, rounded once. */
function signedAmount(item, date) {
  const signed = item.direction === 'IN' ? item.amountMinor : -item.amountMinor;
  const growth = Dec.of(item.growthPct || '0');
  if (growth.isZero()) return signed;
  const years = Math.max(0, Math.floor(monthsSince(date.slice(0, 7), item.firstDate.slice(0, 7)) / 12));
  if (years <= 0) return signed;
  const factor = Dec.int(1).add(growth.div(Dec.int(100))).pow(years);
  const grown = Dec.int(item.amountMinor).mul(factor).round(0).toBigInt();
  return item.direction === 'IN' ? grown : -grown;
}

// ---------------------------------------------------------------------------------------------
// The engine

export class ProjectionError extends Error {
  constructor(kind, code) { super(kind === 'missingRate' ? `No rate for ${code}` : kind === 'unknownCurrency' ? `Unknown currency ${code}` : kind); this.kind = kind; this.code = code; }
}

/**
 * The context, in plain values (built from iCloud's records by `contextFrom`):
 * - base, scales: { code: decimals }, rates: { code: "decimal string" } (base absent)
 * - accounts: [{ kind, currency, invested, latestMinor (BigInt or number, ≥ 0) or null,
 *     income: { basis: 'RATE'|'AMOUNT', ratePct, amountMinor, frequency, reinvested } or null,
 *     availableFromAge, availableFromMonth }]
 * - assumptions: { incomeMinor, spendingMinor, raisePct, raiseMonth, spendingGrowthPct,
 *     returnPct, horizonMonths, birthYear, birthMonth }
 * - planned: [{ direction, amountMinor, currency (null = base), firstDate, frequency, endsOn, growthPct }]
 */
export function project(ctx, today, monthCount = ctx.assumptions.horizonMonths) {
  const base = ctx.base;
  const scale = ctx.scales[base];
  if (scale == null) throw new ProjectionError('unknownCurrency', base);
  const a = ctx.assumptions;

  const convert = (amount, code) => {
    if (ctx.scales[code] == null) throw new ProjectionError('unknownCurrency', code);
    if (code === base) return amount;
    if (ctx.rates[code] == null) throw new ProjectionError('missingRate', code);
    return amount.mul(Dec.of(ctx.rates[code])).shift(scale - ctx.scales[code]).round(0);
  };
  const minor = (d) => d.round(0).toBigInt();

  const startMonth = today.slice(0, 7);
  const birth = a.birthYear != null && a.birthMonth != null && a.birthYear >= 1900 && a.birthYear <= 2100 && a.birthMonth >= 1 && a.birthMonth <= 12
    ? `${String(a.birthYear).padStart(4, '0')}-${String(a.birthMonth).padStart(2, '0')}` : null;

  let invested = ZERO;
  let cash = ZERO;
  const tracked = [];
  for (const acct of ctx.accounts) {
    const latest = acct.latestMinor == null ? 0n : BigInt(acct.latestMinor);
    const magnitude = latest === 0n ? ZERO : convert(Dec.int(latest), acct.currency);
    const signed = acct.kind === 'ASSET' ? magnitude : magnitude.negate();
    if (acct.invested) invested = invested.add(signed); else cash = cash.add(signed);
    let unlock = null;
    if (acct.availableFromAge != null) {
      if (birth) unlock = addMonthsToMonth(birth, acct.availableFromAge * 12);
    } else if (acct.availableFromMonth) {
      unlock = acct.availableFromMonth;
    }
    let unlocksAt = unlock ? monthsSince(unlock, startMonth) : null;
    if (unlocksAt != null && unlocksAt <= 0) unlocksAt = null;
    const income = acct.income;
    if (!income && unlocksAt == null) continue;
    let fixed = ZERO;
    if (income && income.basis === 'AMOUNT' && Number(income.amountMinor) !== 0) {
      const m = convert(Dec.int(income.amountMinor), acct.currency);
      fixed = acct.kind === 'ASSET' ? m : m.negate();
    }
    tracked.push({ invested: acct.invested, income, basis: signed, fixed, unlocksAt });
  }
  const lockedAt = (offset) => tracked.reduce((t, x) => (x.unlocksAt != null && offset < x.unlocksAt ? t.add(x.basis) : t), ZERO);

  const months = [];
  let previous = minor(invested.add(cash));
  const lockedNow = lockedAt(0);
  months.push({ offset: 0, month: startMonth, netWorth: previous, invested: minor(invested), cash: minor(cash),
    locked: minor(lockedNow), available: minor(invested.add(cash).sub(lockedNow)),
    income: 0n, spending: 0n, savings: 0n, growth: 0n, interest: 0n, planned: 0n, change: 0n });

  const baseIncome = Dec.int(a.incomeMinor);
  const baseSpending = Dec.int(a.spendingMinor);
  const hundred = Dec.int(100);
  const raiseFactor = Dec.int(1).add(Dec.of(a.raisePct).div(hundred));
  const spendingFactor = Dec.int(1).add(Dec.of(a.spendingGrowthPct).div(hundred));
  const monthlyReturn = Dec.of(a.returnPct).div(hundred).div(Dec.int(12));
  let raises = 0;
  let years = -1;

  const plannedByMonth = new Map();
  for (const item of ctx.planned) {
    const code = item.currency || base;
    for (const date of occurrences(item, today, monthCount)) {
      const offset = Math.max(1, monthsSince(date.slice(0, 7), startMonth));
      const signed = BigInt(signedAmount(item, date));
      const magnitude = convert(Dec.int(signed < 0n ? -signed : signed), code).toBigInt();
      plannedByMonth.set(offset, (plannedByMonth.get(offset) || 0n) + (signed < 0n ? -magnitude : magnitude));
    }
  }

  let savings = ZERO;
  let incomeM = 0n, spendingM = 0n, savingsM = 0n;
  for (let m = 1; m <= monthCount; m++) {
    const month = addMonthsToMonth(startMonth, m);
    let stepped = false;
    if (Number(month.slice(5, 7)) === a.raiseMonth) { raises += 1; stepped = true; }
    if (Math.floor((m - 1) / 12) !== years) { years = Math.floor((m - 1) / 12); stepped = true; }
    if (stepped) {
      const income = baseIncome.mul(raiseFactor.pow(raises));
      const spending = baseSpending.mul(spendingFactor.pow(years));
      savings = income.sub(spending);
      incomeM = minor(income); spendingM = minor(spending); savingsM = minor(savings);
    }
    const growth = monthlyReturn.isZero() ? ZERO : invested.mul(monthlyReturn);
    const planned = Dec.int(plannedByMonth.get(m) || 0n);
    invested = invested.add(growth);
    cash = cash.add(savings).add(planned);

    let interest = ZERO;
    for (const t of tracked) {
      if (t.invested) t.basis = t.basis.add(t.basis.mul(monthlyReturn));
      if (!t.income) continue;
      const every = PAY_MONTHS[t.income.frequency] || 12;
      if (!(m > 0 && m % every === 0)) continue;
      const payment = t.income.basis === 'AMOUNT' ? t.fixed
        : t.basis.mul(Dec.of(t.income.ratePct || '0')).mul(Dec.int(every)).div(Dec.int(1200));
      interest = interest.add(payment);
      if (t.income.reinvested) t.basis = t.basis.add(payment);
      if (t.income.reinvested && t.invested) invested = invested.add(payment); else cash = cash.add(payment);
    }
    const lockedValue = lockedAt(m);
    const netWorth = minor(invested.add(cash));
    const untracked = tracked.length === 0;
    months.push({
      offset: m, month, netWorth, invested: minor(invested), cash: minor(cash),
      locked: untracked ? 0n : minor(lockedValue),
      available: untracked ? netWorth : minor(invested.add(cash).sub(lockedValue)),
      income: incomeM, spending: spendingM, savings: savingsM,
      growth: monthlyReturn.isZero() ? 0n : minor(growth),
      interest: untracked ? 0n : minor(interest),
      planned: plannedByMonth.get(m) || 0n,
      change: netWorth - previous,
    });
    previous = netWorth;
  }
  return { base, scale, months };
}
