// node --test statements/tests/xlsx.test.mjs
// Excel downloads (.xlsx): each sheet read as rows of text, as Excel shows them, then the first
// sheet with a table of lines read as the bank's CSV would be, to the minor unit. Every workbook
// here is made in the test, a zip written by hand (stored or deflated entries, each with its
// CRC-32), so no binary files are kept. The banks, the numbers and the lines are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { xlsxSheets, readXlsxStatement, looksLikeXlsx, isXlsxName, unreadableExcel } from '../xlsx.js';
import { readCsvStatement, readCsvRows, parseCsv, monthly, labelLines } from '../readers.js';

const amounts = (a) => a.lines.map((l) => l.amount);
const dates = (a) => a.lines.map((l) => l.date);

// ---------------------------------------------------------------------------------------------
// A workbook by hand

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip: each entry `{ name, data }` stored, or deflated with `deflate`, with its CRC-32. */
function zipOf(entries, { deflate = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const raw = Buffer.from(data);
    const body = deflate ? deflateRawSync(raw) : raw;
    const nameBytes = Buffer.from(name);
    const method = deflate ? 8 : 0;
    const day = ((2026 - 1980) << 9) | (9 << 5) | 1;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8); local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10);
    central.writeUInt16LE(day, 14); central.writeUInt32LE(crc32(raw), 16); central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dir, end]));
}

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const columnName = (i) => (i >= 26 ? columnName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));

/**
 * A sheet's rows → its <sheetData> rows. A string is a shared string, a number a number, null no
 * cell at all; `{ v, s, t, f }` is a cell written as given (a raw value, its style, its type, a
 * formula), and `{ inline }` an inline string.
 */
function rowsXml(rows, strings) {
  return rows.map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => {
    if (cell == null) return '';
    const ref = `${columnName(c)}${r + 1}`;
    if (typeof cell === 'string') {
      if (!strings.includes(cell)) strings.push(cell);
      return `<c r="${ref}" t="s"><v>${strings.indexOf(cell)}</v></c>`;
    }
    if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
    if (cell.inline != null) return `<c r="${ref}" t="inlineStr"><is><t>${esc(cell.inline)}</t></is></c>`;
    const { v, s, t, f } = cell;
    return `<c r="${ref}"${s != null ? ` s="${s}"` : ''}${t ? ` t="${t}"` : ''}>${f ? `<f>${esc(f)}</f>` : ''}${v != null ? `<v>${esc(v)}</v>` : ''}</c>`;
  }).join('')}</row>`).join('');
}

/** styles.xml: a cell style for each number format id in `xfs`, the custom ones' codes in `codes`. */
function stylesXml(xfs, codes = {}) {
  const custom = Object.entries(codes);
  // The cell style below (cellStyleXfs) is a date's, to show it is the cell's own (cellXfs) that counts.
  return `${XML}<styleSheet xmlns="${MAIN}"><numFmts count="${custom.length}">${custom.map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`).join('')}</numFmts>`
    + '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="14" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${xfs.length}">${xfs.map((id) => `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0" xfId="0"${id ? ' applyNumberFormat="1"' : ''}><alignment vertical="top"/></xf>`).join('')}</cellXfs>`
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}

/**
 * A workbook, as Excel lays one out. Each sheet is `{ name, rows }` (see rowsXml) or `{ name,
 * xml }` (its <sheetData> rows as written). `shared` is the shared strings' <si>s as written,
 * else those the rows make; `styles` is styles.xml; `workbookPr` goes in the workbook.
 */
function xlsxOf(sheets, { shared = null, styles = null, workbookPr = '', deflate = false } = {}) {
  const strings = [];
  const sheetData = sheets.map((s) => s.xml ?? rowsXml(s.rows, strings));
  const si = shared ?? strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('');
  const overrides = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const entries = [
    { name: '[Content_Types].xml', data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>${styles ? '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' : ''}</Types>` },
    { name: '_rels/.rels', data: `${XML}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}">${workbookPr}<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `${XML}<Relationships xmlns="${PACKAGE_REL}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdS" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>${styles ? `<Relationship Id="rIdT" Type="${REL}/styles" Target="styles.xml"/>` : ''}</Relationships>` },
    ...sheetData.map((rows, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${REL}"><dimension ref="A1"/><sheetData>${rows}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>` })),
    { name: 'xl/sharedStrings.xml', data: `${XML}<sst xmlns="${MAIN}">${si}</sst>` },
  ];
  if (styles) entries.push({ name: 'xl/styles.xml', data: styles });
  return zipOf(entries, { deflate });
}

const firstRows = async (bytes) => (await xlsxSheets(bytes))[0].rows;

// ---------------------------------------------------------------------------------------------
// Cells as Excel shows them

test('Excel: shared strings, plain or rich text, with their entities and escapes', async () => {
  const shared = '<si><t>Date</t></si>'
    // Rich text: the runs' text joined; the phonetic reading (rPh) is not part of it.
    + '<si><r><rPr><b/><sz val="11"/><rFont val="Calibri"/></rPr><t>Corner</t></r><r><t xml:space="preserve"> Grocer &amp; Co</t></r>'
    + '<rPh sb="0" eb="6"><t>KO-NA</t></rPh><phoneticPr fontId="1"/></si>'
    + '<si><t>Line&#10;two &#x263A; &lt;b&gt; &quot;q&quot; &apos;s&apos;</t></si>'
    + '<si><t xml:space="preserve">  spaced  </t></si>'
    // Excel's own escapes: _x0009_ is a tab, and _x005F_ an underscore that escapes the next one.
    + '<si><t>Tab_x0009_in, under_x005F_x0009_score</t></si>'
    + '<si><t/></si>';
  const xml = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="C2" t="s"><v>4</v></c>'
    + '<c r="D2" t="s"><v>5</v></c><c r="E2" t="s"><v>99</v></c></row>';
  assert.deepEqual(await firstRows(xlsxOf([{ name: 'Strings', xml }], { shared })), [
    ['Date', 'Corner Grocer & Co'],
    ['Line\ntwo ☺ <b> "q" \'s\'', '  spaced  ', 'Tab\tin, under_x0009_score'],
  ]);
});

test('Excel: inline strings, a formula’s text, TRUE and FALSE, and errors', async () => {
  const xml = '<row r="1"><c r="A1" t="inlineStr"><is><t>Inline &amp; plain</t></is></c>'
    + '<c r="B1" t="inlineStr"><is><r><t>Rich</t></r><r><rPr><i/></rPr><t xml:space="preserve"> inline</t></r></is></c>'
    + '<c r="C1" t="str"><f>A1&amp;"!"</f><v>Inline &amp; plain!</v></c>'
    + '<c r="D1" t="b"><v>1</v></c><c r="E1" t="b"><v>0</v></c><c r="F1" t="e"><v>#N/A</v></c>'
    // Inline text with its type left off, and a formula whose value was never worked out.
    + '<c r="G1"><is><t>No type</t></is></c><c r="H1"><f>SUM(A2:A9)</f></c><c r="I1"><v>7</v></c></row>';
  assert.deepEqual(await firstRows(xlsxOf([{ name: 'Inline', xml }])),
    [['Inline & plain', 'Rich inline', 'Inline & plain!', 'TRUE', 'FALSE', '#N/A', 'No type', '', '7']]);
});

test('Excel: dates by built-in and custom formats, the time only when the format shows hours', async () => {
  // Cell styles: 0 General, 1 built-in 14 (a short date), 2 dd/mm/yyyy, 3 yyyy-mm-dd hh:mm:ss,
  // 4 built-in 22 (date and time), 5 built-in 20 (h:mm), and three that look like dates but
  // aren't: 6 with "days" quoted, 7 with [Red] (a colour, not a d), 8 an amount with # and ".
  // 9 is a date whose code has quoted words and escapes in it.
  const styles = stylesXml([0, 14, 164, 165, 22, 20, 166, 167, 168, 169], {
    164: 'dd/mm/yyyy', 165: 'yyyy-mm-dd hh:mm:ss', 166: '0.00 "days"', 167: '[Red]0.00;[Red]\\-0.00',
    168: '#,##0.00 "d";[Red]-#,##0.00 "d"', 169: '"Paid "d\\ mmm\\ yyyy',
  });
  const n = (v, s) => ({ v, s });
  const rows = [
    [n('46266', 1), n('46266', 2), n('46266.4375', 3), n('46266', 3), n('46266.75', 4), n('0.75', 5),
      n('12.5', 6), n('46266', 7), n('46266', 8), n('46266', 9), n('46266.4375', 2), 46266, n('-1', 1)],
    // Excel counts a 29 February 1900 that never was: day 60. Days before it are one off from
    // the days after, so 59 is 28 February and 61 is 1 March.
    [n('1', 1), n('59', 1), n('60', 1), n('61', 1), n('2958465', 1), n('2958466', 1)],
    // Dates typed as dates (t="d"), as ISO 8601: the time is kept only where the format has hours.
    [{ t: 'd', v: '2026-09-01T10:30:00Z', s: 1 }, { t: 'd', v: '2026-09-01T10:30:00Z', s: 3 }, { t: 'd', v: '2026-09-01T10:30:00' },
      { t: 'd', v: '2026-09-02T00:00:00' }, { t: 'd', v: '2026-09-03' }],
  ];
  assert.deepEqual(await firstRows(xlsxOf([{ name: 'Dates', rows }], { styles })), [
    ['2026-09-01', '2026-09-01', '2026-09-01 10:30', '2026-09-01', '2026-09-01 18:00', '18:00',
      '12.5', '46266', '46266', '2026-09-01', '2026-09-01', '46266', '-1'],
    ['1900-01-01', '1900-02-28', '1900-02-29', '1900-03-01', '9999-12-31', '2958466'],
    ['2026-09-01', '2026-09-01 10:30', '2026-09-01 10:30', '2026-09-02', '2026-09-03'],
  ]);
});

test('Excel: a 1904 workbook counts its days from 1 January 1904', async () => {
  const styles = stylesXml([0, 14, 164], { 164: 'dd/mm/yyyy' });
  const rows = [[{ v: '44804', s: 1 }, { v: '44804', s: 2 }, { v: '0', s: 1 }, { v: '44804.5', s: 1 }]];
  for (const workbookPr of ['<workbookPr date1904="1"/>', '<workbookPr defaultThemeVersion="166925" date1904="true"/>']) {
    assert.deepEqual(await firstRows(xlsxOf([{ name: 'Mac', rows }], { styles, workbookPr })),
      [['2026-09-01', '2026-09-01', '1904-01-01', '2026-09-01']], workbookPr);
  }
  // Without it, or with it off, the same days are counted from 1900.
  for (const workbookPr of ['', '<workbookPr date1904="0"/>', '<workbookPr date1904="false"/>']) {
    assert.deepEqual(await firstRows(xlsxOf([{ name: 'Mac', rows: [[{ v: '44804', s: 1 }]] }], { styles, workbookPr })),
      [['2022-08-31']], workbookPr);
  }
});

test('Excel: numbers as Excel shows them, to 15 digits, without a float’s noise', async () => {
  const cases = [
    ['1234.5600000000001', '1234.56'], ['-0.30000000000000004', '-0.3'], ['1E-3', '0.001'], ['12', '12'],
    ['-1234.5600000000001', '-1234.56'], ['-12.3', '-12.3'], ['-1E-3', '-0.001'], ['1.5E+2', '150'],
    ['395.00000000000006', '395'], ['0.1', '0.1'], ['100', '100'], ['-0', '0'], ['0.000', '0'], ['.5', '0.5'],
    ['2.5e-7', '0.00000025'], ['123456789012345678', '123456789012346000'], ['9.9999999999999998', '10'],
    ['-999999999999999.9', '-1000000000000000'], [' 7 ', '7'], ['abc', 'abc'], ['1,234.50', '1,234.50'],
  ];
  const rows = cases.map(([v]) => [{ v }]);
  assert.deepEqual(await firstRows(xlsxOf([{ name: 'Numbers', rows }])), cases.map(([, shown]) => [shown]));
});

test('Excel: cells and rows a sheet leaves out are empty, and empty ones at the ends are left off', async () => {
  const xml = '<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="C1"><v>3</v></c></row>'
    + '<row r="3"><c r="B3"><v>1</v></c><c r="D3" s="0"/></row>'
    // A row that doesn't say where it is comes next; so do its cells.
    + '<row><c><v>4</v></c><c t="inlineStr"><is><t>b</t></is></c></row>'
    + '<row r="9"><c r="A9" s="0"/></row><row r="12" spans="1:3"/>';
  assert.deepEqual(await firstRows(xlsxOf([{ name: 'Sparse', xml }])), [['a', '', '3'], [], ['', '1'], ['4', 'b']]);
  // Sparse cells built from the rows: A1 and C1 only.
  assert.deepEqual(await firstRows(xlsxOf([{ name: 'Sparse', rows: [['Date', null, 'Amount'], [null, null, null, 'x']] }])),
    [['Date', '', 'Amount'], ['', '', '', 'x']]);
});

test('Excel: any prefix, attributes in any order, paths in any case, and no shared strings or styles', async () => {
  const x = 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const sheet = (rows) => `${XML}<x:worksheet ${x}><x:sheetData>${rows}</x:sheetData></x:worksheet>`;
  const bytes = zipOf([
    { name: '[Content_Types].xml', data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>` },
    // The package names its workbook with an absolute path, in capitals.
    { name: '_rels/.rels', data: `<Relationships xmlns="${PACKAGE_REL}"><Relationship Target="/XL/Workbook.xml" Type="${REL}/officeDocument" Id="rId1"/></Relationships>` },
    { name: 'XL/Workbook.xml', data: `${XML}<x:workbook ${x} xmlns:rel="${REL}"><x:workbookPr date1904='false'/><x:sheets>`
      + `<x:sheet rel:id="R7" name="Data &amp; more" sheetId="3"/><x:sheet sheetId="4" name='Second' rel:id='R8'/></x:sheets></x:workbook>` },
    { name: 'XL/_rels/Workbook.xml.rels', data: `<Relationships xmlns="${PACKAGE_REL}">`
      + `<Relationship Id="R7" Target="/xl/sheets/Data.xml" Type="${REL}/worksheet"/>`
      + `<Relationship Type="${REL}/worksheet" Target="../XL/Sheets/Other.xml" Id="R8"/></Relationships>` },
    { name: 'XL/Sheets/Data.xml', data: sheet('<x:row r="1"><x:c t="inlineStr" r="A1"><x:is><x:t>Date</x:t></x:is></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>Amount</x:t></x:is></x:c></x:row>'
      + '<x:row r="2" spans="1:3"><x:c r="A2" t="inlineStr"><x:is><x:t>2026-09-01</x:t></x:is></x:c><x:c s="0" t="n" r="B2"><x:v>-4.5</x:v></x:c><x:c r="C2"/></x:row>') },
    { name: 'XL/Sheets/Other.xml', data: sheet('<x:row r="2"><x:c r="B2" t="b"><x:v>0</x:v></x:c></x:row>') },
  ]);
  assert.ok(looksLikeXlsx(bytes));
  assert.deepEqual(await xlsxSheets(bytes), [
    { name: 'Data & more', rows: [['Date', 'Amount'], ['2026-09-01', '-4.5']] },
    { name: 'Second', rows: [[], ['', 'FALSE']] },
  ]);
  const statement = await readXlsxStatement(bytes, { fileName: 'export.xlsx' });
  assert.deepEqual(amounts(statement.accounts[0]), [-450]);
});

// ---------------------------------------------------------------------------------------------
// Statements

test('Excel: the first sheet with a table of lines is the statement, a cover page before it', async () => {
  const styles = stylesXml([0, 164], { 164: 'dd/mm/yyyy' });
  const day = (serial) => ({ v: String(serial), s: 1 });
  const bytes = xlsxOf([
    { name: 'Cover', rows: [['Example Bank'], ['Statement of account'], ['Account', 'GB00 EXMP 0000 0000 1234'],
      ['Period', '01/09/2026 to 30/09/2026'], ['Opening balance', 1000], ['Closing balance', 2487.7]] },
    { name: 'Lines', rows: [['Your lines'], [], ['Date', 'Description', 'Amount', 'Balance'],
      [day(46266), 'Example Studio', 1500, 2500], [day(46268), 'Corner Grocer', { v: '-12.300000000000001' }, { v: '2487.6999999999998' }]] },
  ], { styles, deflate: true });
  const statement = await readXlsxStatement(bytes, { fileName: 'statement.xlsx' });
  assert.equal(statement.reader, 'CSV');
  assert.equal(statement.fileName, 'statement.xlsx');
  assert.equal(statement.accounts.length, 1);
  const account = statement.accounts[0];
  assert.deepEqual(amounts(account), [150_000, -1_230]);
  assert.deepEqual(dates(account), ['2026-09-01', '2026-09-03']);
  assert.equal(account.opening, 100_000);
  assert.equal(account.closing, 248_770);
  assert.ok(account.check.ok);
  assert.deepEqual(statement.period, { from: '2026-09-01', to: '2026-09-03' });
});

test('Excel: a table further down than a CSV’s header would be is still found', async () => {
  const above = Array.from({ length: 24 }, (_, i) => [`Note ${i + 1}`, 'About this account']);
  const bytes = xlsxOf([{ name: 'Lines', rows: [...above, ['Booking Date', 'Details', 'Debit', 'Credit', 'Balance'],
    ['2026-09-01', 'Example Studio', null, 1500, 1500], ['2026-09-02', 'Corner Grocer', 12.3, null, 1487.7]] }]);
  const account = (await readXlsxStatement(bytes, { fileName: 'lines.xlsx' })).accounts[0];
  assert.deepEqual(amounts(account), [150_000, -1_230]);
  assert.equal(account.closing, 148_770);
  assert.ok(account.check.ok);
});

// The columns Revolut's personal account export has, with its states and fees.
const REVOLUT_HEADER = ['Type', 'Product', 'Started Date', 'Completed Date', 'Description', 'Amount', 'Fee', 'Currency', 'State', 'Balance'];
const REVOLUT_LINES = [
  ['TOPUP', 'Current', '46266.416666666664', '46266.416724537038', 'Top-up by *1234', '500', '0', 'EUR', 'COMPLETED', '500'],
  ['CARD_PAYMENT', 'Current', '46268.5', '46269.375', 'Cafe Example', '-4.5', '0', 'EUR', 'COMPLETED', '495.5'],
  ['EXCHANGE', 'Current', '46270.333333333336', '46270.333333333336', 'Exchanged to GBP', '-100', '0.5', 'EUR', 'COMPLETED', '395.00000000000006'],
  ['CARD_PAYMENT', 'Current', '46271.333333333336', null, 'Pending shop', '-9.99', '0', 'EUR', 'PENDING', null],
  ['CARD_PAYMENT', 'Current', '46271.5', '46271.5', 'Reverted shop', '-20', '0', 'EUR', 'REVERTED', null],
  ['EXCHANGE', 'Current', '46270.333333333336', '46270.333333333336', 'Exchanged from EUR', '86', '0', 'GBP', 'COMPLETED', '86'],
];

test('Excel: a Revolut-like download is an account per currency, in minor units, nothing pending', async () => {
  // Dates are date cells shown with their time; amounts are numbers, some with a float's noise.
  const styles = stylesXml([0, 164], { 164: 'yyyy-mm-dd hh:mm:ss' });
  const asCell = (v, i) => (v == null ? null : i === 2 || i === 3 ? { v, s: 1 } : i >= 5 && i !== 7 && i !== 8 ? { v } : v);
  const bytes = xlsxOf([{ name: 'Account statement', rows: [REVOLUT_HEADER, ...REVOLUT_LINES.map((r) => r.map(asCell))] }], { styles, deflate: true });
  const rows = (await xlsxSheets(bytes))[0].rows;
  assert.deepEqual(rows[1], ['TOPUP', 'Current', '2026-09-01 10:00', '2026-09-01 10:00', 'Top-up by *1234', '500', '0', 'EUR', 'COMPLETED', '500']);
  assert.deepEqual(rows[3].slice(2, 10), ['2026-09-05 08:00', '2026-09-05 08:00', 'Exchanged to GBP', '-100', '0.5', 'EUR', 'COMPLETED', '395']);

  const statement = await readXlsxStatement(bytes, { fileName: 'account-statement_2026-09-01_2026-09-30_en.xlsx' });
  assert.equal(statement.reader, 'CSV');
  assert.equal(statement.institution, 'Revolut');
  assert.deepEqual(statement.accounts.map((a) => a.name), ['Revolut EUR', 'Revolut GBP']);
  // Nothing in the file names the account (a brand alone would be the same for everyone's), as for the CSV.
  assert.deepEqual(statement.accounts.map((a) => a.ref), [null, null]);
  const [euro, pound] = statement.accounts;
  assert.equal(euro.currency, 'EUR');
  // The exchange's fee is taken from its amount: -100.00 and 0.50 are -10050.
  assert.deepEqual(amounts(euro), [50_000, -450, -10_050]);
  assert.deepEqual(dates(euro), ['2026-09-01', '2026-09-04', '2026-09-05']);
  assert.deepEqual(euro.lines.map((l) => l.running), [50_000, 49_550, 39_500]);
  assert.equal(euro.opening, 0);
  assert.equal(euro.closing, 39_500);
  assert.ok(euro.check.ok);
  assert.deepEqual(amounts(pound), [8_600]);
  assert.equal(pound.closing, 8_600);
  assert.ok(pound.check.ok);
  assert.deepEqual(statement.period, { from: '2026-09-01', to: '2026-09-05' });

  // The same table saved as CSV reads the same, and readCsvRows is readCsvStatement after parsing.
  const csv = [REVOLUT_HEADER, ...rows.slice(1)].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  const fromCsv = readCsvStatement(csv, { fileName: statement.fileName });
  assert.deepEqual(fromCsv.accounts.map((a) => [a.name, amounts(a), dates(a), a.closing]),
    statement.accounts.map((a) => [a.name, amounts(a), dates(a), a.closing]));
  assert.deepEqual(readCsvRows(parseCsv(csv), { fileName: statement.fileName }), fromCsv);
});

test('Excel: a BBVA-like Spanish download, its table under the bank’s own rows, from column B', async () => {
  const styles = stylesXml([0, 164], { 164: 'dd/mm/yyyy' });
  const day = (serial) => ({ v: String(serial), s: 1 });
  const rows = [
    [], [null, 'Últimos movimientos'], [null, 'Cuenta', 'ES00 0000 0000 0000 0000 1234'], [null, 'Fecha de consulta', day(46295)], [],
    [null, 'F.Valor', 'Fecha', 'Concepto', 'Movimiento', 'Importe', 'Divisa', 'Disponible', 'Divisa', 'Observaciones'],
    [null, day(46268), day(46268), 'Supermercado Ejemplo', 'Pago con tarjeta', { v: '-23.399999999999999' }, 'EUR', { v: '1476.85' }, 'EUR', ''],
    [null, day(46266), day(46266), 'Nómina Example Studio', 'Transferencia recibida', { v: '1500.25' }, 'EUR', { v: '1500.25' }, 'EUR', 'Septiembre'],
  ];
  const bytes = xlsxOf([{ name: 'Movimientos', rows }], { styles });
  const sheetRows = (await xlsxSheets(bytes))[0].rows;
  assert.deepEqual(sheetRows[6], ['', '2026-09-03', '2026-09-03', 'Supermercado Ejemplo', 'Pago con tarjeta', '-23.4', 'EUR', '1476.85', 'EUR']);
  const statement = await readXlsxStatement(bytes, { fileName: 'movimientos.xlsx' });
  // The same table as a CSV, for what the CSV reader makes of Spanish headings.
  const csv = readCsvStatement(sheetRows.filter((r) => r.length).map((r) => r.map((c) => `"${c}"`).join(',')).join('\n'));
  if (!csv.accounts.length) {
    // The bank CSV reader knows no Spanish headings yet (Fecha, Concepto, Importe, Disponible):
    // this layout isn't read from a CSV, so it isn't from Excel either. When it learns them, the
    // lines below must come out of the workbook as they come out of the CSV.
    assert.equal(statement.reader, null);
    assert.equal(statement.unknownCsv, true);
    assert.deepEqual(statement.accounts, []);
    return;
  }
  const account = statement.accounts[0];
  assert.deepEqual(amounts(account), [150_025, -2_340]);
  assert.deepEqual(dates(account), ['2026-09-01', '2026-09-03']);
  assert.deepEqual(statement.accounts.map((a) => [amounts(a), dates(a), a.closing]), csv.accounts.map((a) => [amounts(a), dates(a), a.closing]));
});

test('Excel: a Wise statement in Excel is read by Wise’s own reader', async () => {
  const header = ['TransferWise ID', 'Date', 'Amount', 'Currency', 'Description', 'Running Balance'];
  const bytes = xlsxOf([{ name: 'Statement', rows: [header,
    ['CARD-2', '02-03-2026', { v: '-0.5' }, 'USD', 'Card spend', { v: '199.5' }],
    ['TRANSFER-1', '01-03-2026', 200, 'USD', 'Received money', 200]] }]);
  const statement = await readXlsxStatement(bytes, { fileName: 'statement_123456_USD_2026-03-01_2026-03-31.xlsx' });
  assert.equal(statement.reader, 'INTL-Wise');
  assert.deepEqual(amounts(statement.accounts[0]), [20_000, -50]);
  assert.equal(statement.accounts[0].closing, 19_950);
  assert.ok(statement.accounts[0].check.ok);
});

test('Excel: a sheet that names no currency adds up by month beside one that does', async () => {
  // The statements page sums every statement by month and currency; a sheet without a currency
  // column has none, and once stopped the page from drawing (a QIF did the same).
  const none = await readXlsxStatement(xlsxOf([{ name: 'Lines', rows: [['Date', 'Amount'], ['2026-09-01', -12.3]] }]), { fileName: 'a.xlsx' });
  const euro = readCsvStatement('Date,Amount,Currency\n2026-09-02,100.00,EUR', { fileName: 'b.csv' });
  for (const statements of [[none, euro], [euro, none]]) {
    assert.deepEqual(monthly(labelLines(statements)).map((m) => [m.month, m.currency, m.in, m.out]),
      [['2026-09', null, 0, 1_230], ['2026-09', 'EUR', 10_000, 0]]);
  }
});

test('Excel: a workbook with no table of lines says so', async () => {
  const bytes = xlsxOf([{ name: 'People', rows: [['Name', 'Email'], ['Sam Example', 'sam@example.com']] }, { name: 'Empty', rows: [] }]);
  assert.deepEqual(await readXlsxStatement(bytes, { fileName: 'people.xlsx' }),
    { reader: null, fileName: 'people.xlsx', accounts: [], unknownCsv: true });
});

test('Excel: what isn’t a workbook is known by what is in it, and isn’t read', async () => {
  const workbook = xlsxOf([{ name: 'Sheet1', rows: [['Date', 'Amount']] }]);
  assert.ok(looksLikeXlsx(workbook));
  assert.ok(looksLikeXlsx(workbook.buffer.slice(workbook.byteOffset, workbook.byteOffset + workbook.byteLength)));
  const zipOfCsv = zipOf([{ name: 'statement.csv', data: 'Date,Amount\n2026-09-01,5.00' }]);
  const wordFile = zipOf([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: 'word/document.xml', data: '<w:document/>' }]);
  const notWorkbooks = [new TextEncoder().encode('%PDF-1.7\n%made up'), new TextEncoder().encode('Date,Amount\n2026-09-01,5.00'),
    zipOfCsv, wordFile, new Uint8Array(0)];
  for (const bytes of notWorkbooks) {
    assert.equal(looksLikeXlsx(bytes), false);
    await assert.rejects(xlsxSheets(bytes));
    await assert.rejects(readXlsxStatement(bytes, { fileName: 'statement.xlsx' }));
  }
  assert.ok(isXlsxName('Statement.XLSX'));
  assert.ok(!isXlsxName('statement.xls') && !isXlsxName('statement.xlsx.csv'));

  // The older Office container: an .xls workbook, or an .xlsx saved with a password to open.
  const container = (streams) => {
    const bytes = new Uint8Array(1536);
    bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    bytes.set(new Uint8Array(Buffer.from(streams, 'utf16le')), 1024);
    return bytes;
  };
  assert.equal(unreadableExcel(container('Workbook')), 'xls');
  assert.equal(unreadableExcel(container('EncryptionInfo\0EncryptedPackage')), 'password');
  assert.equal(unreadableExcel(workbook), null);
  assert.equal(unreadableExcel(new TextEncoder().encode('Date,Amount')), null);
});
