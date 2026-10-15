// node --test web/tests/projection.test.mjs
// The website's projection against the app's: its verification fixture to the minor unit, and a
// corpus of made-up files the app itself projected (projection-corpus.json, made by the app's
// test ProjectionCorpusTests). Every figure here is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { project, Dec } from '../projection.mjs';

const fixture = {
  base: 'AED', scales: { AED: 2 }, rates: {},
  accounts: [
    { kind: 'ASSET', currency: 'AED', invested: true, latestMinor: 100_000_00, income: null },
    { kind: 'ASSET', currency: 'AED', invested: false, latestMinor: 300_000_00, income: null },
  ],
  assumptions: { incomeMinor: 45_000_00, spendingMinor: 22_000_00, raisePct: '5', raiseMonth: 4, spendingGrowthPct: '3',
    returnPct: '7', horizonMonths: 12, birthYear: null, birthMonth: null },
  planned: [],
};

test("the app's verification fixture, to the minor unit", () => {
  const p = project(fixture, '2026-09-08');
  assert.deepEqual(p.months.map((m) => m.netWorth), [
    40_000_000n, 42_358_333n, 44_717_007n, 47_076_023n, 49_435_383n, 51_795_089n, 54_155_144n,
    56_740_549n, 59_326_306n, 61_912_418n, 64_498_886n, 67_085_713n, 69_672_901n,
  ]);
  assert.equal(p.months[6].income, 45_000_00n);
  assert.equal(p.months[7].income, 47_250_00n);
});

test('decimal: rounds halves away from zero; a quotient is cut off', () => {
  assert.equal(Dec.of('2.5').round(0).toBigInt(), 3n);
  assert.equal(Dec.of('-2.5').round(0).toBigInt(), -3n);
  assert.equal(Dec.int(2).div(Dec.int(3)).mag, 66666666666666666666666666666666666666n, 'cut off, as Foundation does, not rounded');
});

const corpusPath = new URL('./projection-corpus.json', import.meta.url);
test('the corpus the app projected, every month of every file', { skip: !existsSync(corpusPath) }, () => {
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
  let compared = 0;
  for (const c of corpus.cases) {
    const p = project(c.context, c.today);
    for (const [i, want] of c.months.entries()) {
      const got = p.months[i];
      for (const key of Object.keys(want)) {
        assert.equal(String(got[key]), String(want[key]), `${c.name} month ${i} ${key}`);
        compared++;
      }
    }
  }
  assert.ok(compared > 1000, `compared ${compared} figures`);
});

// Apple's own Decimal, asked 1,449 sums, differences, products, quotients and powers of random
// long numbers on macOS 15 (decimal-probe.txt): each line "OP a expA b expB result" or
// "P base n result". The port has to give the same mantissa and exponent, not just the value.
const probePath = new URL('./decimal-probe.txt', import.meta.url);
test("decimal: Apple's results for random long numbers, every one", { skip: !existsSync(probePath) }, () => {
  const parse = (s) => { const neg = s.startsWith('-'); s = s.replace('-', ''); const [w, f = ''] = s.split('.'); return new Dec(neg, BigInt(w + f), -f.length); };
  const same = (a, b) => a.neg === b.neg && a.mag === b.mag && a.e === b.e;
  let n = 0;
  for (const line of readFileSync(probePath, 'utf8').trim().split('\n')) {
    const p = line.split(' ');
    let got, want;
    if (p[0] === 'P') { got = Dec.of(p[1]).pow(Number(p[2])); want = parse(p[3]); }
    else {
      const a = Dec.of(p[1]).shift(Number(p[2])), b = Dec.of(p[3]).shift(Number(p[4]));
      want = parse(p[5]);
      got = p[0] === 'M' ? a.mul(b) : p[0] === 'A' ? a.add(b) : p[0] === 'S' ? a.sub(b) : a.div(b);
    }
    assert.ok(same(got, want), line);
    n++;
  }
  assert.ok(n > 1400);
});
