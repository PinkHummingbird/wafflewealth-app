// node --test 'statements/tests/*.test.mjs'
// Any bank's CSV (BankCSV): every rule, each with a small file laid out as a real bank lays its
// export out. Every file here is made up: the names, numbers and lines. The app's Swift port reads
// the same words (csv-words.js is its Statements/CSV/words.json) and must give the same results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCsvStatement, csvAmount, csvDate, csvKey, dateOrderOf, dayFirstOf, validIban, minorDigits } from '../readers.js';

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
  assert.equal(a.ref, 'CSV:XXXXXXXXXXXX1234');
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
  // Currencies without decimals: yen, won, forint, krónur.
  assert.equal(minorDigits('HUF'), 0);
  assert.equal(csvAmount('12 345', 0), 12_345);
  assert.equal(csvAmount('-2.450', 0), -2_450);
  assert.equal(csvAmount('1 234,00 Ft', 0), 1_234);
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
  // No sign heading, but a column whose every value is Debit or Credit beside amounts that never carry a minus.
  const c360 = read(`Account Number,Transaction Date,Transaction Amount,Transaction Type,Transaction Description,Balance
1234,09/22/26,89.99,Debit,Debit Card Purchase,3831.16
1234,09/16/26,200.00,Credit,Zelle money received,3921.15`);
  assert.deepEqual(amounts(c360.accounts[0]), [20_000, -8_999]);
  assert.equal(c360.accounts[0].type, 'current');
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

test('no currency named: the figures are in the main currency’s units; a code ending in DR is no mark', () => {
  const yen = read('Date,Description,Amount\n2026-09-01,Pay,1200\n2026-09-02,Shop,-450\n', 'export.csv', { mainCurrency: 'JPY' });
  assert.equal(yen.accounts[0].currency, null);
  assert.deepEqual(amounts(yen.accounts[0]), [1_200, -450]);
  const pounds = read('Date,Description,Amount\n2026-09-01,Pay,12.00\n', 'export.csv', { mainCurrency: 'GBP' });
  assert.deepEqual(amounts(pounds.accounts[0]), [1_200]);
  // "IDR" is rupiah, not money out; "12.00DR" is.
  assert.equal(csvAmount('1.000.000 IDR', 2), 100_000_000);
  assert.equal(csvAmount('12.00DR', 2), -1_200);
});
