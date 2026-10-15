// node --test 'statements/tests/*.test.mjs'
// Putting a reading right in the review: the same made-up figures as the app's
// StatementCorrectionTests, with the same results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, correctLine, leaveOutLine, linesOff, correctedCount, readOfxStatement } from '../readers.js';

/** 1,000.00 to 1,200.00, with the 200.00 out misread as 2,000.00. */
function misread() {
  const acct = {
    owed: false, opening: 100000, closing: 120000, lines: [
      { date: '2026-09-01', description: 'Pay', amount: 50000, running: 150000, label: null },
      { date: '2026-09-02', description: 'Shop', amount: -200000, running: 130000, label: 'out' },
      { date: '2026-09-03', description: 'Cafe', amount: -10000, running: 120000, label: null },
    ],
  };
  acct.check = check(acct);
  return acct;
}

test('correct: a misread figure is marked, then put right', () => {
  const a = misread();
  assert.equal(a.check.ok, false);
  assert.equal(a.check.checked, true);
  assert.deepEqual([...linesOff(a)], [1]);
  correctLine(a, 1, -20000, 130000);
  assert.equal(a.check.ok, true);
  assert.equal(linesOff(a).size, 0);
  assert.equal(a.lines[1].corrected, true);
  assert.equal(correctedCount(a), 1);
});

test('correct: a stray row is left out', () => {
  const a = misread();
  correctLine(a, 1, -20000, 130000);
  a.lines.splice(3, 0, { date: null, description: 'Total', amount: 30000, running: null, label: null });
  a.check = check(a);
  assert.equal(a.check.ok, false);
  leaveOutLine(a, 3);
  assert.equal(a.check.ok, true);
  assert.equal(a.lines.length, 3);
  assert.equal(correctedCount(a), 2);
});

test('correct: a label follows the new sign, a move between accounts stays one', () => {
  const a = misread();
  correctLine(a, 1, 20000, null);
  assert.equal(a.lines[1].label, 'in');
  a.lines[2].label = 'own';
  correctLine(a, 2, 10000, null);
  assert.equal(a.lines[2].label, 'own');
  correctLine(a, 9, 1, null);
  leaveOutLine(a, -1);
  assert.equal(a.lines.length, 3);
});

test('correct: a worked-out balance follows the correction', () => {
  const card = { owed: true, opening: 0, closing: 5000, closingWorkedOut: true, lines: [{ amount: -5000, running: null }] };
  correctLine(card, 0, -500, null);
  assert.equal(card.closing, 500);
  const ofx = readOfxStatement(`OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD<BANKACCTFROM><ACCTID>000123456789<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260801<DTEND>20260930
<STMTTRN><DTPOSTED>20260820<TRNAMT>-45.67<FITID>F1<NAME>Corner Grocery</STMTTRN>
<STMTTRN><DTPOSTED>20260901<TRNAMT>3000.00<FITID>F2<NAME>Payroll</STMTTRN>
<STMTTRN><DTPOSTED>20260915<TRNAMT>-250.00<FITID>F3<NAME>Rent</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>4204.33<DTASOF>20260930</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`).accounts[0];
  correctLine(ofx, 0, -4500, null);
  assert.equal(ofx.closing, 420433);
  assert.equal(ofx.opening, 420433 - (-4500 + 300000 - 25000));
});
