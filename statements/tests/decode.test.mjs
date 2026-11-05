// node --test 'statements/tests/*.test.mjs'
// A bank file's bytes as text (decodeText): byte order marks, UTF-16 without one, UTF-8, and the
// code pages banks still write, told apart by which reading looks like words. The bytes are made
// here with an encoder built by turning TextDecoder round, so no library is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeText, ofxText, readCsvStatement } from '../readers.js';

/** Text → bytes in a code page, by reading every byte (or byte pair) the page has. */
const encoders = new Map();
function encoderFor(page) {
  if (encoders.has(page)) return encoders.get(page);
  const map = new Map();
  const decoder = new TextDecoder(page, { fatal: true });
  const tryBytes = (bytes) => {
    try {
      const ch = decoder.decode(Uint8Array.from(bytes));
      if ([...ch].length === 1 && !map.has(ch)) map.set(ch, bytes);
    } catch { /* not a character of this page */ }
  };
  for (let b = 0; b < 256; b++) tryBytes([b]);
  if (['shift_jis', 'euc-jp', 'gbk', 'big5', 'euc-kr'].includes(page)) {
    for (let lead = 0x81; lead <= 0xFE; lead++) for (let trail = 0x40; trail <= 0xFE; trail++) tryBytes([lead, trail]);
  }
  const encode = (text) => Uint8Array.from([...text].flatMap((c) => {
    const bytes = map.get(c);
    if (!bytes) throw new Error(`${page} has no ${c}`);
    return bytes;
  }));
  encoders.set(page, encode);
  return encode;
}
const encode = (text, page) => encoderFor(page)(text);
const utf8 = (text) => new TextEncoder().encode(text);

test('a byte order mark says UTF-8 or UTF-16, and goes', () => {
  assert.equal(decodeText(Uint8Array.from([0xEF, 0xBB, 0xBF, ...utf8('Datum;Betrag')])), 'Datum;Betrag');
  const le = Uint8Array.from([0xFF, 0xFE, ...[...'Date\tAmount'].flatMap((c) => [c.charCodeAt(0), 0])]);
  assert.equal(decodeText(le), 'Date\tAmount');
  const be = Uint8Array.from([0xFE, 0xFF, ...[...'Date\tAmount'].flatMap((c) => [0, c.charCodeAt(0)])]);
  assert.equal(decodeText(be), 'Date\tAmount');
});

test('UTF-16 without a mark: NUL in every other byte (Excel’s "Unicode text")', () => {
  const text = 'Date\tDescription\tAmount\tBalance\r\n20/08/2026\tAMAZON.CO.UK\t-45.20\t1189.36\r\n';
  const le = Uint8Array.from([...text].flatMap((c) => [c.charCodeAt(0), 0]));
  assert.equal(decodeText(le), text);
  const be = Uint8Array.from([...text].flatMap((c) => [0, c.charCodeAt(0)]));
  assert.equal(decodeText(be), text);
  // And the file reads, tabs and all.
  const account = readCsvStatement(decodeText(le), { fileName: 'export.csv' }).accounts[0];
  assert.equal(account.closing, 118_936);
});

test('valid UTF-8 is UTF-8', () => {
  const text = 'Ημερομηνία;Αιτιολογία;Ποσό\n29/06/2026;ΑΓΟΡΑ;38,40\n';
  assert.equal(decodeText(utf8(text)), text);
});

test('an OFX file that says CHARSET:1252 is read as Windows Latin, whatever else it might be', () => {
  const text = 'OFXHEADER:100\nCHARSET:1252\n\n<OFX><NAME>CafÃ©</OFX>';
  assert.equal(decodeText(utf8(text)), new TextDecoder('windows-1252').decode(utf8(text)));
  assert.equal(ofxText(utf8(text)), decodeText(utf8(text)));
});

test('code pages: the reading that looks like words wins, then the one with heading words, then Windows Latin', () => {
  const cases = [
    ['windows-1252', 'Buchungstag;Empfänger;Verwendungszweck;Betrag\n20.08.2026;Müller GmbH;Gebühr für Straße;-45,20\n'],
    ['windows-1250', 'Data operacji;Opis operacji;Kwota\n2026-08-20;Płatność kartą w sklepie;-45,20\n'],
    ['windows-1250', 'Číslo účtu;Datum zaúčtování;Částka;Měna\n123456789;29.10.2026;-129,00;CZK\n'],
    ['windows-1251', 'Дата;Описание;Сумма\n20.08.2026;Оплата в магазине;-45,20\n'],
    ['windows-1253', 'Ημερομηνία;Αιτιολογία;Ποσό\n29/06/2026;Αγορά σούπερ μάρκετ;38,40\n'],
    ['windows-1254', 'Tarih;Açıklama;Tutar\n20.08.2026;Mağaza alışverişi;-45,20\n'],
    ['windows-1257', 'Data;Išlaidos;Pajamos\n2026-08-20;45,20;\n'],
    ['iso-8859-2', 'Data;Opis;Kwota\n2026-08-20;Płatność kartą w sklepie Świętokrzyska;-45,20\n'],
    ['shift_jis', '取引日,入出金(円),取引後残高(円),入出金内容\n20261002,-6499,393501,口座振替　ノースウインド電力\n'],
    ['euc-kr', '거래일자,적요,출금액,입금액,잔액\n2026.10.02,카드결제,6499,,393501\n'],
    ['big5', '交易日期,說明,提出,存入,餘額\n2026/10/02,消費,85,,82264\n'],
    ['gbk', '交易日期,摘要,交易金额,余额\n2026-10-02,消费,-85.00,822.64\n'],
  ];
  for (const [page, text] of cases) assert.equal(decodeText(encode(text, page)), text, page);
});

test('a Windows-1250 mBank file reads with its Polish words whole', () => {
  const text = `#Data operacji;#Data księgowania;#Opis operacji;#Tytuł;#Nadawca/Odbiorca;#Kwota;#Saldo po operacji;
2026-08-20;2026-08-20;ZAKUP PRZY UŻYCIU KARTY;"SKLEP PRZYKŁADOWY";"";-45,20 PLN;1 189,36 PLN;
2026-08-09;2026-08-09;PRZELEW PRZYCHODZĄCY;"WYNAGRODZENIE SIERPIEŃ";"FIRMA SP. Z O.O.";2 000,00 PLN;1 234,56 PLN;
`;
  const account = readCsvStatement(decodeText(encode(text, 'windows-1250')), { fileName: 'eKonto.csv' }).accounts[0];
  assert.equal(account.currency, 'PLN');
  assert.deepEqual(account.lines.map((l) => l.description), ['FIRMA SP. Z O.O. · WYNAGRODZENIE SIERPIEŃ', 'SKLEP PRZYKŁADOWY']);
  assert.equal(account.closing, 118_936);
  assert.ok(account.check.ok);
});

test('Hebrew, Arabic and Thai code pages are read too (V2#15, V3#25)', () => {
  const pages = [
    ['windows-1255', 'תאריך,תיאור,סכום\n20/08/2026,קניה בסופר,-45.20\n', 'קניה בסופר'],
    ['windows-1256', 'التاريخ,الوصف,المبلغ\n20/08/2026,مشتريات,-45.20\n', 'مشتريات'],
    ['windows-874', 'วันที่,รายการ,ถอนเงิน,ฝากเงิน,ยอดคงเหลือ\n20/08/2026,ค่าอาหาร,100.00,,900.00\n', 'ค่าอาหาร'],
  ];
  for (const [page, text, words] of pages) {
    const decoded = decodeText(encode(text, page));
    assert.equal(decoded, text, page);
    const statement = readCsvStatement(decoded, { fileName: 'export.csv' });
    assert.equal(statement.general, false, `${page}: read from its header`);
    assert.equal(statement.accounts[0].lines[0].description, words, page);
  }
  // A French file in windows-1252 stays French: Hebrew letters between Latin ones aren't words.
  const french = 'Date;Libellé;Montant\n20/08/2026;Société Générale à Évry;-45,20\n';
  assert.equal(decodeText(encode(french, 'windows-1252')), french);
});

test('a byte a page leaves undefined never fails the reading: TextDecoder’s mapping, which the Swift port copies (V3#22)', () => {
  // An OFX header names windows-1252, whose 0x81 and 0x9D are the controls U+0081 and U+009D on the web (WHATWG).
  const bytes = Uint8Array.from([...utf8('OFXHEADER:100\nCHARSET:1252\n<NAME>caf'), 0xE9, 0x81, 0x9D, ...utf8('</NAME>\n')]);
  assert.equal(decodeText(bytes), 'OFXHEADER:100\nCHARSET:1252\n<NAME>café\u0081\u009D</NAME>\n');
  // Left to the scores, bytes that are letters only in windows-1251 read as Cyrillic; no reading ever fails.
  for (let b = 0x80; b <= 0xFF; b++) assert.equal(typeof decodeText(Uint8Array.from([...utf8('Date;Text\n2026-09-01;a'), b, ...utf8('b\n')])), 'string');
});

test('code pages told by their letters alone: Cyrillic isn’t accented Latin; Thai letters are words past their marks', () => {
  const russian = 'Date,Description,Amount\n01.09.2026,Магазин продукты,-10.00\n';
  assert.equal(decodeText(encode(russian, 'windows-1251')), russian);
  const thai = 'Date,Description,Amount\n20/08/2026,ค่าอาหารกลางวันที่ร้าน,-100.00\n';
  assert.equal(decodeText(encode(thai, 'windows-874')), thai);
});

test('a web page’s own word on its code page is taken: windows-1255 Hebrew, not Cyrillic', () => {
  const head = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1255"></head><body><table><tr><th>';
  const hebrew = [0xFA, 0xE0, 0xF8, 0xE9, 0xEA]; // תאריך in windows-1255
  const bytes = new Uint8Array([...new TextEncoder().encode(head), ...hebrew, ...new TextEncoder().encode('</th></tr></table></body></html>')]);
  assert.match(decodeText(bytes), /<th>תאריך<\/th>/);
});

