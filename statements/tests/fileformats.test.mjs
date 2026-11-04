// node --test 'statements/tests/*.test.mjs'
// The bank files beside the PDF: MT940, CAMT.053 and .052, QIF, and any bank's CSV read from its
// header. The same made-up files as the app's FileFormatTests, with the same figures expected to
// the minor unit. Every file here is made up: the banks, the numbers and the lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readMt940Statement, readCamtStatement, readQifStatement, readCsvStatement, csvAmount, inCurrency,
  looksLikeMt940, looksLikeCamt, looksLikeQif, looksLikeOfx,
} from '../readers.js';

const amounts = (a) => a.lines.map((l) => l.amount);
const descriptions = (a) => a.lines.map((l) => l.description);

// ---------------------------------------------------------------------------------------------
// MT940

const mt940 = `{1:F01EXMPAEADAXXX0000000000}{2:I940EXMPAEADXXXXN}{4:
:20:STMT0831
:25:AE070331234567890123456
:28C:00031/001
:60F:C260731AED10000,00
:61:2608010801D250,00NTRFNONREF//B1
:86:/NAME/Desert Rent LLC/REMI/USTD//August rent/
:61:2608150815C3500,5NTRFPAY0815//B2
:86:?20Salary August?32Harbourside Example?33 Studio
:61:2608310901D12,34NCHGNONREF
:86:Account fee
:62F:C260831AED13238,16
-}`;

test('MT940: a statement is checked against its own balances', () => {
  const statement = readMt940Statement(mt940, { fileName: 'statement.sta' });
  assert.equal(statement.reader, 'MT940');
  assert.equal(statement.accounts.length, 1);
  const account = statement.accounts[0];
  assert.equal(account.name, 'Account ·· 3456');
  assert.equal(account.ref, 'MT940:AE070331234567890123456');
  assert.equal(account.currency, 'AED');
  assert.equal(account.opening, 1_000_000);
  assert.equal(account.closing, 1_323_816);
  assert.deepEqual(amounts(account), [-25_000, 350_050, -1_234]);
  assert.deepEqual(descriptions(account), [
    'Desert Rent LLC · August rent', 'Harbourside Example Studio · Salary August', 'Account fee']);
  assert.deepEqual(account.lines.map((l) => l.ref), [null, 'PAY0815', null]);
  // Booked on 1 September for a value date of 31 August.
  assert.equal(account.lines[2].date, '2026-09-01');
  assert.equal(account.lines[2].madeOn, '2026-08-31');
  assert.ok(account.check.ok);
  assert.deepEqual(statement.period, { from: '2026-08-01', to: '2026-08-31' });
});

test('MT940: daily statements of one account are one account', () => {
  const text = `:20:D1
:25:NL91EXMP0417164300
:60F:C260901EUR500,00
:61:260901C100,00NTRFREF1
:86:Gift
:62M:C260901EUR600,00
:20:D2
:25:NL91EXMP0417164300
:60M:C260901EUR600,00
:61:260902RD20,00NTRFREF2
:86:Refund of a fee
:62F:C260902EUR620,00`;
  const statement = readMt940Statement(text);
  assert.equal(statement.accounts.length, 1);
  const account = statement.accounts[0];
  // A reversed debit adds.
  assert.deepEqual(amounts(account), [10_000, 2_000]);
  assert.equal(account.opening, 50_000);
  assert.equal(account.closing, 62_000);
  assert.ok(account.check.ok);
  assert.equal(account.name, 'Account ·· 4300');
});

test('MT940: whole amounts, and the statement’s own words', () => {
  const text = `:20:D1
:25:NL91EXMP0417164300
:60F:C260901EUR500,
:61:260901C100,NTRFREF1
:86:Gift
:62F:C260901EUR600,00
:64:C260901EUR600,00
:86:Statement info for the owner
-}{5:{CHK:123456789ABC}}`;
  const account = readMt940Statement(text).accounts[0];
  assert.equal(account.opening, 50_000);
  assert.equal(account.closing, 60_000);
  assert.deepEqual(amounts(account), [10_000]);
  assert.deepEqual(descriptions(account), ['Gift']);
  assert.ok(account.check.ok);
});

// A customer reference with one slash is still a line; `:NS:` is a field of its own; German
// purpose pieces join without a space; ING's `/CNTP/` names the other side.
test('MT940: references, extra fields and the other side’s name', () => {
  const text = `:20:D1
:25:NL91EXMP0417164300
:60F:C260901EUR600,00
:61:260901C100,00NTRFREF1
:86:?20Woh?21nung September?32Example Haus
:61:260902D10,00NMSC/TRTP/SEPA
:NS:01Shop
:86:/CNTP/NL00EXMP0123456789/EXMPNL2A/Corner Grocer/REMI/USTD//Groceries/
:61:260903D5,00NMSCNONREF
:86:Caf&#xE9; Example
:62F:C260903EUR685,00`;
  const account = readMt940Statement(text).accounts[0];
  assert.deepEqual(amounts(account), [10_000, -1_000, -500]);
  assert.deepEqual(descriptions(account), ['Example Haus · Wohnung September', 'Corner Grocer · Groceries', 'Caf&#xE9; Example']);
  assert.equal(account.lines[1].ref, '/TRTP/SEPA');
  assert.ok(account.check.ok);
});

test('MT940: a line that can’t be read is said', () => {
  const text = ':20:D1\n:25:12345678\n:60F:C260901EUR600,00\n:61:260901C100,00NTRFREF1\n:86:Gift\n:61:garbled\n:86:Lost\n:62F:C260901EUR690,00\n';
  const account = readMt940Statement(text).accounts[0];
  assert.deepEqual(descriptions(account), ['Gift']);
  assert.deepEqual(account.notes, ['1 line could not be read']);
  assert.equal(account.check.ok, false);
});

test('MT940: text that isn’t MT940 is left alone', () => {
  const statement = readMt940Statement('Date,Amount\n2026-01-01,5');
  assert.equal(statement.reader, null);
  assert.equal(statement.accounts.length, 0);
  assert.equal(looksLikeMt940(mt940), true);
  assert.equal(looksLikeMt940('Date,Amount\n2026-01-01,5'), false);
});

// ---------------------------------------------------------------------------------------------
// CAMT

const camt053 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
<BkToCstmrStmt>
<GrpHdr><MsgId>M1</MsgId><CreDtTm>2026-09-01T06:00:00</CreDtTm></GrpHdr>
<Stmt>
<Id>S1</Id>
<FrToDt><FrDtTm>2026-08-01T00:00:00</FrDtTm><ToDtTm>2026-08-31T23:59:59</ToDtTm></FrToDt>
<Acct><Id><IBAN>CH9300762011623852957</IBAN></Id><Ccy>CHF</Ccy><Ownr><Nm>Sam Example</Nm></Ownr>
<Svcr><FinInstnId><BIC>EXMPCHZZ</BIC><Nm>Alpine Example Bank</Nm></FinInstnId></Svcr></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">2500.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-07-31</Dt></Dt></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">4180.25</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-08-31</Dt></Dt></Bal>
<Ntry><NtryRef>E1</NtryRef><Amt Ccy="CHF">1820.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts>
<BookgDt><Dt>2026-08-02</Dt></BookgDt><ValDt><Dt>2026-08-02</Dt></ValDt><AcctSvcrRef>R1</AcctSvcrRef>
<NtryDtls><TxDtls><AmtDtls><TxAmt><Amt Ccy="CHF">1820.00</Amt></TxAmt></AmtDtls>
<RltdPties><Cdtr><Nm>Lake Flats AG</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Rent August</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="CHF">3500.25</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
<BookgDt><Dt>2026-08-25</Dt></BookgDt><ValDt><Dt>2026-08-26</Dt></ValDt><AcctSvcrRef>R2</AcctSvcrRef>
<NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Example Studio GmbH</Nm></Dbtr><Cdtr><Nm>Sam Example</Nm></Cdtr></RltdPties>
<RmtInf><Ustrd>Salary</Ustrd><Ustrd>August</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="CHF">99.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2026-08-31</Dt></BookgDt>
<AddtlNtryInf>Card, pending</AddtlNtryInf></Ntry>
</Stmt>
</BkToCstmrStmt>
</Document>`;

test('CAMT: a camt.053 statement is checked, and pending lines wait', () => {
  const statement = readCamtStatement(camt053, { fileName: 'camt053.xml' });
  assert.equal(statement.reader, 'CAMT');
  assert.equal(statement.institution, 'Alpine Example Bank');
  assert.equal(statement.holder, 'Sam Example');
  assert.deepEqual(statement.period, { from: '2026-08-01', to: '2026-08-31' });
  const account = statement.accounts[0];
  assert.equal(account.name, 'Alpine Example Bank ·· 2957');
  assert.equal(account.ref, 'CAMT:CH9300762011623852957');
  assert.equal(account.currency, 'CHF');
  assert.equal(account.opening, 250_000);
  assert.equal(account.closing, 418_025);
  assert.deepEqual(amounts(account), [-182_000, 350_025]);
  assert.deepEqual(descriptions(account), ['Lake Flats AG · Rent August', 'Example Studio GmbH · Salary August']);
  assert.deepEqual(account.lines.map((l) => l.ref), ['R1', 'R2']);
  assert.equal(account.lines[1].madeOn, '2026-08-26');
  assert.ok(account.check.ok);
  assert.equal(looksLikeCamt(camt053), true);
});

test('CAMT: a prefixed camt.052 report without a closing works it out', () => {
  const text = `<n:Document xmlns:n="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08"><n:BkToCstmrAcctRpt><n:Rpt>
<n:Acct><n:Id><n:Othr><n:Id>12345678</n:Id></n:Othr></n:Id><n:Ccy>EUR</n:Ccy></n:Acct>
<n:Bal><n:Tp><n:CdOrPrtry><n:Cd>PRCD</n:Cd></n:CdOrPrtry></n:Tp><n:Amt Ccy="EUR">40.00</n:Amt><n:CdtDbtInd>DBIT</n:CdtDbtInd>
<n:Dt><n:DtTm>2026-10-01T00:00:00+02:00</n:DtTm></n:Dt></n:Bal>
<n:Ntry><n:Amt Ccy="EUR">100.00</n:Amt><n:CdtDbtInd>CRDT</n:CdtDbtInd><n:Sts><n:Cd>BOOK</n:Cd></n:Sts>
<n:BookgDt><n:DtTm>2026-10-02T09:30:00+02:00</n:DtTm></n:BookgDt><n:AddtlNtryInf>Transfer from savings</n:AddtlNtryInf></n:Ntry>
</n:Rpt></n:BkToCstmrAcctRpt></n:Document>`;
  const account = readCamtStatement(text).accounts[0];
  assert.equal(account.name, 'Account ·· 5678');
  assert.deepEqual(account.numbers, ['12345678']);
  assert.equal(account.opening, -4_000);
  assert.equal(account.closing, 6_000);
  assert.equal(account.closingWorkedOut, true);
  assert.equal(account.check.checked, false);
  assert.deepEqual(descriptions(account), ['Transfer from savings']);
  assert.equal(account.lines[0].date, '2026-10-02');
});

test('CAMT: a balance isn’t its credit line', () => {
  const text = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
<Acct><Id><IBAN>CH9300762011623852957</IBAN></Id><Ccy>CHF</Ccy></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><CdtLine><Incl>true</Incl><Amt Ccy="CHF">5000.00</Amt></CdtLine>
<Amt Ccy="CHF">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-07-31</Dt></Dt></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><CdtLine><Incl>true</Incl><Amt Ccy="CHF">5000.00</Amt></CdtLine>
<Amt Ccy="CHF">80.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-08-31</Dt></Dt></Bal>
<Ntry><Amt Ccy="CHF">20.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-08-10</Dt></BookgDt>
<AddtlNtryInf>Card</AddtlNtryInf></Ntry>
</Stmt></BkToCstmrStmt></Document>`;
  const account = readCamtStatement(text).accounts[0];
  assert.equal(account.opening, 10_000);
  assert.equal(account.closing, 8_000);
  assert.ok(account.check.ok);
});

// Statements newest first: the opening is the earliest, the closing the latest. Numbered
// characters and CDATA come through as text.
test('CAMT: statements in any order, and their text', () => {
  const stmt = (open, openDay, close, closeDay, amount, mark, day, words) => `<Stmt><Acct><Id><IBAN>CH9300762011623852957</IBAN></Id><Ccy>CHF</Ccy></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">${open}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>${openDay}</Dt></Dt></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">${close}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>${closeDay}</Dt></Dt></Bal>
<Ntry><Amt Ccy="CHF">${amount}</Amt><CdtDbtInd>${mark}</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${day}</Dt></BookgDt>
<NtryDtls><TxDtls><RmtInf><Ustrd>${words}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry></Stmt>`;
  const text = '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.04"><BkToCstmrStmt>'
    + stmt('90.00', '2027-01-01', '95.00', '2027-01-02', '5.00', 'CRDT', '2027-01-02', 'M&#252;ller')
    + stmt('100.00', '2026-12-31', '90.00', '2027-01-01', '10.00', 'DBIT', '2026-12-31', '<![CDATA[Rent & more]]>')
    + '</BkToCstmrStmt></Document>';
  const account = readCamtStatement(text).accounts[0];
  assert.equal(account.opening, 10_000);
  assert.equal(account.closing, 9_500);
  assert.ok(account.check.ok);
  assert.deepEqual(descriptions(account), ['Rent & more', 'Müller']);
});

// ---------------------------------------------------------------------------------------------
// QIF

test('QIF: a newest-first file keeps its opening balance out of the lines', () => {
  const text = `!Type:Bank
D15/08/2026
T-20.00
PCorner Grocer
^
D01/08/2026
T100.00
POpening Balance
L[Current]
^`;
  const account = inCurrency(readQifStatement(text).accounts[0], 'GBP');
  assert.deepEqual(amounts(account), [-2_000]);
  assert.equal(account.opening, 10_000);
  assert.equal(account.closing, 8_000);
});

test('QIF: dates that read either way follow the main currency', () => {
  const text = '!Type:Bank\nD09/01/2026\nT10.00\nPPay\n^\nD09/02/2026\nT-5.00\nPShop\n^\n';
  assert.equal(readQifStatement(text, { dayFirstWhenUnsure: false }).accounts[0].lines[0].date, '2026-09-01');
  assert.equal(readQifStatement(text).accounts[0].lines[0].date, '2026-01-09');
});

test('QIF: a bank file is its lines, with the opening it gives', () => {
  const text = `!Type:Bank
D01/08/2026
T100.00
POpening Balance
L[Current]
^
D03/08/2026
T-45.20
PCorner Grocer
MWeekly shop
^
D15/08/2026
T2,500.00
PExample Studio
^
D28/08/2026
T-1,250.00
PRent
N1043
^`;
  const statement = readQifStatement(text, { fileName: 'export.qif' });
  const read = statement.accounts[0];
  // Read at three decimals with no currency, then given pounds in the review.
  assert.equal(read.currency, null);
  assert.equal(read.ref, null);
  assert.equal(read.readDigits, 3);
  assert.equal(read.lines[0].amount, -45_200);
  const account = inCurrency(read, 'GBP');
  assert.equal(statement.reader, 'QIF');
  assert.deepEqual(amounts(account), [-4_520, 250_000, -125_000]);
  assert.deepEqual(descriptions(account), ['Corner Grocer · Weekly shop', 'Example Studio', 'Rent · Cheque 1043']);
  assert.equal(account.lines[0].date, '2026-08-03');
  assert.equal(account.opening, 10_000);
  assert.equal(account.closing, 130_480);
  assert.equal(account.closingWorkedOut, true);
  assert.equal(account.currency, 'GBP');
  // In yen the pennies have nowhere to go; in dinars they gain a place.
  assert.equal(inCurrency(read, 'JPY'), null);
  assert.equal(inCurrency(read, 'KWD').lines[0].amount, -45_200);
  assert.equal(looksLikeQif(text), true);
});

test('QIF: a Quicken card file reads its dates month first and has no balance', () => {
  const text = `!Type:CCard
D9/ 2'26
T-12.50
PCoffee Example
^
D9/14'26
T-80.00
PBook Example
^
D9/20'26
T92.50
PPayment, thank you
^`;
  const account = inCurrency(readQifStatement(text).accounts[0], 'USD');
  assert.equal(account.type, 'card');
  assert.equal(account.owed, true);
  assert.equal(account.name, 'Card');
  assert.deepEqual(account.lines.map((l) => l.date), ['2026-09-02', '2026-09-14', '2026-09-20']);
  assert.deepEqual(amounts(account), [-1_250, -8_000, 9_250]);
  assert.equal(account.closing, null);
  assert.deepEqual(account.notes, ['no balance in the file']);
  assert.equal(account.check.checked, false);
});

// A whole-yen file: read at three decimals, it moves to yen exactly.
test('QIF: a file in yen keeps its figures', () => {
  const text = '!Type:Bank\nD2026/09/03\nT-1234\nPCorner Grocer\n^\n';
  const account = inCurrency(readQifStatement(text).accounts[0], 'JPY');
  assert.deepEqual(amounts(account), [-1_234]);
});

// Quicken's export of several accounts: the AutoSwitch list declares them, then each comes as
// `!Account` and `!Type:` with its own lines.
test('QIF: a Quicken file of several accounts is an account each', () => {
  const text = `!Option:AutoSwitch
!Account
NChecking
TBank
^
NVisa
TCCard
^
!Clear:AutoSwitch
!Account
NChecking
TBank
^
!Type:Bank
D09/01/2026
T1000.00
PExample Studio
^
D09/02/2026
T-20.00
PCorner Grocer
^
!Account
NVisa
TCCard
^
!Type:CCard
D09/03/2026
T-45.00
PBook Example
^`;
  const statement = readQifStatement(text);
  assert.deepEqual(statement.accounts.map((a) => a.name), ['Checking', 'Visa']);
  assert.deepEqual(statement.accounts.map((a) => a.owed), [false, true]);
  assert.deepEqual(statement.accounts.map((a) => a.lines.length), [2, 1]);
});

// ---------------------------------------------------------------------------------------------
// Any bank's CSV

test('CSV: amounts as banks write them', () => {
  const cases = [
    ['£1,234.56', 123_456], ['1.234,56', 123_456], ['-12,50', -1_250], ['(12.00)', -1_200],
    ['12.00 DR', -1_200], ['12.00 CR', 1_200], ['12.00-', -1_200], ['AED 1,000', 100_000], ['+3.5', 350],
    ['N/A', null], ['', null]];
  for (const [text, expected] of cases) assert.equal(csvAmount(text, 2), expected, text);
});

test('CSV: one without a balance is its lines, newest last', () => {
  const text = `Number,Date,Account,Amount,Subcategory,Memo
,05/09/2026,20-00-00 12345678,-23.40,Payment,CORNER GROCER    ON 04 SEP
,02/09/2026,20-00-00 12345678,1500.00,Credit,EXAMPLE STUDIO SALARY`;
  const statement = readCsvStatement(text, { fileName: 'Barclays_Statement.csv' });
  const account = statement.accounts[0];
  assert.equal(statement.reader, 'CSV');
  assert.equal(statement.institution, 'Barclays');
  assert.equal(account.name, 'Barclays ·· 5678');
  assert.equal(account.ref, 'CSV:20-00-0012345678');
  assert.deepEqual(amounts(account), [150_000, -2_340]);
  assert.deepEqual(descriptions(account), ['EXAMPLE STUDIO SALARY', 'CORNER GROCER ON 04 SEP']);
  assert.equal(account.lines[0].date, '2026-09-02');
  assert.equal(account.closing, null);
  assert.equal(account.check.checked, false);
  assert.deepEqual(account.notes, ['no balance in the file']);
});

test('CSV: Revolut is an account per currency, with fees and nothing pending', () => {
  const text = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TOPUP,Current,2026-09-01 10:00:00,2026-09-01 10:00:05,Top-up by *1234,500.00,0.00,EUR,COMPLETED,500.00
CARD_PAYMENT,Current,2026-09-03 12:00:00,2026-09-04 09:00:00,Cafe Example,-4.50,0.00,EUR,COMPLETED,495.50
EXCHANGE,Current,2026-09-05 08:00:00,2026-09-05 08:00:00,Exchanged to GBP,-100.00,0.50,EUR,COMPLETED,395.00
CARD_PAYMENT,Current,2026-09-06 08:00:00,,Pending shop,-9.99,0.00,EUR,PENDING,
EXCHANGE,Current,2026-09-05 08:00:00,2026-09-05 08:00:00,Exchanged from EUR,86.00,0.00,GBP,COMPLETED,86.00`;
  const statement = readCsvStatement(text, { fileName: 'account-statement.csv' });
  assert.equal(statement.institution, 'Revolut');
  assert.deepEqual(statement.accounts.map((a) => a.name), ['Revolut EUR', 'Revolut GBP']);
  assert.deepEqual(statement.accounts.map((a) => a.ref), ['CSV:Revolut:EUR', 'CSV:Revolut:GBP']);
  const euro = statement.accounts[0];
  assert.deepEqual(amounts(euro), [50_000, -450, -10_050]);
  assert.equal(euro.opening, 0);
  assert.equal(euro.closing, 39_500);
  assert.ok(euro.check.ok);
  assert.equal(statement.accounts[1].closing, 8_600);
  assert.ok(statement.accounts[1].check.ok);
  assert.deepEqual(statement.period, { from: '2026-09-01', to: '2026-09-05' });
});

test('CSV: a semicolon file with decimal commas checks its balances', () => {
  const text = `Buchungstag;Verwendungszweck;Begünstigter/Zahlungspflichtiger;Betrag;Saldo;Währung
30.09.2026;Miete September;Example Haus GmbH;-850,00;1.234,56;EUR
15.09.2026;Gehalt;Example Studio;2.000,00;2.084,56;EUR`;
  const account = readCsvStatement(text, { fileName: 'umsaetze.csv' }).accounts[0];
  assert.equal(account.currency, 'EUR');
  assert.deepEqual(amounts(account), [200_000, -85_000]);
  assert.deepEqual(descriptions(account), ['Example Studio · Gehalt', 'Example Haus GmbH · Miete September']);
  assert.equal(account.opening, 8_456);
  assert.equal(account.closing, 123_456);
  assert.ok(account.check.ok);
  assert.equal(account.ref, null);
  assert.equal(account.name, 'Account');
});

test('CSV: money in and money out columns make one amount', () => {
  const text = `Transaction Date,Transaction Type,Sort Code,Account Number,Transaction Description,Debit Amount,Credit Amount,Balance
02/10/2026,DEB,'30-00-00,12345678,CORNER GROCER,12.30,,987.70
01/10/2026,FPI,'30-00-00,12345678,EXAMPLE STUDIO,,1000.00,1000.00`;
  const account = readCsvStatement(text, { fileName: 'statement.csv' }).accounts[0];
  assert.deepEqual(amounts(account), [100_000, -1_230]);
  assert.equal(account.name, 'Account ·· 5678');
  assert.equal(account.ref, 'CSV:12345678');
  assert.deepEqual(account.numbers, ['12345678']);
  assert.equal(account.opening, 0);
  assert.equal(account.closing, 98_770);
  assert.ok(account.check.ok);
});

test('CSV: a currency in the heading is the account’s', () => {
  const text = `Date,Counter Party,Reference,Type,Amount (GBP),Balance (GBP)
01/09/2026,Example Studio,Salary,FASTER PAYMENT,1000.00,1000.00
03/09/2026,Corner Grocer,,CARD,-12.30,987.70`;
  const account = readCsvStatement(text, { fileName: 'statement.csv' }).accounts[0];
  assert.equal(account.currency, 'GBP');
  assert.equal(account.closing, 98_770);
  assert.ok(account.check.ok);
  assert.deepEqual(descriptions(account), ['Example Studio · Salary', 'Corner Grocer']);
});

test('CSV: dates that read either way follow the bank, then the main currency', () => {
  const chase = `Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #
DEBIT,09/02/2026,"CORNER GROCER",-45.20,DEBIT_CARD,1954.80,,
CREDIT,09/01/2026,"EXAMPLE STUDIO PAYROLL",2000.00,ACH_CREDIT,2000.00,,`;
  const account = readCsvStatement(chase, { fileName: 'Chase1234_Activity_20260903.CSV' }).accounts[0];
  assert.deepEqual(account.lines.map((l) => l.date), ['2026-09-01', '2026-09-02']);
  assert.ok(account.check.ok);

  const plain = 'Date,Description,Amount\n09/02/2026,Shop,-5.00\n09/01/2026,Pay,10.00\n';
  const inDollars = readCsvStatement(plain, { fileName: 'export.csv', dayFirstWhenUnsure: false }).accounts[0];
  assert.equal(inDollars.lines[0].date, '2026-09-01');
  const elsewhere = readCsvStatement(plain, { fileName: 'export.csv' }).accounts[0];
  assert.equal(elsewhere.lines[0].date, '2026-01-09');
  // Decimal commas say the day comes first, whatever the main currency.
  const commas = 'Date;Description;Amount\n09/02/2026;Shop;-5,00\n09/01/2026;Pay;10,00\n';
  const european = readCsvStatement(commas, { fileName: 'export.csv', dayFirstWhenUnsure: false }).accounts[0];
  assert.equal(european.lines[0].date, '2026-01-09');
});

test('CSV: one that isn’t a bank statement isn’t read', () => {
  const statement = readCsvStatement('Name,Email\nSam,sam@example.com');
  assert.equal(statement.unknownCsv, true);
  assert.equal(statement.accounts.length, 0);
});

test('CSV: a bank’s name counts only as a whole word', () => {
  const statement = readCsvStatement('Booking Date,Amount\n2026-09-01,5.00\n', { fileName: 'Spending.csv' });
  assert.equal(statement.institution, null);
  assert.equal(statement.accounts[0].name, 'Account');
});

test('each format is known by what is in it, and by nothing else', () => {
  const files = { mt940, camt053, qif: '!Type:Bank\nD01/08/2026\nT1.00\n^', csv: 'Date,Amount\n2026-09-01,5.00' };
  const seen = Object.fromEntries(Object.entries(files).map(([k, t]) => [k,
    [looksLikeMt940(t), looksLikeCamt(t), looksLikeQif(t), looksLikeOfx(t)].map(Number).join('')]));
  assert.deepEqual(seen, { mt940: '1000', camt053: '0100', qif: '0010', csv: '0000' });
});
