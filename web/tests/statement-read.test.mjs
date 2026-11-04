// node --test web/tests/statement-read.test.mjs
// Read here: a bank's file is known by what is in it before its name, as in the app, and hashed
// as the app hashes it (a CSV by its name and bytes, the rest by bytes). Every file here is made up.
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

/** A zip by hand, every entry stored. */
function zipOf(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, text } of entries) {
    const data = Buffer.from(text);
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
  assert.match((await readDocument('photo.heic', bytes('hello'))).problems[0], /isn’t a statement WaffleWealth reads/);
});

test('read here: dates that read either way follow the main currency the page passes in', async () => {
  const plain = bytes('Date,Description,Amount\n09/02/2026,Shop,-5.00\n09/01/2026,Pay,10.00\n');
  const inDollars = await readDocument('export.csv', plain, { dayFirstWhenUnsure: false });
  assert.equal(inDollars.statements[0].accounts[0].lines[0].date, '2026-09-01');
  const elsewhere = await readDocument('export.csv', plain);
  assert.equal(elsewhere.statements[0].accounts[0].lines[0].date, '2026-01-09');
});

test('read here: a tab-separated .TAB or .tsv file is a bank file (ABN AMRO), read without a header', async () => {
  const tab = '123456789\tEUR\t20261001\t1640,25\t390,25\t20261001\t-1250,00\tHuur oktober\n'
    + '123456789\tEUR\t20261024\t390,25\t3005,55\t20261024\t2615,30\tSalaris oktober\n';
  for (const name of ['TXT261104101530.TAB', 'export.tsv']) {
    const { statements, problems } = await readDocument(name, bytes(tab));
    assert.deepEqual(problems, [], name);
    assert.equal(statements[0].reader, 'CSV', name);
    assert.equal(statements[0].general, true, name);
    assert.equal(statements[0].accounts[0].closing, 300_555, name);
    // Hashed on its bytes, as the app hashes every bank file that isn't named .csv.
    assert.equal(statements[0].sha256, sha(tab), name);
  }
});

test('read here: a table whose dates can’t be read says so, as the phone does', async () => {
  const { statements, problems } = await readDocument('export.csv', bytes('Date,Description,Amount\nyesterday,Shop,-5.00\n'));
  assert.equal(statements.length, 0);
  assert.deepEqual(problems, ['export.csv: its dates couldn’t be read.']);
});

test('read here: the main currency settles dates that read either way, and the statement says it guessed', async () => {
  const plain = bytes('Date,Description,Amount\n09/02/2026,Shop,-5.00\n09/01/2026,Pay,10.00\n');
  const canadian = await readDocument('export.csv', plain, { mainCurrency: 'CAD' });
  assert.equal(canadian.statements[0].accounts[0].lines[0].date, '2026-09-01');
  assert.equal(canadian.statements[0].dateOrder, 'MDY');
  assert.equal(canadian.statements[0].dateOrderGuessed, true);
  const british = await readDocument('export.csv', plain, { mainCurrency: 'GBP', dayFirstWhenUnsure: true });
  assert.equal(british.statements[0].accounts[0].lines[0].date, '2026-01-09');
  assert.equal(british.statements[0].dateOrder, 'DMY');
});

test('read here: a Windows-1250 or UTF-16 file is decoded before it is read', async () => {
  const text = 'Date\tDescription\tAmount\tBalance\r\n20/08/2026\tAMAZON.CO.UK\t-45.20\t1189.36\r\n';
  const utf16 = new Uint8Array([0xFF, 0xFE, ...[...text].flatMap((c) => [c.charCodeAt(0), 0])]);
  const { statements } = await readDocument('export.csv', utf16);
  assert.equal(statements[0].accounts[0].closing, 118_936);
});

test('read here: the main currency gives a file naming none its decimals when they fit, for a CSV and a QIF alike (Addendum 2)', async () => {
  const yen = await readDocument('export.csv', bytes(csv), { dayFirstWhenUnsure: true, mainCurrency: 'JPY' });
  assert.deepEqual([yen.statements[0].accounts[0].readDigits, yen.statements[0].accounts[0].closing], [3, 87_700]);
  const usd = await readDocument('export.csv', bytes(csv), { dayFirstWhenUnsure: false, mainCurrency: 'USD' });
  assert.deepEqual([usd.statements[0].accounts[0].readDigits, usd.statements[0].accounts[0].closing], [2, 8_770]);
  const quicken = await readDocument('export.qif', bytes(qif), { dayFirstWhenUnsure: true, mainCurrency: 'JPY' });
  assert.deepEqual(quicken.statements[0].accounts[0].lines.map((l) => l.amount), [-45_200, 2_500_000]);
  // Each CSV account comes with its reading the other way round, for the review's "It's a card".
  assert.equal(usd.statements[0].accounts[0].other.owed, true);
});
