// A bank's Excel download (.xlsx), read the way its CSV is read. Pure functions: no network, no
// storage, no library. An .xlsx file is a zip of XML parts: the workbook lists its sheets, each
// sheet holds its cells, the shared strings hold their text and the styles say which numbers are
// dates. The zip is opened with the zip reader the CSV files use, the XML is scanned with regular
// expressions (no DOMParser, so it runs in Node as in the browser), and each sheet becomes rows of
// text, as the bank's CSV would have them. The first sheet with a table of lines is read by the
// CSV readers (readers.js). A number is written out from its own digits and never goes through a
// float, so an amount comes out exactly as the cell shows it.

import { unzip, readCsvRows } from './readers.js?v=30';

export const isXlsxName = (name) => /\.xlsx$/i.test(name);

// ---------------------------------------------------------------------------------------------
// XML, scanned: any namespace prefix (x:c, x:row), attributes in any order, self-closing or not

const PREFIX = '(?:[\\w.-]+:)?';
// The attributes of a tag, lazily: a quoted value may hold a ">" or a "/".
const ATTRIBUTES = '((?:[^>"\']|"[^"]*"|\'[^\']*\')*?)';

/** `<tag …/>` or `<tag …>inner</tag>`: [whole, attributes, inner], inner undefined when self-closing. */
const element = (tag, flags = 'g') =>
  new RegExp(`<${PREFIX}${tag}(?=[\\s/>])${ATTRIBUTES}(?:/>|>([\\s\\S]*?)</${PREFIX}${tag}\\s*>)`, flags);

const SI = element('si');
const T = element('t');
const PHONETIC = element('rPh');
const ROW = element('row');
const CELL = element('c');
const VALUE = element('v', '');
const INLINE = element('is', '');
const NUMFMTS = element('numFmts', '');
const NUMFMT = element('numFmt');
const CELLXFS = element('cellXfs', '');
const XF = element('xf');
const SHEET = element('sheet');
const WORKBOOK_PROPERTIES = element('workbookPr', '');
const RELATIONSHIP = element('Relationship');

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY = /&(?:#(\d+)|#x([\da-fA-F]+)|(lt|gt|amp|quot|apos));/g;
const NAMED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

const character = (n) => (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\uFFFD');

/** `&amp;`, `&#10;`, `&#x263A;` → their characters. */
const entities = (s) => s.replace(ENTITY, (_, dec, hex, name) => (name ? NAMED[name] : character(dec ? Number(dec) : parseInt(hex, 16))));

/** A tag's attributes by name, as written (`r`, `s`, `r:id`), their entities decoded. */
function attributes(text) {
  const found = Object.create(null);
  for (const m of (text ?? '').matchAll(ATTRIBUTE)) found[m[1]] = entities(m[2] ?? m[3]);
  return found;
}

/**
 * A cell's text as Excel holds it → the text itself: entities, CDATA taken as it is, then Excel's
 * own escapes for characters XML can't carry (`_x000D_` is a carriage return, `_x005F_` an underscore).
 */
function cellText(raw) {
  if (!/[&<_]/.test(raw ?? '')) return raw ?? '';
  const parts = String(raw).split(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return parts.map((p, i) => (i % 2 ? p : entities(p))).join('')
    .replace(/_x([\da-fA-F]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** The text of a shared or inline string: its `<t>`, or its rich-text runs' `<t>`s joined. A phonetic run (`<rPh>`) is a reading aid, not text. */
function stringText(xml) {
  let text = '';
  for (const m of xml.replace(PHONETIC, '').matchAll(T)) text += cellText(m[2] ?? '');
  return text;
}

// ---------------------------------------------------------------------------------------------
// Numbers and dates, as Excel shows them

/**
 * A number as the sheet stores it → the decimal Excel shows, to 15 significant digits and without
 * a float's noise: "1234.5600000000001" → "1234.56", "-0.30000000000000004" → "-0.3",
 * "1E-3" → "0.001". Worked on the digits as text (rounding with a BigInt), never through a float.
 * Text that isn't a number comes back as it is.
 */
function excelNumber(text) {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d{1,6}))?$/.exec(text);
  if (!m || !(m[2] || m[3])) return text;
  const all = m[2] + (m[3] ?? '');
  let digits = all.replace(/^0+/, '');
  // The value is `digits` with the decimal point after its first `point` digits.
  let point = m[2].length + Number(m[4] ?? 0) - (all.length - digits.length);
  if (!digits) return '0';
  if (digits.length > 15) {
    let kept = digits.slice(0, 15);
    if (digits[15] >= '5') kept = (BigInt(kept) + 1n).toString();
    if (kept.length > 15) { kept = kept.slice(0, 15); point += 1; }
    digits = kept;
  }
  digits = digits.replace(/0+$/, '');
  if (Math.abs(point) > 400) return text;
  const shown = point <= 0 ? `0.${'0'.repeat(-point)}${digits}`
    : point >= digits.length ? digits + '0'.repeat(point - digits.length)
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return m[1] === '-' ? `-${shown}` : shown;
}

const two = (n) => String(n).padStart(2, '0');

/** A day number → "YYYY-MM-DD", from 1899-12-30 (or 1904-01-01 for a 1904 workbook). Null past 9999. */
function serialDay(days, date1904) {
  if (days > 2_958_465) return null;
  // Excel counts a 29 February 1900 that never was, so its days before March are one later.
  if (!date1904 && days === 60) return '1900-02-29';
  const d = new Date(date1904 ? Date.UTC(1904, 0, 1 + days) : Date.UTC(1899, 11, days < 60 ? 31 + days : 30 + days));
  return d.getUTCFullYear() > 9999 ? null : `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
}

/**
 * A date serial shown with a date format → "YYYY-MM-DD", or "YYYY-MM-DD HH:MM" when the format
 * shows hours and the value has a time; a time format alone → "HH:MM". Null when Excel can't
 * show it as a date (below zero, past 9999). Dates are whole days, never money.
 */
function excelDate(serial, format, date1904) {
  if (!Number.isFinite(serial) || serial < 0) return null;
  let days = Math.floor(serial);
  let seconds = Math.round((serial - days) * 86_400);
  if (seconds >= 86_400) { days += 1; seconds -= 86_400; }
  const time = `${two(Math.floor(seconds / 3600))}:${two(Math.floor(seconds / 60) % 60)}`;
  if (!format.date) return time;
  const day = serialDay(days, date1904);
  if (day == null) return null;
  return format.hours && seconds > 0 ? `${day} ${time}` : day;
}

/** A cell typed as a date (`t="d"`), written ISO 8601 → as excelDate would show it. */
function isoCell(text, format) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?/.exec(text);
  if (!m) return text;
  const time = m[2] != null ? `${m[2]}:${m[3]}` : '00:00';
  if (format && !format.date) return time;
  return time !== '00:00' && (!format || format.hours) ? `${m[1]} ${time}` : m[1];
}

/** Built-in number formats that show a date or a time: 14 to 22, 45 to 47, and the East Asian 27 to 36 and 50 to 58. */
const BUILT_IN_DATE = (id) => (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58);
/** Of those, the ones that show a time of day and no date. */
const BUILT_IN_TIME = new Set([18, 19, 20, 21, 32, 33, 45, 46, 47]);

/**
 * What a number format shows: null for a number, or `{ date, hours }`, where `date` is false for
 * a time of day alone. A custom format is a date when it has a d or a y once its quoted text,
 * escaped characters, `[…]` sections (colours, conditions, locales) and padding are taken out;
 * one with a # or ? is a number's, whatever letters it has.
 */
function formatKind(id, code) {
  if (code == null) {
    return BUILT_IN_DATE(id) ? { date: !BUILT_IN_TIME.has(id), hours: BUILT_IN_TIME.has(id) || id === 22 } : null;
  }
  const bare = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '').replace(/[_*]./g, '');
  if (/[#?]/.test(bare) || /^\s*(general|standard)\s*$/i.test(bare)) return null;
  const date = /[dy]/i.test(bare);
  if (!date && !/[hs]/i.test(bare)) return null;
  return { date, hours: /h/i.test(bare) };
}

/** styles.xml → what each cell style's number format shows (formatKind), by the style's number (`s`). */
function cellFormats(xml) {
  if (!xml) return [];
  const codes = new Map();
  for (const [, attrs] of (NUMFMTS.exec(xml)?.[2] ?? '').matchAll(NUMFMT)) {
    const a = attributes(attrs);
    if (a.numFmtId != null && a.formatCode != null) codes.set(Number(a.numFmtId), a.formatCode);
  }
  return [...(CELLXFS.exec(xml)?.[2] ?? '').matchAll(XF)].map(([, attrs]) => {
    const id = Number(attributes(attrs).numFmtId ?? 0);
    return formatKind(id, codes.get(id));
  });
}

// ---------------------------------------------------------------------------------------------
// Sheets

const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;
const CELL_REFERENCE = /^([A-Za-z]{1,3})(\d{1,7})$/;

/** "7" → 6: a row or column number from 1 → its place from 0. Null when it isn't one Excel has. */
const place = (n, most) => (Number.isInteger(n) && n >= 1 && n <= most ? n - 1 : null);
const columnPlace = (letters) => place([...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0), MAX_COLUMNS);

/** One cell → its text, as the sheet shows it. */
function cellValue(a, inner, strings, formats, date1904) {
  const value = VALUE.exec(inner)?.[2];
  const format = formats[/^\d+$/.test(a.s ?? '') ? Number(a.s) : 0] ?? null;
  const inline = () => {
    const is = INLINE.exec(inner);
    return is ? stringText(is[2] ?? '') : null;
  };
  switch (a.t) {
    case 's': return strings[/^\s*\d+\s*$/.test(value ?? '') ? Number(value) : -1] ?? '';
    case 'inlineStr': return inline() ?? cellText(value ?? '');
    case 'str': case 'e': return cellText(value ?? '');
    case 'b': return value == null ? '' : /^\s*(1|true)\s*$/i.test(value) ? 'TRUE' : 'FALSE';
    case 'd': return value == null ? '' : isoCell(cellText(value).trim(), format);
    default: {
      // A number; inline text with its type left off is still text, and text where a number
      // should be is kept as it is.
      if (value == null) return inline() ?? '';
      const text = cellText(value).trim();
      const shown = format && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text) ? excelDate(Number(text), format, date1904) : null;
      return shown ?? excelNumber(text);
    }
  }
}

/**
 * A sheet's XML → rows of text. A cell's place comes from its reference ("C7"), so the cells and
 * rows a sheet leaves out are empty: '' within a row, [] between rows. Empty cells at the end of
 * a row, and empty rows at the end of the sheet, are left off.
 */
function sheetRows(xml, strings, formats, date1904) {
  const kept = [];
  let next = 0;
  for (const [, rowAttrs, rowInner = ''] of xml.matchAll(ROW)) {
    const cells = [];
    let at = place(Number(attributes(rowAttrs).r), MAX_ROWS);
    for (const [, cellAttrs, cellInner = ''] of rowInner.matchAll(CELL)) {
      const a = attributes(cellAttrs);
      const ref = CELL_REFERENCE.exec(a.r ?? '');
      if (at == null && ref) at = place(Number(ref[2]), MAX_ROWS);
      const column = (ref && columnPlace(ref[1])) ?? cells.length;
      while (cells.length < column) cells.push('');
      cells[column] = cellValue(a, cellInner, strings, formats, date1904);
    }
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    // Rows come in order; one that doesn't say where it is, or says so wrongly, comes next.
    if (at == null || at < next) at = next;
    next = at + 1;
    if (cells.length) kept.push([at, cells]);
  }
  const rows = [];
  for (const [at, cells] of kept) {
    while (rows.length < at) rows.push([]);
    rows.push(cells);
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// The workbook

/** A part's path as a key: forward slashes, no leading slash, any case. */
const partKey = (path) => String(path).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();

/** A relationship's target, from the folder of the part that names it: relative or absolute. */
function resolvePart(folder, target) {
  const parts = target.startsWith('/') ? [] : folder.split('/').filter(Boolean);
  for (const segment of target.replace(/\\/g, '/').split('/')) {
    if (segment === '..') parts.pop();
    else if (segment && segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

/** A .rels part → its relationships, as [{ id, type, target }], targets resolved from `folder`. */
function relationships(xml, folder) {
  const found = [];
  for (const [, attrs] of (xml ?? '').matchAll(RELATIONSHIP)) {
    const a = attributes(attrs);
    if (a.Id == null || a.Target == null || /^external$/i.test(a.TargetMode ?? '')) continue;
    found.push({ id: a.Id, type: a.Type ?? '', target: resolvePart(folder, a.Target) });
  }
  return found;
}

/** An XML part's bytes → text: UTF-8, or UTF-16 when it starts with that byte order mark. */
function xmlString(bytes) {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  try { return new TextDecoder(encoding).decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

const asBytes = (bytes) => (bytes instanceof Uint8Array ? bytes
  : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(0));

/**
 * An .xlsx file's bytes → its sheets in the workbook's order, as [{ name, rows }]. Each row is
 * the cells' text: shared and inline strings, TRUE and FALSE, errors as Excel shows them (#N/A),
 * dates as "YYYY-MM-DD" (with " HH:MM" when the format shows the time), and other numbers as the
 * decimal Excel shows. Rejects when the bytes aren't a zip holding a workbook.
 */
export async function xlsxSheets(bytes) {
  const files = new Map();
  for (const f of await unzip(asBytes(bytes))) files.set(partKey(f.path ?? f.name), f.bytes);
  const bytesOf = (path) => {
    if (path == null) return null;
    let decoded = path;
    try { decoded = decodeURIComponent(path); } catch { /* as written */ }
    return files.get(partKey(path)) ?? files.get(partKey(decoded)) ?? null;
  };
  const part = (path) => {
    const found = bytesOf(path);
    return found ? xmlString(found) : null;
  };
  // The package names its workbook; xl/workbook.xml when it doesn't.
  const main = relationships(part('_rels/.rels'), '').find((r) => /\/officeDocument$/i.test(r.type))?.target;
  const workbookPath = [main, 'xl/workbook.xml'].find((p) => p && bytesOf(p));
  if (!workbookPath) throw new Error('not an Excel workbook');
  const workbook = part(workbookPath);
  const folder = workbookPath.split('/').slice(0, -1).join('/');
  const rels = relationships(part(`${folder}/_rels/${workbookPath.split('/').pop()}.rels`), folder);
  const related = (type, usual) => part(rels.find((r) => r.type.endsWith(`/${type}`))?.target) ?? part(`${folder}/${usual}`);

  const strings = [...(related('sharedStrings', 'sharedStrings.xml') ?? '').matchAll(SI)].map((m) => stringText(m[2] ?? ''));
  const formats = cellFormats(related('styles', 'styles.xml'));
  const date1904 = /^\s*(1|true)\s*$/i.test(attributes(WORKBOOK_PROPERTIES.exec(workbook)?.[1]).date1904 ?? '');

  return [...workbook.matchAll(SHEET)].map(([, attrs]) => {
    const a = attributes(attrs);
    // The relationship's id is in the relationships namespace, under whatever prefix: r:id.
    const idName = Object.keys(a).find((k) => /:id$/i.test(k)) ?? (a.id != null ? 'id' : null);
    const path = rels.find((r) => idName && r.id === a[idName])?.target ?? `${folder}/worksheets/sheet${a.sheetId}.xml`;
    const xml = part(path);
    return { name: a.name ?? '', rows: xml ? sheetRows(xml, strings, formats, date1904) : [] };
  });
}

// ---------------------------------------------------------------------------------------------
// The statement

/**
 * Whether these bytes are an Excel workbook, whatever the file is called: a zip whose entries
 * include [Content_Types].xml and xl/workbook.xml. Reads the zip's list of entries, nothing more.
 */
export function looksLikeXlsx(bytes) {
  const b = asBytes(bytes);
  if (b.length < 22 || b[0] !== 0x50 || b[1] !== 0x4b || b[2] !== 0x03 || b[3] !== 0x04) return false;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) return false;
  const names = new Set();
  const decoder = new TextDecoder();
  let at = view.getUint32(end + 16, true);
  for (let n = view.getUint16(end + 10, true); n > 0 && at + 46 <= b.length; n--) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const length = view.getUint16(at + 28, true);
    names.add(partKey(decoder.decode(b.subarray(at + 46, at + 46 + length))));
    at += 46 + length + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return names.has('[content_types].xml') && names.has('xl/workbook.xml');
}

/**
 * Why an Excel file that isn't a zip can't be read: 'password' for a workbook saved with a
 * password to open (Excel keeps it encrypted in the older Office container), 'xls' for the older
 * .xls workbook itself, null for anything else.
 */
export function unreadableExcel(bytes) {
  const b = asBytes(bytes);
  const container = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (b.length < 512 || !container.every((x, i) => b[i] === x)) return null;
  // The container lists its streams by name in UTF-16: an encrypted workbook is "EncryptedPackage".
  return new TextDecoder('utf-16le').decode(b).includes('EncryptedPackage') ? 'password' : 'xls';
}

/**
 * One .xlsx file → one statement, as readCsvStatement gives for a CSV: each sheet in turn is read
 * by the CSV readers (Wise's, then any bank's from its header), and the first with lines in it is
 * the statement. A spreadsheet often has more above its table than a CSV (the bank's name, the
 * account, the period), so the header is looked for in the first hundred rows with something in
 * them, not only the first ten. A statement with no accounts when no sheet has a table of lines.
 * Any other options go to the CSV readers as they are. Rejects when the bytes aren't an Excel
 * workbook (looksLikeXlsx says which are).
 */
export async function readXlsxStatement(bytes, { fileName = null, ...options } = {}) {
  for (const sheet of await xlsxSheets(bytes)) {
    const rows = sheet.rows.filter((r) => r.length);
    for (let start = 0; start < Math.min(rows.length, 100); start += 10) {
      const statement = readCsvRows(rows.slice(start), { ...options, fileName });
      if (statement.accounts.length) return statement;
    }
  }
  return { reader: null, fileName, accounts: [], unknownCsv: true };
}
