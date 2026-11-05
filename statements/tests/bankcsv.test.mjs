// node --test 'statements/tests/*.test.mjs'
// Any bank's CSV (BankCSV): every rule, each with a small file laid out as a real bank lays its
// export out. Every file here is made up: the names, numbers and lines. The app's Swift port reads
// the same words (csv-words.js is its Statements/CSV/words.json) and must give the same results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCsvStatement, csvAmount, csvDate, csvKey, dateOrderOf, dayFirstOf, validIban, minorDigits } from '../readers.js';
import { CSV_WORDS } from '../csv-words.js';

const amounts = (a) => a.lines.map((l) => l.amount);
const dates = (a) => a.lines.map((l) => l.date);
const descriptions = (a) => a.lines.map((l) => l.description);
const read = (text, fileName = 'export.csv', options = {}) => readCsvStatement(text, { fileName, ...options });

// ---------------------------------------------------------------------------------------------
// Words

test('keys: lowercase, no accents, punctuation as one space, any script kept', () => {
  assert.equal(csvKey('Betrag (€)'), 'betrag');
  assert.equal(csvKey('Zahlungsempfänger*in'), 'zahlungsempfanger in');
  assert.equal(csvKey('  Running Bal. '), 'running bal');
  assert.equal(csvKey('Ποσό'), 'ποσο');
  assert.equal(csvKey('ΠΟΣΌΣ'), 'ποσοσ');
  assert.equal(csvKey('取引日'), '取引日');
  assert.equal(csvKey('Omschrijving-1'), 'omschrijving 1');
  assert.equal(csvKey('Číslo účtu'), 'cislo uctu');
});

test('headings: the word itself first, then the word with a currency or a number after it', () => {
  // Rabobank: three numbered description columns join, in order.
  const rabo = read(`"IBAN/BBAN","Munt","Datum","Bedrag","Saldo na trn","Naam tegenpartij","Omschrijving-1","Omschrijving-2"
"NL91ABNA0417164300","EUR","2026-10-01","+2450,00","+3262,40","Voorbeeld Zorg B.V.","Salaris","oktober"
"NL91ABNA0417164300","EUR","2026-10-02","-1095,00","+2167,40","Stichting Woonvoorbeeld","Huur","oktober"`);
  assert.deepEqual(descriptions(rabo.accounts[0]), ['Voorbeeld Zorg B.V. · Salaris · oktober', 'Stichting Woonvoorbeeld · Huur · oktober']);
  assert.equal(rabo.accounts[0].opening, 81_240);
  // "Bedrag (EUR)" and a heading written as the currency's sign.
  const ing = read('Datum;Omschrijving;Bedrag (EUR)\n01-10-2026;Bakker;-2,50\n');
  assert.equal(ing.accounts[0].currency, 'EUR');
  const yen = read('取引日,入出金(円),入出金内容\n20261002,-6499,口座振替\n', 'RB-torihikimeisai.csv');
  assert.equal(yen.accounts[0].currency, 'JPY');
  assert.deepEqual(amounts(yen.accounts[0]), [-6_499]);
});

test('a column per currency (RBC): each line its filled one, and its currency', () => {
  const rbc = read(`"Account Type","Account Number","Transaction Date","Cheque Number","Description 1","Description 2","CAD$","USD$"
Chequing,01234-5678901,9/20/2026,,"CORNER GROCER","",-45.20,
Chequing,01234-5678901,9/9/2026,,"PAYROLL DEPOSIT","EXAMPLE STUDIO",2000.00,
Savings,01234-5670000,9/15/2026,,"TRANSFER","",,100.00`, 'csv12345.csv');
  assert.equal(rbc.institution, 'RBC');
  assert.deepEqual(rbc.accounts.map((a) => [a.name, a.currency]), [['RBC ·· 8901 CAD', 'CAD'], ['RBC ·· 0000 USD', 'USD']]);
  assert.deepEqual(amounts(rbc.accounts[0]), [200_000, -4_520]);
  assert.deepEqual(descriptions(rbc.accounts[0]), ['PAYROLL DEPOSIT · EXAMPLE STUDIO', 'CORNER GROCER']);
});

test('non-English headings: French, Spanish, Italian, Portuguese, Polish, Czech, Swedish, Greek, Japanese', () => {
  const files = [
    ['Date;Libellé;Débit euros;Crédit euros;\n20/08/2026;PAIEMENT PAR CARTE;45,20;;\n09/08/2026;VIREMENT EN VOTRE FAVEUR;;2 000,00;', 'EUR', [200_000, -4_520]],
    ['Fecha Operación;Fecha Valor;Concepto;Importe;Saldo\n20/08/2026;20/08/2026;COMPRA;-45,20;1189,36\n09/08/2026;09/08/2026;NOMINA;2000,00;1234,56', null, [200_000, -4_520]],
    ['Data registrazione;Data valuta;Descrizione;Importo (EUR)\n20.08.2026;20.08.2026;PAGAMENTO POS;-45,20\n09.08.2026;09.08.2026;BONIFICO;2.000,00', 'EUR', [200_000, -4_520]],
    ['Data mov. ;Data valor ;Descrição ;Débito ;Crédito ;Saldo contabilístico ;\n30-10-2026;30-10-2026;COMPRA ;54,20;;2716,85;\n23-10-2026;23-10-2026;SALARIO ;;600,00;2771,05;', null, [60_000, -5_420]],
    ['"Data operacji","Data waluty","Typ transakcji","Kwota","Waluta","Saldo po transakcji","Opis transakcji"\n"2026-08-20","2026-08-20","Płatność kartą","-45.20","PLN","+1189.36","Lokalizacja: SKLEP"\n"2026-08-09","2026-08-09","Przelew","+2000.00","PLN","+1234.56","Nadawca: FIRMA"', 'PLN', [200_000, -4_520]],
    ['číslo účtu;datum zaúčtování;částka;měna;zůstatek;název účtu protiúčtu;poznámka\n123456789;29.10.2026;-129,00;CZK;42959,80;;Platba kartou\n123456789;15.10.2026;38450,00;CZK;43088,80;FIRMA S.R.O.;Mzda', 'CZK', [3_845_000, -12_900]],
    ['Bokföringsdag;Belopp;Avsändare;Mottagare;Namn;Rubrik;Saldo;Valuta;\n2026/10/30;350,00;;1234 56 78901;;Swish;22308,85;SEK;\n2026/10/28;-129,00;1234 56 78901;;;Autogiro;21958,85;SEK;', 'SEK', [-12_900, 35_000]],
    ['Α/Α;Ημερομηνία;Αιτιολογία;Ποσό;Πρόσημο ποσού;\n1;29/06/2026;="ΑΓΟΡΑ";38,40;Χ;\n2;05/06/2026;="ΜΙΣΘΟΔΟΣΙΑ";1.550,00;Π;', null, [155_000, -3_840]],
    ['年月日,お引出し,お預入れ,お取り扱い内容,残高\n2026/10/02,6499,,口座振替,393501\n2026/10/23,,280000,給与,673501', 'JPY', [-6_499, 280_000]],
  ];
  for (const [text, currency, expected] of files) {
    const a = read(text).accounts[0];
    assert.ok(a, text.slice(0, 40));
    assert.equal(a.currency, currency, text.slice(0, 40));
    assert.deepEqual(amounts(a), expected, text.slice(0, 40));
  }
});

// ---------------------------------------------------------------------------------------------
// Finding the table

test('the header up to 40 rows down; the rows above give the account, currency, holder and balances', () => {
  // ING Deutschland: eleven rows above, the IBAN after its label, "Saldo" and the currency.
  const ing = read(`Umsatzanzeige;Datei erstellt am: 01.09.2026 10:00
;
IBAN;DE89 3704 0044 0532 0130 00
Kontoname;Girokonto
Bank;ING
Kunde;Max Mustermann
Zeitraum;01.08.2026 - 31.08.2026
Saldo;1.189,36;EUR
;
Sortierung;Datum absteigend
;
Buchung;Valuta;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Saldo;Währung;Betrag;Währung
20.08.2026;20.08.2026;AMAZON EU S.A.R.L.;Lastschrift;AMZN Mktp DE;1.189,36;EUR;-45,20;EUR
09.08.2026;09.08.2026;ACME GMBH;Gehalt/Rente;Gehalt August;1.234,56;EUR;2.000,00;EUR`, 'Umsatzanzeige_DE89370400440532013000_20260901.csv');
  const a = ing.accounts[0];
  assert.equal(ing.institution, 'ING');
  assert.equal(ing.holder, 'Max Mustermann');
  assert.deepEqual(ing.period, { from: '2026-08-01', to: '2026-08-31' });
  assert.equal(a.ref, 'CSV:DE89370400440532013000');
  assert.equal(a.name, 'ING ·· 3000');
  assert.equal(a.currency, 'EUR');
  assert.deepEqual(amounts(a), [200_000, -4_520]);
  assert.deepEqual(descriptions(a), ['ACME GMBH · Gehalt August', 'AMAZON EU S.A.R.L. · AMZN Mktp DE']);
  assert.equal(a.opening, -76_544);
  assert.equal(a.closing, 118_936);
});

test('balances above and below the table: labelled, in the label, unlabelled pairs and lone figures', () => {
  // Deutsche Bank: "Alter Saldo" above, "Kontostand" below; Soll and Haben beside an empty foreign Betrag.
  const db = read(`Umsätze;;;;
Konto:;Girokonto 123 4567890 00;;;
Alter Saldo:;1.234,56 EUR;;;
Buchungstag;Wert;Umsatzart;Begünstigter / Auftraggeber;Verwendungszweck;Betrag;Soll;Haben;Währung
20.08.2026;20.08.2026;Kartenzahlung;AMAZON EU;AMZN Mktp DE;;-45,20;;EUR
09.08.2026;09.08.2026;Gutschrift;ACME GMBH;Gehalt August;;;2.000,00;EUR
Kontostand:;3.189,36 EUR;;;`);
  const a = db.accounts[0];
  assert.equal(db.general, false, 'read from its header, not worked out from the cells');
  assert.deepEqual(a.notes, []);
  assert.deepEqual(amounts(a), [200_000, -4_520]);
  assert.equal(a.opening, 123_456);
  assert.equal(a.closing, 318_936);
  assert.ok(a.check.ok);
  assert.equal(a.ref, 'CSV:123456789000');
  // Crédit Agricole: the balance written inside its label, the only one: the opening is worked back.
  const ca = read(`Téléchargement du 04/11/2026;
Compte de Dépôt carte n° 12345678901;
Solde au 03/11/2026 1787,98 €

Date;Libellé;Débit euros;Crédit euros;
31/10/2026;"VIREMENT EN VOTRE FAVEUR M CAMILLE";;30,00;
24/10/2026;"PAIEMENT PAR CARTE CAFE";12,90;;`, 'CA20261104_101530.csv');
  const ac = ca.accounts[0];
  assert.equal(ac.closing, 178_798);
  assert.equal(ac.opening, 177_088);
  assert.equal(ac.openingWorkedOut, true);
  assert.equal(ac.ref, 'CSV:12345678901');
  // PNC: no header, a first row of the account, its dates and two balances the lines lead between.
  const pnc = read(`12345678,2026/09/01,2026/09/30,1608.22,2784.74
2026/09/02,2450.00,DIRECT DEPOSIT - PAYROLL,,000000001234567,CREDIT
2026/09/04,1395.00,ACH WEB-SINGLE RENT,,000000001234568,DEBIT
2026/09/23,121.52,MOBILE DEPOSIT,,000000001234571,CREDIT`, 'pnc.csv');
  const ap = pnc.accounts[0];
  assert.deepEqual(amounts(ap), [245_000, -139_500, 12_152]);
  assert.equal(ap.opening, 160_822);
  assert.equal(ap.closing, 278_474);
  assert.ok(ap.check.ok);
  assert.equal(ap.ref, 'CSV:12345678');
  // LCL: no header, and a lone figure below the lines that isn't their total: the balance.
  const lcl = read(`30/10/2026;-9,99;Carte;;CB STREAMING EXEMPLE 29/10/26;
14/10/2026;-45,00;Chèque;1234567;;
01/10/2026;2265,00;Virement;;VIR SEPA EXEMPLE SAS SALAIRE OCTOBRE;
;2172,72;;;;`, 'operations_04112026.csv');
  const al = lcl.accounts[0];
  assert.equal(al.closing, 217_272);
  assert.equal(al.openingWorkedOut, true);
  assert.deepEqual(descriptions(al), ['VIR SEPA EXEMPLE SAS SALAIRE OCTOBRE', 'Chèque · 1234567', 'CB STREAMING EXEMPLE 29/10/26']);
});

test('balance and total rows inside the table are not lines (Swedbank Estonia)', () => {
  const st = read(`"Kliendi konto";"Reatüüp";"Kuupäev";"Saaja/Maksja";"Selgitus";"Summa";"Valuuta";"Deebet/Kreedit";
"EE382200221020145685";"10";"01.10.2026";"";"Algsaldo";"1534,15";"EUR";"K";
"EE382200221020145685";"20";"02.10.2026";"NÄIDIS POOD OÜ";"Kaardimakse";"23,40";"EUR";"D";
"EE382200221020145685";"20";"15.10.2026";"NÄIDIS TARKVARA AS";"Palk";"2850,00";"EUR";"K";
"EE382200221020145685";"82";"31.10.2026";"";"Käive";"23,40";"EUR";"D";
"EE382200221020145685";"86";"31.10.2026";"";"Lõppsaldo";"4360,75";"EUR";"K";`);
  const a = st.accounts[0];
  assert.deepEqual(amounts(a), [-2_340, 285_000]);
  assert.equal(a.opening, 153_415);
  assert.equal(a.closing, 436_075);
  assert.ok(a.check.ok);
});

test('no header: columns told by their cells (Wells Fargo, TD, ABN AMRO, SNS)', () => {
  const wf = read(`"09/29/2026","-15.49","*","","RECURRING PAYMENT EXAMPLE STREAMING"
"09/25/2026","2860.00","*","","EXAMPLE STUDIO PAYROLL"
"09/09/2026","-120.00","*","1042","CHECK # 1042"`, 'Checking1.csv');
  assert.equal(wf.general, true);
  assert.equal(wf.institution, 'Wells Fargo');
  const w = wf.accounts[0];
  assert.deepEqual(w.notes, ['read without a header: check each line', 'no balance in the file']);
  assert.deepEqual(dates(w), ['2026-09-09', '2026-09-25', '2026-09-29']);
  assert.deepEqual(amounts(w), [-12_000, 286_000, -1_549]);
  // TD: money out and in never on the same line, and a balance that follows from them.
  const td = read('08/20/2026,AMAZON.CA,45.20,,1189.36\n08/09/2026,ACME PAYROLL,,2000.00,1234.56\n', 'accountactivity.csv');
  assert.deepEqual(amounts(td.accounts[0]), [200_000, -4_520]);
  assert.equal(td.accounts[0].closing, 118_936);
  // ABN AMRO: the account and currency in every row, a start and end balance either side of the amount.
  const abn = read('123456789\tEUR\t20261001\t1640,25\t390,25\t20261001\t-1250,00\tHuur oktober\n'
    + '123456789\tEUR\t20261024\t390,25\t3005,55\t20261024\t2615,30\tSalaris oktober\n', 'TXT261104101530.TAB');
  const ab = abn.accounts[0];
  assert.equal(ab.ref, 'CSV:123456789');
  assert.equal(ab.currency, 'EUR');
  assert.equal(ab.opening, 164_025);
  assert.equal(ab.closing, 300_555);
  assert.ok(ab.check.ok);
  // SNS: the balance before each line.
  const sns = read(`01-10-2026,NL12SNSB0123456789,NL91ABNA0417164300,Voorbeeld Onderwijs BV,,,,EUR,950.20,EUR,2185.40,'Salaris oktober'
02-10-2026,NL12SNSB0123456789,NL02RABO0123456789,Woonvoorbeeld BV,,,,EUR,3135.60,EUR,-1075.00,'Huur oktober'
13-10-2026,NL12SNSB0123456789,,,,,,EUR,2060.60,EUR,-32.15,'[PIN BETALING] SUPERMARKT'`, 'transactie-historie.csv');
  const sn = sns.accounts[0];
  assert.equal(sn.opening, 95_020);
  assert.equal(sn.closing, 202_845);
  assert.ok(sn.check.ok);
  assert.deepEqual(descriptions(sn), ['Voorbeeld Onderwijs BV · Salaris oktober', 'Woonvoorbeeld BV · Huur oktober', '[PIN BETALING] SUPERMARKT']);
  // Nothing clear: refused rather than guessed.
  assert.equal(read('a,b,c\n1,2,3\n').accounts.length, 0);
});

test('Label: value blocks (Santander UK .txt)', () => {
  const nb = ' ';
  const text = [`From:${nb}01/09/2026 to 30/09/2026`, '\t\t\t\t\t\t\t', `Account:${nb}XXXX XXXX XXXX 1234`, '\t\t\t\t\t\t',
    `Date:${nb}29/09/2026`, `Description:${nb}FASTER PAYMENTS RECEIPT FROM A FRIEND`, `Amount:${nb}25.00\t`, `Balance:${nb}1538.39`, '\t\t\t\t\t\t',
    `Date:${nb}01/09/2026`, `Description:${nb}DIRECT DEBIT NORTHWIND ENERGY`, `Amount:${nb}-64.99\t`, `Balance:${nb}1513.39`, ''].join('\r\n');
  const st = read(text, 'santander.txt');
  const a = st.accounts[0];
  assert.deepEqual(st.period, { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(amounts(a), [-6_499, 2_500]);
  assert.equal(a.opening, 157_838);
  assert.equal(a.closing, 153_839);
  assert.ok(a.check.ok);
  assert.equal(a.name, 'Santander ·· 1234');
  // A number shown masked is its last four digits, with the bank's name (verification N7).
  assert.equal(a.ref, 'CSV:Santander:1234');
});

// ---------------------------------------------------------------------------------------------
// Reading a row

test('dates: every form read whole, month names in many languages, eras and scripts', () => {
  const cases = [
    ['2026-08-20', '2026-08-20'], ['2026/08/20', '2026-08-20'], ['2026.08.20', '2026-08-20'], ['20260820', '2026-08-20'],
    ['20.08.2026', '2026-08-20'], ['20-08-2026', '2026-08-20'], ['20/08/26', '2026-08-20'], ['2026. 8. 20.', '2026-08-20'],
    ['2026年8月20日', '2026-08-20'], ['2026년 8월 20일', '2026-08-20'], ['20 Aug 2026', '2026-08-20'], ['Aug 20, 2026', '2026-08-20'],
    ['20. August 2026', '2026-08-20'], ['20 de agosto de 2026', '2026-08-20'], ['1er août 2026', '2026-08-01'], ['20 sierpnia 2026', '2026-08-20'],
    ['20 Ağustos 2026', '2026-08-20'], ['20 αυγούστου 2026', '2026-08-20'], ['20 августа 2026', '2026-08-20'], ['20/08/2569', '2026-08-20'],
    ['2026-08-20T10:31:00+02:00', '2026-08-20'], ['20.08.2026 10:31', '2026-08-20'], ['19900101', '1990-01-01'],
    ['31/02/2026', null], ['18991231', null], ['Total', null], ['20 Aug', null],
  ];
  for (const [text, expected] of cases) assert.equal(csvDate(text), expected, text);
  assert.equal(csvDate('08/20/2026', false), '2026-08-20');
});

test('day or month first: the dates, their order, then the bank, the currency, commas, the main currency', () => {
  assert.deepEqual(dateOrderOf(['13/01/2026']), { order: 'DMY', dayFirst: true, guessed: false });
  assert.deepEqual(dateOrderOf(['01/13/2026']), { order: 'MDY', dayFirst: false, guessed: false });
  // Only month first keeps these in order.
  assert.deepEqual(dateOrderOf(['01/02/2026', '02/01/2026', '03/01/2026']), { order: 'MDY', dayFirst: false, guessed: false });
  const tied = ['09/02/2026', '09/01/2026'];
  assert.deepEqual(dateOrderOf(tied, { bankOrder: 'MDY' }), { order: 'MDY', dayFirst: false, guessed: false });
  assert.deepEqual(dateOrderOf(tied, { currency: 'CAD' }), { order: 'MDY', dayFirst: false, guessed: true });
  assert.deepEqual(dateOrderOf(tied, { currency: 'GBP' }), { order: 'DMY', dayFirst: true, guessed: true });
  assert.deepEqual(dateOrderOf(tied, { decimalComma: true, mainCurrency: 'USD' }), { order: 'DMY', dayFirst: true, guessed: true });
  assert.deepEqual(dateOrderOf(tied, { mainCurrency: 'USD' }), { order: 'MDY', dayFirst: false, guessed: true });
  assert.deepEqual(dateOrderOf(tied, { dayFirstWhenUnsure: false }), { order: 'MDY', dayFirst: false, guessed: true });
  assert.deepEqual(dateOrderOf(tied), { order: 'DMY', dayFirst: true, guessed: true });
  assert.deepEqual(dateOrderOf(['2026-09-02']), { order: 'YMD', dayFirst: true, guessed: false });
  assert.equal(dayFirstOf(tied, false), false);
  // On the statement, so the review can say the dates could be read either way.
  const plain = read('Date,Description,Amount\n09/02/2026,Shop,-5.00\n09/01/2026,Pay,10.00\n', 'export.csv', { mainCurrency: 'USD' });
  assert.equal(plain.dateOrder, 'MDY');
  assert.equal(plain.dateOrderGuessed, true);
  assert.equal(plain.accounts[0].lines[0].date, '2026-09-01');
  // A US bank's file is month first by the bank, whatever the main currency (Wells Fargo, every day 12 or less).
  const wf = read('"09/12/2026","-15.49","*","","STREAMING"\n"09/10/2026","2860.00","*","","PAYROLL"\n', 'Checking1.csv', { mainCurrency: 'EUR' });
  assert.equal(wf.dateOrder, 'MDY');
  assert.equal(wf.dateOrderGuessed, false);
  assert.deepEqual(dates(wf.accounts[0]), ['2026-09-10', '2026-09-12']);
});

test('amounts: every way banks write them', () => {
  const cases = [
    ['1 234,56', 123_456], ['1 234,56', 123_456], ['1 234,56', 123_456], ['1 234,56', 123_456], ["1'234.56", 123_456],
    ['1’234.56', 123_456], ['1.234.567,89', 123_456_789], ['1,23,456.78', 12_345_678], ['+1,234.56', 123_456], ['1.234,56-', -123_456],
    ['(1,234.56)', -123_456], ['1,234.56 CR', 123_456], ['1,234.56 DR', -123_456], ['12.00 Dr.', -1_200], ['12.00 Cr.', 1_200],
    ['€ 12,50', 1_250], ['12,50 €', 1_250], ['£12.00', 1_200], ['$-45.20', -4_520], ['CHF 1’234.50', 123_450], ['12,50 zł', 1_250],
    ['100 kr', 10_000], ['1 234,00 Kč', 123_400], ['₹1,23,456.00', 12_345_600], ['R$ 1.234,56', 123_456], ['C$12.00', 1_200], ['A$12.00', 1_200],
    ['−45.20', -4_520], ['245.000', 24_500_000], ['-', null], ['', null], ['n/a', null],
  ];
  for (const [text, expected] of cases) assert.equal(csvAmount(text, 2), expected, text);
  // Currencies without decimals: yen, won, krónur.
  assert.equal(minorDigits('ISK'), 0);
  assert.equal(csvAmount('12 345', 0), 12_345);
  assert.equal(csvAmount('-2.450', 0), -2_450);
  assert.equal(csvAmount('1 234,00 kr', 0), 1_234);
  // Three decimals keep the dot as the point.
  assert.equal(csvAmount('1.234', 3), 1_234);
  // A column's decimal mark decides: "2.000" among decimal commas is two thousand.
  assert.equal(csvAmount('2.000', 2, ','), 200_000);
  const kbc = read('Datum;Omschrijving;Bedrag\n01/10/2026;Huur;-1.000\n02/10/2026;Bakker;-2,50\n');
  assert.deepEqual(amounts(kbc.accounts[0]), [-100_000, -250]);
});

test('a sign column: Af Bij (ING), Debit/Credit (Capital One 360, Navy Federal), Χ/Π (Alpha Bank)', () => {
  const ing = read(`"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen";"Saldo na mutatie"
"20261027";"Webwinkel Voorbeeld";"NL20INGB0001234567";"";"ID";"Af";"18,99";"iDEAL";"Bestelling 1234567";"3103,81"
"20261024";"Voorbeeld Software B.V.";"NL20INGB0001234567";"";"OV";"Bij";"2840,00";"Overschrijving";"Salaris oktober";"3122,80"`);
  const a = ing.accounts[0];
  assert.deepEqual(amounts(a), [284_000, -1_899]);
  assert.equal(a.closing, 310_381);
  assert.ok(a.check.ok);
  assert.equal(a.ref, 'CSV:NL20INGB0001234567');
  // No sign heading ("Posting Code" is no word of `sign`), but a column whose every value is Debit or
  // Credit beside amounts that never carry a minus.
  const c360 = read(`Account Number,Transaction Date,Transaction Amount,Posting Code,Transaction Description,Balance
1234,09/22/26,89.99,Debit,Debit Card Purchase,3831.16
1234,09/16/26,200.00,Credit,Zelle money received,3921.15`);
  assert.deepEqual(amounts(c360.accounts[0]), [20_000, -8_999]);
  assert.equal(c360.accounts[0].type, 'current');
  assert.equal(c360.accounts[0].check.ok, true);
  // decaf's ref for an id of four characters or fewer: the bank's name (or "Account") before it.
  assert.equal(c360.accounts[0].ref, 'CSV:Account:1234');
});

test('pending lines are left out, in any language; fees come off; a footer is not a line', () => {
  const dkb = read(`"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)"
"20.08.26";"20.08.26";"Gebucht";"Max Mustermann";"AMAZON EU S.A.R.L.";"AMZN Mktp DE";"Ausgang";"DE98765432109876543210";"-45,2"
"21.08.26";"";"Vorgemerkt";"Max Mustermann";"STARBUCKS";"Kaffee";"Ausgang";"";"-6,75"
"09.08.26";"09.08.26";"Gebucht";"ACME GMBH";"Max Mustermann";"Gehalt August";"Eingang";"DE11111111111111111111";"2000"`);
  const a = dkb.accounts[0];
  assert.deepEqual(amounts(a), [200_000, -4_520]);
  // The holder is the name on both sides; the other side's IBAN is never the account's.
  assert.equal(dkb.holder, 'Max Mustermann');
  assert.deepEqual(descriptions(a), ['ACME GMBH · Gehalt August', 'AMAZON EU S.A.R.L. · AMZN Mktp DE']);
  assert.equal(a.ref, null);
  assert.equal(a.currency, 'EUR');
  const revolut = read(`Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
ATM,Current,2026-09-14 10:05:31,2026-09-14 10:05:33,Cash,-200.00,2.00,GBP,COMPLETED,1386.95
CARD_PAYMENT,Current,2026-09-12 19:02:55,,Example Cinema,-12.50,0.00,GBP,REVERTED,
Total,,,,,,,,,`);
  assert.deepEqual(amounts(revolut.accounts[0]), [-20_200]);
});

test('the other side: account numbers and the holder kept out, rows that carry it on (OCBC)', () => {
  const ocbc = read(`Account details for:,360 Account 601-234567-001
Ledger Balance,"3,307.90"

Transaction History
Transaction date,Value date,Description,Withdrawals (SGD),Deposits (SGD)
28/10/2026,28/10/2026,DEBIT PURCHASE,23.40,
,,26/10/26 CORNER GROCER SINGAPORE SG
15/10/2026,15/10/2026,SALARY,,"2,150.00"
,,EXAMPLE STUDIO PTE LTD SALARY OCT`);
  const a = ocbc.accounts[0];
  assert.equal(a.currency, 'SGD');
  assert.deepEqual(descriptions(a), ['SALARY · EXAMPLE STUDIO PTE LTD SALARY OCT', 'DEBIT PURCHASE · 26/10/26 CORNER GROCER SINGAPORE SG']);
  assert.equal(a.closing, 330_790);
  assert.equal(a.ref, 'CSV:601-234567-001');
  // Komerční banka: the other side given as an account number is no name; the kind of line when nothing else.
  const kb = read(`"Datum zauctovani";"Protistrana";"Nazev protiuctu";"Castka";"Mena";"Typ transakce";"Zprava pro prijemce"
"01.10.2026";"2001234567/2010";"PŘÍKLAD SVJ";"-3500,00";"CZK";"Trvalý příkaz";"Fond oprav"
"20.10.2026";"";"";"-2000,00";"CZK";"Výběr hotovosti z bankomatu";""`);
  assert.deepEqual(descriptions(kb.accounts[0]), ['PŘÍKLAD SVJ · Fond oprav', 'Výběr hotovosti z bankomatu']);
});

test('the text that says most: codes last, a longer column holding the first (Société Générale, DBS)', () => {
  const sg = read(`="00012345678";

Date de l'opération;Libellé;Détail de l'écriture;Montant de l'opération;Devise
30/10/2026;VIR INST RE 3456789012;VIR INST RE 3456789012 DE: M CAMILLE EXEMPLE MOTIF: REMBOURSEMENT;25,00;EUR`);
  assert.deepEqual(descriptions(sg.accounts[0]), ['VIR INST RE 3456789012 DE: M CAMILLE EXEMPLE MOTIF: REMBOURSEMENT']);
  assert.equal(sg.accounts[0].ref, 'CSV:00012345678');
  const dbs = read(`Transaction Date,Reference,Debit Amount,Credit Amount,Transaction Ref1,Transaction Ref2,Transaction Ref3
28 Oct 2026,MST, 23.40, ,CORNER GROCER SI NG 26OCT,5264-7111-2233-4455,,
15 Oct 2026,SAL, , 2150.00,EXAMPLE STUDIO PTE LTD,SALARY,,`);
  assert.deepEqual(descriptions(dbs.accounts[0]), ['EXAMPLE STUDIO PTE LTD · SALARY', 'CORNER GROCER SI NG 26OCT · 5264-7111-2233-4455']);
});

// ---------------------------------------------------------------------------------------------
// Accounts, cards, refs

test('refs only from an identifier: the account column, the rows above, the file name; never the bank alone', () => {
  const monzo = (rows) => read(`Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split,Money Out,Money In\n${rows}`,
    'Monzo Data Export - August 2026.csv');
  const personal = monzo('tx_1,09/08/2026,09:00:01,Faster payment,Acme Ltd,,Income,2000.00,GBP,2000.00,GBP,,,,SALARY,,,2000.00');
  assert.equal(personal.institution, 'Monzo');
  assert.equal(personal.accounts[0].ref, null);
  assert.equal(personal.accounts[0].name, 'Monzo');
  // Chase's checking and card files: told apart by the numbers in their names.
  const checking = read('Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nDEBIT,08/14/2026,AMAZON,-45.20,DEBIT_CARD,1189.36,\n', 'Chase1234_Activity_20260901.CSV');
  const card = read('Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n08/20/2026,08/21/2026,AMAZON,Shopping,Sale,-45.20,\n', 'Chase5678_Activity20260801.CSV');
  assert.equal(checking.accounts[0].ref, 'CSV:Chase:1234');
  assert.equal(card.accounts[0].ref, 'CSV:Chase:5678');
  assert.equal(checking.accounts[0].name, 'Chase ·· 1234');
  // N26's "Account number" is the other side's IBAN (empty for a card payment): no ref, one account.
  const n26 = read(`"Date","Payee","Account number","Transaction type","Payment reference","Amount (EUR)"
"2026-08-09","ACME GmbH","DE11111111111111111111","Income","Gehalt August","2000.0"
"2026-08-20","Amazon","","MasterCard Payment","","-45.2"
"2026-08-22","Max Mustermann","DE22222222222222222222","Outgoing Transfer","Rent","-800.0"`, 'n26-csv-transactions.csv');
  assert.equal(n26.accounts.length, 1);
  assert.equal(n26.accounts[0].ref, null);
  // An IBAN in the file's name (its check digits right), and Wise's statement id.
  const rabo = read('"Datum","Bedrag","Omschrijving-1"\n"2026-10-01","+10,00","Rente"\n', 'CSV_A_NL91ABNA0417164300_EUR_20261001_20261031.csv');
  assert.equal(rabo.accounts[0].ref, 'CSV:NL91ABNA0417164300');
  assert.equal(validIban('NL91 ABNA 0417 1643 00'), true);
  assert.equal(validIban('NL92ABNA0417164300'), false);
  const wise = read('Date,Description,Amount\n2026-10-01,Top up,10.00\n', 'statement_12345678_EUR_2026-10-01_2026-10-31.csv');
  assert.equal(wise.accounts[0].ref, 'CSV:12345678');
});

test('the own account column: filled on every line, three numbers at most, the one above when named', () => {
  const two = read(`Account,Date,Description,Amount,Currency
GB29NWBK60161331926819,2026-09-01,Pay,100.00,GBP
GB94BARC10201530093459,2026-09-02,Rent,-50.00,GBP`);
  assert.deepEqual(two.accounts.map((a) => a.ref), ['CSV:GB29NWBK60161331926819', 'CSV:GB94BARC10201530093459']);
  // DKB's old export: "Kontonummer" in the table is the other side's; the account is above.
  const dkb = read(`"Kontonummer:";"DE89370400440532013000 / Girokonto";
"Buchungstag";"Wertstellung";"Buchungstext";"Auftraggeber / Begünstigter";"Verwendungszweck";"Kontonummer";"Betrag (EUR)";
"20.08.2026";"20.08.2026";"Lastschrift";"AMAZON EU S.A.R.L.";"AMZN Mktp DE";"DE98765432109876543210";"-45,20";`);
  assert.equal(dkb.accounts.length, 1);
  assert.equal(dkb.accounts[0].ref, 'CSV:DE89370400440532013000');
});

test('cards: by name, heading, file name; Truist and Navy Federal checking exports stay accounts you own', () => {
  const discover = read(`Trans. Date,Post Date,Description,Amount,Category
08/29/2026,08/29/2026,"CORNER GROCER",57.62,"Supermarkets"
09/02/2026,09/02/2026,"INTERNET PAYMENT - THANK YOU",-1200.00,"Payments and Credits"`, 'Discover-Statement-20260928.csv');
  const d = discover.accounts[0];
  assert.equal(d.name, 'Discover card');
  assert.deepEqual(amounts(d), [-5_762, 120_000]);
  const apple = read('Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By\n09/28/2026,09/29/2026,CORNER GROCER,Corner Grocer,Grocery,Purchase,83.14,Jane\n',
    'Apple Card Transactions September 2026.csv');
  assert.equal(apple.accounts[0].name, 'Apple Card');
  assert.equal(apple.accounts[0].currency, 'USD');
  assert.deepEqual(amounts(apple.accounts[0]), [-8_314]);
  // BMO prints charges positive and has no payment word: most lines money in says so.
  const bmo = read(`Item #,Card #,Transaction Date,Posting Date,Transaction Amount,Description
1,'5191230012345678',20260904,20260908,64.18,CORNER GROCER
2,'5191230012345678',20260915,20260915,-1500.0,TRSF FROM ACCT
3,'5191230012345678',20260919,20260922,22.75,BLUE DOOR CAFE`, 'bmo.csv');
  assert.equal(bmo.accounts[0].owed, true);
  assert.deepEqual(amounts(bmo.accounts[0]), [-6_418, 150_000, -2_275]);
  const truist = read(`Posted Date,Transaction Date,Transaction Type,Check/Serial #,Description,Amount,Daily Posted Balance
09/29/2026,09/28/2026,POS Debit,,EXAMPLE STREAMING,-15.49,4067.33
09/25/2026,09/25/2026,Transfer,,FROM SAVINGS,300.00,4082.82`, 'truist.csv');
  assert.equal(truist.accounts[0].owed, false);
  assert.equal(truist.accounts[0].opening, 378_282);
  assert.deepEqual(dates(truist.accounts[0]), ['2026-09-25', '2026-09-28']);
  const navy = read(`Posting Date,Transaction Date,Amount,Credit Debit Indicator,type,Description,Category
09/29/2026,09/28/2026,15.49,Debit,POS,EXAMPLE STREAMING,Entertainment
09/25/2026,09/25/2026,2840.00,Credit,ACH,PAYROLL,Paycheck`, 'navyfederal.csv');
  assert.equal(navy.accounts[0].type, 'current');
  assert.deepEqual(amounts(navy.accounts[0]), [284_000, -1_549]);
});

test('banks known by their header or file name; short names only as written', () => {
  assert.equal(read('Booking Date,Amount\n2026-09-01,5.00\n', 'Spending.csv').institution, null);
  // A name of four letters or fewer counts only as written: "ing" is no bank, "ING" is.
  assert.equal(read('Booking Date,Amount\n2026-09-01,5.00\n', 'ing.csv').institution, null);
  assert.equal(read('Booking Date,Amount\n2026-09-01,5.00\n', 'ING.csv').institution, 'ING');
  assert.equal(read('Booking Date,Amount\n2026-09-01,5.00\n', 'n26-export.csv').institution, 'N26');
  assert.equal(read('Date,Description,Amount\n2026-09-01,X,5.00\n', 'Checking.csv').institution, null);
  const citi = read('Status,Date,Description,Debit,Credit\nCleared,09/27/2026,"CORNER GROCER",68.12,\nCleared,09/20/2026,"ONLINE PAYMENT, THANK YOU",,-1500.00\n', 'citi.csv');
  assert.equal(citi.institution, 'Citi');
  assert.equal(citi.accounts[0].owed, true);
  assert.deepEqual(amounts(citi.accounts[0]), [150_000, -6_812]);
});

test('two balance columns and no amount: the figures say which is which (BoursoBank)', () => {
  const bourso = read(`"Date Opération";"Date Valeur";Libellé;Solde;"Numéro Compte";Solde
2026-10-28;2026-10-28;"VIR INST M CAMILLE";40,00;00040123456;1763.61
2026-10-20;2026-10-19;"CARTE LIBRAIRIE";-64,99;00040123456;1723.61
2026-10-01;2026-10-01;"VIR SEPA EXEMPLE SAS";2 310,00;00040123456;1788.60`);
  const a = bourso.accounts[0];
  assert.deepEqual(amounts(a), [231_000, -6_499, 4_000]);
  assert.equal(a.opening, -52_140);
  assert.equal(a.closing, 176_361);
  assert.ok(a.check.ok);
});

test('separators: comma, semicolon, tab, bar, and Excel’s sep= line', () => {
  const bar = read('29/07/2026|COMPRA CAFETERA|29/07/2026|-4,50|2.807,35||\n24/07/2026|TRANSFERENCIA|24/07/2026|-725,00|2.811,85||\n', 'sabadell.txt');
  assert.deepEqual(amounts(bar.accounts[0]), [-72_500, -450]);
  assert.equal(bar.accounts[0].closing, 280_735);
  const sep = read('sep=;\nDate;Description;Amount\n2026-09-01;Pay;10,00\n');
  assert.deepEqual(amounts(sep.accounts[0]), [1_000]);
});

test('no currency named: the figures in the main currency’s decimals when they fit, with readDigits saying so; a code ending in DR is no mark', () => {
  const yen = read('Date,Description,Amount\n2026-09-01,Pay,1200\n2026-09-02,Shop,-450\n', 'export.csv', { mainCurrency: 'JPY' });
  assert.equal(yen.accounts[0].currency, null);
  assert.deepEqual([yen.accounts[0].readDigits, ...amounts(yen.accounts[0])], [0, 1_200, -450]);
  // Cents don't fit yen: kept at three decimals for the review to put into the currency chosen.
  const cents = read('Date,Description,Amount\n2026-09-01,Pay,12.50\n', 'export.csv', { mainCurrency: 'JPY' });
  assert.deepEqual([cents.accounts[0].readDigits, ...amounts(cents.accounts[0])], [3, 12_500]);
  const pounds = read('Date,Description,Amount\n2026-09-01,Pay,12.00\n', 'export.csv', { mainCurrency: 'GBP' });
  assert.deepEqual([pounds.accounts[0].readDigits, ...amounts(pounds.accounts[0])], [2, 1_200]);
  // "IDR" is rupiah, not money out; "12.00DR" is.
  assert.equal(csvAmount('1.000.000 IDR', 2), 100_000_000);
  assert.equal(csvAmount('12.00DR', 2), -1_200);
});

// ---------------------------------------------------------------------------------------------
// The second review's findings, each pinned (V1, V2, V3: the reviewers' ids)

test('refs: a year or a date is never an account id (V1#1, V3#4, V3#12)', () => {
  const plain = 'Date,Description,Amount\n2026-09-01,PAY,10.00\n';
  for (const name of ['Chase-2026-09.csv', 'Monzo 2024-08.csv', 'Barclays 2026.csv', 'Barclays 2026 savings.csv', 'Chase 2024 checking.csv',
    'HSBC-2026-09.csv', 'Revolut 2026-09.csv', 'statement_2026_09.csv', 'statement_20260930_checking.csv']) {
    assert.equal(read(plain, name).accounts[0].ref, null, name);
  }
  // Written straight after the bank's name, four digits are the account's last four (Chase's own names).
  const chase = read(plain, 'Chase2026_Activity_20260912.CSV').accounts[0];
  assert.deepEqual([chase.ref, chase.number], ['CSV:Chase:2026', '2026']);
  // Wise's statement id only in Wise's whole name.
  assert.equal(read(plain, 'statement_12345678_EUR_2026-10-01_2026-10-31.csv').accounts[0].ref, 'CSV:12345678');
  // Rows above: dates and a holder's phone number are no account; the number beside the date is.
  const above = (rows) => read(`${rows}\nDate,Description,Amount\n2026-09-01,PAY,10.00\n`).accounts[0].ref;
  assert.equal(above('Account statement,01/09/2026 - 30/09/2026'), null);
  assert.equal(above('Account,Statement from 01/09/2026 to 30/09/2026'), null);
  assert.equal(above('Account holder,SAM EXAMPLE,01234 567890'), null);
  assert.equal(above('Account,12345678 opened 01/02/2015'), 'CSV:12345678');
  assert.equal(above('Account,Current account,2026-09'), null);
});

test('no currency named: read at three decimals, given in the main currency’s when they fit (Addendum 2: V1#2, V2#6, V3#1)', () => {
  const chase = `Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #
DEBIT,09/11/2026,"AMAZON MKTPLACE",-45.20,DEBIT_CARD,1189.36,
CREDIT,09/05/2026,"ACME PAYROLL",2000.00,ACH_CREDIT,1234.56,
DEBIT,09/02/2026,"ONLINE TRANSFER",-765.44,ACH_DEBIT,-765.44,`;
  const name = 'Chase1234_Activity_20260912.CSV';
  // Yen can't hold cents: nothing is dropped, the figures stay at three decimals.
  const yen = read(chase, name, { mainCurrency: 'JPY' }).accounts[0];
  assert.equal(yen.readDigits, 3);
  assert.deepEqual(amounts(yen), [-765_440, 2_000_000, -45_200]);
  assert.equal(yen.closing, 1_189_360);
  assert.ok(yen.check.ok);
  // Dollars hold them: given in cents.
  const usd = read(chase, name, { mainCurrency: 'USD' }).accounts[0];
  assert.deepEqual([usd.readDigits, usd.closing], [2, 118_936]);
  // Kuwaiti dinars have three: the figures stay as read.
  assert.equal(read(chase, name, { mainCurrency: 'KWD' }).accounts[0].readDigits, 3);
  // Whole yen fit yen.
  const whole = read('Date,Description,Amount\n2026-09-01,Pay,1200\n2026-09-02,Shop,-450\n', 'export.csv', { mainCurrency: 'JPY' }).accounts[0];
  assert.deepEqual([whole.readDigits, ...amounts(whole)], [0, 1_200, -450]);
  // Three-decimal figures (dinars) in a file naming no currency are read, not dropped; a point after
  // four digits says the column's decimal mark, so "-12.345" is twelve dinars, not twelve thousand.
  const dinars = read('Date,Description,Amount,Balance\n2026-09-01,Salary,1500.250,2000.500\n2026-09-05,Shop,-12.345,1988.155\n', 'export.csv', { mainCurrency: 'USD' }).accounts[0];
  assert.deepEqual([dinars.readDigits, ...amounts(dinars)], [3, 1_500_250, -12_345]);
  assert.ok(dinars.check.ok);
  // A currency the file names keeps its own decimals, and no readDigits.
  assert.equal(read('Date,Description,Amount (EUR)\n2026-09-01,Pay,10.00\n').accounts[0].readDigits, undefined);
});

test('a file without a header: an empty column beside an unsigned one is the other half of money out and in (V1#3)', () => {
  // CIBC in a month with no deposits: date, text, money out, (empty) money in.
  const out = read('2026-09-01,GROCER,50.00,\n2026-09-03,RENT,1200.00,\n2026-09-05,PHONE,45.00,\n', 'cibc.csv').accounts[0];
  assert.deepEqual(amounts(out), [-5_000, -120_000, -4_500]);
  // A month with only deposits: the empty column comes first, so the filled one is money in.
  const into = read('2026-09-01,PAYROLL,,2000.00\n2026-09-03,INTEREST,,1.25\n2026-09-05,REFUND,,45.00\n', 'cibc.csv').accounts[0];
  assert.deepEqual(amounts(into), [200_000, 125, 4_500]);
  // TD with its balance: the balance agrees.
  const td = read('09/05/2026,RENT,54.80,,890.00\n09/02/2026,AMAZON.CA,45.20,,944.80\n09/01/2026,GROCER,10.00,,990.00\n', 'accountactivity.csv').accounts[0];
  assert.deepEqual(amounts(td), [-1_000, -4_520, -5_480]);
  assert.deepEqual([td.owed, td.opening, td.closing, td.check.ok], [false, 100_000, 89_000, true]);
});

test('a card only on real signs: never by a file name alone with another header, nor a card column on some lines (V1#4, V2#7, V2#14, V3#5, V3#9)', () => {
  const kind = (s) => [s.institution, s.accounts[0].type, s.accounts[0].owed, ...amounts(s.accounts[0])];
  // A checking account saved as activity.csv (Amex's file name): a balance column, or ISO dates, say it isn't Amex's export.
  assert.deepEqual(kind(read('Date,Description,Amount,Balance\n2026-09-01,PAYROLL,2000.00,3000.00\n2026-09-03,GROCER,-50.00,2950.00\n', 'Activity_2026-09.csv')),
    [null, 'current', false, 200_000, -5_000]);
  assert.deepEqual(kind(read('Date,Description,Amount\n2026-09-01,SALARY,2500.00\n2026-09-03,GROCER,-45.20\n', 'activity.csv')),
    [null, 'current', false, 250_000, -4_520]);
  // Amex's own basic export (exactly these three headings, dates as Amex writes them): charges printed positive.
  assert.deepEqual(kind(read('Date,Description,Amount\n09/02/2026,GROCER,50.00\n09/06/2026,AUTOPAY PAYMENT - THANK YOU,-500.00\n', 'activity.csv', { mainCurrency: 'USD' })),
    ['American Express', 'card', true, -5_000, 50_000]);
  // Discover's bank (savings) is no card; its card is told by its layout.
  assert.deepEqual(kind(read('Transaction Date,Transaction Description,Transaction Type,Amount,Balance\n09/01/2026,INTEREST,Credit,4.83,1004.83\n09/03/2026,TRANSFER,Debit,-500.00,504.83\n',
    'Discover-Savings-AllAvailable-20260901.csv')), ['Discover', 'current', false, 483, -50_000]);
  // A current account's card number column is filled on its card payments only (Air Bank, Revolut Business).
  const air = read(`Datum provedení;Směr úhrady;Typ úhrady;Měna účtu;Částka v měně účtu;Číslo karty;Držitel karty;Název protistrany
20.08.2026;Odchozí;Platba kartou;CZK;-452,00;516844******1234;JAN NOVAK;
18.08.2026;Příchozí;Příchozí úhrada;CZK;1 200,00;;;PETR NOVAK
15.08.2026;Příchozí;Příchozí úhrada;CZK;35 000,00;;;ACME S.R.O.`);
  assert.deepEqual(kind(air), [null, 'current', false, 3_500_000, 120_000, -45_200]);
  // A file named for a debit card is a bank account's.
  for (const name of ['Visa Debit.csv', 'Debit card transactions.csv', 'historia karta.csv']) {
    assert.equal(read('Date,Description,Amount\n2026-09-01,SALARY,2500.00\n', name).accounts[0].owed, false, name);
  }
});

test('the payment rule: only a repayment, as whole words; purchases named "payment" in other languages stay as printed (V1#5)', () => {
  const card = (rows, name = 'karta_kredytowa_2026_09.csv') => amounts(read(`Data operacji;Opis operacji;Numer karty;Kwota\n${rows}`, name).accounts[0]);
  assert.deepEqual(card('2026-09-02;PŁATNOŚĆ KARTĄ ŻABKA;****1234;-25,00\n2026-09-04;PŁATNOŚĆ KARTĄ ORLEN;****1234;-180,00\n2026-09-06;ZWROT ZAKUPU;****1234;49,99\n2026-09-10;PRZELEW NA KARTĘ;****1234;500,00'),
    [-2_500, -18_000, 4_999, 50_000]);
  const english = read('Date,Description,Card Number,Amount\n2026-09-02,PAYMENTSENSE*CORNER CAFE,****1234,-4.50\n2026-09-04,TESCO,****1234,-60.00\n2026-09-06,REFUND AMAZON,****1234,19.90\n2026-09-08,REFUND ARGOS,****1234,12.00\n', 'card.csv');
  assert.deepEqual(amounts(english.accounts[0]), [-450, -6_000, 1_990, 1_200]);
  // No repayment line: the signs are as printed (decaf's rule), unless the bank's entry says charges are positive (BMO's card).
  const bmo = read(`Item #,Card #,Transaction Date,Posting Date,Transaction Amount,Description
1,'5191230012345678',20260904,20260908,64.18,CORNER GROCER
2,'5191230012345678',20260915,20260915,-1500.0,TRSF FROM ACCT`, 'export.csv');
  assert.deepEqual([bmo.institution, bmo.accounts[0].owed, ...amounts(bmo.accounts[0])], ['BMO', true, -6_418, 150_000]);
});

test('each account read is also read the other way round, for the review’s card switch (V1#6, V2#3, V3#9)', () => {
  // Navy Federal's card has its checking's columns: read as yours, with the card reading beside it.
  const nfcu = read(`Posting Date,Transaction Date,Amount,Credit Debit Indicator,type,Description,Category
09/29/2026,09/28/2026,15.49,Debit,POS,EXAMPLE STREAMING,Entertainment
09/25/2026,09/25/2026,500.00,Credit,ACH,PAYMENT - THANK YOU,Payment`, 'transactions.csv').accounts[0];
  assert.deepEqual([nfcu.owed, nfcu.type, nfcu.name], [false, 'current', 'Account']);
  assert.deepEqual([nfcu.other.owed, nfcu.other.type, nfcu.other.name], [true, 'card', 'Card']);
  assert.deepEqual(amounts(nfcu.other), [50_000, -1_549]);
  // An issuer's export read as a card: the other reading is as printed, and owns it.
  const amex = read('Date,Description,Card Member,Account #,Amount\n09/03/2026,CAFE EXAMPLE,SAM EXAMPLE,-41005,4.50\n09/15/2026,ONLINE PAYMENT - THANK YOU,SAM EXAMPLE,-41005,-29.50\n', 'activity.csv').accounts[0];
  assert.deepEqual(amounts(amex), [-450, 2_950]);
  assert.deepEqual([amex.other.owed, ...amounts(amex.other)], [false, 450, -2_950]);
  assert.equal(amex.other.other, undefined);
});

test('the bank’s date order only from a bank that writes one; brands by their longest name, never in the holder’s (V1#7, V2#8, V3#6, V3#13)', () => {
  const amexUk = read(`Date,Description,Amount,Extended Details,Appears On Your Statement As,Address,Town/City,Postcode,Country,Reference,Category
09/09/2026,TESCO STORES,23.40,,TESCO STORES LEEDS,,,,,'AT1',General Purchases
05/09/2026,PAYMENT RECEIVED - THANK YOU,-1250.00,,PAYMENT RECEIVED,,,,,'AT2',
02/09/2026,EXAMPLE AIRWAYS,312.80,,EXAMPLE AIRWAYS,,,,,'AT3',Travel`, 'activity.csv', { mainCurrency: 'GBP' });
  assert.deepEqual([amexUk.institution, amexUk.dateOrder, amexUk.dateOrderGuessed], ['American Express', 'DMY', true]);
  assert.deepEqual(dates(amexUk.accounts[0]), ['2026-09-02', '2026-09-05', '2026-09-09']);
  assert.deepEqual(amounts(amexUk.accounts[0]), [-31_280, 125_000, -2_340]);
  // A brand's name in the holder's row names no bank.
  const ally = read('Account holder,Ally Smith\nDate,Description,Amount\n05/09/2026,GROCER,-50.00\n09/09/2026,PAYROLL,2000.00\n', 'export.csv', { mainCurrency: 'GBP' });
  assert.deepEqual([ally.institution, ally.dateOrder, ...dates(ally.accounts[0])], [null, 'DMY', '2026-09-05', '2026-09-09']);
  // "National Bank of Greece" is Greece's bank, not Canada's National Bank.
  const nbg = read('Ημερομηνία;Περιγραφή;Ποσό;Υπόλοιπο\n05/09/2026;ΑΓΟΡΑ;-10,00;90,00\n02/09/2026;ΚΑΤΑΘΕΣΗ;100,00;100,00\n', 'National Bank of Greece export.csv');
  assert.deepEqual([nbg.institution, nbg.country, ...dates(nbg.accounts[0])], ['National Bank of Greece', 'GR', '2026-09-02', '2026-09-05']);
  // Barclays works in the UK and the US: no order of its own, the main currency's (said to be guessed).
  const barclays = read('Date,Description,Amount\n09/02/2026,FUEL,-7.80\n09/05/2026,PAYMENT RECEIVED,500.00\n', 'Barclays card.csv', { mainCurrency: 'USD' });
  assert.deepEqual([barclays.dateOrder, barclays.dateOrderGuessed, ...dates(barclays.accounts[0])], ['MDY', true, '2026-09-02', '2026-09-05']);
  // A heading that is a brand's name ("Wise", neon's column) names no bank.
  assert.equal(read('"Date";"Amount";"Description";"Wise"\n"2026-09-01";"-5.00";"Coffee";""\n', 'neon-export.csv').institution, null);
});

test('a dated row is never dropped without a word; an empty date takes the next date column (V1#8, V2#13, V3#2, V3#18)', () => {
  const unread = read('Date,Description,Amount\n2026-09-01,Pay,2000.00\n2026-09-02,Fuel,-12.50*\n2026-09-03,Shop,-5.00\n').accounts[0];
  assert.deepEqual(amounts(unread), [200_000, -500]);
  assert.deepEqual(unread.notes, ['1 row could not be read', 'no balance in the file']);
  // Interest has no "Transaction Date": its "Posting Date" dates it, and the closing is the last line's.
  const two = read(`Transaction Date,Posting Date,Description,Amount,Balance
09/01/2026,09/01/2026,PAYROLL,2000.00,3000.00
09/03/2026,09/03/2026,GROCER,-50.00,2950.00
,09/30/2026,INTEREST PAID,1.25,2951.25`, 'export.csv').accounts[0];
  assert.deepEqual(dates(two), ['2026-09-01', '2026-09-03', '2026-09-30']);
  assert.deepEqual([two.closing, two.check.ok], [295_125, true]);
  // Krónur have no decimals: one written with aurar is rounded to a whole króna, and said.
  const isk = read('Dagsetning;Skýring;Upphæð;Mynt\n01.09.2026;Laun;450.000,00;ISK\n03.09.2026;Kortafærsla;-4.872,35;ISK\n05.09.2026;Verslun;-12.500,50;ISK\n').accounts[0];
  assert.deepEqual(amounts(isk), [450_000, -4_872, -12_501]);
  assert.deepEqual(isk.notes, ['2 amounts rounded to whole ISK', 'no balance in the file']);
  // Forint and rupiah keep two, as the app counts them: fillér and sen are read, not rounded.
  const huf = read('Könyvelés dátuma;Közlemény;Összeg;Pénznem\n2026.09.01;Munkabér;450 000,00;HUF\n2026.09.03;Kártyás vásárlás;-4 872,35;HUF\n').accounts[0];
  assert.deepEqual([huf.currency, ...amounts(huf)], ['HUF', 45_000_000, -487_235]);
});

test('the other side’s accounts never split one account: N26, payees one to one, a card’s cardholders (V1#9, V1#10, V2#10, V2#11, V3#3)', () => {
  const n26 = read(`"Date","Payee","Account number","Transaction type","Payment reference","Amount (EUR)"
"2026-09-01","ACME GmbH","DE89370400440532013000","Income","Gehalt September","2000.00"
"2026-09-03","Max Mustermann","DE02120300000000202051","Outgoing Transfer","Miete","-800.00"`, 'n26-csv-transactions.csv');
  assert.deepEqual(n26.accounts.map((a) => [a.name, a.ref]), [['N26', null]]);
  // Renamed, with no bank named: each number with one payee, a different one each, is the payees'.
  const payees = read(`Date,Payee,Account number,Amount
2026-09-01,ACME GmbH,DE89370400440532013000,2000.00
2026-09-02,Max Mustermann,DE02120300000000202051,-800.00
2026-09-03,ACME GmbH,DE89370400440532013000,150.00`, 'export.csv');
  assert.deepEqual(payees.accounts.map((a) => a.ref), [null]);
  // A card's export with a card number per cardholder is one card, with no ref.
  const capone = read(`Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit
2026-09-02,2026-09-03,1234,GROCER,Merchandise,50.00,
2026-09-04,2026-09-05,5678,FUEL,Gas,40.00,
2026-09-06,2026-09-06,1234,CAPITAL ONE MOBILE PYMT,Payment/Credit,,500.00`, '2026-10-01_transaction_download.csv');
  assert.deepEqual(capone.accounts.map((a) => [a.name, a.ref, a.owed, ...amounts(a)]), [['Card', null, true, -5_000, -4_000, 50_000]]);
  const members = read('Date,Description,Card Member,Account #,Amount\n09/02/2026,GROCER,JANE EXAMPLE,-41007,50.00\n09/04/2026,FUEL,JOHN EXAMPLE,-42015,40.00\n', 'activity.csv');
  assert.deepEqual(members.accounts.map((a) => [a.ref, ...amounts(a)]), [[null, -5_000, -4_000]]);
});

test('several accounts in one file: by their own numbers, each one’s lines together, a card among them by its account type (V1#14, V2#2)', () => {
  const ibans = ['NL91ABNA0417164300', 'NL69INGB0123456789', 'NL20INGB0001234567', 'NL44RABO0123456789'];
  const rows = ibans.flatMap((iban, k) => [`${iban},EUR,2026-09-0${k + 1},-1${k}.00,Shop`, `${iban},EUR,2026-09-1${k + 1},2${k}.00,Pay`]);
  const four = read(`IBAN/BBAN,Munt,Datum,Bedrag,Omschrijving\n${rows.join('\n')}`);
  assert.deepEqual(four.accounts.map((a) => a.ref), ibans.map((i) => `CSV:${i}`));
  const rbc = read(`"Account Type","Account Number","Transaction Date","Cheque Number","Description 1","Description 2","CAD$","USD$"
Chequing,01234-5012345,8/15/2026,,"PAYROLL DEPOSIT","EXAMPLE STUDIO",2450.00,
Chequing,01234-5012345,8/20/2026,,"C-IDP PURCHASE","CORNER GROCER",-86.43,
Savings,01234-5067890,8/31/2026,,"INTEREST","",4.12,
Visa,4510123456781234,8/18/2026,,"PAYMENT - THANK YOU","",500.00,
Visa,4510123456781234,8/20/2026,,"AMAZON.CA","",-45.20,
U.S. Chequing,01234-4012345,8/05/2026,,"DEPOSIT","",,250.00`, 'csv12345.csv');
  assert.deepEqual(rbc.accounts.map((a) => [a.ref, a.currency, a.owed]), [
    ['CSV:01234-5012345', 'CAD', false], ['CSV:01234-5067890', 'CAD', false], ['CSV:4510123456781234', 'CAD', true], ['CSV:01234-4012345', 'USD', false]]);
  assert.deepEqual(amounts(rbc.accounts[2]), [50_000, -4_520]);
});

test('balances around the table: a total is no balance, a card’s minus is owed, a currency only beside money (V1#11, V1#12, V1#15)', () => {
  // A lone figure below a card's lines is a total of charges, and one below an account's is their money out: neither is the balance.
  const card = read('Date,Description,Amount\n09/02/2026,GROCER,50.00\n09/04/2026,FUEL,40.00\n09/06/2026,AUTOPAY PAYMENT - THANK YOU,-500.00\n,,90.00\n', 'activity.csv').accounts[0];
  assert.deepEqual([card.owed, card.closing], [true, null]);
  const outs = read('Date,Description,Amount\n2026-09-01,PAYROLL,2000.00\n2026-09-03,GROCER,-50.00\n2026-09-05,RENT,-1200.00\n,,-1250.00\n').accounts[0];
  assert.equal(outs.closing, null);
  // A card's balance column showing what is owed as a minus: turned round.
  const minus = read('Date,Description,Card Number,Amount,Balance\n2026-09-02,TESCO,****1234,-60.00,-1060.00\n2026-09-04,FUEL,****1234,-40.00,-1100.00\n2026-09-10,PAYMENT RECEIVED THANK YOU,****1234,500.00,-600.00\n').accounts[0];
  assert.deepEqual([minus.owed, minus.opening, minus.closing, minus.check.ok], [true, 100_000, 60_000, true]);
  // DKB's card: "Saldo: -600,00 EUR" above is what is owed.
  const dkb = read(`"Kreditkarte:";"4930********1234 Kreditkarte";
"Saldo:";"-600,00 EUR";
"Umsatz abgerechnet und nicht im Saldo enthalten";"Wertstellung";"Belegdatum";"Beschreibung";"Betrag (EUR)";
"Ja";"03.09.2026";"02.09.2026";"REWE";"-60,00";
"Ja";"11.09.2026";"10.09.2026";"Einzahlung";"500,00";`).accounts[0];
  assert.deepEqual([dkb.owed, dkb.closing, dkb.currency], [true, 60_000, 'EUR']);
  // A code that is a word ("ALL") in a row about something else names no currency.
  const all = read('Transaction type,ALL\nDate,Description,Amount\n09/02/2026,GROCER,-50.00\n09/05/2026,PAYROLL,2000.00\n', 'export.csv', { mainCurrency: 'USD' });
  assert.deepEqual([all.accounts[0].currency, ...dates(all.accounts[0])], [null, '2026-09-02', '2026-09-05']);
});

test('a currency column of each purchase’s own currency splits nothing (V1#13)', () => {
  const de = read('Datum;Beschreibung;Betrag (EUR);Ursprünglicher Betrag;Währung\n02.09.2026;REWE;-60,00;-60,00;EUR\n04.09.2026;AMAZON.COM;-46,10;-50,00;USD\n06.09.2026;HOTEL LONDON;-117,20;-100,00;GBP\n');
  assert.deepEqual(de.accounts.map((a) => [a.currency, ...amounts(a)]), [['EUR', -6_000, -4_610, -11_720]]);
  const billing = read('Transaction date,Description,Transaction amount,Transaction currency,Billing amount\n2026-09-02,TESCO,-60.00,GBP,-60.00\n2026-09-04,AMAZON.COM,-50.00,USD,-40.10\n');
  assert.deepEqual(billing.accounts.map((a) => [a.currency, ...amounts(a)]), [[null, -6_000, -4_010]]);
});

test('a balance or total row is told by its own words at the table’s edge, never by a payee called Total (V2#12, V3#7)', () => {
  const lv = read(`"Klienta konts";"Ieraksta tips";"Datums";"Saņēmējs/Maksātājs";"Informācija saņēmējam";"Summa";"Valūta";"Debets/Kredīts"
"LV80BANK0000435195001";"10";"01.09.2026";"";"Sākuma atlikums";"1000,00";"EUR";"K"
"LV80BANK0000435195001";"20";"02.09.2026";"SIA PIEMĒRS";"Pirkums";"45,20";"EUR";"D"
"LV80BANK0000435195001";"20";"15.09.2026";"SIA DARBS";"Alga";"2000,00";"EUR";"K"
"LV80BANK0000435195001";"82";"30.09.2026";"";"Apgrozījums";"45,20";"EUR";"D"
"LV80BANK0000435195001";"82";"30.09.2026";"";"Apgrozījums";"2000,00";"EUR";"K"
"LV80BANK0000435195001";"86";"30.09.2026";"";"Beigu atlikums";"2954,80";"EUR";"K"`).accounts[0];
  assert.deepEqual([...amounts(lv), lv.opening, lv.closing, lv.check.ok], [-4_520, 200_000, 100_000, 295_480, true]);
  // Monzo's payee "Total" (a fuel station) is a line.
  const monzo = read(`Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description
tx_1,09/08/2026,09:00:01,Faster payment,Acme Ltd,,Income,2000.00,GBP,2000.00,GBP,,,,SALARY
tx_2,10/08/2026,12:00:00,Card payment,Total,,Transport,-45.00,GBP,-45.00,GBP,,,,`, 'Monzo Data Export.csv').accounts[0];
  assert.deepEqual(amounts(monzo), [200_000, -4_500]);
  // A line described "Total" whose balance follows on is a line too (Revolut).
  const revolut = read(`Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-09-01 10:00:00,2026-09-01 10:00:01,Total,-45.00,0.00,EUR,COMPLETED,455.00
CARD_PAYMENT,Current,2026-09-02 10:00:00,2026-09-02 10:00:01,Bakery,-5.00,0.00,EUR,COMPLETED,450.00`).accounts[0];
  assert.deepEqual([...amounts(revolut), revolut.opening, revolut.check.ok], [-4_500, -500, 50_000, true]);
});

test('lines without a header whose balance rises with purchases: a card, what is owed (V2#5)', () => {
  const td = read('08/20/2026,AMAZON.CA,45.20,,1189.36\n08/15/2026,PAYMENT - THANK YOU,,500.00,1144.16\n08/10/2026,TIM HORTONS #1234,6.75,,1644.16\n', 'accountactivity.csv').accounts[0];
  assert.deepEqual([td.type, td.owed, ...amounts(td)], ['card', true, -675, 50_000, -4_520]);
  assert.deepEqual([td.opening, td.closing, td.check.ok], [163_741, 118_936, true]);
});

test('headings: a column of dates is never money; camelCase; more words (V1#18, V1#20, V2#4, V2#16, V3#16)', () => {
  const tr = read('Tarih;Valör;Açıklama;Tutar;Bakiye\n20.08.2026;20.08.2026;MİGROS;-452,00;11.893,60\n15.08.2026;15.08.2026;MAAŞ;35.000,00;12.345,60\n').accounts[0];
  assert.deepEqual([...amounts(tr), tr.closing, tr.check.ok], [3_500_000, -45_200, 1_189_360, true]);
  const marcus = read('TransactionDate,Description,Value,AccountBalance,AccountName,AccountNumber\n2026-09-01,Interest,1.25,1001.25,Marcus Online Saver,12345678\n').accounts[0];
  assert.deepEqual([marcus.closing, marcus.ref], [100_125, 'CSV:12345678']);
  assert.equal(csvKey('RunningBalance'), 'running balance');
  const truist = read('Posted Date,Transaction Date,Transaction Type,Check/Serial #,Full description,Merchant name,Category name,Amount\n09/29/2026,09/28/2026,POS Debit,,EXAMPLE STREAMING CO,,Entertainment,-15.49\n').accounts[0];
  assert.deepEqual(descriptions(truist), ['EXAMPLE STREAMING CO']);
  const revolutBusiness = read(`Date started (UTC),Date completed (UTC),ID,Type,Description,Reference,Payer,Card number,Orig currency,Orig amount,Payment currency,Amount,Fee,Balance,Account
2026-09-01,2026-09-01,a1,TOPUP,Top up,,ACME LTD,,GBP,5000.00,GBP,5000.00,0.00,15000.00,Main
2026-09-02,2026-09-02,a2,CARD_PAYMENT,AWS,,Sam,459678******1234,USD,150.00,GBP,-120.00,0.00,14880.00,Main`, 'transaction-statement.csv');
  assert.deepEqual([revolutBusiness.general, revolutBusiness.accounts[0].owed, ...amounts(revolutBusiness.accounts[0])], [false, false, 500_000, -12_000]);
  // Venmo: "Amount (total)", "Datetime", and the balances on rows of their own.
  const venmo = read(`Account Statement - (@Jane-Example) ,,,,,,,,,
,ID,Datetime,Type,Status,Note,From,To,Amount (total),Beginning Balance,Ending Balance
,,,,,,,,,$120.00,
,391,2026-08-03T18:22:41,Payment,Complete,Dinner,Jane,Sam,- $45.20,,
,392,2026-08-10T09:15:02,Payment,Complete,Rent share,Alex,Jane,+ $600.00,,
,,,,,,,,,,$674.80`, 'VenmoStatement.csv').accounts[0];
  assert.deepEqual([...amounts(venmo), venmo.opening, venmo.closing, venmo.check.ok], [-4_520, 60_000, 12_000, 67_480, true]);
});

test('cards told by their whole header: Apple Card, Discover, Lloyds and Halifax, Nubank, Japan (V2#1, V3#16)', () => {
  const owedAmounts = (text, name, mainCurrency = 'USD') => { const a = read(text, name, { mainCurrency }).accounts[0]; return [a.owed, ...amounts(a)]; };
  assert.deepEqual(owedAmounts('Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By\n08/20/2026,08/21/2026,AMAZON.COM,Amazon,Other,Purchase,45.20,Jane\n08/15/2026,08/15/2026,ACH DEPOSIT,Payment,Payment,Payment,-500.00,Jane\n', 'transactions (1).csv'),
    [true, 50_000, -4_520]);
  assert.deepEqual(owedAmounts('Trans. Date,Post Date,Description,Amount,Category\n08/29/2026,08/29/2026,"CORNER GROCER",57.62,"Supermarkets"\n09/02/2026,09/02/2026,"INTERNET PAYMENT - THANK YOU",-1200.00,"Payments and Credits"\n', 'Statement.csv'),
    [true, -5_762, 120_000]);
  assert.deepEqual(owedAmounts('Date,Date entered,Reference,Description,Amount\n20/08/2026,21/08/2026,1234,TESCO STORES,45.20\n15/08/2026,15/08/2026,5678,PAYMENT RECEIVED,-500.00\n', 'download.csv'),
    [true, 50_000, -4_520]);
  assert.deepEqual(owedAmounts('date,title,amount\n2026-08-20,Mercado,45.20\n2026-08-25,Pagamento recebido,-500.00\n', 'nubank-2026-08.csv'),
    [true, -4_520, 50_000]);
  assert.deepEqual(owedAmounts('"利用日","利用店名・商品名","利用者","支払方法","利用金額"\n"2026/08/20","スーパー","本人","1回払い","4520"\n"2026/08/22","カフェ","本人","1回払い","675"\n', 'enavi202608.csv', 'JPY'),
    [true, -4_520, -675]);
});

test('quotes are read as banks write them: a quote inside a field is a character (V2#9)', () => {
  const hebrew = read('תאריך,תיאור,חובה,זכות,יתרה\n20/08/2026,שופרסל דיל,45.20,,1189.36\n18/08/2026,משכורת אקמי בע"מ,,2000.00,1234.56\n15/08/2026,חשמל,100.00,,-765.44\n10/08/2026,קפה,10.00,,-665.44\n').accounts[0];
  assert.equal(hebrew.lines.length, 4);
  assert.ok(hebrew.lines.some((l) => l.description === 'משכורת אקמי בע"מ'));
  const inch = read('08/20/2026,HOME DEPOT 12" SAW BLADE,-45.20,1189.36\n08/15/2026,PAYROLL,2000.00,1234.56\n08/10/2026,RENT,-765.44,-765.44\n', 'Checking1.csv').accounts[0];
  assert.deepEqual(descriptions(inch), ['RENT', 'PAYROLL', 'HOME DEPOT 12" SAW BLADE']);
  const quoted = read('"Date","Description","Amount"\n"2026-08-20","HOME DEPOT 12" SAW BLADE","-45.20"\n"2026-08-21","GROCER","-5.00"\n').accounts[0];
  assert.deepEqual(descriptions(quoted), ['HOME DEPOT 12" SAW BLADE', 'GROCER']);
});

test('keys: Thai months keep their vowels; csv-words gives no month twice and its signs a fixed order (V2#17, V3#15, V3#21)', () => {
  assert.equal(csvDate('15 ม.ค. 2567'), '2024-01-15');
  assert.equal(csvDate('15 มี.ค. 2567'), '2024-03-15');
  const seen = new Map();
  for (let month = 1; month <= 12; month++) {
    for (const name of CSV_WORDS.months[String(month)]) {
      const k = csvKey(name);
      assert.ok(!seen.has(k) || seen.get(k) === month, `"${name}" is month ${month} and ${seen.get(k)}`);
      seen.set(k, month);
    }
  }
  // Every bank entry's patterns compile, and the ISO list is the data's own, not the platform's.
  for (const b of CSV_WORDS.banks) if (b.fileName) assert.doesNotThrow(() => new RegExp(b.fileName), b.brand);
  assert.ok(CSV_WORDS.isoCurrencies.includes('HRK') && CSV_WORDS.isoCurrencies.includes('EUR'));
  const hrk = read('Datum;Opis;Betrag HRK\n01.09.2022;Plaća;5.000,00\n');
  assert.equal(hrk.accounts[0].currency, 'HRK');
});

test('decimals as the app counts them (StatementText.minorDigits; BUILD.md seeds IDR at two), so iCloud holds what the phone reads', () => {
  assert.deepEqual(['IDR', 'HUF', 'IQD', 'COP', 'JPY', 'USD', 'KWD', 'ISK'].map(minorDigits), [2, 2, 3, 2, 0, 2, 3, 0]);
  const idr = read('Tanggal,Keterangan,Mata Uang,Jumlah,Saldo\n2026-09-01,GAJI,IDR,"10.000.000,00","10.000.000,00"\n2026-09-02,BELANJA,IDR,"-250.000,00","9.750.000,00"\n').accounts[0];
  assert.deepEqual([idr.currency, idr.closing, ...amounts(idr)], ['IDR', 975_000_000, 1_000_000_000, -25_000_000]);
});

test('a file without a header of more than a hundred thousand rows is read, not refused by a crash (V1#19, V3#24)', () => {
  const rows = [];
  for (let i = 0; i < 130_000; i++) rows.push(`no date ${i},${i % 7 === 0 ? 'x' : 'y'},${i}`);
  assert.doesNotThrow(() => readCsvStatement(rows.join('\n'), { fileName: 'big.csv' }));
});

test('two accounts of one file never share a ref; a balance row’s label may end in its date', () => {
  // The account above the table, its lines in two currencies: each account its currency after the id.
  const two = read('IBAN;DE89 3704 0044 0532 0130 00\nDatum;Text;Betrag;Währung\n01.09.2026;Pay;100,00;EUR\n02.09.2026;Card;-10,00;USD\n');
  assert.deepEqual(two.accounts.map((a) => a.ref), ['CSV:DE89370400440532013000:EUR', 'CSV:DE89370400440532013000:USD']);
  // "Opening balance 01/09/2026" in the table is the opening, not a line.
  const opening = read('Date,Description,Amount\n2026-09-01,Opening balance 01/09/2026,1000.00\n2026-09-02,PAYROLL,2000.00\n2026-09-03,GROCER,-50.00\n').accounts[0];
  assert.deepEqual([...amounts(opening), opening.opening, opening.closing], [200_000, -5_000, 100_000, 295_000]);
});

// ---------------------------------------------------------------------------------------------
// One test per rule a mutation run found unpinned (V3#10): each fails when its rule is taken out.

test('the rows above: 40 of them, a label’s value on the next row, a leading apostrophe kept out of a number', () => {
  const fifteen = read(`${Array.from({ length: 15 }, (_, i) => `Note ${i},x`).join('\n')}\nDate,Description,Amount\n2026-09-01,PAY,10.00\n`);
  assert.equal(fifteen.general, false);
  const mbank = read('#Klient;\nJAN KOWALSKI;\n\n#Data operacji;#Opis operacji;#Kwota;\n2026-10-01;ZAKUP;-10,00;\n2026-10-02;PRZELEW;100,00;', 'mbank.csv');
  assert.equal(mbank.holder, 'JAN KOWALSKI');
  assert.equal(read("Account,'12345678\nDate,Description,Amount\n2026-09-01,PAY,10.00\n").accounts[0].ref, 'CSV:12345678');
});

test('columns with no heading after a text heading carry its words (PKO BP)', () => {
  const pko = read(`"Data operacji","Data waluty","Typ transakcji","Kwota","Waluta","Saldo po transakcji","Opis transakcji","","",""
"2026-10-30","2026-10-30","Przelew","+50.00","PLN","+7064.89","Rachunek nadawcy: 12 1240","Nazwa nadawcy: ANNA","Tytuł: ZWROT"`, 'pko.csv');
  assert.deepEqual(descriptions(pko.accounts[0]), ['Rachunek nadawcy: 12 1240 · Nazwa nadawcy: ANNA · Tytuł: ZWROT']);
});

test('own account columns: short values or values that change line to line are no accounts', () => {
  const interleaved = read('Account,Date,Description,Amount\n111111,2026-09-01,A,1.00\n222222,2026-09-02,B,2.00\n333333,2026-09-03,C,3.00\n444444,2026-09-04,D,4.00\n111111,2026-09-05,E,5.00\n');
  assert.deepEqual(interleaved.accounts.map((a) => a.ref), [null]);
  const short = read('Account,Date,Description,Amount\n1,2026-09-01,A,1.00\n2,2026-09-02,B,2.00\n');
  assert.deepEqual(short.accounts.map((a) => a.ref), [null]);
  // N26 by its name: its "Account number" is the payees' even when a payee has two.
  const n26 = read(`"Date","Payee","Account number","Transaction type","Payment reference","Amount (EUR)"
"2026-09-01","ACME GmbH","DE89370400440532013000","Income","Gehalt","2000.00"
"2026-09-02","ACME GmbH","DE02120300000000202051","Income","Bonus","100.00"`, 'n26-csv-transactions.csv');
  assert.deepEqual(n26.accounts.map((a) => a.ref), [null]);
});

test('without a header: a summary row first is read as the rows above; a single ABN AMRO line keeps its balances; a masked card number makes a card', () => {
  const santander = read(`01-10-2026,31-10-2026,'12 1090 1014 0000 0712 1981 2874,Konto Jakie Chcę,PLN,"1870,20","5932,47",3,
28-10-2026,30-10-2026,"ZAKUP PRZY UŻYCIU KARTY KINO","",,"-58,20",,3,
27-10-2026,27-10-2026,"TRANSAKCJA BLIK SKLEP","",,"-186,68",,2,
24-10-2026,24-10-2026,"PRZELEW PRZYCHODZĄCY WYNAGRODZENIE","FIRMA SP. Z O.O.",,"5450,00",,1,`, 'historia.csv').accounts[0];
  assert.deepEqual([santander.ref, santander.currency, ...amounts(santander)], ['CSV:12109010140000071219812874', 'PLN', 545_000, -18_668, -5_820]);
  const abn = read('123456789\tEUR\t20261001\t1640,25\t390,25\t20261001\t-1250,00\tHuur oktober\n', 'TXT261104101530.TAB').accounts[0];
  assert.deepEqual([abn.opening, abn.closing], [164_025, 39_025]);
  const cibc = read('2026-09-01,GROCER,50.00,,4500********1234\n2026-09-03,AMAZON.CA,45.20,,4500********1234\n', 'cibc.csv').accounts[0];
  assert.deepEqual([cibc.owed, cibc.ref, ...amounts(cibc)], [true, 'CSV:CIBC:1234', -5_000, -4_520]);
});

test('dates either way: a bank’s country decides before the main currency; the currency before decimal commas (the brief’s order)', () => {
  const lloyds = read("Transaction Date,Transaction Type,Sort Code,Account Number,Transaction Description,Debit Amount,Credit Amount,Balance\n09/02/2026,DEB,'30-12-34,12345678,SHOP,5.00,,95.00\n09/01/2026,FPI,'30-12-34,12345678,PAY,,100.00,100.00\n",
    'Lloyds export.csv', { mainCurrency: 'USD' });
  assert.deepEqual([lloyds.dateOrder, lloyds.dateOrderGuessed, ...dates(lloyds.accounts[0])], ['DMY', false, '2026-01-09', '2026-02-09']);
  // A dollar account at a bank writing decimal commas: (b) the currency decides before (c) the commas, marked guessed (V1#17).
  assert.deepEqual(dateOrderOf(['09/02/2026', '09/01/2026'], { currency: 'USD', decimalComma: true }), { order: 'MDY', dayFirst: false, guessed: true });
});

test('cards: a file named for a credit card; a purchase date beside a posting date (Discover’s "Trans. Date"); refunds don’t flip a card', () => {
  assert.equal(read('Date,Description,Amount\n2026-09-01,SHOP,-10.00\n', 'my credit card 2026.csv').accounts[0].owed, true);
  const trans = read('Trans. Date,Post Date,Description,Amount\n08/29/2026,08/29/2026,GROCER,57.62\n09/02/2026,09/02/2026,PAYMENT - THANK YOU,-1200.00\n', 'export.csv').accounts[0];
  assert.deepEqual([trans.owed, ...amounts(trans)], [true, -5_762, 120_000]);
  // A card month of one purchase and two refunds, no repayment: as printed (decaf's rule has no "most lines" flip).
  const refunds = read('Data operacji;Opis operacji;Numer karty;Kwota\n2026-09-02;ZAKUP;****1234;-25,00\n2026-09-04;ZWROT;****1234;49,99\n2026-09-06;ZWROT;****1234;12,00\n', 'karta_kredytowa.csv').accounts[0];
  assert.deepEqual(amounts(refunds), [-2_500, 4_999, 1_200]);
  // A lone figure below a card's lines is never its balance, even one that isn't a total.
  const footer = read('Date,Description,Card Number,Amount\n2026-09-02,GROCER,****1234,-50.00\n2026-09-04,FUEL,****1234,-40.00\n,,,123.45\n').accounts[0];
  assert.deepEqual([footer.owed, footer.closing], [true, null]);
});

test('a line called Total in the middle of the table is a line; the longest bank name wins (Bank Millennium, not Millennium bcp)', () => {
  const total = read('Date,Description,Amount\n2026-09-01,PAYROLL,2000.00\n2026-09-02,Total,-45.00\n2026-09-03,GROCER,-50.00\n').accounts[0];
  assert.deepEqual(amounts(total), [200_000, -4_500, -5_000]);
  const millennium = read('Data;Opis;Kwota\n2026-10-01;ZAKUP;-10,00\n', 'Bank Millennium historia.csv');
  assert.deepEqual([millennium.institution, millennium.country], ['Bank Millennium', 'PL']);
});

test('verification fixes: a prepaid card, a card read the other way, masked numbers, QIF notes and dates, dotted dates', () => {
  // N2: a file named for a card whose balance is the person's money (each balance the one before plus
  // its line, never below zero, mostly money out) is an account you own; the switch can turn it round.
  const travel = read('Date,Description,Amount,Balance\n2026-09-01,Top up,500.00,500.00\n2026-09-03,Cafe,-4.50,495.50\n', 'travel card.csv', { mainCurrency: 'GBP' }).accounts[0];
  assert.deepEqual([travel.owed, travel.closing, travel.check.ok, travel.other.owed], [false, 49_550, true, true]);
  // A real card named so keeps being one: charges printed positive with what is owed rising.
  const card = read('Date,Description,Amount,Balance\n2026-09-01,SHOP,45.20,45.20\n2026-09-03,CAFE,4.50,49.70\n', 'my card.csv', { mainCurrency: 'GBP' }).accounts[0];
  assert.equal(card.owed, true);
  // N3: read as an account its balances don't follow on; read as a card every one does: a card.
  const tesco = read('Date,Description,Amount,Debit/Credit Flag,Balance\n01/09/2026,TESCO STORES,45.20,D,1189.36\n28/08/2026,PAYMENT RECEIVED,500.00,C,1144.16\n20/08/2026,CAFE,6.75,D,1644.16\n', 'transactions.csv', { mainCurrency: 'GBP' }).accounts[0];
  assert.deepEqual([tesco.owed, tesco.opening, tesco.closing, tesco.check.ok, tesco.other.owed], [true, 163_741, 118_936, true, false]);
  // N7: masked numbers above the table are the bank's and the last four digits, never one ref for every bank.
  const masked = (bank) => read(`Account number,****5678\nDate,Description,Amount\n2026-09-01,PAY,10.00\n`, `${bank}.csv`, { mainCurrency: 'GBP' }).accounts[0].ref;
  assert.deepEqual([masked('export'), masked('Monzo export')], ['CSV:Account:5678', 'CSV:Monzo:5678']);
  // N11: dates written with dots put the day first, even for a person whose main currency is the dollar.
  const dotted = read('Datum;Text;Betrag\n01.09.2026;Miete;-1250,00\n05.09.2026;Gehalt;2500,00\n', 'umsaetze.csv', { mainCurrency: 'USD' });
  assert.deepEqual(dates(dotted.accounts[0]), ['2026-09-01', '2026-09-05']);
  assert.equal(dotted.dateOrder, 'DMY');
});

