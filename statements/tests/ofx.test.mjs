// node --test 'statements/tests/*.test.mjs'
// A bank's download, OFX in either version. The same made-up files as the app's OFXTests, with
// the same figures expected to the minor unit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOfxStatement, ofxText, isOfxName, looksLikeOfx } from '../readers.js';

const checking = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260930120000[-5:EST]
<LANGUAGE>ENG<FI><ORG>Maple Leaf Savings<FID>9999</FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>USD
<BANKACCTFROM><BANKID>000000001<ACCTID>000123456789<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260801<DTEND>20260930
<STMTTRN><TRNTYPE>CHECK<DTPOSTED>20260915<TRNAMT>-250.00<FITID>F3<CHECKNUM>1042<NAME>Rent</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260901120000.000[-5:EST]<TRNAMT>3000.00<FITID>F2<NAME>Payroll<MEMO>September</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260820<TRNAMT>-45.67<FITID>F1<NAME>Corner Grocery<MEMO>Corner Grocery</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>4204.33<DTASOF>20260930</LEDGERBAL>
<AVAILBAL><BALAMT>4100.00<DTASOF>20260930</AVAILBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const card = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <SIGNONMSGSRSV1><SONRS><FI><ORG>B1</ORG><FID>10898</FID></FI></SONRS></SIGNONMSGSRSV1>
  <CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>
    <CURDEF>usd</CURDEF>
    <CCACCTFROM><ACCTID>4111000000004321</ACCTID></CCACCTFROM>
    <BANKTRANLIST>
      <DTSTART>20260901</DTSTART><DTEND>20260930</DTEND>
      <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260905</DTPOSTED><DTUSER>20260903</DTUSER><TRNAMT>-20.00</TRNAMT><FITID>a</FITID><NAME>Waffles &amp; Co</NAME></STMTTRN>
      <STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260910</DTPOSTED><TRNAMT>100.00</TRNAMT><FITID>b</FITID><NAME>Payment, thank you</NAME></STMTTRN>
    </BANKTRANLIST>
    <LEDGERBAL><BALAMT>-523.10</BALAMT><DTASOF>20260930</DTASOF></LEDGERBAL>
  </CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>
</OFX>`;

test('ofx: a checking download is one account, oldest line first, the opening worked back', () => {
  const s = readOfxStatement(checking, { fileName: 'export.qfx' });
  assert.equal(s.reader, 'OFX');
  assert.equal(s.institution, 'Maple Leaf Savings');
  assert.deepEqual(s.period, { from: '2026-08-01', to: '2026-09-30' });
  assert.equal(s.accounts.length, 1);
  const a = s.accounts[0];
  assert.equal(a.name, 'Maple Leaf Savings ·· 6789');
  assert.equal(a.ref, 'OFX:000123456789');
  assert.deepEqual(a.numbers, ['000123456789']);
  assert.equal(a.type, 'current');
  assert.equal(a.owed, false);
  assert.equal(a.currency, 'USD');
  assert.deepEqual(a.lines.map((l) => l.amount), [-4567, 300000, -25000]);
  assert.deepEqual(a.lines.map((l) => l.description), ['Corner Grocery', 'Payroll · September', 'Rent · Cheque 1042']);
  assert.deepEqual(a.lines.map((l) => l.ref), ['F1', 'F2', 'F3']);
  assert.equal(a.lines[1].date, '2026-09-01');
  assert.equal(a.closing, 420433);
  assert.equal(a.opening, 150000);
  assert.equal(a.openingWorkedOut, true);
  assert.equal(a.check.ok, false);
  assert.equal(a.check.checked, false);
});

test('ofx: a card download is owed, its balance turned round, a code in ORG is no name', () => {
  const s = readOfxStatement(card);
  assert.equal(s.institution, null);
  const a = s.accounts[0];
  assert.equal(a.name, 'Card ·· 4321');
  assert.equal(a.type, 'card');
  assert.equal(a.owed, true);
  assert.equal(a.currency, 'USD');
  assert.equal(a.closing, 52310);
  assert.equal(a.opening, 60310);
  assert.deepEqual(a.lines.map((l) => l.description), ['Waffles & Co', 'Payment, thank you']);
  assert.equal(a.lines[0].madeOn, '2026-09-03');
  assert.equal(a.lines[0].date, '2026-09-05');
});

test('ofx: several accounts in one file, a comma before the decimals, a Latin-1 name', () => {
  const text = `OFXHEADER:100
CHARSET:1252
<OFX><SIGNONMSGSRSV1><SONRS><FI><ORG>Banque Exemple</FI></SONRS></SIGNONMSGSRSV1><BANKMSGSRSV1>
<STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM><ACCTID>FR7600001111<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260901<DTEND>20260930
<STMTTRN><DTPOSTED>20260902<TRNAMT>-12,50<FITID>x<NAME>Café</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>87,50<DTASOF>20260930</LEDGERBAL></STMTRS></STMTTRNRS>
<STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM><ACCTID>FR7600002222<ACCTTYPE>SAVINGS</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260901<DTEND>20260930</BANKTRANLIST><LEDGERBAL><BALAMT>1000.00<DTASOF>20260930</LEDGERBAL></STMTRS></STMTTRNRS>
</BANKMSGSRSV1></OFX>`;
  // Encoded as Windows Latin-1, as such a file is sent: é is one byte, 0xE9.
  const bytes = Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
  const s = readOfxStatement(ofxText(bytes));
  assert.deepEqual(s.accounts.map((a) => a.name), ['Banque Exemple ·· 1111', 'Banque Exemple ·· 2222']);
  assert.deepEqual(s.accounts.map((a) => a.type), ['current', 'savings']);
  assert.deepEqual(s.accounts[0].lines.map((l) => l.amount), [-1250]);
  assert.deepEqual(s.accounts[0].lines.map((l) => l.description), ['Café']);
  assert.deepEqual(s.accounts.map((a) => a.closing), [8750, 100000]);
  assert.equal(s.accounts[1].opening, 100000);
});

test('ofx: a file that is not OFX, or holds no statement, is not read', () => {
  assert.equal(readOfxStatement('Date,Description,Amount\n2026-09-01,Coffee,-3.00').unknownOfx, true);
  assert.equal(readOfxStatement('OFXHEADER:100\n<OFX><SIGNONMSGSRSV1></SIGNONMSGSRSV1></OFX>').unknownOfx, true);
  assert.equal(isOfxName('Export.QFX'), true);
  assert.equal(isOfxName('statement.pdf'), false);
  assert.equal(looksLikeOfx(checking), true);
});
