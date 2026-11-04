// node --test web/tests/statement-read.test.mjs
// Read here: a bank's file is known by what is in it before its name, as in the app, and hashed
// as the app hashes it (a CSV by its name and bytes, the rest by bytes, an Excel file too). Every
// file here is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readDocument } from '../statement-read.mjs';

const bytes = (text) => new TextEncoder().encode(text);
const sha = (...parts) => createHash('sha256').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest('hex');

const mt940 = `:20:D1
:25:NL91EXMP0417164300
:60F:C260901EUR500,00
:61:260901C100,00NTRFREF1
:86:Gift
:62F:C260901EUR600,00`;
const qif = '!Type:Bank\nD03/08/2026\nT-45.20\nPCorner Grocer\n^\nD15/08/2026\nT2,500.00\nPExample Studio\n^';
const csv = 'Date,Description,Amount,Balance\n2026-09-01,Example Studio,100.00,100.00\n2026-09-02,Corner Grocer,-12.30,87.70';
const camt = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
<Acct><Id><IBAN>CH9300762011623852957</IBAN></Id><Ccy>CHF</Ccy></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-07-31</Dt></Dt></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">15.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-08-31</Dt></Dt></Bal>
<Ntry><Amt Ccy="CHF">5.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-08-02</Dt></BookgDt></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

/** A zip by hand, every entry stored: its `text`, or its `bytes`. */
function zipOf(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, text, bytes: raw } of entries) {
    const data = Buffer.from(raw ?? text);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dir, end]));
}

/** An Excel workbook by hand: one sheet, its text inline and its numbers as numbers. */
function xlsxOf(rows) {
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const cell = (v, ref) => (typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`);
  const sheet = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, `${'ABCDEFGH'[c]}${r + 1}`)).join('')}</row>`).join('');
  return zipOf([
    { name: '[Content_Types].xml', text: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: 'xl/workbook.xml', text: `<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="Lines" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: 'xl/worksheets/sheet1.xml', text: `<worksheet xmlns="${main}"><sheetData>${sheet}</sheetData></worksheet>` },
  ]);
}
const xlsx = xlsxOf([['Date', 'Description', 'Amount', 'Balance'], ['2026-09-01', 'Example Studio', 100, 100], ['2026-09-02', 'Corner Grocer', -12.3, 87.7]]);

/** The older Office container, as an .xls workbook or an .xlsx saved with a password is kept. */
function officeContainer(streams) {
  const bytes = new Uint8Array(1536);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  bytes.set(new Uint8Array(Buffer.from(streams, 'utf16le')), 1024);
  return bytes;
}

test('read here: MT940, CAMT and QIF are known by what is in them and hashed on their bytes', async () => {
  for (const [name, text, reader] of [['statement.sta', mt940, 'MT940'], ['export.txt', mt940, 'MT940'], ['no-extension', mt940, 'MT940'],
    ['camt053.xml', camt, 'CAMT'], ['download.qif', qif, 'QIF']]) {
    const { statements, problems } = await readDocument(name, bytes(text));
    assert.deepEqual(problems, [], name);
    assert.equal(statements[0].reader, reader, name);
    assert.equal(statements[0].sha256, sha(text), name);
  }
});

test('read here: a bank’s CSV is hashed on its name and bytes, as the app hashes a CSV', async () => {
  const { statements } = await readDocument('Monthly.csv', bytes(csv));
  assert.equal(statements[0].reader, 'CSV');
  assert.equal(statements[0].sha256, sha('Monthly.csv', csv));
  assert.ok(statements[0].accounts[0].check.ok);
});

test('read here: an OFX download is hashed as the app hashes it, by its name: a .csv on its name and bytes', async () => {
  const ofx = 'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD<BANKACCTFROM><BANKID>1<ACCTID>000123456789<ACCTTYPE>CHECKING</BANKACCTFROM>'
    + '<BANKTRANLIST><DTSTART>20260901<DTEND>20260930<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260915<TRNAMT>-25.00<FITID>F1<NAME>Corner Grocer</STMTTRN></BANKTRANLIST>'
    + '<LEDGERBAL><BALAMT>975.00<DTASOF>20260930</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';
  const asOfx = await readDocument('download.ofx', bytes(ofx));
  assert.equal(asOfx.statements[0].sha256, sha(ofx));
  const asCsv = await readDocument('export.csv', bytes(ofx));
  assert.equal(asCsv.statements[0].reader, asOfx.statements[0].reader);
  assert.equal(asCsv.statements[0].sha256, sha('export.csv', ofx), 'StatementImporter hashes a .csv name and bytes whatever is in it');
});
test('read here: a zip is every statement file in it', async () => {
  const zip = zipOf([{ name: 'a.sta', text: mt940 }, { name: 'b.qif', text: qif }, { name: 'c.csv', text: csv }, { name: 'd.png', text: 'not one' }]);
  const { statements, problems } = await readDocument('downloads.zip', zip);
  assert.deepEqual(problems, []);
  assert.deepEqual(statements.map((s) => s.reader), ['MT940', 'QIF', 'CSV']);
  const empty = await readDocument('pictures.zip', zipOf([{ name: 'd.png', text: 'not one' }]));
  assert.deepEqual(empty.problems, ['There are no statement files in this zip.']);
});

test('read here: what isn’t a statement says so', async () => {
  assert.match((await readDocument('people.csv', bytes('Name,Email\nSam,sam@example.com'))).problems[0], /columns weren’t recognised/);
  assert.match((await readDocument('notes.qif', bytes('hello'))).problems[0], /no statement was found/);
  assert.match((await readDocument('photo.heic', bytes('hello'))).problems[0], /isn’t a statement WaffleWealth reads: .*Excel file \(\.xlsx\)/);
});

test('read here: an Excel download is its table, hashed on its bytes alone, whatever it is called', async () => {
  // .xlsx, an .xlsx renamed .zip (read as the workbook, not as a zip of files), no extension at
  // all, and an .xls that is really an .xlsx: each hashed as the app hashes a file not named .csv.
  for (const name of ['September.xlsx', 'September.zip', 'download', 'September.xls']) {
    const { statements, problems } = await readDocument(name, xlsx);
    assert.deepEqual(problems, [], name);
    assert.equal(statements.length, 1, name);
    assert.equal(statements[0].reader, 'CSV', name);
    assert.equal(statements[0].fileName, name);
    assert.equal(statements[0].sha256, sha(xlsx), name);
    assert.deepEqual(statements[0].accounts[0].lines.map((l) => [l.date, l.amount, l.label]),
      [['2026-09-01', 10_000, 'in'], ['2026-09-02', -1_230, 'out']], name);
    assert.ok(statements[0].accounts[0].check.ok, name);
  }
});

test('read here: an Excel file in a zip is read with the rest, each hashed as the app hashes it', async () => {
  const zip = zipOf([{ name: 'september.xlsx', bytes: xlsx }, { name: 'c.csv', text: csv }, { name: 'old.xls', bytes: officeContainer('Workbook') }]);
  const { statements, problems } = await readDocument('downloads.zip', zip);
  assert.deepEqual(statements.map((s) => [s.fileName, s.reader]), [['september.xlsx', 'CSV'], ['c.csv', 'CSV']]);
  assert.equal(statements[0].sha256, sha(xlsx));
  assert.equal(statements[1].sha256, sha('c.csv', csv));
  assert.deepEqual(problems, ['old.xls: this is an older Excel file (.xls), which WaffleWealth can’t read. Open it in a spreadsheet app, save it as .xlsx or CSV, and upload that copy.']);
});

test('read here: a spreadsheet with no table, an older .xls and one with a password each say so', async () => {
  const people = xlsxOf([['Name', 'Email'], ['Sam Example', 'sam@example.com']]);
  assert.deepEqual((await readDocument('people.xlsx', people)).problems, ['No table of lines was found in this spreadsheet.']);
  assert.deepEqual((await readDocument('people.zip', zipOf([{ name: 'people.xlsx', bytes: people }]))).problems,
    ['people.xlsx: no table of lines was found in this spreadsheet.']);
  assert.deepEqual((await readDocument('old.xls', officeContainer('Workbook'))).problems,
    ['This is an older Excel file (.xls), which WaffleWealth can’t read. Open it in a spreadsheet app, save it as .xlsx or CSV, and upload that copy.']);
  assert.deepEqual((await readDocument('locked.xlsx', officeContainer('EncryptionInfo\0EncryptedPackage'))).problems,
    ['This spreadsheet has a password. Open it, save a copy without the password, and upload that copy.']);
  // A bank's CSV named as Excel is read for what is in it.
  const named = await readDocument('export.xls', bytes(csv));
  assert.deepEqual(named.problems, []);
  assert.equal(named.statements[0].sha256, sha(csv));
});

test('read here: dates that read either way follow the main currency the page passes in', async () => {
  const plain = bytes('Date,Description,Amount\n09/02/2026,Shop,-5.00\n09/01/2026,Pay,10.00\n');
  const inDollars = await readDocument('export.csv', plain, { dayFirstWhenUnsure: false });
  assert.equal(inDollars.statements[0].accounts[0].lines[0].date, '2026-09-01');
  const elsewhere = await readDocument('export.csv', plain);
  assert.equal(elsewhere.statements[0].accounts[0].lines[0].date, '2026-01-09');
});
