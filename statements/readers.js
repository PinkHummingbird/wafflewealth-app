// Reads bank statements from the text a PDF already holds. Pure functions: no network, no
// storage, no PDF library. The page hands in text items with positions (from PDF.js), this
// file rebuilds the rows a person sees, and a reader for the bank turns them into accounts,
// balances and lines. Amounts are whole numbers of the currency's smallest unit, never floats.

import { PROFILES } from './profiles.js';
import { CSV_WORDS } from './csv-words.js?v=2';

// ---------------------------------------------------------------------------------------------
// Rows

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

/**
 * Text items → rows. An item is { x, y, w, h, s }: left edge, baseline, width, font size and
 * text, in PDF points with y growing upwards. Items on one baseline form a row; within a row,
 * items that touch join into a word, items a space apart join into one cell, and a wider gap
 * starts a new cell. Arabic-only cells are dropped (every statement here repeats itself in
 * English).
 */
export function rowsFromItems(items) {
  const usable = items
    .filter((i) => i.s && i.s.trim())
    .map((i) => ({ ...i, h: i.h || 8 }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const item of usable) {
    const row = rows.find((r) => Math.abs(r.y - item.y) <= Math.max(1.5, item.h * 0.3));
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  return rows
    .map((row) => {
      const sorted = row.items.sort((a, b) => a.x - b.x);
      const cells = [];
      for (const item of sorted) {
        const last = cells[cells.length - 1];
        const gap = last ? item.x - last.x2 : Infinity;
        if (last && gap <= item.h * 0.12) {
          last.s += item.s;
          last.x2 = Math.max(last.x2, item.x + item.w);
        } else if (last && gap <= item.h * 0.9) {
          last.s += ' ' + item.s;
          last.x2 = Math.max(last.x2, item.x + item.w);
        } else {
          cells.push({ x: item.x, x2: item.x + item.w, s: item.s });
        }
      }
      const kept = cells
        .map((c) => ({ ...c, s: c.s.replace(/\s+/g, ' ').trim() }))
        .filter((c) => c.s && !(ARABIC.test(c.s) && !/[A-Za-z0-9]/.test(c.s.replace(ARABIC, ''))));
      return { y: row.y, cells: kept, text: kept.map((c) => c.s).join(' | ') };
    })
    .filter((r) => r.cells.length)
    .sort((a, b) => b.y - a.y);
}

/** Every page of a PDF.js document → pages of rows. */
export async function pagesFromPdf(pdf) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const items = content.items.map((i) => ({
      x: i.transform[4],
      y: i.transform[5],
      w: i.width,
      h: Math.abs(i.transform[3]) || i.height,
      s: i.str,
    }));
    pages.push(rowsFromItems(items));
  }
  return pages;
}

// ---------------------------------------------------------------------------------------------
// Numbers, dates, currencies

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// The decimals a currency is written with: csv-words' `currencyDigits`, the app's own table
// (StatementText.minorDigits; BUILD.md seeds IDR at two), so a figure read is stored in the units the
// phone counts in. Newer CLDR gives IDR, HUF, COP and IQD none: not this table, never Intl's.
const ZERO_DIGITS = new Set(CSV_WORDS.currencyDigits['0']);
const THREE_DIGITS = new Set(CSV_WORDS.currencyDigits['3']);
export const minorDigits = (code) => (ZERO_DIGITS.has(code) ? 0 : THREE_DIGITS.has(code) ? 3 : 2);

/** Currency names as statements spell them → ISO codes. */
const CURRENCY_NAMES = {
  'US DOLLAR': 'USD', 'SINGAPORE DOLLAR': 'SGD', 'EURO': 'EUR', 'BRITISH POUND': 'GBP', 'POUND STERLING': 'GBP',
  'JAPANESE YEN': 'JPY', 'AUSTRALIAN DOLLAR': 'AUD', 'NEW ZEALAND DOLLAR': 'NZD', 'CANADIAN DOLLAR': 'CAD',
  'HONG KONG DOLLAR': 'HKD', 'SWISS FRANC': 'CHF', 'CHINESE RENMINBI': 'CNY', 'CHINESE YUAN': 'CNY',
  'MALAYSIAN RINGGIT': 'MYR', 'THAI BAHT': 'THB', 'INDONESIAN RUPIAH': 'IDR', 'PHILIPPINE PESO': 'PHP',
  'INDIAN RUPEE': 'INR', 'KOREAN WON': 'KRW', 'NEW TAIWAN DOLLAR': 'TWD', 'VIETNAMESE DONG': 'VND',
  'UAE DIRHAM': 'AED', 'U.A.E. DIRHAM': 'AED', 'SAUDI RIYAL': 'SAR', 'QATARI RIYAL': 'QAR',
  'DANISH KRONE': 'DKK', 'SWEDISH KRONA': 'SEK', 'NORWEGIAN KRONE': 'NOK', 'GEORGIAN LARI': 'GEL',
  'TURKISH LIRA': 'TRY', 'SOUTH AFRICAN RAND': 'ZAR', 'MEXICAN PESO': 'MXN', 'BRAZILIAN REAL': 'BRL',
};
export const currencyFromName = (name) => CURRENCY_NAMES[name.trim().toUpperCase()] ?? null;

const ISO = /\b(AED|SGD|USD|EUR|GBP|JPY|AUD|NZD|CAD|HKD|CHF|CNY|MYR|THB|IDR|PHP|INR|KRW|TWD|SAR|QAR|KWD|BHD|OMR|DKK|SEK|NOK|ZAR)\b/;

const AMOUNT = /^\(?[-+]?\s*(?:[A-Z]{3}\s*|\$\s*)?[-+]?\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?\s*(?:CR|DR|Cr|Dr)?(?:\s+[A-Z]{3})?$|^\(?[-+]?\d+(?:\.\d+)?\)?\s*(?:CR|DR|Cr|Dr)?$/;
export const isAmount = (s) => AMOUNT.test(s.trim());

/**
 * "2,468.10" → 246810; "(318.40)", "-318.40", "102.00CR" are negative; "350.8" → 35080;
 * "100,000 AED" → 10000000. Returns null when the text isn't an amount. The sign is what the
 * statement prints: a reader decides what it means for the account.
 */
export function parseAmount(text, digits = 2) {
  if (text == null) return null;
  const s = String(text).trim();
  if (!isAmount(s)) return null;
  const negative = /^\(.*\)$/.test(s) || /-/.test(s) || /(CR|Cr)$/.test(s);
  const number = s.replace(/[^\d.]/g, '');
  const [whole, fraction = ''] = number.split('.');
  if (fraction.length > digits && /[1-9]/.test(fraction.slice(digits))) return null;
  const minor = Number(whole || '0') * 10 ** digits + Number((fraction + '000').slice(0, digits) || '0');
  return negative ? -minor : minor;
}

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Dates as statements print them → "YYYY-MM-DD". `year` fills in "22 AUG"; `before` (an ISO
 * date) moves a yearless date back a year when it would land after the statement.
 */
export function parseDate(text, { year, before, dayFirst = true } = {}) {
  const s = String(text).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})(?:[/.-]| )(\d{1,2})(?:[/.-]| )(\d{2,4})$/))) {
    const [a, b] = dayFirst ? [+m[1], +m[2]] : [+m[2], +m[1]];
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return b >= 1 && b <= 12 && a >= 1 && a <= 31 ? iso(y, b, a) : null;
  }
  // "12/28" with the year left to the statement, as US banks print their lines.
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})$/)) && year) {
    const [a, b] = dayFirst ? [+m[1], +m[2]] : [+m[2], +m[1]];
    if (b < 1 || b > 12 || a < 1 || a > 31) return null;
    let date = iso(year, b, a);
    if (before && date > before) date = iso(year - 1, b, a);
    return date;
  }
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]([A-Za-z]{3})[A-Za-z]*,?[\s-]?(\d{2,4})?$/))) {
    const month = MONTHS[m[2].toLowerCase()];
    if (!month) return null;
    let y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year;
    if (!y) return null;
    let date = iso(y, month, +m[1]);
    if (!m[3] && before && date > before) date = iso(y - 1, month, +m[1]);
    return date;
  }
  if ((m = s.match(/^([A-Za-z]{3})[A-Za-z]*\.? (\d{1,2}),? (\d{4})$/))) {
    const month = MONTHS[m[1].toLowerCase()];
    return month ? iso(+m[3], month, +m[2]) : null;
  }
  return null;
}

const DAY_MONTH = /^\d{1,2} [A-Za-z]{3}$/;
const DMY = /^\d{2}\/\d{2}\/\d{4}$/;

// ---------------------------------------------------------------------------------------------
// Accounts and checks

/**
 * One account as a statement shows it. Amounts on lines are from the owner's side: money in is
 * positive, money out negative, for a card as much as a bank account. `opening` and `closing`
 * are what the statement prints: what you have for an account you own, what you owe for one
 * you owe (negative when the card is in credit).
 */
function account(fields) {
  return {
    ref: null, number: null, numbers: [], name: '', type: 'current', owed: false, currency: null,
    ratePct: null, opened: null, closes: null, closed: false, opening: null, closing: null,
    lines: [], notes: [], ...fields,
  };
}

/** What you have after the lines: opening + money in − money out, or the mirror for a card. */
export function check(acct) {
  const messages = [];
  const sum = acct.lines.reduce((t, l) => t + l.amount, 0);
  let expected = null;
  if (acct.opening != null) expected = acct.owed ? acct.opening - sum : acct.opening + sum;
  if (expected != null && acct.closing != null && expected !== acct.closing) {
    messages.push({ kind: 'total', expected, got: acct.closing });
  }
  // A line the statement printed no balance for (HSBC UK prints one a day) carries the
  // worked-out balance on, so the next printed one is still checked.
  let previous = acct.opening;
  acct.lines.forEach((line, index) => {
    if (previous == null) { previous = line.running ?? null; return; }
    const after = acct.owed ? previous - line.amount : previous + line.amount;
    if (line.running == null) { previous = after; return; }
    if (after !== line.running) messages.push({ kind: 'line', index, expected: after, got: line.running });
    previous = line.running;
  });
  // An opening worked back from the closing balance (an OFX download) leads to it by construction.
  // So does a closing worked out from the opening (a QIF file, a CAMT report): nothing to check.
  const checked = expected != null && acct.closing != null && !acct.openingWorkedOut && !acct.closingWorkedOut;
  return { ok: checked && messages.length === 0, checked, sum, expected, messages };
}

// Put right in the review: the same as the app's StatementAccount.correct and leaveOut.

/** The indexes of the lines whose running balance doesn't follow from the one before. */
export const linesOff = (acct) => new Set(acct.check.messages.filter((m) => m.kind === 'line').map((m) => m.index));

/** Lines the user corrected or left out. */
export const correctedCount = (acct) => acct.lines.filter((l) => l.corrected).length + (acct.linesLeftOut ?? 0);

/**
 * A balance worked out from the lines is worked out again from the lines as they are now, then
 * everything is checked again.
 */
function recheck(acct) {
  const sum = acct.lines.reduce((t, l) => t + l.amount, 0);
  if (acct.closingWorkedOut && acct.opening != null) acct.closing = acct.owed ? acct.opening - sum : acct.opening + sum;
  if (acct.openingWorkedOut && acct.closing != null) acct.opening = acct.owed ? acct.closing + sum : acct.closing - sum;
  acct.check = check(acct);
}

/**
 * **A line put right by the user**: the amount from the owner's side, and the balance after it as
 * the statement prints it (null where it prints none). Its label follows the new sign unless it
 * was a move between accounts or interest. Changes `acct` in place and checks it again.
 */
export function correctLine(acct, index, amount, running) {
  const l = acct.lines[index];
  if (!l) return acct;
  l.amount = amount;
  l.running = running ?? null;
  l.corrected = true;
  if (l.label === 'in' || l.label === 'out') l.label = amount >= 0 ? 'in' : 'out';
  recheck(acct);
  return acct;
}

/** **A line left out by the user**: a total or heading read as a line. Changes `acct` in place. */
export function leaveOutLine(acct, index) {
  if (!acct.lines[index]) return acct;
  acct.lines.splice(index, 1);
  acct.linesLeftOut = (acct.linesLeftOut ?? 0) + 1;
  recheck(acct);
  return acct;
}

function line(fields) {
  return { date: null, madeOn: null, description: '', amount: 0, running: null, ref: null, foreign: null, label: null, ...fields };
}

const text = (rows) => rows.map((r) => r.text).join('\n');
const allRows = (pages) => pages.flatMap((rows, page) => rows.map((r) => ({ ...r, page })));
const cellsText = (cells) => cells.map((c) => c.s).join(' ').replace(/\s+/g, ' ').trim();
const titleCase = (s) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
const last4 = (n) => String(n).replace(/\D/g, '').slice(-4);

/** The cell under a label: the next rows down, the cell whose middle sits under the label. */
function valueBelow(rows, label, { within = 3, slack = 20 } = {}) {
  for (let i = 0; i < rows.length; i++) {
    const cell = rows[i].cells.find((c) => c.s.toUpperCase() === label.toUpperCase());
    if (!cell) continue;
    for (let j = i + 1; j <= Math.min(rows.length - 1, i + within); j++) {
      const below = rows[j].cells.find((c) => {
        const mid = (c.x + c.x2) / 2;
        return mid >= cell.x - slack && mid <= cell.x2 + slack + 30;
      });
      if (below && below.s.toUpperCase() !== below.s.toLowerCase() || below && /\d/.test(below.s)) return below.s;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// UAE-Wio: one PDF for every account. A page that starts with "ACCOUNT TYPE" starts an account;
// its lines run on the pages after it until the next.

const UAEWio = {
  id: 'UAE-Wio',
  institution: 'Wio Bank',
  country: 'AE',
  recognises: (pages) => /Wio Bank/.test(text(allRows(pages))) && /ACCOUNT STATEMENT/.test(text(allRows(pages))),
  read(pages) {
    const all = text(allRows(pages));
    const p = all.match(/FROM (\d{2}\/\d{2}\/\d{4}) TO (\d{2}\/\d{2}\/\d{4})/);
    const period = p ? { from: parseDate(p[1]), to: parseDate(p[2]) } : { from: null, to: null };
    const blocks = [];
    for (const rows of pages) {
      if (rows.some((r) => r.cells.some((c) => c.s === 'ACCOUNT TYPE'))) blocks.push({ head: rows, rows: [...rows] });
      else if (blocks.length) blocks[blocks.length - 1].rows.push(...rows);
    }
    let holder = null;
    const accounts = blocks.map(({ head, rows }) => {
      holder ??= valueBelow(head, 'ACCOUNT HOLDER NAME');
      const currency = valueBelow(head, 'CURRENCY');
      const digits = minorDigits(currency);
      const kind = (valueBelow(head, 'ACCOUNT TYPE') || '').toUpperCase();
      const type = kind.includes('FIXED') ? 'deposit' : kind.includes('SAVING') ? 'savings' : 'current';
      const number = valueBelow(head, 'ACCOUNT NUMBER');
      const named = valueBelow(head, 'ACCOUNT NAME');
      const rate = (valueBelow(head, 'INTEREST RATE') || '').replace('%', '');
      const closes = valueBelow(head, 'ACCOUNT CLOSURE');
      const lines = [];
      for (const row of rows) {
        const c = row.cells;
        if (c.length < 4 || !DMY.test(c[0].s) || !/^P\d+$/.test(c[1].s)) continue;
        const amount = parseAmount(c[c.length - 2].s, digits);
        const running = parseAmount(c[c.length - 1].s, digits);
        if (amount == null || running == null) continue;
        lines.push(line({ date: parseDate(c[0].s), ref: c[1].s, description: cellsText(c.slice(2, -2)), amount, running }));
      }
      const name =
        type === 'current' ? `Wio ${currency}` :
        type === 'deposit' ? `${named || 'Fixed deposit'} ·· ${last4(number)}` :
        named || `Wio savings ·· ${last4(number)}`;
      const acct = account({
        ref: `UAE-Wio:${number}`, number, numbers: [number, valueBelow(head, 'IBAN')].filter(Boolean),
        name, type, currency, ratePct: rate && rate !== '0' ? rate : null,
        opened: parseDate(valueBelow(head, 'ACCOUNT OPENED') || ''), closes: closes ? parseDate(closes) : null,
        opening: parseAmount(valueBelow(head, 'OPENING BALANCE'), digits),
        closing: parseAmount(valueBelow(head, 'CLOSING BALANCE'), digits),
        lines,
      });
      acct.closed = type === 'deposit' && acct.closing === 0 && acct.closes != null && acct.closes <= period.to;
      return acct;
    });
    return { holder, period, accounts };
  },
};

// ---------------------------------------------------------------------------------------------
// UAE-Emirates-Islamic: a card statement whose text runs column by column, so it is read only
// from rebuilt rows. Lines have no year; "CR" is money back.

const UAEEmiratesIslamic = {
  id: 'UAE-Emirates-Islamic',
  institution: 'Emirates Islamic',
  country: 'AE',
  recognises: (pages) => /Statement of Card Account/.test(text(allRows(pages))) && /Emirates Islamic/.test(text(allRows(pages))),
  read(pages) {
    const rows = allRows(pages);
    const all = text(rows);
    const from = all.match(/From:\s*\|?\s*(\d{1,2}(?:st|nd|rd|th)? [A-Za-z]{3} \d{4})/);
    const to = all.match(/To:\s*\|?\s*(\d{1,2}(?:st|nd|rd|th)? [A-Za-z]{3} \d{4})/);
    const period = { from: from ? parseDate(from[1]) : null, to: to ? parseDate(to[1]) : null };
    const year = period.to ? +period.to.slice(0, 4) : null;
    const cardNumber = (all.match(/Card Account Number\.?:?\s*\|?\s*([\dX ]{12,})/) || [])[1]?.trim() ?? '';
    const currency = (all.match(/Current Balance \(([A-Z]{3})\)/) || [])[1] ?? 'AED';
    const digits = minorDigits(currency);
    // The name sits top left in capitals, over the address; the address is the first with digits.
    const nameParts = [];
    for (const row of pages[0] ?? []) {
      const c = row.cells[0];
      if (c.x > 100 || row.y < 600) continue;
      if (/\d/.test(c.s)) break;
      if (/^[A-Z][A-Z .'-]+$/.test(c.s)) nameParts.push(c.s);
    }
    let opening = null;
    let closing = null;
    const lines = [];
    rows.forEach((row, i) => {
      const c = row.cells;
      if (/OPENING BALANCE/.test(row.text) && opening == null) opening = parseAmount(c[c.length - 1].s, digits);
      if (c.some((x) => /Current Balance \(/.test(x.s)) && closing == null && rows[i + 1]) {
        const values = rows[i + 1].cells;
        closing = parseAmount(values[values.length - 1].s, digits);
      }
      if (c.length < 4 || !DAY_MONTH.test(c[0].s) || !DAY_MONTH.test(c[1].s)) return;
      const printed = parseAmount(c[c.length - 1].s, digits);
      if (printed == null) return;
      lines.push(line({
        date: parseDate(c[0].s, { year, before: period.to }),
        madeOn: parseDate(c[1].s, { year, before: period.to }),
        description: cellsText(c.slice(2, -1)).replace(/ ARE$/, ''),
        amount: -printed, // a purchase is money out; "CR" (printed negative) is money back
      }));
    });
    const acct = account({
      ref: `UAE-Emirates-Islamic:${last4(cardNumber)}`, number: cardNumber, numbers: [],
      name: `Emirates Islamic card ·· ${last4(cardNumber)}`, type: 'card', owed: true, currency,
      opening, closing, lines,
    });
    return { holder: nameParts.join(' ') || null, period, accounts: [acct] };
  },
};

// ---------------------------------------------------------------------------------------------
// SG-Citibank: card statements. Each line may be followed by its foreign amount and by the
// masked card that made it; brackets are money back. The right margin holds a sideways code.

const SGCitibank = {
  id: 'SG-Citibank',
  institution: 'Citibank Singapore',
  country: 'SG',
  recognises: (pages) => /Citibank Singapore Ltd/.test(text(allRows(pages))) && /YOUR BILL SUMMARY/.test(text(allRows(pages))),
  read(pages) {
    const trimmed = pages.map((rows) =>
      rows.map((r) => ({ ...r, cells: r.cells.filter((c) => c.x < 570) }))
        .filter((r) => r.cells.length)
        .map((r) => ({ ...r, text: r.cells.map((c) => c.s).join(' | ') })));
    const rows = allRows(trimmed);
    const all = text(rows);
    const stated = (all.match(/Statement Date\s*\|?\s*:?\s*\|?\s*([A-Za-z]+ \d{1,2}, \d{4})/) || [])[1];
    const to = stated ? parseDate(stated) : null;
    let from = null;
    if (to) {
      const d = new Date(`${to}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - 1);
      d.setUTCDate(d.getUTCDate() + 1);
      from = d.toISOString().slice(0, 10);
    }
    const year = to ? +to.slice(0, 4) : null;
    const currency = (all.match(/AMOUNT \(([A-Z]{3})\)/) || [])[1] ?? 'SGD';
    const digits = minorDigits(currency);
    const holder = (trimmed[0] ?? []).map((r) => r.cells[0]).find((c) => c.x < 100 && /^[A-Z][A-Z.'-]+(?: [A-Z.'-]+)+$/.test(c.s) && !/CITI/.test(c.s))?.s ?? null;
    // The account number also sits in the barcode line, behind leading zeros.
    const statementNumbers = [...new Set((all.match(/\b\d{16,19}\b/g) || []).map((n) => n.slice(-16)))];

    const cards = new Map();
    let card = null;
    let previous = null;
    let grand = null;
    for (const row of rows) {
      const c = row.cells;
      const heading = row.text.match(/^(CITI [A-Z ]+?) (\d{4} \d{4} \d{4} \d{4}) - /);
      if (heading) {
        const number = heading[2].replace(/ /g, '');
        if (!cards.has(number)) {
          cards.set(number, account({
            ref: `SG-Citibank:${last4(number)}`, number, numbers: [number, ...statementNumbers],
            name: `${titleCase(heading[1]).replace(/^Citi /, 'Citi ')} ·· ${last4(number)}`,
            type: 'card', owed: true, currency, opening: previous, lines: [],
          }));
        }
        card = cards.get(number);
        continue;
      }
      if (/^BALANCE PREVIOUS STATEMENT/.test(row.text)) { previous = parseAmount(c[c.length - 1].s, digits); continue; }
      if (/^GRAND TOTAL/.test(row.text)) { grand = parseAmount(c[c.length - 1].s, digits); continue; }
      const foreign = row.text.match(/^FOREIGN AMOUNT ([A-Z .]+?) ([\d,]+(?:\.\d+)?)$/);
      if (foreign && card?.lines.length) {
        const code = currencyFromName(foreign[1]);
        const last = card.lines[card.lines.length - 1];
        last.foreign = code
          ? { currency: code, amount: Math.sign(last.amount) * Math.abs(parseAmount(foreign[2], minorDigits(code)) ?? 0) }
          : { currency: foreign[1], amount: null };
        continue;
      }
      if (!card || c.length < 2 || !DAY_MONTH.test(c[0].s)) continue;
      const printed = parseAmount(c[c.length - 1].s, digits);
      if (printed == null) continue;
      card.lines.push(line({
        date: parseDate(c[0].s, { year, before: to }),
        description: cellsText(c.slice(1, -1)),
        amount: -printed,
      }));
    }
    const accounts = [...cards.values()];
    // One card: the grand total is its balance. Several: each is checked against its own sum.
    if (accounts.length === 1) accounts[0].closing = grand;
    for (const a of accounts) {
      if (a.opening == null) a.opening = 0;
      if (a.closing == null) a.closing = a.opening - a.lines.reduce((t, l) => t + l.amount, 0);
      if (a.closing < 0) a.notes.push('in credit');
    }
    return { holder, period: { from, to }, accounts };
  },
};

// ---------------------------------------------------------------------------------------------
// SG-UOB: an overview of every account, then each account's lines. A line's description runs
// on below it; which column a figure sits in says in or out, and the running balance agrees.

const SGUOB = {
  id: 'SG-UOB',
  institution: 'UOB',
  country: 'SG',
  recognises: (pages) => /United Overseas Bank Limited/.test(text(allRows(pages))) && /Statement of Account/.test(text(allRows(pages))),
  read(pages) {
    const rows = allRows(pages);
    const all = text(rows);
    const p = all.match(/Period: (\d{1,2} [A-Za-z]{3} \d{4}) to (\d{1,2} [A-Za-z]{3} \d{4})/);
    const period = p ? { from: parseDate(p[1]), to: parseDate(p[2]) } : { from: null, to: null };
    const year = period.to ? +period.to.slice(0, 4) : null;
    // The name heads the address block, in capitals; a nickname may follow after "@".
    const holder = (pages[0] ?? [])
      .map((r) => r.cells[0])
      .filter((c) => c.x < 150)
      .map((c) => c.s.match(/^([A-Z][A-Z.'-]+(?: [A-Z.'-]+)+?)(?: @.*)?$/)?.[1])
      .find(Boolean) ?? null;

    // Overview: "TX ACCOUNT | SGD | 0.00 | 0.00 | - | 42.00" with the number on the row below.
    const accounts = [];
    let section = 'savings';
    rows.forEach((row, i) => {
      if (/^(Savings|Current|Fixed Deposits?|Time Deposits?)$/i.test(row.text)) section = row.text.toLowerCase();
      const c = row.cells;
      if (c.length < 3 || !ISO.test(c[1]?.s ?? '') || c[1].s.length !== 3) return;
      const number = rows[i + 1]?.text.match(/^\d{3}-\d{3}-\d{3}-\d$/)?.[0];
      if (!number) return;
      const currency = c[1].s;
      const digits = minorDigits(currency);
      const type = section.startsWith('current') ? 'current' : /deposit/.test(section) ? 'deposit' : 'savings';
      accounts.push(account({
        ref: `SG-UOB:${number.replace(/-/g, '')}`, number, numbers: [number.replace(/-/g, '')],
        name: `UOB ${titleCase(c[0].s).replace(/\bTx\b/, 'TX')} ·· ${last4(number)}`, type, currency,
        closing: parseAmount(c[c.length - 1].s, digits),
      }));
    });

    // Details: a heading with the number, then a header row whose columns say what each figure is.
    let current = null;
    let columns = null;
    for (const row of rows) {
      const c = row.cells;
      const heading = row.text.match(/(\d{3}-\d{3}-\d{3}-\d)$/);
      if (heading && c.length <= 2) {
        current = accounts.find((a) => a.number === heading[1]) ?? null;
        continue;
      }
      if (c.some((x) => x.s === 'Withdrawals') && c.some((x) => x.s === 'Deposits')) {
        const at = (name) => c.find((x) => x.s === name);
        columns = { out: at('Withdrawals'), in: at('Deposits'), balance: at('Balance') };
        continue;
      }
      if (!current || !columns) continue;
      const digits = minorDigits(current.currency);
      if (/^\d{1,2} [A-Za-z]{3}$/.test(c[0].s) && /BALANCE B\/F/.test(row.text)) {
        current.opening = parseAmount(c[c.length - 1].s, digits);
        continue;
      }
      if (c[0].s === 'Total') { current.statedTotals = c.slice(1).map((x) => x.s); continue; }
      if (/^\d{1,2} [A-Za-z]{3}$/.test(c[0].s)) {
        const figures = c.filter((x) => x.x > columns.out.x - 60 && isAmount(x.s));
        if (figures.length < 2) continue;
        const running = parseAmount(figures[figures.length - 1].s, digits);
        const figure = figures[figures.length - 2];
        const size = Math.abs(parseAmount(figure.s, digits));
        const nearIn = Math.abs(figure.x2 - columns.in.x2) < Math.abs(figure.x2 - columns.out.x2);
        const before = current.lines.length ? current.lines[current.lines.length - 1].running : current.opening;
        let amount = nearIn ? size : -size;
        if (before != null && before + amount !== running && before - amount === running) amount = -amount;
        current.lines.push(line({
          date: parseDate(c[0].s, { year, before: period.to }),
          description: cellsText(c.filter((x) => x.x < columns.out.x - 60).slice(1)),
          amount, running,
        }));
        continue;
      }
      // A row with words only, under the description: the line above runs on.
      const lastLine = current.lines[current.lines.length - 1];
      if (lastLine && c.every((x) => x.x < columns.out.x - 60) && !/End of Transaction/.test(row.text)) {
        lastLine.description += ' · ' + cellsText(c);
      }
      if (/End of Transaction/.test(row.text)) current = null;
    }
    for (const a of accounts) if (a.opening == null && !a.lines.length) a.opening = a.closing;
    return { holder, period, accounts };
  },
};

// ---------------------------------------------------------------------------------------------
// Any other bank: find the table's header row, then read every row under it by the header's
// columns. Marked for checking line by line.

const HEADER = {
  date: /^(?:(?:txn|trans(?:action)?|value|post(?:ing)?|book(?:ing)?)\.?\s*)?date$/i,
  description: /^(description|details|particulars|narrative|transaction(?: details)?|remarks|reference)$/i,
  amount: /^amount(?: \(?[A-Z]{3}\)?)?$/i,
  out: /^(debit|debits|withdrawals?|paid out|money out|out)(?: \(?[A-Z]{3}\)?)?$/i,
  in: /^(credit|credits|deposits?|paid in|money in|in)(?: \(?[A-Z]{3}\)?)?$/i,
  balance: /^(balance|running balance)(?: \(?[A-Z]{3}\)?)?$/i,
};

/**
 * The bank's name, from the print above the table: the first run of words, eight at most, that
 * says it is a bank, without its legal ending ("plc", "N.A."). A name printed in capitals is given
 * ordinary capitals; a short word that isn't an ordinary one stays as printed ("UOB", "HSBC").
 */
export function bankName(top) {
  const says = /\b(bank|banque|banco|bancorp|credit union|building society|savings and loan|trust company)\b/i;
  const not = /statement|details|summary|transfer|your |page|branch|sort code|account|www\.|@|\d/i;
  for (const cell of top.flatMap((r) => r.cells)) {
    const s = cell.s.trim();
    if (!says.test(s) || not.test(s) || s.split(/\s+/).length > 8) continue;
    const words = s.split(/\s+/);
    while (words.length > 1 && /^(plc|ltd\.?|limited|inc\.?|llc|n\.?a\.?|ag|s\.?a\.?|pjsc|psc|berhad|bhd|card|cards|,)$/i.test(words[words.length - 1])) words.pop();
    let name = words.join(' ').replace(/^[ ,]+|[ ,]+$/g, '');
    if (name === name.toUpperCase()) {
      name = name.split(' ').map((w, i) => {
        if (i > 0 && ['OF', 'THE', 'AND', 'DE', 'DU'].includes(w)) return w.toLowerCase();
        if (w.length <= 4 && !['BANK', 'CITY', 'FIRST', 'STATE', 'TRUST', 'WEST', 'EAST'].includes(w)) return w;
        return titleCase(w);
      }).join(' ');
    }
    return name;
  }
  return null;
}

/**
 * The account or card number above the table: digits in groups ("0000 4471", "1234-5678-9012"),
 * or masked ("XXXX XXXX XXXX 1234"). One labelled as the account's or card's comes first; a sort
 * code, a phone number or a date never counts.
 */
export function accountNumber(top) {
  const number = /(?:[Xx*•]{2,}[ -]?)*\d[\d -]{2,}\d/g;
  const never = /sort code|routing|swift|bic|tel|phone|fax|call|page|statement|period/i;
  const label = /account|a\/c|card|iban|number|no\./i;
  const found = [];
  for (const row of top) {
    for (const cell of row.cells) {
      if (never.test(cell.s)) continue;
      const labelled = label.test(cell.s) || row.cells.some((o) => o.x2 <= cell.x && label.test(o.s) && !never.test(o.s));
      for (const match of cell.s.match(number) ?? []) {
        const digits = match.replace(/\D/g, '');
        const masked = /[Xx*•]/.test(match);
        if (!(digits.length >= 6 || (masked && digits.length >= 4)) || parseDate(match)) continue;
        found.push({ labelled, number: match.trim() });
      }
    }
  }
  return (found.find((f) => f.labelled) ?? found[0])?.number ?? null;
}

const OPENING_WORDS = /opening balance|beginning balance|starting balance|balance b\/f|brought forward|previous balance|balance previous statement/i;
const CLOSING_WORDS = /closing balance|ending balance|balance c\/f|carried forward|grand total|new balance/i;
const TOTALS = '^(sub)?totals?\\b|page totals?';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MONEY = ['amount', 'out', 'in', 'balance'];
const signature = (columns) => MONEY.filter((k) => columns[k]).join(',');

/**
 * **Where each money column really is, from its figures.** Amounts line up on their right edge,
 * and a heading may sit well away from it: centred over the column, at its left, or, read from a
 * picture, a little off where the figures are. So the right edges of every figure under a header
 * are grouped (a gap of more than 20 points starts a new group); when there are at least as many
 * groups as money columns, the biggest, left to right, are those columns, left to right. Only
 * where the headings fail (most figures more than 45 points from every money heading) is this
 * used, so a stray number in a margin can't move a column. Mirrors GeneralTable.learnedEdges.
 */
export function learnedEdges(rows, headerAt) {
  const gathered = new Map();
  let current = null;
  let skipUntil = -1;
  rows.forEach((row, index) => {
    const head = headerAt(index);
    if (head) {
      const money = MONEY.filter((k) => head.found[k]).sort((a, b) => head.found[a].x - head.found[b].x);
      current = {
        key: signature(head.found), columns: money, cells: money.map((k) => head.found[k]),
        from: (head.found.description ?? head.found.date).x2,
      };
      skipUntil = Math.max(...head.near.map((r) => rows.indexOf(r)));
      return;
    }
    if (index <= skipUntil || !current) return;
    const figures = row.cells.filter((x) => isAmount(x.s) && x.x >= current.from);
    const middle = (c) => (c.x + c.x2) / 2;
    const unreached = figures.filter((f) => !current.cells.some((h) => Math.abs(middle(h) - middle(f)) <= 45)).length;
    const entry = gathered.get(current.key) ?? { columns: current.columns, edges: [], unreached: 0 };
    entry.edges.push(...figures.map((f) => f.x2));
    entry.unreached += unreached;
    gathered.set(current.key, entry);
  });
  const learned = new Map();
  for (const [key, entry] of gathered) {
    if (!entry.columns.length || entry.unreached * 2 <= entry.edges.length) continue;
    const groups = [];
    for (const edge of [...entry.edges].sort((a, b) => a - b)) {
      const last = groups[groups.length - 1];
      if (last && edge - last[last.length - 1] <= 20) last.push(edge); else groups.push([edge]);
    }
    if (groups.length < entry.columns.length) continue;
    const biggest = groups.map((g, i) => ({ g, i }))
      .sort((a, b) => b.g.length - a.g.length || a.i - b.i)
      .slice(0, entry.columns.length)
      .sort((a, b) => a.i - b.i);
    const medians = biggest.map(({ g }) => [...g].sort((a, b) => a - b)[Math.floor(g.length / 2)]);
    learned.set(key, Object.fromEntries(entry.columns.map((k, i) => [k, medians[i]])));
  }
  return learned;
}

/**
 * Day first or month first, from the dates themselves: a first figure over 12 can only be a day,
 * a second over 12 only a day too; failing both, US dollars are taken as month first and any
 * other currency as day first.
 */
export function inferDayFirst(rows, currency) {
  let dayFirst = false;
  let monthFirst = false;
  for (const cell of rows.flatMap((r) => r.cells)) {
    const m = cell.s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-]\d{2,4})?$/);
    if (!m) continue;
    if (+m[1] > 12) dayFirst = true;
    if (+m[2] > 12) monthFirst = true;
  }
  if (dayFirst !== monthFirst) return dayFirst;
  return currency !== 'USD';
}

/**
 * **Any table of lines: a described bank, or any other.** Finds the table's header row, then
 * reads every row under it by the header's columns. With a profile (profiles.js, the same JSON
 * the app reads) it reads that bank as described; without one it is the plain-table reader, and
 * everything it reads is marked for checking line by line. Either way it copes with dates printed
 * day or month first, a date printed once a day, a description running on below with its amount
 * on the last of its rows, a running balance printed for some lines only, and headings that give
 * every line under them its sign. Mirrors GeneralTable.swift.
 */
const GeneralTable = {
  id: 'General',
  institution: null,
  country: null,
  recognises: () => true,
  read(pages, profile = null) {
    const rows = allRows(pages);
    const all = text(rows);
    const codes = (all.match(new RegExp(ISO.source, 'g')) ?? []);
    const counts = codes.reduce((m, c) => m.set(c, (m.get(c) ?? 0) + 1), new Map());
    const currency = profile?.currency ?? [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
    const digits = minorDigits(currency);
    const dayFirst = profile?.dateOrder ? profile.dateOrder === 'DMY' : inferDayFirst(rows, currency);

    let from = null;
    let to = null;
    if (profile?.period) {
      const g = all.match(new RegExp(profile.period, 'i'))?.groups;
      if (g?.to) to = parseDate(g.to, { dayFirst });
      if (g?.from) from = parseDate(g.from, { year: to ? +to.slice(0, 4) : null, before: to, dayFirst });
    }
    const full = all.match(/\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)? [A-Za-z]{3,9} \d{4}|[A-Za-z]{3,9} \d{1,2}, \d{4})\b/g) ?? [];
    const dates = full.map((d) => parseDate(d, { dayFirst })).filter(Boolean).sort();
    to = to ?? dates[dates.length - 1] ?? null;
    const year = to ? +to.slice(0, 4) : null;
    // A card statement prints what you spend as a plain figure: that is money out, and what
    // the statement calls the balance is what you owe.
    const owed = profile?.accountType ? profile.accountType === 'card' : /minimum payment|credit limit|card limit/i.test(all);

    const own = profile?.columns ?? {};
    const header = Object.fromEntries(Object.entries(HEADER).map(([k, re]) => [k, own[k] ? new RegExp(own[k], 'i') : re]));
    const phrases = (list) => (list?.length ? new RegExp(list.join('|'), 'i') : null);
    const openingRe = phrases(profile?.opening);
    const closingRe = phrases(profile?.closing);
    const skipRe = new RegExp(profile?.skip?.length ? `${profile.skip.join('|')}|${TOTALS}` : TOTALS, 'i');
    const endRe = phrases(profile?.end);
    const sections = profile?.sections ?? null;

    let columns = null;
    let lastRow = null;
    let opening = null;
    let closingStated = null;
    let closingLocked = false;
    const lines = [];
    let headerUntil = -1;
    let firstHeader = null;
    let sign = null;
    let lastDate = null;
    let pending = null;
    // A header can stand on two or three rows ("Amount" over "(Incl. VAT)" beside "Date"):
    // its words are gathered from the rows within a line's height of this one.
    const headerAt = (index) => {
      const row = rows[index];
      const near = rows.filter((r, j) => Math.abs(j - index) <= 3 && Math.abs(r.y - row.y) <= 14 && r.page === row.page);
      const found = {};
      for (const cell of near.flatMap((r) => r.cells)) {
        for (const [key, re] of Object.entries(header)) if (!found[key] && re.test(cell.s)) found[key] = cell;
      }
      return found.date && found.description && (found.amount || found.out || found.in) ? { found, near } : null;
    };
    const edges = learnedEdges(rows, headerAt);
    rows.forEach((row, index) => {
      const c = row.cells;
      const head = headerAt(index);
      if (head) {
        const { found, near } = head;
        columns = found;
        if (firstHeader == null) firstHeader = Math.min(...near.map((r) => rows.indexOf(r)));
        headerUntil = Math.max(...near.map((r) => rows.indexOf(r)));
        pending = null;
        return;
      }
      if (index <= headerUntil) return;
      // "Checks Paid (continued)", "Withdrawals and other debits - continued"
      const section = sections?.find((sec) => new RegExp(`^${escapeRe(sec.heading)}(?:\\s*(?:\\(continued\\)|[-–] ?continued))?$`, 'i').test(row.text));
      if (section) { sign = section.sign; return; }
      const lastFigure = () => parseAmount(c[c.length - 1].s, digits);
      if (openingRe?.test(row.text)) { if (opening == null) opening = lastFigure(); return; }
      if (closingRe?.test(row.text)) {
        const v = lastFigure();
        if (!closingLocked && v != null) { closingStated = v; closingLocked = true; }
        return;
      }
      if (OPENING_WORDS.test(row.text)) { if (opening == null) opening = lastFigure(); return; }
      if (CLOSING_WORDS.test(row.text)) {
        const v = lastFigure();
        if (!closingLocked && v != null) closingStated = v;
        return;
      }
      if (endRe?.test(row.text)) { columns = null; return; }
      if (skipRe.test(row.text)) return;
      if (!columns) return;
      const descriptionX = (columns.description ?? columns.date).x;
      const figuresFrom = (columns.description ?? columns.date).x2;
      const dateCell = c[0] && c[0].x < descriptionX - 4 && parseDate(c[0].s, { year, before: to, dayFirst }) ? c[0] : null;
      const date = dateCell ? parseDate(dateCell.s, { year, before: to, dayFirst }) : null;
      const figures = c.filter((x) => isAmount(x.s) && x.x >= figuresFrom);
      // Each figure goes to the column it sits nearest, and only when it sits near one: print
      // in a margin, or a number in a merchant's name, is left alone. Two in one column: the
      // nearer wins. Where the figures themselves showed where each money column's right edge
      // is (learnedEdges), that is where a column is; otherwise its heading is.
      const learned = edges.get(signature(columns));
      const distance = (cell, key, col) => (learned?.[key] != null
        ? Math.abs(learned[key] - cell.x2)
        : Math.abs((col.x + col.x2) / 2 - (cell.x + cell.x2) / 2));
      const reach = learned ? 30 : 45;
      const taken = {};
      for (const f of figures) {
        const [key, col] = Object.entries(columns)
          .filter(([k]) => MONEY.includes(k))
          .sort(([ka, a], [kb, b]) => distance(f, ka, a) - distance(f, kb, b))[0] ?? [];
        if (!key || distance(f, key, col) > reach) continue;
        if (!taken[key] || distance(f, key, col) < distance(taken[key], key, col)) taken[key] = f;
      }
      let amount = null;
      let running = null;
      for (const [key, f] of Object.entries(taken)) {
        const v = parseAmount(f.s, digits);
        if (v == null) continue;
        if (key === 'balance') running = v;
        else if (key === 'out') { if (v !== 0) amount = -Math.abs(v); }
        else if (key === 'in') { if (v !== 0) amount = Math.abs(v); }
        else if (key === 'amount') amount = owed ? -v : /DR$/i.test(f.s) ? -Math.abs(v) : v;
      }
      if (sign != null && amount != null) amount = sign * Math.abs(amount);
      const rightEdge = Math.max(...Object.values(columns).map((k) => k.x2)) + 10;
      const used = [...Object.values(taken), ...(dateCell ? [dateCell] : [])];
      // Words never sit in the money columns (".00" in an empty one), and a date standing alone
      // right of the description is a value date, not words.
      const moneyFrom = Math.min(...Object.entries(columns).filter(([k]) => ['amount', 'out', 'in', 'balance'].includes(k)).map(([, v]) => v.x), rightEdge);
      const wordCells = c.filter((x) => !used.includes(x) && x.x2 <= rightEdge && x.x < moneyFrom - 10
        && !(x.x > descriptionX && parseDate(x.s, { dayFirst })));
      let madeOn = null;
      if (date && wordCells[0] && wordCells[0].x < descriptionX - 4) {
        const made = parseDate(wordCells[0].s, { year, before: to, dayFirst });
        if (made) { madeOn = made; wordCells.shift(); }
      }
      const words = cellsText(wordCells);

      if (amount == null) {
        if (date && words) {
          // A dated row with no amount: the amount comes on a row below.
          pending = { date, madeOn, words: [words], page: row.page };
          lastDate = date;
          return;
        }
        if (date) lastDate = date;
        if (words && wordCells[0] && wordCells[0].x >= descriptionX - 20) {
          if (pending && pending.page === row.page) {
            pending.words.push(words);
          } else if (lines.length && lastRow && lastRow.page === row.page && lastRow.y - row.y < 30) {
            // Words just under a line, in the description's column, carry its description on.
            lines[lines.length - 1].description += ' · ' + words;
            lastRow = row;
          }
        } else if (running != null && !pending && lines.length && lines[lines.length - 1].running == null) {
          // A balance printed on its own row, for the line above.
          lines[lines.length - 1].running = running;
        }
        return;
      }
      // A line: dated here, dated on a row above it, or the day's date left blank.
      let description = words;
      let lineDate = date;
      if (!date && pending) {
        lineDate = pending.date;
        madeOn = pending.madeOn;
        description = [...pending.words, ...(words ? [words] : [])].join(' · ');
      } else if (!date) {
        lineDate = lastDate;
      }
      pending = null;
      if (!lineDate) return;
      lastDate = lineDate;
      const before = lines.length ? lines[lines.length - 1].running : opening;
      if (!owed && sign == null && running != null && before != null && before + amount !== running && before - amount === running) amount = -amount;
      lines.push(line({ date: lineDate, madeOn, description, amount, running }));
      lastRow = row;
    });
    const lastRunning = [...lines].reverse().find((l) => l.running != null)?.running ?? null;
    const closing = closingStated ?? lastRunning;
    if (opening == null && lines[0]?.running != null) opening = lines[0].running - (owed ? -lines[0].amount : lines[0].amount);
    if (!lines.length) return { holder: null, period: { from: from ?? dates[0] ?? null, to }, accounts: [] };
    const top = rows.slice(0, firstHeader ?? 15);
    let acct;
    if (profile) {
      const number = profile.account ? all.match(new RegExp(profile.account, 'i'))?.groups?.number ?? null : null;
      const product = profile.product ? all.match(new RegExp(profile.product, 'i'))?.groups?.product?.trim() ?? null : null;
      let name = (profile.name ?? '{institution} ·· {last4}')
        .replace('{product}', product ?? profile.institution)
        .replace('{institution}', profile.institution);
      name = number ? name.replace('{last4}', last4(number)) : name.replace(' ·· {last4}', '').replace('{last4}', '');
      const digitsOnly = number ? number.replace(/\D/g, '') : null;
      acct = account({
        ref: digitsOnly ? `${profile.id}:${digitsOnly}` : null, number, numbers: digitsOnly ? [digitsOnly] : [],
        name, type: profile.accountType === 'savings' ? 'savings' : profile.accountType === 'card' ? 'card' : 'current',
        owed, currency, opening, closing, lines,
      });
    } else {
      // Named from what sits above the table: the bank and the number's last four (owner's ruling,
      // 15 October 2026), so next month's statement from the same account finds it again.
      const bank = bankName(top);
      const number = accountNumber(top);
      const named = bank ? (owed ? `${bank} card` : bank) : (owed ? 'Card' : 'Account');
      acct = account({
        ref: bank && number ? `General:${bank.toLowerCase()}:${last4(number)}` : null,
        number, numbers: number ? [number] : [],
        name: number ? `${named} ·· ${last4(number)}` : named,
        type: owed ? 'card' : 'current', owed, currency, opening, closing, lines,
        notes: ['read as a plain table: check each line'],
      });
    }
    const start = [from, dates[0], lines[0]?.date].filter(Boolean).sort()[0] ?? null;
    return { holder: null, period: { from: from ?? start, to }, accounts: [acct], institution: profile ? null : bankName(top) };
  },
};

export const READERS = [UAEWio, UAEEmiratesIslamic, SGCitibank, SGUOB];
export { GeneralTable, PROFILES };

/** The readers made for one bank each, and the banks described, for saying which read best. */
export const BANK_READERS = [...READERS.map((r) => r.id), ...PROFILES.map((p) => p.id)].sort();

// ---------------------------------------------------------------------------------------------
// Reading a statement, and seeing it beside the others

/** Pages of rows → one statement: who read it, the holder, the period, the accounts. */
export function readStatement(pages, { fileName = null } = {}) {
  const hasText = pages.some((rows) => rows.length > 0);
  if (!hasText) return { reader: null, picture: true, fileName, accounts: [] };
  const reader = READERS.find((r) => r.recognises(pages));
  // A bank described rather than coded: the table engine, told how this bank prints.
  const profile = reader ? null : PROFILES.find((p) => p.recognise.length && p.recognise.every((re) => new RegExp(re, 'i').test(text(allRows(pages)))));
  const read = reader ? reader.read(pages) : GeneralTable.read(pages, profile);
  for (const a of read.accounts) {
    a.check = check(a);
    // An account of the user's own that went below zero (overdrawn): balances are kept at zero
    // or above, so the review says the overdraft isn't counted.
    a.belowZero = !a.owed && [a.opening, a.closing, ...a.lines.map((l) => l.running)].some((v) => v != null && v < 0);
  }
  const by = reader ?? (profile ? { id: profile.id, institution: profile.institution, country: profile.country } : GeneralTable);
  return {
    reader: by.id, institution: read.institution ?? by.institution, country: by.country, general: !reader && !profile,
    fileName, holder: read.holder, period: read.period, accounts: read.accounts,
  };
}

const nameWords = (name) => (name ?? '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3);

/**
 * Labels every line: between your accounts, interest, money in, or money out. A line is between
 * your accounts when it names the holder (any two of their names, in any order), names another
 * of the statement's accounts, carries the number of any account read, or repays a card.
 *
 * **Every statement added together belongs to one person**, so a statement that doesn't print a
 * name (a Wise CSV, a plain table) is checked against the names the others print.
 */
export function labelLines(statements) {
  const numbers = new Map();
  for (const s of statements) for (const a of s.accounts) for (const n of a.numbers) {
    const digits = String(n).replace(/\D/g, '');
    if (digits.length >= 8) numbers.set(digits, a);
  }
  const holders = [...new Set(statements.map((s) => s.holder).filter(Boolean))].map((h) => new Set(nameWords(h)));
  for (const s of statements) {
    const otherNames = s.accounts.filter((a) => a.type !== 'current').map((a) => a.name.replace(/ ·· \d+$/, '').toLowerCase());
    for (const a of s.accounts) for (const l of a.lines) {
      const d = l.description.toLowerCase();
      const words = new Set(nameWords(d));
      const namesHolder = holders.some((holder) => [...holder].filter((w) => words.has(w)).length >= 2);
      const namesAccount = otherNames.some((n) => n.length >= 5 && d.includes(n));
      const carries = (d.replace(/[\s-]/g, '').match(/\d{8,}/g) ?? []).some((n) => numbers.has(n) && numbers.get(n) !== a);
      const repays = /credit (card )?repayment|card repayment|repayment autopay/.test(d);
      const interest = /^interest credit|interest earned|early withdrawal interest|^interest$|profit paid/.test(d);
      l.label = interest ? 'interest' : namesHolder || namesAccount || carries || repays ? 'own' : l.amount >= 0 ? 'in' : 'out';
    }
  }
  return statements;
}

/** Money in and out per month and currency, leaving out moves between your own accounts. */
export function monthly(statements) {
  const months = new Map();
  for (const s of statements) for (const a of s.accounts) for (const l of a.lines) {
    if (!l.date || l.label === 'own') continue;
    const key = `${l.date.slice(0, 7)} ${a.currency}`;
    const m = months.get(key) ?? { month: l.date.slice(0, 7), currency: a.currency, in: 0, out: 0, interest: 0 };
    if (l.label === 'interest') m.interest += l.amount;
    else if (l.amount >= 0) m.in += l.amount;
    else m.out -= l.amount;
    months.set(key, m);
  }
  // A file that names no currency (a QIF, many a CSV or spreadsheet) has none: it sorts first.
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month) || (a.currency ?? '').localeCompare(b.currency ?? ''));
}

// ---------------------------------------------------------------------------------------------
// CSV files, and the zips they come in

/**
 * CSV text → rows of fields. Quotes, doubled quotes inside them, and line breaks in a quoted
 * field. The separator is a comma unless said otherwise (a semicolon or a tab, for banks whose
 * decimal mark is a comma). Quotes are read leniently, as banks write them: a quote opens a quoted
 * field only at the field's start (after spaces at most); anywhere else in an unquoted field it is
 * a character (`HOME DEPOT 12" SAW`, `בע"מ`). Inside a quoted field a doubled quote is one quote, and
 * a quote closes the field only when the separator, a line end or the end of the text follows it
 * (spaces and tabs between allowed); any other quote there is a character too.
 */
export function parseCsv(text, separator = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const t = text.replace(/^\uFEFF/, '');
  const closes = (i) => {
    let k = i + 1;
    while (k < t.length && t[k] !== separator && (t[k] === ' ' || t[k] === '\t')) k++;
    return k >= t.length || t[k] === separator || t[k] === '\n' || t[k] === '\r';
  };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"' && closes(i)) quoted = false;
      else field += c;
    } else if (c === '"' && /^[ \t]*$/.test(field)) { quoted = true; field = ''; }
    else if (c === separator) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

/**
 * **INTL-Wise**: one CSV per currency balance, newest line first, each with the balance after
 * it. The file name carries the balance's id, its currency and the dates covered. There is no
 * opening or closing figure: the opening is worked back from the oldest line, the closing is the
 * newest line's balance, and the check is that every running balance follows from the one
 * before. A file with no lines has no balance in it at all, and says so.
 */
const INTLWise = {
  id: 'INTL-Wise',
  institution: 'Wise',
  country: null,
  recognises: (header) => header.includes('TransferWise ID') && header.includes('Running Balance'),
  read(rows, fileName) {
    const [header, ...body] = rows;
    const col = (name) => header.indexOf(name);
    const m = (fileName ?? '').match(/statement_(\d+)_([A-Z]{3})_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/);
    const currency = m?.[2] ?? body[0]?.[col('Currency')] ?? null;
    const digits = minorDigits(currency);
    const number = m?.[1] ?? null;
    const lines = body.map((r) => {
      const amount = parseAmount(r[col('Amount')], digits);
      const exchangeTo = r[col('Exchange To')];
      const exchangeAmount = parseAmount(r[col('Exchange To Amount')], minorDigits(exchangeTo));
      return line({
        date: parseDate(r[col('Date')]),
        description: (r[col('Description')] ?? '').trim(),
        amount, running: parseAmount(r[col('Running Balance')], digits),
        ref: r[col('TransferWise ID')] || null,
        foreign: exchangeTo && exchangeTo !== currency && exchangeAmount != null
          ? { currency: exchangeTo, amount: amount < 0 ? -Math.abs(exchangeAmount) : Math.abs(exchangeAmount) } : null,
      });
    }).filter((l) => l.amount != null).reverse();
    const acct = account({
      ref: number ? `INTL-Wise:${number}` : null, number, numbers: [],
      name: `Wise ${currency ?? ''}`.trim(), type: 'current', currency, lines,
    });
    if (lines.length) {
      acct.opening = lines[0].running - lines[0].amount;
      acct.closing = lines[lines.length - 1].running;
    } else {
      acct.notes.push('no lines, so no balance in the file');
    }
    const holderCell = body.map((r) => r[col('Card Holder Full Name')]).find((v) => v && v.trim());
    return {
      holder: holderCell?.trim() ?? null,
      period: { from: m ? m[3] : lines[0]?.date ?? null, to: m ? m[4] : lines[lines.length - 1]?.date ?? null },
      accounts: [acct],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Helpers for the bank files beside the PDF: CSV, MT940, CAMT and QIF, as the app reads them

/** Spaces and tabs off both ends, as the app trims a cell: line ends stay. */
const trimSpaces = (s) => String(s ?? '').replace(/^[\t\p{Zs}]+|[\t\p{Zs}]+$/gu, '');

/** Every run of white space as one space, none at the ends. */
const collapse = (s) => String(s ?? '').split(/\s+/).filter(Boolean).join(' ');

/** "YYYY-MM-DD" for a day that exists, or null. */
function realDay(y, m, d) {
  if (!(y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1)) return null;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate() ? iso(y, m, d) : null;
}

/** "2026-08-31" → itself when the day exists, else null. */
const isoDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  return m ? realDay(+m[1], +m[2], +m[3]) : null;
};

/** A date as a bank file writes it → "YYYY-MM-DD", only for a day that exists. */
const fileDay = (s, dayFirst = true) => isoDay(parseDate(s, { dayFirst }));

const UNCHECKED = () => ({ ok: false, checked: false, sum: 0, expected: null, messages: [] });

/** Checked, or not when there is nothing to check against, and whether it went below zero. */
function finishAccount(a, unchecked = false) {
  a.check = unchecked ? UNCHECKED() : check(a);
  a.belowZero = !a.owed && [a.opening, a.closing, ...a.lines.map((l) => l.running)].some((v) => v != null && v < 0);
}

// ---------------------------------------------------------------------------------------------
// Any bank's CSV: the words banks use are data (csv-words.js, the app's Statements/CSV/words.json),
// so the phone and the website read a file alike and no bank has code of its own. Every rule below
// is written to be ported line by line, in this file's order (the list of rules for the Swift port follows it).
// Porting the patterns and strings: in JavaScript `\d` is [0-9] and `\b` an ASCII word edge, where
// NSRegularExpression's are any Unicode digit and a Unicode word edge: write [0-9] (and spell the
// edges out) in Swift. `\s` is JavaScript's white space, `\p{Zs}` the same on both. A line ends at
// "\n" or "\r" as scalars (a Swift Character holds "\r\n" whole, so split unicodeScalars), and a
// text is walked, counted and sliced by Unicode scalars (`unicodeScalars`), never by Characters. The
// shares (nine in ten, four in five, half) are compared as whole numbers.

/**
 * **A key**: how a heading, a label or a word is compared, here and on the phone. camelCase split
 * ("RunningBalance" → "Running Balance"), lowercase (no locale), final sigma as sigma, decomposed
 * (NFD), the combining marks after a Latin, Greek or Cyrillic letter dropped (accents) and every other
 * kept (Thai vowels and tones, Indic signs, Japanese voicing: "ม.ค." is January, "มี.ค." March), every
 * run of characters that are neither letters, digits nor kept marks one space, none at the ends.
 * "Betrag (€)" → "betrag", "Zahlungsempfänger*in" → "zahlungsempfanger in", "Ποσό" → "ποσο", "取引日"
 * stays "取引日". Swift: `(\p{Ll})(\p{Lu})` → "$1 $2", `lowercased()`, "ς"→"σ",
 * `decomposedStringWithCanonicalMapping`, then `([\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])\p{M}+`
 * → "$1" and `[^\p{L}\p{N}\p{M}]+` → " " with NSRegularExpression, trimmed (csv-words' `_key`).
 */
export function csvKey(s) {
  return String(s ?? '').replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').toLowerCase().replace(/ς/g, 'σ').normalize('NFD')
    .replace(/([\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])\p{M}+/gu, '$1').replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();
}

const WORD_LISTS = ['date', 'text', 'party', 'kind', 'amount', 'net', 'out', 'in', 'balance', 'currency', 'account', 'counterAccount',
  'state', 'pending', 'fee', 'sign', 'signOut', 'signIn', 'card', 'cardFile', 'creditCard', 'debitFile', 'payment', 'holder',
  'opening', 'closing', 'totals', 'periodFrom', 'periodTo', 'period', 'dateFillers', 'accountType'];

/** Every list of words as keys, in its order. A word whose key is empty ("+", "-") is kept out. */
const WORDS = Object.fromEntries(WORD_LISTS.map((name) => [name, CSV_WORDS[name].map(csvKey).filter(Boolean)]));

/** A card's two dates: when the purchase was made ("Transaction Date", Discover's "Trans. Date") and when it was posted. */
const CARD_MADE = CSV_WORDS.cardDates.made.map(csvKey);
const CARD_POSTED = CSV_WORDS.cardDates.posted.map(csvKey);

/** Whole headers that are a card's export with no bank named (Lloyds' and Halifax's card, Nubank, Japan's card statements). */
const CARD_HEADERS = CSV_WORDS.cardHeaders.map((h) => ({ ...h, headerKeys: (h.header ?? []).map(csvKey), layoutKeys: (h.layout ?? []).map(csvKey) }));

/** Currencies and countries whose banks write dates month first (USD, CAD, PHP; US, CA, PH). */
const MONTH_FIRST_CURRENCIES = new Set(CSV_WORDS.monthFirstCurrencies);
const MONTH_FIRST_COUNTRIES = new Set(CSV_WORDS.monthFirstCountries);

/**
 * Month names and abbreviations of every language, by key ("aug", "agosto", "ม ค"); a key of one or
 * two words. Months 1 to 12 in turn, each list in its order, the first month to give a key keeps it
 * (csv-words is tested to give none twice, so a Swift dictionary built from it is the same).
 */
const MONTH_NAMES = new Map();
for (let month = 1; month <= 12; month++) {
  for (const name of CSV_WORDS.months[String(month)]) {
    const k = csvKey(name);
    if (k && !MONTH_NAMES.has(k)) MONTH_NAMES.set(k, month);
  }
}

/**
 * Signs and words that name a currency ("€", "zł", "euros"), lowercase, the longest first (in UTF-16
 * code units; every sign is in the Basic Multilingual Plane, so as many as its characters), equal
 * lengths in code unit order, so the order of csv-words' object never matters; "$" alone names none.
 */
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const CURRENCY_SIGNS = Object.entries(CSV_WORDS.currencySigns)
  .map(([sign, code]) => ({ sign: sign.toLowerCase(), code }))
  .sort((a, b) => b.sign.length - a.sign.length || byCodeUnits(a.sign, b.sign));

/**
 * The banks known by name, with their whole-word patterns (a name of four letters or fewer only as
 * written: "ING" isn't "Spending") and each name's length, their headings that must all be there
 * (`header`), their whole header in order (`layout`), and the pattern for their file's name.
 */
const BANKS = CSV_WORDS.banks.map((b) => ({
  ...b,
  patterns: [b.brand, ...(b.aliases ?? [])].map((n) => ({
    re: new RegExp(`(?<![A-Za-z])${escapeRe(n)}(?![A-Za-z])`, n.length > 4 ? 'i' : ''), length: n.length,
  })),
  headerKeys: (b.header ?? []).map(csvKey),
  layoutKeys: (b.layout ?? []).map(csvKey),
  counterKeys: (b.counterAccount ?? []).map(csvKey),
  fileRe: b.fileName ? new RegExp(b.fileName, 'i') : null,
  datesRe: b.dates ? new RegExp(b.dates) : null,
}));

/** ISO 4217 codes, for telling a currency at the end of a heading from any three letters: csv-words' list, the same on every platform. */
const ISO_CURRENCIES = new Set(CSV_WORDS.isoCurrencies);
const isCode = (s) => /^[A-Z]{3}$/.test(s) && ISO_CURRENCIES.has(s);

/** The file's own name, without its folders. */
const baseName = (name) => String(name ?? '').split(/[\\/]/).pop();

/**
 * A cell as the bank meant it: spaces off both ends, and Excel's ways of keeping text as text
 * undone: a leading `=` (`="00012345678"`), a leading apostrophe (`'30-12-34`), or the whole cell in
 * apostrophes (`'Salaris oktober'`).
 */
function cleanCell(value) {
  let s = trimSpaces(value);
  if (s.startsWith('=') && s.length > 1) s = trimSpaces(s.slice(1).replace(/^"([\s\S]*)"$/, '$1'));
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1);
  else if (/^'\S/.test(s)) s = s.slice(1);
  return trimSpaces(s);
}

// --- Words in a header --------------------------------------------------------------------------

/**
 * Whether a heading's key is a word followed only by a currency code, a currency's sign or word, or
 * a number: "amount eur", "入出金 円", "description 2", "description1", "omschrijving 3".
 */
function suffixed(key, word) {
  if (!key.startsWith(word) || key.length === word.length) return false;
  const rest = key.slice(word.length);
  if (/^ ?\d{1,2}$/.test(rest)) return true;
  if (!rest.startsWith(' ')) return false;
  const tail = rest.slice(1);
  return (/^[a-z]{3}$/.test(tail) && ISO_CURRENCIES.has(tail.toUpperCase())) || CURRENCY_SIGNS.some((c) => c.code && csvKey(c.sign) === tail);
}

/** The column for the first of `words` the header has, as the whole heading, then with a code or number after it. `used`: anything with `has(j)`. */
function columnOf(keys, words, used) {
  for (const w of words) {
    const i = keys.findIndex((k, j) => !used.has(j) && k === w);
    if (i >= 0) return i;
  }
  for (const w of words) {
    const i = keys.findIndex((k, j) => !used.has(j) && suffixed(k, w));
    if (i >= 0) return i;
  }
  return null;
}

/** Every column one of `words` names, best first. */
function columnsOf(keys, words, used) {
  const found = [];
  for (const exact of [true, false]) {
    for (const w of words) {
      keys.forEach((k, j) => {
        if (!used.has(j) && !found.includes(j) && (exact ? k === w : suffixed(k, w))) found.push(j);
      });
    }
  }
  return found;
}

/** A currency a heading or a figure names: its last word if that is a code ("Amount (GBP)"), else a sign or word ("€", "euros", "zł"). */
function currencyNamed(text, { lastWordOnly = false } = {}) {
  const raw = String(text ?? '');
  const tokens = csvKey(raw).split(' ').filter(Boolean);
  const last = tokens[tokens.length - 1] ?? '';
  if (tokens.length > (lastWordOnly ? 1 : 0) && isCode(last.toUpperCase()) && /^[a-z]{3}$/.test(last)) return last.toUpperCase();
  const lower = raw.toLowerCase();
  for (const { sign, code } of CURRENCY_SIGNS) {
    // A sign of letters only ("euros", "zł", "Ft") as a whole word; any other ("€", "R$") anywhere.
    if (code && (/^\p{L}+$/u.test(sign) ? tokens.includes(csvKey(sign)) : lower.includes(sign))) return code;
  }
  return null;
}

/**
 * **The header**: the first of the first 40 rows that names a date and money: an amount, money out
 * and money in, a column per currency ("CAD$", "USD$"), or two balance columns of which one is
 * the amount (told apart by the figures). Its columns, each used once, in this order: amount, out,
 * in, currency columns, balances, dates, sign, currency, own account, state, fee, the other side,
 * the text (each word's columns, numbered ones and those with no heading after them), and the kind
 * of line ("Type", "Typ transakce": words for a line that has no others). A column whose cells in
 * the rows below (`below`, the next 50) are dates, half of those filled or more, is never money:
 * Turkish "Valör" (a value date) has the key of Portuguese "Valor" (an amount).
 */
function headerColumns(row, below = []) {
  const keys = row.map(csvKey);
  const used = new Set();
  const take = (i) => { if (i != null) used.add(i); return i; };
  const datedCells = new Map();
  const dated = (j) => {
    if (!datedCells.has(j)) {
      const filled = below.map((r) => cleanCell(r[j] ?? '')).filter(Boolean);
      datedCells.set(j, filled.length > 0 && filled.filter(isDateCell).length * 2 >= filled.length);
    }
    return datedCells.get(j);
  };
  const notMoney = { has: (j) => used.has(j) || dated(j) };
  const amount = take(columnOf(keys, WORDS.amount, notMoney));
  const out = take(columnOf(keys, WORDS.out, notMoney));
  const into = take(columnOf(keys, WORDS.in, notMoney));
  const coded = [];
  keys.forEach((k, i) => {
    if (!notMoney.has(i) && /^[a-z]{3}$/.test(k) && isCode(k.toUpperCase())) { coded.push({ index: i, code: k.toUpperCase() }); used.add(i); }
  });
  const balances = columnsOf(keys, WORDS.balance, notMoney);
  const pairedBalances = amount == null && (out == null || into == null) && !coded.length && balances.length >= 2;
  if (amount == null && (out == null || into == null) && !coded.length && !pairedBalances) return null;
  const balance = pairedBalances ? null : (balances[0] ?? null);
  if (balance != null) used.add(balance);
  if (pairedBalances) balances.forEach((i) => used.add(i));
  const dates = columnsOf(keys, WORDS.date, used);
  if (!dates.length) return null;
  used.add(dates[0]);
  const sign = take(columnOf(keys, WORDS.sign, used));
  const currency = take(columnOf(keys, WORDS.currency, used));
  // The other date headings, less the currency's ("Valuta" is a value date in German, a currency in Swedish).
  dates.slice(1).forEach((i) => { if (i !== currency) used.add(i); });
  const account = take(columnOf(keys, WORDS.account, used));
  const accountType = take(columnOf(keys, WORDS.accountType, used));
  const state = take(columnOf(keys, WORDS.state, used));
  const fee = amount != null && !WORDS.net.includes(keys[amount]) ? take(columnOf(keys, WORDS.fee, used)) : null;
  const party = columnsOf(keys, WORDS.party, used);
  party.forEach((i) => used.add(i));
  const text = [];
  for (const w of WORDS.text) {
    const family = keys.map((k, j) => j).filter((j) => !used.has(j) && (keys[j] === w || suffixed(keys[j], w)));
    if (!family.length) continue;
    // Columns with no heading right after one carry its words on (PKO BP's "Opis transakcji","","","").
    for (let j = family[family.length - 1] + 1; j < keys.length && keys[j] === '' && !used.has(j); j++) family.push(j);
    text.push(family);
    family.forEach((j) => used.add(j));
  }
  const kind = take(columnOf(keys, WORDS.kind, used));
  return {
    keys, dates: dates.filter((i) => i !== currency), amount, out, in: into, coded, balance, pairedBalances: pairedBalances ? balances.slice(0, 2) : null,
    sign, currency, account, accountType, state, fee, party, text, kind,
  };
}

/** The header row within the first 40 and its columns, or null. */
function findHeader(rows) {
  for (let at = 0; at < Math.min(rows.length, 40); at++) {
    const cols = headerColumns(rows[at], rows.slice(at + 1, at + 51));
    if (cols) return { at, headerless: false, ...cols };
  }
  return null;
}

// --- Dates --------------------------------------------------------------------------------------

/** A clock time at the end of a date goes: "10:31", "10:31:00", "T10:31:00Z", "+02:00", "AM". (decaf's pattern) */
const TIME_AT_END = /(?:[T ]+\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*(?:[AaPp][Mm])?\s*(?:Z|[+-]\d{2}:?\d{2})?)$/;
const withoutTime = (s) => trimSpaces(cleanCell(s).replace(TIME_AT_END, ''));

/** A year as written → the year: two figures are 20xx, a Buddhist-era year (2400 to 2700, Thailand) is 543 ahead; 1900 to 2100 only. */
function fullYear(text) {
  let y = Number(text);
  if (text.length <= 2) y += 2000;
  else if (y >= 2400 && y <= 2700) y -= 543;
  return y >= 1900 && y <= 2100 ? y : null;
}

const dayIn = (year, month, day) => {
  const y = fullYear(year);
  return y == null ? null : realDay(y, month, day);
};

/** `a/b/y`, `a.b.y`, `a-b-y`, `a b y`: day and month either way round. */
const AB_Y = /^(\d{1,2})\s*[-/.\s]\s*(\d{1,2})\s*[-/.\s]\s*(\d{4}|\d{2})\s*\.?$/;

/**
 * **A date as a bank file writes it** → "YYYY-MM-DD", or null. The whole cell is read, once a time
 * at its end is gone: `yyyy-mm-dd` (or `/`, `.`, and Korean `2024. 8. 20.`), `2024年8月20日`,
 * `2024년 8월 20일`, `yyyymmdd` (a real day, 1990 to 2100), `a/b/y` with `dayFirst` saying which is
 * the day, and dates with a month's name in any language in `months` ("20 Aug 2024", "20-Aug-24",
 * "Aug 20, 2024", "20. August 2024", "20 de agosto de 2024", "1er août 2024").
 */
export function csvDate(text, dayFirst = true) {
  const s = withoutTime(text);
  if (!s) return null;
  let m;
  if ((m = /^(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*\.?$/.exec(s))) return dayIn(m[1], +m[2], +m[3]);
  if ((m = /^(\d{4})\s*[年년]\s*(\d{1,2})\s*[月월]\s*(\d{1,2})\s*[日일]?$/.exec(s))) return dayIn(m[1], +m[2], +m[3]);
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return +m[1] >= 1990 && +m[1] <= 2100 ? realDay(+m[1], +m[2], +m[3]) : null;
  if ((m = AB_Y.exec(s))) return dayFirst ? dayIn(m[3], +m[2], +m[1]) : dayIn(m[3], +m[1], +m[2]);
  return /\p{L}/u.test(s) && /\d/.test(s) ? namedMonthDate(s) : null;
}

/**
 * A date with a month's name: the key's words (seven at most) are a month's name (the first run of
 * two words, or failing that one word, that is a name in `months`), two numbers, and nothing else
 * but small words ("de", "of": `dateFillers`). A number of four figures is the year; otherwise the
 * first is the day. Ordinals ("1st", "1er") count as numbers.
 */
function namedMonthDate(s) {
  const words = csvKey(s).split(' ');
  if (words.length > 7) return null;
  let at = -1;
  let span = 0;
  for (const size of [2, 1]) {
    for (let i = 0; i + size <= words.length && at < 0; i++) {
      if (MONTH_NAMES.has(words.slice(i, i + size).join(' '))) { at = i; span = size; }
    }
    if (at >= 0) break;
  }
  if (at < 0) return null;
  const month = MONTH_NAMES.get(words.slice(at, at + span).join(' '));
  const numbers = [];
  for (const word of [...words.slice(0, at), ...words.slice(at + span)]) {
    const n = /^(\d{1,4})(?:st|nd|rd|th|er|e)?$/.exec(word);
    if (n) numbers.push(n[1]);
    else if (!WORDS.dateFillers.includes(word)) return null;
  }
  if (numbers.length !== 2) return null;
  const [day, year] = numbers[0].length === 4 ? [numbers[1], numbers[0]] : numbers;
  if (day.length > 2 || (year.length !== 2 && year.length !== 4)) return null;
  return dayIn(year, month, +day);
}

/** Whether a cell reads as a date either way round. */
const isDateCell = (s) => csvDate(s, true) != null || csvDate(s, false) != null;

/**
 * **Day or month first** for dates written `a/b/y`, in this order: a first part over 12 says day
 * first; a second part over 12 says month first; else the order that keeps the lines sorted (up or
 * down), if only one does. Else a hint, and the order is then marked as guessed: (a) the bank's own
 * order (`banks[].dateOrder`, or its country in `monthFirstCountries`; not marked as guessed), (b) the
 * currency the file names (USD, CAD, PHP month first; any other day first), (c) decimal commas in
 * the amounts: day first, (d) the person's main currency (`mainCurrency`, month first for USD, CAD,
 * PHP), else `dayFirstWhenUnsure` (false when it is USD), (e) day first.
 * → `{ order: 'DMY'|'MDY'|'YMD', dayFirst, guessed }`. Files with no `a/b/y` dates are 'YMD' (or
 * the order their month names are written in), and never guessed.
 */
export function dateOrderOf(cells, { bankOrder = null, currency = null, decimalComma: commas = false, mainCurrency = null, dayFirstWhenUnsure = true } = {}) {
  const parts = [];
  let named = null;
  for (const c of cells) {
    const s = withoutTime(c);
    const m = AB_Y.exec(s);
    if (m) parts.push([+m[1], +m[2]]);
    else if (named == null && !/^\d{4}/.test(s) && /\p{L}/u.test(s) && namedMonthDate(s)) named = /^\d/.test(csvKey(s)) ? 'DMY' : 'MDY';
  }
  const settled = (dayFirst, guessed = false) => ({ order: dayFirst ? 'DMY' : 'MDY', dayFirst, guessed });
  if (!parts.length) return { order: named ?? 'YMD', dayFirst: true, guessed: false };
  if (parts.some(([a]) => a > 12)) return settled(true);
  if (parts.some(([, b]) => b > 12)) return settled(false);
  const sorted = (dayFirst) => {
    const days = cells.map((c) => csvDate(c, dayFirst)).filter(Boolean);
    const up = [...days].sort();
    return days.every((d, i) => d === up[i]) || days.every((d, i) => d === up[up.length - 1 - i]);
  };
  const dayFirstSorted = sorted(true);
  if (dayFirstSorted !== sorted(false)) return settled(dayFirstSorted);
  if (bankOrder === 'DMY' || bankOrder === 'MDY') return settled(bankOrder === 'DMY');
  if (currency) return settled(!MONTH_FIRST_CURRENCIES.has(currency), true);
  if (commas) return settled(true, true);
  if (mainCurrency) return settled(!MONTH_FIRST_CURRENCIES.has(mainCurrency), true);
  return settled(dayFirstWhenUnsure !== false, true);
}

/**
 * Whether dates written `a/b/yyyy` put the day first (`dateOrderOf` with only the page's hint).
 * `unsure`: what the person's main currency says when nothing in the dates does.
 */
export function dayFirstOf(dates, unsure = true) {
  return dateOrderOf(dates, { dayFirstWhenUnsure: unsure }).dayFirst;
}

/** Amounts with a decimal comma (`12,50`): a sign of the day written first. */
const decimalComma = (amounts) => amounts.some((a) => /\d,\d{2}\)?-?\s*$/.test(a) && !a.includes('.'));

// --- Amounts ------------------------------------------------------------------------------------

/**
 * **A CSV or QIF amount**: `1,234.56`, `1.234,56`, `1 234,56` (any space: NBSP, narrow, thin),
 * `1'234.56` and `1’234.56`, `1.234.567,89`, `1,23,456.78`, `+1,234.56`, `-12,50`, `1.234,56-`,
 * `(12.00)`, `12.00 DR`/`CR`/`Dr.`/`Cr.` (`DR` takes away), a currency's code, sign or word before or
 * after (`€`, `£`, `$`, `CHF`, `zł`, `kr`, `Kč`, `Ft`, `₹`, `¥`, `₩`, `₪`, `R$`, `C$`, `A$`). `mark` is the
 * column's decimal mark (',' or '.') when its figures show it; without it a comma before the last
 * one or two digits is the point, and dots before groups of three are thousands ("245.000") unless
 * the currency has three decimals (`places`, the decimals it is written with: `digits` unless the
 * figures are read at more than their currency's, as a file naming none is, at three). Null when it
 * isn't a figure, and for an empty cell or a lone dash.
 */
export function csvAmount(text, digits = 2, mark = null, places = digits) {
  let s = trimSpaces(text);
  if (s === '' || /^[-\u2013\u2014]$/.test(s)) return null;
  // Letters between figures make it something else ("1e3", "12a34").
  if (/\d\p{L}+\d/u.test(s)) return null;
  let sign = 1;
  // DR or CR after the figure, or after a space: not the end of a code ("100 IDR" is rupiah, not money out).
  const dc = /^(.*?)(?:\s+|(?<=[\d)]))(DR|Dr|dr|CR|Cr|cr)\.?$/.exec(s);
  if (dc) {
    s = dc[1];
    if (dc[2].toLowerCase() === 'dr') sign = -1;
  }
  // Currency codes, signs and words go; the minus may come before or after them.
  s = s.replace(/\u2212/g, '-').replace(/[\p{L}\p{Sc}]+\.?/gu, '').replace(/[\s\p{Zs}'\u2019+]/gu, '');
  if (!s) return null;
  if (mark === ',' || (mark == null && /^\(?-?[\d.]*,\d{1,2}\)?-?$/.test(s))) s = s.replace(/\./g, '').replace(/,/g, '.');
  // "5.000", "245.000", "1.234.567": dots before groups of three are thousands (Icelandic krónur,
  // German whole euros), unless the currency has three decimals ("1.234" Kuwaiti dinars).
  else if (mark == null && places !== 3 && /^\(?-?[1-9]\d{0,2}(?:\.\d{3})+\)?-?$/.test(s)) s = s.replace(/\./g, '');
  else s = s.replace(/,/g, '');
  if (s.endsWith('-')) s = '-' + s.slice(0, -1);
  if (!/^\(?-?\d*\.?\d+\)?$/.test(s)) return null;
  const value = parseAmount(s, digits);
  return value == null ? null : value * sign;
}

/**
 * The decimal mark a column's figures show: ',' when some end in a comma and one or two digits (or a
 * comma after four digits or more: no thousands mark follows four digits, "1500,250") and none in a
 * point that way, '.' the other way round ("1500.250" says the point, so "-12.345" is twelve dinars),
 * null when they don't say.
 */
function decimalMarkOf(cells) {
  let comma = false;
  let point = false;
  for (const c of cells) {
    const s = String(c ?? '').replace(/[^\d.,]/g, '');
    if (/\d,\d{1,2}$/.test(s) || /\d\.\d{3},\d+$/.test(s) || /(?:^|[^\d.,])\d{4,},\d+$/.test(` ${s}`)) comma = true;
    if (/\d\.\d{1,2}$/.test(s) || /\d,\d{3}\.\d+$/.test(s) || /(?:^|[^\d.,])\d{4,}\.\d+$/.test(` ${s}`)) point = true;
  }
  return comma === point ? null : comma ? ',' : '.';
}

/** A figure: an amount with its decimals written ("12.50", "1.234,00"), not a date. */
const isFigure = (s, mark = null) => /\d[.,]\d{1,3}(?!\d)/.test(s) && !isDateCell(s) && csvAmount(s, 2, mark) != null;

/** The currency a figure carries ("1.234,56 EUR", "£12.00", "25,00€"), or null. */
function currencyOfFigure(text) {
  const s = trimSpaces(text).replace(/(?:\s+|(?<=[\d)]))(DR|Dr|dr|CR|Cr|cr)\.?$/, '');
  if (!/\d/.test(s)) return null;
  const marks = s.replace(/[^\p{L}\p{Sc}]/gu, '');
  if (!marks) return null;
  if (isCode(marks)) return marks;
  const found = CURRENCY_SIGNS.find((c) => c.sign === marks.toLowerCase());
  return found ? found.code : null;
}

/** The one currency every marked figure carries, or null. */
function currencyOfFigures(cells) {
  const codes = new Set(cells.map(currencyOfFigure).filter(Boolean));
  return codes.size === 1 ? [...codes][0] : null;
}

/** A sign column's value: -1 for money out ("Af", "D", "Debit", "S", "Χ"), +1 for money in, 0 when it says neither. */
function signOf(value) {
  const raw = trimSpaces(value);
  if (raw === '-') return -1;
  if (raw === '+') return 1;
  const k = csvKey(raw);
  if (!k) return 0;
  return WORDS.signOut.includes(k) ? -1 : WORDS.signIn.includes(k) ? 1 : 0;
}

/** A line not booked yet, or not at all: its state names one of `pending` ("Vorgemerkt", "Umsatz vorgemerkt"). */
const isPending = (value) => {
  const k = ` ${csvKey(value)} `;
  return k.trim() !== '' && WORDS.pending.some((p) => k.includes(` ${p} `));
};

// --- Accounts and banks -------------------------------------------------------------------------

/** Whether an IBAN's check digits are right (ISO 13616: the first four moved to the end, letters as 10 to 35, mod 97 is 1). */
export function validIban(text) {
  const s = String(text ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  let rest = 0;
  for (const c of s.slice(4) + s.slice(0, 4)) {
    const value = /[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c;
    for (const d of value) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

/** Every IBAN in a text whose check digits are right, without its spaces. */
function ibansIn(text) {
  return (String(text ?? '').toUpperCase().match(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g) ?? [])
    .map((s) => s.replace(/\s/g, '')).filter(validIban);
}

/**
 * An account number in a cell: an IBAN; else the longest run of words made of digits and letters
 * with a digit in each (or mask characters only: "XXXX", "****"), with six digits or more, or four
 * with a mask ("****5678"). "Girokonto 123 4567890 00" → "123 4567890 00"; a figure never counts
 * (its dots and commas break the words), nor a date ("01/09/2026", "2026-09-01") or a year and month
 * ("2015-02"): they are taken out first, so "12345678 opened 01/02/2015" is "12345678".
 */
function identifierIn(text) {
  const iban = ibansIn(text)[0];
  if (iban) return iban;
  const plain = String(text ?? '')
    .replace(/[0-9]{1,4}[-/.][0-9]{1,2}[-/.][0-9]{1,4}/g, (m) => (isDateCell(m) ? ' ' : m))
    .replace(/(?<![-0-9/.])(?:19|20)[0-9]{2}[-/.](?:0?[1-9]|1[0-2])(?![-0-9/.])/g, ' ');
  let best = null;
  let run = [];
  const flush = () => {
    const t = run.join(' ').replace(/^[-\s]+|[-\s]+$/g, '');
    const digits = t.replace(/\D/g, '').length;
    if (t && /\d/.test(t) && (digits >= 6 || (/[Xx*•]/.test(t) && digits >= 4)) && (!best || t.length > best.length)) best = t;
    run = [];
  };
  for (const word of plain.split(/[\s/]+/)) {
    if (/^[0-9A-Za-z*•-]+$/.test(word) && (/\d/.test(word) || /^[Xx*•]+$/.test(word))) run.push(word);
    else flush();
  }
  flush();
  return best;
}

/** An account number standing for a name ("2001234567/2010", "FI21 1234 5600 0007 85", "NL55INGB0001234567"). */
const looksLikeAccountNumber = (v) => validIban(v) || /^[A-Z]{2}\d{2}[A-Z0-9 ]{11,34}$/.test(v)
  || (/^[A-Z]{0,2}[\d\s/.-]+$/.test(v) && v.replace(/\D/g, '').length >= 6);

/** Whether a key is a label from `words`: the word itself, or the word then more words ("kontostand vom 31 08 2024"). */
const labelled = (key, words) => words.some((w) => key === w || key.startsWith(`${w} `));

/** Whether a header is a signature's: every one of its `headerKeys` there, or its `layoutKeys` the header's headings exactly, in order. */
function signedBy(sig, headerKeys) {
  const headings = headerKeys.filter(Boolean);
  if (sig.layoutKeys.length) return sig.layoutKeys.length === headings.length && sig.layoutKeys.every((k, i) => k === headings[i]);
  return sig.headerKeys.length > 0 && sig.headerKeys.every((k) => headerKeys.includes(k));
}

/**
 * **The bank** a file is from: of the brands whose name or another of their names is a whole word
 * in the file's name or in a row above the table (never a heading: neon's "Wise" column; never a
 * row of the holder's name: "Account holder, Ally Smith"), the one with the longest such name
 * ("National Bank of Greece" over "National Bank"); failing that, a bank whose header is its
 * signature (`header` words all there: "Emoji" is Monzo's; or its whole `layout`) or whose file
 * name pattern matches ("Checking1.csv" is Wells Fargo's), the signature first. An entry with both a
 * signature and a file name pattern needs both, and one with a pattern for its dates (`dates`) needs
 * every date cell to match it (American Express's own basic export: "activity.csv" with exactly Date,
 * Description, Amount and dates written 09/28/2026; a checking file saved as activity.csv with ISO
 * dates isn't it). Of a brand's entries, the one whose header or file name also matches comes first
 * (the card export of a bank that has both). Null when nothing says.
 */
function bankOf(fileName, headerKeys, texts, dates = []) {
  const name = baseName(fileName);
  const signed = (b) => b.headerKeys.length > 0 || b.layoutKeys.length > 0;
  const datesFit = (b) => b.datesRe == null || (dates.length > 0 && dates.every((d) => b.datesRe.test(d)));
  const byHeader = (b) => signed(b) && signedBy(b, headerKeys) && (b.fileRe == null || b.fileRe.test(name)) && datesFit(b);
  const byName = (b) => b.fileRe != null && b.fileRe.test(name) && (!signed(b) || signedBy(b, headerKeys)) && datesFit(b);
  let named = null;
  let longest = 0;
  for (const b of BANKS) {
    for (const { re, length } of b.patterns) {
      if (length > longest && (re.test(name) || texts.some((t) => re.test(t)))) { named = b; longest = length; }
    }
  }
  if (named) return BANKS.find((b) => b.brand === named.brand && (byHeader(b) || byName(b))) ?? named;
  return BANKS.find(byHeader) ?? BANKS.find(byName) ?? null;
}

/** A bank's own order for dates: its `dateOrder`, or its country's (month first in `monthFirstCountries`, else day first). */
function bankDateOrder(bank) {
  if (!bank) return null;
  if (bank.dateOrder) return bank.dateOrder;
  if (!bank.country) return null;
  return MONTH_FIRST_COUNTRIES.has(bank.country) ? 'MDY' : 'DMY';
}

/** Whether a text names a card: one of `words` in its key as whole words, and no `debitFile` word ("Visa Debit" is a bank account's card). */
function saysCard(text, words) {
  const k = ` ${csvKey(text)} `;
  return words.some((w) => k.includes(` ${w} `)) && !WORDS.debitFile.some((w) => k.includes(` ${w} `));
}

/**
 * **A card export**: the bank's entry says card (matched by its name, its header or its file name);
 * a header in `cardHeaders`; a heading in `card` ("Card Member", "Card No.") filled on nine lines in
 * ten or more (`cardColumn`: a current account's "Card number" is filled on its card payments only);
 * a purchase date (`cardDates.made`: "Transaction Date", "Trans. Date") with a posting date
 * (`cardDates.posted`) and neither a balance nor a sign column (decaf's rule, narrowed: Truist's and
 * Navy Federal's checking exports carry both dates too); the file's name saying card (`cardFile` or
 * `creditCard`, without a `debitFile` word: "Apple Card Transactions", "CardStatement", not "Visa
 * Debit"); or a row above the table saying credit card (`creditCard`: DKB's "Kreditkarte:") or
 * labelled with a card heading ("Card Number 4835-****-****-1234").
 */
function cardExport(bank, cardHeader, headerKeys, fileName, above, { balance = false, sign = false, cardColumn = false } = {}) {
  if (bank?.card || cardHeader) return true;
  if (cardColumn) return true;
  if (CARD_MADE.some((w) => headerKeys.includes(w)) && CARD_POSTED.some((w) => headerKeys.includes(w)) && !balance && !sign) return true;
  if (saysCard(baseName(fileName).replace(/\.[^.]*$/, ''), [...WORDS.cardFile, ...WORDS.creditCard])) return true;
  return above.some((r) => {
    const cells = r.map((x) => cleanCell(x)).filter(Boolean);
    return cells.length > 0 && (saysCard(cells.join(' '), WORDS.creditCard) || labelled(csvKey(cells[0]), WORDS.card));
  });
}

/**
 * Whether a card file prints charges positive (as its issuer sees the account): the bank's entry or
 * the card header says so (`chargesPositive`: American Express, Discover, Apple Card, BMO), or its
 * lines whose description has a `payment` phrase (a repayment: "PAYMENT RECEIVED", "THANK YOU",
 * "AUTOPAY", "REMBOURSEMENT", "SPŁATA"; never a purchase's "PAIEMENT CB" or "PŁATNOŚĆ KARTĄ") as
 * whole words are all money out while more than half of the others are money in (decaf's rule).
 * With no such line, the signs are as printed.
 */
function chargesPrintedPositive(bank, cardHeader, lines) {
  if (bank?.chargesPositive || cardHeader?.chargesPositive) return true;
  let payments = 0;
  let paymentsOut = 0;
  let others = 0;
  let othersIn = 0;
  for (const l of lines) {
    const k = ` ${csvKey(l.description)} `;
    if (WORDS.payment.some((w) => k.includes(` ${w} `))) { payments++; if (l.amount < 0) paymentsOut++; }
    else { others++; if (l.amount > 0) othersIn++; }
  }
  return payments > 0 && paymentsOut === payments && othersIn * 2 > others;
}

// --- The rows above and below the table ---------------------------------------------------------

/**
 * **What the rows around the table say** (the rows above the header, and below the last line):
 * - the account: an IBAN anywhere (check digits right), or a number after a label from `account`
 *   ("Konto:", "Rachunek eKonto", "Compte de Dépôt carte n° 12345678901"), or a row whose only words
 *   are a number of eight digits or more (`="00012345678"`), or one beginning a row of dates and figures;
 * - the currency: a cell that is a code or a currency word in a row labelled with a `currency` word
 *   ("Währung;EUR") or holding a figure ("Saldo;1.189,36;EUR"), a figure carrying one ("1.189,36
 *   EUR"), or a code in the account's cell ("0123456789012 - EUR - Conta Extracto"), when only one is
 *   named ("Transaction type,ALL" names no Albanian lek);
 * - the holder after a label from `holder` (words, no digits); a row with such a label is never the
 *   account's ("Account holder,SAM EXAMPLE,01234 567890": a phone number is no account);
 * - the period: dates after a label from `periodFrom`, `periodTo` or `period`;
 * - the balances: a figure after (or at the end of) a label from `opening` or `closing`; failing
 *   those, a row of two figures that the lines lead from one to the other, or one figure with a date
 *   on or after the last line (the balance that day), or below the lines a row of one figure alone
 *   that isn't their total (both checked once the lines are read).
 * A label row with nothing after it takes the next row's cells ("#Klient;" then "JAN KOWALSKI;").
 */
function surroundings(above, below) {
  const facts = { number: null, currency: null, holder: null, from: null, to: null, opening: null, closing: null, unlabelled: [] };
  const currencies = new Set();
  const all = [...above.map((r) => ({ r, place: 'above' })), ...below.map((r) => ({ r, place: 'below' }))];
  const figureIn = (cells) => cells.find((c) => isFigure(c) || (csvAmount(c) != null && !isDateCell(c) && /\d/.test(c) && !identifierIn(c)));
  for (let n = 0; n < all.length; n++) {
    const { r, place } = all[n];
    // mBank marks its labels and figures with "#".
    const cells = r.map((x) => cleanCell(x).replace(/^#/, '')).filter((c) => c !== '');
    if (!cells.length) continue;
    const label = csvKey(cells[0]);
    const aboutMoney = labelled(label, WORDS.currency) || cells.some((c) => isFigure(c));
    for (const c of cells) {
      const word = CURRENCY_SIGNS.find((s) => s.code && s.sign.length > 2 && /^\p{L}+$/u.test(s.sign) && csvKey(c) === csvKey(s.sign));
      if (isCode(c)) { if (aboutMoney) currencies.add(c); }
      else if (word) { if (aboutMoney) currencies.add(word.code); }
      else if (/\d/.test(c) && csvAmount(c) != null) {
        const code = currencyOfFigure(c);
        if (code) currencies.add(code);
      }
    }
    let values = cells.slice(1);
    if (!values.length && n + 1 < all.length) {
      const next = all[n + 1].r.map((x) => cleanCell(x).replace(/^#/, '')).filter((c) => c !== '');
      const nextKey = csvKey(next[0] ?? '');
      const isLabel = [WORDS.account, WORDS.holder, WORDS.opening, WORDS.closing, WORDS.periodFrom, WORDS.periodTo, WORDS.period, WORDS.currency]
        .some((words) => labelled(nextKey, words));
      if (next.length && !isLabel) values = next;
    }
    const otherSide = label !== 'iban' && labelled(label, WORDS.counterAccount);
    const holderRow = labelled(label, WORDS.holder);
    // Only an account's label: a customer's number may be shared by two accounts.
    if (facts.number == null && place === 'above' && !otherSide && !holderRow && (label === 'iban' || labelled(label, WORDS.account))) {
      const own = [cells[0], ...values].map(identifierIn).find(Boolean);
      if (own) {
        facts.number = own;
        for (const c of values) for (const word of c.split(/[\s-]+/)) if (isCode(word)) currencies.add(word);
      }
    }
    if (facts.holder == null && labelled(label, WORDS.holder) && values.length && /\p{L}/u.test(values[0]) && !/\d/.test(values[0])) facts.holder = values[0];
    const datesIn = (cs) => cs.flatMap((c) => c.match(/\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/g) ?? []);
    if (labelled(label, WORDS.period) || labelled(label, WORDS.periodFrom) || labelled(label, WORDS.periodTo)) {
      const ds = datesIn([cells[0].replace(/^[^\d]*/, ''), ...values]);
      if (labelled(label, WORDS.period) && ds.length >= 2) { facts.from = ds[0]; facts.to = ds[1]; }
      else if (labelled(label, WORDS.periodTo) && ds.length) facts.to = ds[0];
      else if (labelled(label, WORDS.periodFrom) && ds.length >= 2) { facts.from = ds[0]; facts.to = ds[1]; }
      else if (labelled(label, WORDS.periodFrom) && ds.length) facts.from = ds[0];
    }
    const balanceLabel = labelled(label, WORDS.opening) ? 'opening' : labelled(label, WORDS.closing) ? 'closing' : null;
    if (balanceLabel) {
      const words = cells[0].split(/\s+/);
      const lastWord = words[words.length - 1];
      const figure = figureIn(values) ?? words.find((w) => isFigure(w))
        ?? (csvAmount(lastWord) != null && !isDateCell(lastWord) ? lastWord : null);
      if (figure != null && facts[balanceLabel] == null) facts[balanceLabel] = figure;
      continue;
    }
    // A row without a balance label: its figures, for the checks once the lines are read.
    const figures = cells.filter((c) => isFigure(c));
    const dates = cells.filter((c) => isDateCell(c));
    if (place === 'above' && facts.number == null && !otherSide && !holderRow) {
      const lone = cells.find((c) => identifierIn(c) === c && c.replace(/\D/g, '').length >= 8 && !isFigure(c) && !isDateCell(c));
      if (lone && (cells.length === 1 || figures.length || dates.length)) facts.number = lone;
    }
    if (place === 'above' && figures.length >= 1 && figures.length <= 2) facts.unlabelled.push({ place, figures, dates });
    if (place === 'below' && cells.length === 1 && figures.length === 1) facts.unlabelled.push({ place, figures, dates: [] });
  }
  if (currencies.size === 1) facts.currency = [...currencies][0];
  // No account named: an IBAN anywhere above the table whose check digits are right.
  if (facts.number == null) facts.number = above.flatMap((r) => r.flatMap((c) => ibansIn(cleanCell(c))))[0] ?? null;
  return facts;
}

// --- Without a header ---------------------------------------------------------------------------

/**
 * **A file without a header** (Wells Fargo, HSBC UK, first direct, TD, CIBC, Simplii, Scotiabank,
 * Desjardins, ABN AMRO, LCL, Sabadell, PNC, SNS): the columns are told by their cells, over the
 * rows with three filled cells or more.
 * - The date: the first column whose cells read as dates in one order on 90% of the rows from its
 *   first date to its last, those rows being half or more; they are the lines.
 * - Figures: 80% of the filled cells amounts, one at least with its decimals, not all the same,
 *   not dates. A sign column: every filled cell a `signOut` or `signIn` word, both found.
 * - Constant columns (one value on every line, two lines or more): an account number when one
 *   (an IBAN, six digits or more, or masked "4500********1234", which makes it a card), a
 *   currency when a code. Other date columns (value dates) are passed over.
 * - Text: the column with the most letters a cell, and any other with half as many or more.
 * - Among the figures: a start and an end balance with an amount (end = start + amount on every
 *   line: ABN AMRO); else a balance with an amount, or money out and money in (two columns never
 *   filled on the same line), whose balance follows from the lines (after each line, or before it:
 *   SNS), oldest first when the dates say which way they run, else in either order; or, the dates
 *   running one way, falls by each line's money in and rises by its money out (a card's balance as
 *   its issuer prints it, what is owed: TD Visa), which makes it a card; else one figure column is
 *   the amount, two never on the same line are money out then money in. A figure column that never
 *   prints a minus beside a column empty on every line is half of a money out and money in pair
 *   whose other half had nothing this time (CIBC in a month with no deposits): money out when it
 *   comes first, money in when second, unless the balance says otherwise. Anything else is refused
 *   rather than guessed.
 * - Failing all that, once more without the first row (an account's summary above its lines).
 */
function inferLayout(rows, skip = 0) {
  const filled = (r) => r.filter((c) => cleanCell(c) !== '').length;
  const candidates = rows.map((r, i) => ({ r, i })).filter(({ r }) => filled(r) >= 3).slice(skip);
  if (!candidates.length) return null;
  const tried = inferColumns(rows, candidates);
  // A first row that isn't like the lines below it (a summary of the account: Santander Bank Polska)
  // goes above them, and the columns are told again.
  return tried ?? (skip === 0 && candidates.length >= 3 ? inferLayout(rows, 1) : null);
}

function inferColumns(rows, candidates) {
  let width = 0;
  for (const { r } of candidates) if (r.length > width) width = r.length;
  let date = null;
  let span = null;
  let dayFirstHint = true;
  for (let j = 0; j < width && date == null; j++) {
    // The rows from the first that reads as a date (either way round) to the last: 90% of them in one order.
    const either = candidates.map(({ r }) => isDateCell(r[j] ?? ''));
    const first = either.indexOf(true);
    const last = either.lastIndexOf(true);
    if (first < 0 || (last - first + 1) * 2 < candidates.length) continue;
    for (const dayFirst of [true, false]) {
      const within = candidates.slice(first, last + 1).filter(({ r }) => csvDate(r[j] ?? '', dayFirst) != null).length;
      if (within * 10 >= 9 * (last - first + 1)) {
        date = j;
        span = [first, last];
        dayFirstHint = dayFirst;
        break;
      }
    }
  }
  if (date == null) return null;
  const body = candidates.slice(span[0], span[1] + 1).filter(({ r }) => isDateCell(r[date] ?? ''));
  const column = (j) => body.map(({ r }) => cleanCell(r[j] ?? ''));
  const figures = [];
  const texts = [];
  const empties = [];
  let sign = null;
  let account = null;
  let currency = null;
  let masked = false;
  for (let j = 0; j < width; j++) {
    if (j === date) continue;
    const all = column(j);
    const cells = all.filter((c) => c !== '');
    if (!cells.length) { empties.push(j); continue; }
    const constant = body.length >= 2 && cells.length === all.length && new Set(cells).size === 1;
    if (constant) {
      const id = identifierIn(cells[0]);
      if (isCode(cells[0])) currency = currency ?? cells[0];
      else if (id && id === cells[0] && account == null) { account = id; masked = /[Xx*•]{4,}/.test(id); }
      continue;
    }
    // Another date (a value date) is neither a figure nor words.
    if (cells.filter(isDateCell).length * 2 >= cells.length) continue;
    const mark = decimalMarkOf(cells);
    const amounts = cells.filter((c) => csvAmount(c, 2, mark) != null && !isDateCell(c));
    if (amounts.length * 5 >= cells.length * 4 && cells.some((c) => isFigure(c, mark)) && (cells.length === 1 || new Set(cells).size > 1)) {
      figures.push(j);
      continue;
    }
    const signs = cells.map(signOf);
    if (signs.every((s) => s !== 0) && signs.includes(-1) && signs.includes(1)) { sign = j; continue; }
    const letters = cells.reduce((t, c) => t + (c.match(/\p{L}/gu) ?? []).length, 0) / cells.length;
    texts.push({ j, letters });
  }
  if (!figures.length) return null;
  const best = Math.max(0, ...texts.map((t) => t.letters));
  const text = texts.filter((t) => t.letters > 0 && t.letters >= Math.max(3, best / 2)).map((t) => t.j);
  const others = texts.filter((t) => !text.includes(t.j)).map((t) => t.j);
  // Which way the lines run: oldest first ('up'), newest first ('down'), or not known.
  const days = body.map(({ r }) => csvDate(r[date] ?? '', dayFirstHint));
  const up = days.every((d, k) => k === 0 || d >= days[k - 1]) && days[0] < days[days.length - 1];
  const down = days.every((d, k) => k === 0 || d <= days[k - 1]) && days[0] > days[days.length - 1];
  const roles = figureRoles(body.map(({ r }) => r), figures, sign, { empties, direction: up ? 'up' : down ? 'down' : null });
  if (!roles) return null;
  return {
    headerless: true, at: -1, from: body[0].i, to: body[body.length - 1].i, bodyIndexes: body.map(({ i }) => i),
    keys: [], dates: [date], dayFirstHint, text: text.length ? [text] : [], fallbackText: others, party: [],
    sign, currency: null, account: null, accountType: null, state: null, fee: null, coded: [], pairedBalances: null,
    constAccount: account, constCurrency: currency, maskedCard: masked, ...roles,
  };
}

/**
 * The figure columns' parts: { amount | out and in, balance, balanceKind ('after'|'before'|'owed'),
 * start, end }, or null when unclear. `empties`: the columns empty on every line; `direction`: which
 * way the lines run ('up', 'down' or null).
 */
function figureRoles(rows, figures, sign, { empties = [], direction = null } = {}) {
  // Each figure column's values, read once with its own decimal mark.
  const columns = new Map(figures.map((j) => {
    const cells = rows.map((x) => cleanCell(x[j] ?? ''));
    const mark = decimalMarkOf(cells);
    return [j, cells.map((c) => csvAmount(c, 2, mark))];
  }));
  const at = new Map(rows.map((r, n) => [r, n]));
  const value = (r, j) => (j == null ? null : columns.get(j)[at.get(r)]);
  const signed = (r, j) => {
    const v = value(r, j);
    if (v == null || sign == null) return v;
    const s = signOf(r[sign]);
    return s === 0 ? v : s * Math.abs(v);
  };
  // Start, end and amount on every line (ABN AMRO): the start left of the end, each start the end
  // of the line before it (in the file's order or the other way round).
  for (const a of figures) for (const s of figures) for (const e of figures) {
    if (a === s || a === e || s >= e) continue;
    if (!rows.every((r) => { const x = signed(r, a); const b = value(r, s); const c = value(r, e); return x != null && b != null && c != null && b + x === c; })) continue;
    const starts = rows.map((r) => value(r, s));
    const ends = rows.map((r) => value(r, e));
    const chained = (st, en) => st.every((v, i) => i === 0 || v === en[i - 1]);
    if (rows.length < 2 || chained(starts, ends) || chained([...starts].reverse(), [...ends].reverse())) {
      return { amount: a, out: null, in: null, balance: null, balanceKind: null, start: s, end: e };
    }
  }
  const neverTogether = (p, q) => rows.every((r) => (value(r, p) == null) !== (value(r, q) == null));
  const unsigned = (j) => sign == null && rows.every((r) => (value(r, j) ?? 0) >= 0);
  // An unsigned figure column with an empty one beside it: the pair's other half (out first).
  const halves = [];
  for (const a of figures) for (const e of empties) {
    if (Math.abs(a - e) === 1 && unsigned(a)) halves.push(a < e ? { out: a, in: e } : { out: e, in: a });
  }
  // What the lines could be, most likely first: money out then money in (two columns never filled
  // together, or one beside an empty one), a column of signed amounts, money in then money out.
  const pair = (outCol, inCol) => (r) => {
    const o = value(r, outCol);
    const i = value(r, inCol);
    return o != null ? -Math.abs(o) : i != null ? Math.abs(i) : null;
  };
  const pairs = [];
  for (const p of figures) for (const q of figures) if (p < q && neverTogether(p, q)) pairs.push([p, q]);
  const sources = [];
  for (const [p, q] of pairs) sources.push({ out: p, in: q, of: pair(p, q) });
  for (const h of halves) {
    const filled = figures.includes(h.out) ? h.out : h.in;
    const way = filled === h.out ? -1 : 1;
    sources.push({ out: h.out, in: h.in, of: (r) => (value(r, filled) == null ? null : way * Math.abs(value(r, filled))) });
  }
  for (const a of figures) sources.push({ amount: a, of: (r) => signed(r, a) });
  for (const [p, q] of pairs) sources.push({ out: q, in: p, of: pair(q, p) });
  for (const b of figures) {
    for (const src of sources) {
      if (src.amount === b || src.out === b || src.in === b) continue;
      const kind = runningKind(rows.map((r) => value(r, b)), rows.map(src.of), direction);
      if (kind) return { amount: src.amount ?? null, out: src.out ?? null, in: src.in ?? null, balance: b, balanceKind: kind, start: null, end: null };
    }
  }
  if (figures.length === 1 && halves.length === 1) return { amount: null, out: halves[0].out, in: halves[0].in, balance: null, balanceKind: null, start: null, end: null };
  if (figures.length === 1) return { amount: figures[0], out: null, in: null, balance: null, balanceKind: null, start: null, end: null };
  if (figures.length === 2 && neverTogether(figures[0], figures[1])) {
    return { amount: null, out: figures[0], in: figures[1], balance: null, balanceKind: null, start: null, end: null };
  }
  return null;
}

/**
 * Whether balances follow from amounts, line by line: 'after' when each is the one before plus its
 * line, 'before' when each is the one before plus the line before it, oldest first when `direction`
 * says which way the lines run ('up': as written, 'down': the other way round), else in either order;
 * 'owed' when, oldest first, each is the one before less its line (a card's balance as its issuer
 * prints it: what is owed rises with a purchase). Every line needs both, and there must be two lines
 * or more. The owed balance is only told when the direction is known: written the other way round,
 * it is the 'before' of an account you own.
 */
function runningKind(balances, amounts, direction = null) {
  if (balances.length < 2 || balances.some((b) => b == null) || amounts.some((a) => a == null)) return null;
  const follows = (b, a, after, way = 1) => b.every((v, i) => i === 0 || v === b[i - 1] + way * (after ? a[i] : a[i - 1]));
  const ways = direction === 'up' ? [false] : direction === 'down' ? [true] : [false, true];
  const ordered = (list, back) => (back ? [...list].reverse() : list);
  for (const after of [true, false]) {
    if (ways.some((back) => follows(ordered(balances, back), ordered(amounts, back), after))) return after ? 'after' : 'before';
  }
  if (direction && follows(ordered(balances, direction === 'down'), ordered(amounts, direction === 'down'), true, -1)) return 'owed';
  return null;
}

// --- Label: value text (Santander UK's .txt) ----------------------------------------------------

/**
 * **A file of `Label: value` lines** in blocks (Santander UK's statement .txt): each block with a
 * date label and an amount label is a line; its labels, in the order first met, are the header.
 * The blocks before the first line are read as the rows above a table.
 */
function labelValueTable(text) {
  const blocks = [];
  let block = null;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = trimSpaces(raw.replace(/\t/g, ' '));
    const m = line ? /^([^:]{1,40}?)\s*:\s*([\s\S]*)$/.exec(line) : null;
    if (!m) { block = null; continue; }
    if (!block) { block = []; blocks.push(block); }
    block.push([trimSpaces(m[1]), trimSpaces(m[2])]);
  }
  const isLine = (b) => b.some(([l]) => WORDS.date.includes(csvKey(l))) && b.some(([l]) => [...WORDS.amount, ...WORDS.out, ...WORDS.in].includes(csvKey(l)));
  const first = blocks.findIndex(isLine);
  if (first < 0) return null;
  const labels = [];
  for (const b of blocks.slice(first)) for (const [l] of b) if (!labels.includes(l)) labels.push(l);
  const rows = [
    ...blocks.slice(0, first).flat(),
    labels,
    ...blocks.slice(first).filter(isLine).map((b) => labels.map((l) => b.find(([x]) => x === l)?.[1] ?? '')),
  ];
  const layout = findHeader(rows);
  return layout && layout.at === blocks.slice(0, first).flat().length ? { rows, layout } : null;
}

// --- Reading the lines --------------------------------------------------------------------------

/**
 * **Rows → a statement**, by a header found (or columns told from the cells), or null when no line
 * was read; `{ datesUnread: true }` when lines had amounts but no date could be read.
 */
function readTable(rows, layout, { fileName, dayFirstWhenUnsure, mainCurrency }) {
  const c = layout;
  const headerless = Boolean(c.headerless);
  const header = headerless ? [] : rows[c.at];
  const headerKeys = headerless ? [] : c.keys;
  const cell = (r, j) => (j == null ? '' : cleanCell(r[j] ?? ''));
  const after = headerless ? c.from : c.at + 1;
  const candidates = headerless
    ? c.bodyIndexes.map((i) => ({ r: rows[i], i }))
    : rows.slice(after).map((r, k) => ({ r, i: after + k }));

  // The date columns: the named ones whose filled cells are dates, half of them or more, in order of
  // preference. A row's date is in the first of them that isn't empty on it (interest has no
  // "Transaction Date", only a "Posting Date"); a row whose cell there isn't a date is no line.
  const dateCols = c.dates.filter((j) => {
    const filled = candidates.map(({ r }) => cell(r, j)).filter(Boolean);
    return filled.length > 0 && filled.filter(isDateCell).length * 2 >= filled.length;
  });
  if (!dateCols.length) {
    const hadAmounts = candidates.some(({ r }) => cell(r, c.dates[0]) !== '' && [c.amount, c.out, c.in, ...c.coded.map((x) => x.index)].some((j) => csvAmount(cell(r, j)) != null));
    return hadAmounts ? { datesUnread: true } : null;
  }
  const dateCells = new Map();
  const dateCellOf = (r) => {
    if (dateCells.has(r)) return dateCells.get(r);
    let found = '';
    for (const j of dateCols) {
      const v = cell(r, j);
      if (v !== '') { found = isDateCell(v) ? v : ''; break; }
    }
    dateCells.set(r, found);
    return found;
  };
  const dated = candidates.filter(({ r }) => dateCellOf(r) !== '');
  const lastDated = dated.length ? dated[dated.length - 1].i : -1;
  const above = rows.slice(0, headerless ? c.from : c.at);
  const datedAt = new Set(dated.map((d) => d.i));
  const below = rows.filter((r, i) => i > lastDated && i >= after && !datedAt.has(i));
  const facts = surroundings(above, below);
  // A column headed with an opening or closing balance's words holds it on a row of its own, without
  // a date (Venmo's "Beginning Balance" and "Ending Balance").
  for (const { r } of candidates) {
    if (dateCellOf(r) !== '') continue;
    headerKeys.forEach((k, j) => {
      const v = cell(r, j);
      if (!v || !isFigure(v)) return;
      if (WORDS.opening.includes(k)) facts.opening ??= v;
      else if (WORDS.closing.includes(k)) facts.closing ??= v;
    });
  }

  // Two balance columns and no amount: the figures say which is which (BoursoBank's "Solde").
  let amountCol = c.amount;
  let balanceCol = c.balance;
  let balanceKind = c.balanceKind ?? (c.balance != null ? 'after' : null);
  if (c.pairedBalances) {
    const [p, q] = c.pairedBalances;
    const roles = figureRoles(dated.map(({ r }) => r), [p, q], null);
    if (!roles || roles.amount == null || roles.balance == null) return null;
    amountCol = roles.amount;
    balanceCol = roles.balance;
    balanceKind = roles.balanceKind;
  }
  // An amount column and a money out and in pair: the one filled on more lines (Deutsche Bank's
  // empty "Betrag" beside "Soll" and "Haben").
  let useAmount = amountCol != null;
  if (amountCol != null && c.out != null && c.in != null) {
    const filledAmount = dated.filter(({ r }) => cell(r, amountCol) !== '').length;
    const filledPair = dated.filter(({ r }) => cell(r, c.out) !== '' || cell(r, c.in) !== '').length;
    useAmount = filledAmount >= filledPair;
  }

  // Decimal marks, by column, then for the file.
  const moneyCols = [amountCol, c.out, c.in, balanceCol, c.start, c.end, c.fee, ...c.coded.map((x) => x.index)].filter((j) => j != null);
  const fileMark = decimalMarkOf(moneyCols.flatMap((j) => dated.map(({ r }) => cell(r, j))));
  const marks = new Map(moneyCols.map((j) => [j, decimalMarkOf(dated.map(({ r }) => cell(r, j))) ?? fileMark]));
  const figureCells = moneyCols.flatMap((j) => dated.map(({ r }) => cell(r, j))).filter(Boolean);

  // The currency: the file's own, from the headings, its currency column, the rows around, the figures.
  // A heading that names one is the account's ("Betrag (EUR)"): a currency column beside it then holds
  // each purchase's own. So is a currency column named like another amount column than the one read
  // ("Transaction currency" beside "Transaction amount", when "Billing amount" is read).
  const headingCode = headerless ? null
    : [amountCol, c.out, c.in, balanceCol].filter((j) => j != null).map((j) => currencyNamed(header[j], { lastWordOnly: true })).find(Boolean) ?? null;
  const wordsOf = (k) => new Set(k.split(' ').filter(Boolean));
  const otherAmounts = headerless || c.currency == null ? [] : columnsOf(headerKeys, WORDS.amount, new Set([amountCol]));
  const sharesWords = (j, k) => [...wordsOf(headerKeys[j])].some((w) => wordsOf(headerKeys[k]).has(w));
  const rowCurrencies = c.currency != null && headingCode == null
    && !otherAmounts.some((j) => sharesWords(c.currency, j) && !(amountCol != null && sharesWords(c.currency, amountCol)));
  const columnCodes = rowCurrencies ? dated.map(({ r }) => cell(r, c.currency).toUpperCase()).filter(isCode) : [];
  // A header in Japanese kana or in Hangul names no currency, but its amounts are whole yen or won.
  const headerScript = header.join(' ');
  const scriptCurrency = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(headerScript) ? 'JPY' : /\p{Script=Hangul}/u.test(headerScript) ? 'KRW' : null;
  const fileCurrency = headingCode ?? (new Set(columnCodes).size === 1 ? columnCodes[0] : null) ?? c.constCurrency
    ?? (c.coded.length === 1 ? c.coded[0].code : null) ?? facts.currency ?? currencyOfFigures(figureCells) ?? scriptCurrency;

  // The bank (by its name in the file's name or a row above that isn't the holder's), a card's
  // whole header, and the order of the dates.
  const aboveTexts = above.filter((r) => {
    const cells = r.map((x) => cleanCell(x)).filter(Boolean);
    return cells.length > 0 && !labelled(csvKey(cells[0]), WORDS.holder);
  }).map((r) => r.join(' '));
  const bank = bankOf(fileName, headerKeys, aboveTexts, dated.map(({ r }) => dateCellOf(r)));
  const cardHeader = headerless ? null : CARD_HEADERS.find((h) => signedBy(h, headerKeys)) ?? null;
  const order = dateOrderOf(dated.map(({ r }) => dateCellOf(r)), {
    bankOrder: bankDateOrder(bank), currency: fileCurrency, decimalComma: fileMark === ',' || decimalComma(figureCells),
    mainCurrency, dayFirstWhenUnsure,
  });

  // A sign column told by its values (Capital One 360's "Transaction Type", PNC's "DEBIT"/"CREDIT"),
  // only for an amount column that never prints a minus.
  let signCol = c.sign;
  if (signCol == null && useAmount && amountCol != null && !headerless) {
    const unsigned = dated.every(({ r }) => (csvAmount(cell(r, amountCol), 2, marks.get(amountCol)) ?? 0) >= 0);
    if (unsigned) {
      signCol = header.map((h, j) => j).find((j) => {
        const values = dated.map(({ r }) => cell(r, j)).filter(Boolean);
        const signs = values.map(signOf);
        return values.length > 0 && signs.every((s) => s !== 0) && signs.includes(-1) && signs.includes(1);
      }) ?? null;
    }
  }

  const lineRows = dated.filter(({ r }) => !(c.state != null && isPending(cell(r, c.state))));
  // A card: its heading of a card ("Card No.") counts when filled on nine lines in ten or more.
  const cardColumn = headerKeys.some((k, j) => WORDS.card.includes(k)
    && lineRows.length > 0 && lineRows.filter(({ r }) => cell(r, j) !== '').length * 10 >= lineRows.length * 9);
  const card = cardExport(bank, cardHeader, headerKeys, fileName, above, { balance: balanceCol != null, sign: signCol != null, cardColumn })
    || Boolean(c.maskedCard) || balanceKind === 'owed';

  // The own account column: filled on every line, each value with four digits or more (or an IBAN),
  // and, when the rows above name the account, that one (DKB's old "Kontonummer" is the other side's).
  // Several values are several accounts when there are three at most, or when each value's lines sit
  // together (RBC's, Barclays' and NatWest's downloads of every account); never in a card's export (a
  // card number per cardholder is still one card), never when the bank's entry says the heading is the
  // other side's (`counterAccount`: N26's "Account number"), and never when each value goes with one
  // name of the other side, a different one each (they are the payees' accounts).
  let accountCol = c.account;
  if (accountCol != null && bank && bank.counterKeys.includes(headerKeys[accountCol])) accountCol = null;
  if (accountCol != null) {
    const values = lineRows.map(({ r }) => cell(r, accountCol));
    const distinct = [...new Set(values)];
    const digitsOf = (s) => s.replace(/\D/g, '');
    const matchesAbove = (v) => !facts.number || digitsOf(facts.number).endsWith(digitsOf(v)) || digitsOf(v).endsWith(digitsOf(facts.number));
    const runs = values.filter((v, k) => k === 0 || v !== values[k - 1]).length;
    const names = new Map();
    lineRows.forEach(({ r }, k) => {
      const who = csvKey(c.party.map((j) => cell(r, j)).find(Boolean) ?? '');
      if (!names.has(values[k])) names.set(values[k], new Set());
      names.get(values[k]).add(who);
    });
    const payees = distinct.length >= 2 && c.party.length > 0
      && distinct.every((v) => names.get(v).size === 1 && !names.get(v).has(''))
      && new Set(distinct.map((v) => [...names.get(v)][0])).size === distinct.length;
    const own = values.every((v) => v !== '') && (distinct.length <= 3 || runs === distinct.length)
      && distinct.every((v) => digitsOf(v).length >= 4 || validIban(v)) && distinct.every(matchesAbove) && !payees
      && !(card && distinct.length > 1);
    if (!own) accountCol = null;
  }

  // The holder: a name in two columns of the other side (payer and payee: DKB), or a column of the
  // other side with one name on every line beside another that varies (KBC's "Naam").
  const partyCols = [...c.party];
  let holder = facts.holder;
  if (partyCols.length >= 2) {
    const constant = partyCols.filter((j) => {
      const v = lineRows.map(({ r }) => cell(r, j));
      return lineRows.length >= 2 && v.every(Boolean) && new Set(v).size === 1;
    });
    if (constant.length && constant.length < partyCols.length) {
      holder = holder ?? cell(lineRows[0].r, constant[0]);
      for (const j of constant) partyCols.splice(partyCols.indexOf(j), 1);
    }
    const seenIn = new Map();
    for (const j of partyCols) for (const { r } of lineRows) {
      const v = cell(r, j);
      if (!v) continue;
      if (!seenIn.has(v)) seenIn.set(v, new Set());
      seenIn.get(v).add(j);
    }
    const both = [...seenIn.entries()].filter(([, cols]) => cols.size >= 2).map(([v]) => v);
    if (both.length) holder = holder ?? both[0];
  }
  const sameAsHolder = (v) => holder != null && csvKey(v) === csvKey(holder);
  // The text columns: the one with words on the most lines first; then one that holds more than
  // codes (a code: one word of 16 characters at most, no small letters: DBS's "Reference" holds
  // MST, GIRO, its "Transaction Ref1" the payee); then the first named.
  const linesOf = (family) => lineRows.filter(({ r }) => family.some((j) => /\p{L}/u.test(cell(r, j)))).length;
  const codesOnly = (family) => lineRows.every(({ r }) => family.every((j) => {
    const v = cell(r, j);
    return v === '' || (/^\S{1,16}$/.test(v) && !/\p{Ll}/u.test(v));
  }));
  const textFamilies = c.text.map((family, n) => ({ family, n, lines: linesOf(family), codes: codesOnly(family) ? 1 : 0 }))
    .sort((a, b) => b.lines - a.lines || a.codes - b.codes || a.n - b.n).map((t) => t.family);
  const describing = new Set([...partyCols, ...c.text.flat()]);
  const carriedOn = new Map();
  let lastLine = null;
  for (const { r, i } of candidates) {
    if (dateCellOf(r) !== '') { lastLine = i; continue; }
    const filled = r.map((x, j) => [j, cleanCell(x)]).filter(([, v]) => v !== '');
    if (lastLine != null && filled.length && filled.every(([j]) => describing.has(j))) {
      if (!carriedOn.has(lastLine)) carriedOn.set(lastLine, []);
      carriedOn.get(lastLine).push(filled.map(([, v]) => v).join(' '));
    } else lastLine = null;
  }

  // Each dated row with an amount → a record. A file naming no currency is read at three decimals
  // (the review puts the figures into the currency chosen: readDigits), its thousands told by the
  // main currency's decimals. A zero-decimal currency's figure with decimals ("4 872,35" forint) is
  // rounded to a whole one, half away from zero, and said. A dated row whose amount is written but
  // can't be read is never dropped without a word: it is counted, and said.
  const records = [];
  const unread = new Map();
  const rounded = new Map();
  const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const { r, i: rowIndex } of lineRows) {
    const day = csvDate(dateCellOf(r), order.dayFirst);
    if (!day) continue;
    const coded = c.coded.find((x) => cell(r, x.index) !== '');
    const rowCode = rowCurrencies ? cell(r, c.currency).toUpperCase() : '';
    const currency = (isCode(rowCode) ? rowCode : null) ?? coded?.code ?? fileCurrency ?? null;
    const digits = currency ? minorDigits(currency) : 3;
    const places = currency ? digits : minorDigits(mainCurrency ?? null);
    const number = accountCol != null ? cell(r, accountCol) : '';
    const key = `${number}|${currency ?? ''}`;
    let roundedHere = false;
    const figure = (j) => {
      if (j == null) return null;
      const text = cell(r, j);
      const v = csvAmount(text, digits, marks.get(j) ?? null, places);
      if (v != null || digits !== 0 || text === '') return v;
      const cents = csvAmount(text, 2, marks.get(j) ?? null, 0);
      if (cents == null) return null;
      roundedHere = true;
      const whole = Math.trunc((Math.abs(cents) + 50) / 100);
      return cents < 0 ? -whole : whole;
    };
    let amount;
    if (coded) amount = figure(coded.index);
    else if (useAmount) {
      amount = figure(amountCol);
      if (amount != null && signCol != null) {
        const s = signOf(cell(r, signCol));
        if (s !== 0) amount = s * Math.abs(amount);
      }
      const fee = figure(c.fee);
      if (fee != null && amount != null) amount -= Math.abs(fee);
    } else {
      const o = figure(c.out);
      const i = figure(c.in);
      amount = o == null && i == null ? null : (i == null ? 0 : Math.abs(i)) - (o == null ? 0 : Math.abs(o));
    }
    if (amount == null) {
      const written = (coded ? [coded.index] : useAmount ? [amountCol] : [c.out, c.in]).some((j) => cell(r, j) !== '');
      if (written) count(unread, key);
      continue;
    }
    // What it was: the other side's name (not an account number, not the holder's), then the text
    // column that says most (a later one that holds it whole, and more, instead), then any rows that
    // carry it on.
    const words = [];
    const add = (w) => {
      const v = collapse(w);
      if (v && !sameAsHolder(v) && !words.some((x) => x.toLowerCase() === v.toLowerCase())) words.push(v);
    };
    for (const j of partyCols) {
      const v = cell(r, j);
      if (!looksLikeAccountNumber(v)) add(v);
    }
    const familyTexts = textFamilies.map((family) => collapse(family.map((j) => cell(r, j)).filter(Boolean).join(' · ')));
    let said = familyTexts[0] ?? '';
    // A later text column that holds the first whole, and more (Société Générale's "Détail de l'écriture").
    for (const t of familyTexts.slice(1)) if (said && t.length > said.length && t.toLowerCase().includes(said.toLowerCase())) said = t;
    // Nothing on this line yet: the first text column with words (Belfius's "Transactie" when "Mededelingen" is empty).
    if (!said && !words.length) said = familyTexts.find(Boolean) ?? '';
    add(said);
    const carried = carriedOn.get(rowIndex) ?? [];
    for (const more of carried) add(more);
    const kindWord = c.kind != null ? cell(r, c.kind) : '';
    const fallback = (c.fallbackText ?? []).map((j) => cell(r, j)).filter(Boolean).join(' ');
    if (!words.length && kindWord) add(kindWord);
    if (!words.length) for (const j of c.fallbackText ?? []) add(cell(r, j));
    // The row's own label, from its text columns only (else its kind, else the other cells of a file
    // without a header), never from the other side's name (Monzo's "Total" is a fuel station), for
    // telling a balance or a total row from a line.
    const textual = said || familyTexts.find(Boolean) || kindWord || fallback;
    // A date at the label's end is the balance's day, not its words ("Opening balance 01/09/2026").
    const lastWord = textual.split(/\s+/).pop() ?? '';
    const labelText = textual !== lastWord && isDateCell(lastWord) ? textual.slice(0, textual.length - lastWord.length) : textual;
    const labelKey = csvKey([labelText, ...carried].join(' '));
    let running = null;
    if (c.start != null) running = figure(c.end);
    else if (balanceCol != null) running = balanceKind === 'before' ? (figure(balanceCol) == null ? null : figure(balanceCol) + amount) : figure(balanceCol);
    if (roundedHere) count(rounded, key);
    records.push({
      key, number, currency, day, amount, running, start: c.start != null ? figure(c.start) : null, description: words.join(' · '), labelKey,
      accountType: c.accountType != null ? cell(r, c.accountType) : '',
    });
  }

  // A row of the table that is a balance or a total, not a line (Swedbank's "Algsaldo", "Käive",
  // "Lõppsaldo"; Latvia's "Apgrozījums"): its label is only that word, its running balance (if any)
  // doesn't follow on from a line beside it, and it stands at the start or the end of its account's
  // rows (with others like it), or, for a total, its amount is the lines' money in, money out or both.
  const isLabelRow = new Set();
  const keysInOrder = [...new Set(records.map((x) => x.key))];
  for (const key of keysInOrder) {
    const own = records.filter((x) => x.key === key);
    const chains = (x, k) => [own[k - 1], own[k + 1]].some((n) => n != null && n.running != null && x.running != null
      && (n.running + x.amount === x.running || x.running + n.amount === n.running));
    const labelOf = (x) => (WORDS.opening.includes(x.labelKey) ? 'opening' : WORDS.closing.includes(x.labelKey) ? 'closing'
      : WORDS.totals.includes(x.labelKey) ? 'total' : null);
    const candidate = own.map((x, k) => labelOf(x) != null && !chains(x, k));
    const lines = own.filter((x, k) => !candidate[k]);
    const ins = lines.filter((x) => x.amount > 0).reduce((t, x) => t + x.amount, 0);
    const outs = lines.filter((x) => x.amount < 0).reduce((t, x) => t - x.amount, 0);
    const net = lines.reduce((t, x) => t + x.amount, 0);
    let lead = 0;
    while (lead < own.length && candidate[lead]) lead++;
    let tail = own.length;
    while (tail > lead && candidate[tail - 1]) tail--;
    own.forEach((x, k) => {
      if (!candidate[k]) return;
      const atEdge = k < lead || k >= tail;
      const total = labelOf(x) === 'total' && [ins, outs, Math.abs(net)].includes(Math.abs(x.amount));
      if (atEdge || total) isLabelRow.add(x);
    });
  }
  const built = new Map();
  for (const key of keysInOrder) built.set(key, { number: null, currency: null, lines: [], starts: [], opening: null, closing: null });
  for (const x of records) {
    const b = built.get(x.key);
    b.number = x.number || null;
    b.currency = x.currency;
    if (isLabelRow.has(x)) {
      const label = WORDS.opening.includes(x.labelKey) ? 'opening' : WORDS.closing.includes(x.labelKey) ? 'closing' : null;
      if (label) b[label] ??= x.amount;
      continue;
    }
    b.lines.push(line({ date: x.day, description: x.description, amount: x.amount, running: x.running }));
    b.starts.push(x.start);
  }
  const accountKeys = keysInOrder.filter((k) => built.get(k).lines.length > 0);
  if (!accountKeys.length) return null;

  // An id in the file's name: right after the bank's name ("Chase1234_Activity_….csv", decaf's
  // pattern) unless it is a year (19xx or 20xx after a space, a dash or an underscore, or followed by
  // a month: "Chase-2026-09.csv", "Monzo 2024-08.csv"); Wise's statement id
  // ("statement_12345678_EUR_2026-10-01_2026-10-31.csv"); an IBAN whose check digits are right.
  const fileNameNumber = (() => {
    const name = baseName(fileName);
    if (bank) {
      const m = new RegExp(`(?<![A-Za-z])${escapeRe(bank.brand)}([ _-]?)(\\d{4})(?!\\d)`, 'i').exec(name);
      const year = m && /^(?:19|20)\d{2}$/.test(m[2]) && (m[1] !== '' || /^[-_. ]?\d{1,2}(?!\d)/.test(name.slice(m.index + m[0].length)));
      if (m && !year) return m[2];
    }
    const wise = /statement_(\d+)_[A-Z]{3}_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}/.exec(name);
    if (wise) return wise[1];
    return ibansIn(name.replace(/[_.]/g, ' '))[0] ?? null;
  })();

  // An account type column decides each account: a card when its lines all say a card ("Visa",
  // "MasterCard", "Credit Card": RBC's download of every account), else not. Without one, the file does.
  const cardOf = (k) => {
    const types = records.filter((x) => x.key === k).map((x) => x.accountType);
    if (c.accountType == null || types.some((t) => t === '')) return card;
    return types.every((t) => saysCard(t, [...WORDS.cardFile, ...WORDS.creditCard]));
  };
  // Each account, built as read (a card or not) and the other way round, for the review's "It's a
  // card" switch: the same lines, signed and balanced as the reader would have had it known.
  const currencies = new Set(accountKeys.map((k) => built.get(k).currency));
  const several = accountKeys.length > 1;
  const build = (turned) => accountKeys.map((k, n) => {
    const asCard = cardOf(k) !== turned;
    const b = built.get(k);
    const lines = b.lines.map((l) => ({ ...l }));
    const starts = [...b.starts];
    // Oldest first: by the dates; when the first and last share a day, by the balances.
    const days = lines.map((l) => l.date);
    const reversed = days[0] > days[days.length - 1]
      || (days[0] === days[days.length - 1] && lines.length > 1 && lines[0].running != null
        && runningKind(lines.map((l) => l.running), lines.map((l) => l.amount)) === 'after'
        && !lines.every((l, i) => i === 0 || l.running === lines[i - 1].running + l.amount));
    if (reversed) { lines.reverse(); starts.reverse(); }
    if (asCard && useAmount && !c.coded.length && chargesPrintedPositive(bank, cardHeader, lines)) for (const l of lines) l.amount = -l.amount;
    // A card's balance column is what is owed. Printed from the holder's side instead (owed as a
    // minus: each balance the one before plus its line, or a lone balance below zero), it turns round.
    if (asCard && lines.some((l) => l.running != null)) {
      const holderSide = lines.length >= 2
        ? lines.every((l, i) => i === 0 || (l.running != null && lines[i - 1].running != null && l.running === lines[i - 1].running + l.amount))
        : lines[0].running < 0;
      if (holderSide) for (const l of lines) if (l.running != null) l.running = -l.running;
    }
    const number = b.number ?? facts.number ?? c.constAccount ?? fileNameNumber ?? null;
    // decaf's ref: an id of four characters or fewer is the bank's (or "Account"'s) and the id's.
    const id = number == null ? null : number.toUpperCase().replace(/\s/g, '');
    const ref = id == null ? null : id.length <= 4 ? `CSV:${bank?.brand ?? 'Account'}:${id}` : `CSV:${id}`;
    const digitsOnly = (number ?? '').replace(/\D/g, '');
    const brand = bank?.brand ?? null;
    let name = brand ? (asCard && !/card/i.test(brand) ? `${brand} card` : brand) : asCard ? 'Card' : 'Account';
    if (digitsOnly.length >= 4) name += ` ·· ${digitsOnly.slice(-4)}`;
    if (currencies.size > 1 && b.currency) name += ` ${b.currency}`;
    const acct = account({
      ref, number, numbers: digitsOnly.length >= 8 ? [digitsOnly] : [], name,
      type: asCard ? 'card' : 'current', owed: asCard, currency: b.currency, lines,
    });
    // A file naming no currency: its figures are at three decimals until the review gives it one.
    if (b.currency == null) acct.readDigits = 3;
    if (headerless) acct.notes.push('read without a header: check each line');
    const missed = (unread.get(k) ?? 0) + (n === 0 ? [...unread.keys()].filter((u) => !accountKeys.includes(u)).reduce((t, u) => t + unread.get(u), 0) : 0);
    if (missed) acct.notes.push(`${missed} row${missed === 1 ? '' : 's'} could not be read`);
    if (rounded.get(k)) acct.notes.push(`${rounded.get(k)} amount${rounded.get(k) === 1 ? '' : 's'} rounded to whole ${b.currency}`);
    const first = lines[0];
    const last = lines[lines.length - 1];
    const amountOf = (s) => (s == null ? null : b.currency ? csvAmount(s, minorDigits(b.currency)) : csvAmount(s, 3, null, minorDigits(mainCurrency ?? null)));
    if (c.start != null && starts[0] != null) {
      acct.opening = starts[0];
      acct.closing = last.running;
    } else if (first.running != null) {
      acct.opening = asCard ? first.running + first.amount : first.running - first.amount;
      acct.closing = last.running;
    } else if (b.opening != null || b.closing != null) {
      balancesAround(acct, { ...facts, opening: null, closing: null, unlabelled: [] }, lines, amountOf, lastDayOf(lines), asCard,
        { opening: b.opening, closing: b.closing });
    } else if (!several) {
      balancesAround(acct, facts, lines, amountOf, lastDayOf(lines), asCard);
    }
    if (acct.closing == null) acct.notes.push('no balance in the file');
    settleDigits(acct, mainCurrency);
    finishAccount(acct, acct.closing == null);
    return acct;
  });
  const accounts = build(false);
  build(true).forEach((other, n) => { accounts[n].other = other; });
  // Accounts of one file that would share a ref (an account named above the table, its lines in two
  // currencies) each carry their currency after it, so they are never written into one account.
  const shared = new Set(accounts.map((a) => a.ref).filter((ref, n, refs) => ref != null && refs.indexOf(ref) !== n));
  for (const a of accounts) {
    if (shared.has(a.ref) && a.currency) for (const x of [a, a.other]) x.ref = `${x.ref}:${a.currency}`;
  }
  const lineDates = accounts.flatMap((a) => a.lines.map((l) => l.date)).filter(Boolean).sort();
  const periodDay = (s) => (s ? csvDate(s, order.dayFirst) : null);
  return {
    reader: 'CSV', institution: bank?.brand ?? null, country: bank?.country ?? null, general: headerless, fileName,
    holder: holder ?? null,
    period: { from: periodDay(facts.from) ?? lineDates[0] ?? null, to: periodDay(facts.to) ?? lineDates[lineDates.length - 1] ?? null },
    dateOrder: order.order, dateOrderGuessed: order.guessed, accounts,
  };
}

const lastDayOf = (lines) => lines.map((l) => l.date).filter(Boolean).sort().pop() ?? null;

/**
 * **A file's figures in the person's main currency's decimals**, when it names no currency: read at
 * three (`readDigits` 3), they are given in the main currency's (two when none is passed; `readDigits`
 * then those) when every figure fits them exactly; otherwise they stay at three and the review, once
 * a currency is chosen, puts them into its decimals or says they don't fit (web/statement-save.mjs,
 * accountToSave). Changes `acct` in place.
 */
export function settleDigits(acct, mainCurrency) {
  if (acct.readDigits == null) return acct;
  const target = minorDigits(mainCurrency ?? null);
  if (target >= acct.readDigits) return acct;
  let factor = 1;
  for (let i = target; i < acct.readDigits; i++) factor *= 10;
  const values = [acct.opening, acct.closing, ...acct.lines.flatMap((l) => [l.amount, l.running])].filter((v) => v != null);
  if (!values.every((v) => v % factor === 0)) return acct;
  const down = (v) => (v == null ? v : v / factor);
  acct.opening = down(acct.opening);
  acct.closing = down(acct.closing);
  for (const l of acct.lines) { l.amount = down(l.amount); l.running = down(l.running); }
  acct.readDigits = target;
  return acct;
}

/**
 * **Balances from the rows around the table**, for an account whose lines carry none: rows of the
 * table that are its balances (`read`); the labelled opening and closing; failing those, a row of
 * two figures the lines lead from one to the other (PNC's first row), one figure dated on or after
 * the last line (BNP Paribas's first row), or a lone figure below the lines (LCL) that isn't their
 * money in, their money out or their sum, and never for a card (a card's footer is a total). A card's
 * balance printed below zero (and its opening, then not above zero) is what is owed, turned round. Only
 * the closing known: the opening is worked back from the lines (`openingWorkedOut`); only the opening:
 * the closing is worked out. `amountOf` reads a figure at the account's decimals.
 */
function balancesAround(acct, facts, lines, amountOf, lastDay, owed, read = {}) {
  const sum = lines.reduce((t, l) => t + l.amount, 0);
  const ins = lines.filter((l) => l.amount > 0).reduce((t, l) => t + l.amount, 0);
  const outs = lines.filter((l) => l.amount < 0).reduce((t, l) => t - l.amount, 0);
  const lead = (from) => (owed ? from - sum : from + sum);
  let opening = read.opening ?? amountOf(facts.opening);
  let closing = read.closing ?? amountOf(facts.closing);
  // A card's balance printed below zero is what is owed, written from the holder's side (DKB's "Saldo: -123,45 EUR").
  if (owed && closing != null && closing < 0 && (opening == null || opening <= 0)) {
    closing = -closing;
    if (opening != null) opening = -opening;
  }
  if (opening == null && closing == null) {
    for (const u of facts.unlabelled) {
      const values = u.figures.map((f) => amountOf(f));
      if (u.place === 'above' && values.length === 2 && values.every((v) => v != null) && lead(values[0]) === values[1]) {
        [opening, closing] = values;
        break;
      }
      const dayOf = u.dates.map((d) => csvDate(d, true) ?? csvDate(d, false)).find(Boolean);
      if (u.place === 'above' && values.length === 1 && dayOf && lastDay && dayOf >= lastDay) { closing = values[0]; break; }
      if (u.place === 'below' && !owed && values.length === 1 && values[0] != null
        && ![sum, ins, outs, -outs].includes(values[0])) { closing = values[0]; break; }
    }
  }
  if (opening != null) acct.opening = opening;
  if (closing != null) acct.closing = closing;
  if (opening != null && closing == null) {
    acct.closing = lead(opening);
    acct.closingWorkedOut = true;
  } else if (closing != null && opening == null) {
    acct.opening = owed ? closing + sum : closing - sum;
    acct.openingWorkedOut = true;
  }
}

export const CSV_READERS = [INTLWise];

/** Wise's own CSV, when the first row is its header: the statement Wise's reader gives, checked. */
function wiseStatement(rows, fileName) {
  const reader = rows.length ? CSV_READERS.find((r) => r.recognises(rows[0])) : null;
  if (!reader) return null;
  const read = reader.read(rows, fileName);
  for (const a of read.accounts) {
    a.check = check(a);
    // No lines: nothing to check and no balance known. Not a failure; not a pass either.
    if (!a.lines.length) a.check = UNCHECKED();
  }
  return {
    reader: reader.id, institution: reader.institution, country: reader.country, general: false,
    fileName, holder: read.holder, period: read.period, accounts: read.accounts,
  };
}

/**
 * The tables a file was split into (one per separator tried) → the first statement read from a
 * header, else from a table without one, else from `body`'s `Label: value` blocks. A statement
 * with no accounts when nothing reads it: `datesUnread` when its lines' dates couldn't be read,
 * `unknownCsv` always.
 */
function readTables(tables, options, body = null) {
  let datesUnread = false;
  const tried = (statement) => {
    if (statement?.datesUnread) datesUnread = true;
    return statement?.accounts?.length ? statement : null;
  };
  for (const table of tables) {
    const layout = findHeader(table);
    const statement = layout && tried(readTable(table, layout, options));
    if (statement) return statement;
  }
  for (const table of tables) {
    const layout = inferLayout(table);
    const statement = layout && tried(readTable(table, layout, options));
    if (statement) return statement;
  }
  const blocks = body == null ? null : labelValueTable(body);
  const statement = blocks && tried(readTable(blocks.rows, blocks.layout, options));
  if (statement) return statement;
  return { reader: null, fileName: options.fileName, accounts: [], unknownCsv: true, datesUnread };
}

/**
 * **A table's rows → one statement**, read as a CSV's are: Wise's own, else any bank's, from its
 * header, then without one. A spreadsheet's rows are read so (xlsx.js). `dayFirstWhenUnsure` and
 * `mainCurrency` settle dates that could be read either way when nothing in the file does (see
 * `dateOrderOf`).
 */
export function readCsvRows(rows, { fileName = null, dayFirstWhenUnsure = true, mainCurrency = null } = {}) {
  return wiseStatement(rows, fileName) ?? readTables([rows], { fileName, dayFirstWhenUnsure, mainCurrency });
}

/**
 * **One CSV file → one statement**: Wise's own; else any bank's, read from its header (comma,
 * semicolon, tab or bar, or what Excel's "sep=" line says), then without a header, then as
 * `Label: value` blocks. A statement with no accounts when nothing reads it: `datesUnread` when its
 * lines' dates couldn't be read (the phone says "Its dates couldn't be read."), `unknownCsv` always.
 * `dayFirstWhenUnsure` and `mainCurrency` settle dates that could be read either way when nothing in
 * the file does (see `dateOrderOf`).
 */
export function readCsvStatement(text, { fileName = null, dayFirstWhenUnsure = true, mainCurrency = null } = {}) {
  const rows = parseCsv(text);
  const wise = wiseStatement(rows, fileName);
  if (wise) return wise;
  const sep = /^\uFEFF?sep=([,;\t|])[^\S\n]*\r?\n/i.exec(text);
  const body = sep ? text.slice(sep[0].length) : text;
  const tables = (sep ? [sep[1]] : [',', ';', '\t', '|']).map((s) => (s === ',' && !sep ? rows : parseCsv(body, s)));
  return readTables(tables, { fileName, dayFirstWhenUnsure, mainCurrency }, body);
}

// ---------------------------------------------------------------------------------------------
// OFX, QFX and QBO: a bank's own download

export const OFX_EXTENSIONS = ['ofx', 'qfx', 'qbo'];
export const isOfxName = (name) => OFX_EXTENSIONS.includes((name.split('.').pop() ?? '').toLowerCase());
export const looksLikeOfx = (text) => text.slice(0, 2000).includes('OFXHEADER') || /<OFX>/i.test(text);

/**
 * The code pages a bank's file may be in when it isn't Unicode: Windows Latin first (it wins a
 * tie), then Central European, Cyrillic, Greek, Turkish, Baltic, ISO Latin 2, Hebrew, Arabic, Thai,
 * Vietnamese, and the CJK ones. Swift: .windowsCP1252, .windowsCP1250, .windowsCP1251,
 * .windowsCP1253, .windowsCP1254, CFStringEncodings.windowsBalticRim (1257), .isoLatin2,
 * CFStringEncodings.windowsHebrew (1255), .windowsArabic (1256), .dosThai (874, which is windows-874
 * on the web), .windowsVietnamese (1258), .shiftJIS, .japaneseEUC, CFStringEncodings.GB_18030_2000
 * (gbk), .big5_HKSCS_1999 (big5), .dosKorean (euc-kr, which is windows-949 on the web), each through
 * CFStringConvertEncodingToNSStringEncoding. A single-byte page is read as the web's TextDecoder
 * reads it, never failing: a byte the page leaves undefined is U+FFFD (in windows-1252, 0x81, 0x8D,
 * 0x8F, 0x90 and 0x9D are the controls U+0081 and so on, as WHATWG's table has them), so the Swift
 * port decodes these pages through a table of its own or lossily, never with String(data:encoding:),
 * which gives nil for such a byte.
 */
const SINGLE_BYTE_PAGES = ['windows-1252', 'windows-1250', 'windows-1251', 'windows-1253', 'windows-1254', 'windows-1257', 'iso-8859-2',
  'windows-1255', 'windows-1256', 'windows-874', 'windows-1258'];
const MULTI_BYTE_PAGES = ['shift_jis', 'euc-jp', 'gbk', 'big5', 'euc-kr'];

/** UTF-16 without a byte order mark: NUL in most of one half of the first 400 bytes' pairs and almost none of the other. */
function utf16Unmarked(bytes) {
  const n = Math.min(bytes.length - (bytes.length % 2), 400);
  if (n < 4) return null;
  let even = 0;
  let odd = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) even++;
    if (bytes[i + 1] === 0) odd++;
  }
  const pairs = n / 2;
  if (odd * 10 >= pairs * 3 && even * 20 <= pairs) return 'utf-16le';
  if (even * 10 >= pairs * 3 && odd * 20 <= pairs) return 'utf-16be';
  return null;
}

/** The lines (up to 64 KB of them) that hold a byte of 0x80 or more: where code pages differ. */
function linesBeyondAscii(bytes) {
  const parts = [];
  let size = 0;
  let start = 0;
  for (let i = 0; i <= bytes.length && size < 65536; i++) {
    if (i < bytes.length && bytes[i] !== 0x0A) continue;
    let beyond = false;
    for (let k = start; k < i && !beyond; k++) beyond = bytes[k] >= 0x80;
    if (beyond) {
      parts.push(bytes.subarray(start, Math.min(i + 1, bytes.length)));
      size += i + 1 - start;
    }
    start = i + 1;
  }
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * A letter's script, as far as telling code pages apart needs: Latin, Chinese and Japanese, Hangul,
 * Cyrillic, Greek, Hebrew, Arabic, Thai, or other. By Unicode's Script_Extensions, so the long vowel
 * mark "ー" is Japanese.
 */
function scriptOf(c) {
  if (/\p{scx=Latin}/u.test(c)) return 'Latin';
  if (/[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}]/u.test(c)) return 'CJ';
  if (/\p{scx=Hangul}/u.test(c)) return 'Hangul';
  if (/\p{scx=Cyrillic}/u.test(c)) return 'Cyrillic';
  if (/\p{scx=Greek}/u.test(c)) return 'Greek';
  if (/\p{scx=Hebrew}/u.test(c)) return 'Hebrew';
  if (/\p{scx=Arabic}/u.test(c)) return 'Arabic';
  if (/\p{scx=Thai}/u.test(c)) return 'Thai';
  return 'Other';
}

const isLetter = (c) => c !== undefined && /\p{L}/u.test(c);
const isMark = (c) => c !== undefined && /\p{M}/u.test(c);

/**
 * How much a reading looks like words, over its characters beyond ASCII: +1 for a letter beside a
 * letter of its own script; -1 for a letter of another script inside a word, or for a character
 * that is neither a letter nor a space between two letters that aren't Chinese, Japanese or Korean
 * ("P³atno": windows-1250's ł read as 1252); nothing for a combining mark after a letter or a mark
 * (Thai vowels and tones, Hebrew points: part of the word), and a letter's neighbours are found past
 * such marks ("ค่า": ค is beside า); -2 for a control character or an
 * unreadable byte (0x80 to 0x9F, U+FFFD); and, for a word of three letters or more made only of
 * accented Latin letters ("Äàòà": Cyrillic read as Latin), minus its length. Characters are counted
 * by Unicode scalar (a Swift String's unicodeScalars, not its Characters).
 */
function readingScore(text) {
  const chars = Array.from(text);
  let score = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const code = c.codePointAt(0);
    if (code < 0x80) continue;
    if (code < 0xA0 || code === 0xFFFD) { score -= 2; continue; }
    if (isMark(c) && (isLetter(chars[i - 1]) || isMark(chars[i - 1]))) continue;
    // A letter's neighbours are the characters either side of it, past any marks on it ("ค่า": ค beside า).
    let b = i - 1;
    while (b >= 0 && isMark(chars[b])) b--;
    let a = i + 1;
    while (a < chars.length && isMark(chars[a])) a++;
    const before = chars[b];
    const after = chars[a];
    if (isLetter(c)) {
      const script = scriptOf(c);
      if ((isLetter(before) && scriptOf(before) === script) || (isLetter(after) && scriptOf(after) === script)) score += 1;
      else if (isLetter(before) && isLetter(after)) score -= 1;
    } else if (isLetter(before) && isLetter(after) && !/\p{Z}/u.test(c)
      && !['CJ', 'Hangul'].includes(scriptOf(before)) && !['CJ', 'Hangul'].includes(scriptOf(after))) score -= 1;
  }
  for (const word of text.match(/\p{L}{3,}/gu) ?? []) {
    if (/^[\u00C0-\u024F]+$/u.test(word)) score -= word.length;
  }
  return score;
}

/** Every heading word of `csv-words` as a key, for telling apart readings that look alike ("Číslo účtu" against "Èíslo úètu"). */
const HEADING_KEYS = new Set(['date', 'text', 'party', 'amount', 'out', 'in', 'balance', 'currency', 'account', 'counterAccount', 'state', 'fee', 'sign']
  .flatMap((name) => WORDS[name]));

/** How many cells of the first 60 lines are heading words. */
function headingWords(text) {
  let n = 0;
  for (const row of text.split('\n').slice(0, 60)) for (const cell of row.split(/[,;\t|]/)) if (HEADING_KEYS.has(csvKey(cell))) n++;
  return n;
}

/**
 * **A file's bytes as text**, for every text format (CSV, TSV, OFX, MT940, CAMT, QIF, .txt):
 * 1. a byte order mark: UTF-8, UTF-16 LE or BE;
 * 2. no mark, but NUL in alternate bytes: UTF-16 (little-endian when the NULs come second);
 * 3. an OFX header's `CHARSET:1252` (or another Windows page, 1250 to 1258: Swift's 1255, 1256 and
 *    1258 are CFStringEncodings.windowsHebrew, .windowsArabic and .windowsVietnamese): that page;
 * 4. valid UTF-8: UTF-8;
 * 5. else each of the code pages above reads the lines that differ (the CJK ones refusing bytes
 *    they can't read), and the reading with the most points wins: `readingScore`, plus 10 for each
 *    cell of the first 60 lines that is a heading word; the first on a tie (windows-1252).
 * The same as the app's StatementText.decode.
 */
export function decodeText(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder('utf-8').decode(b);
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b);
  const wide = utf16Unmarked(b);
  if (wide) return new TextDecoder(wide).decode(b);
  const head = new TextDecoder('windows-1252').decode(b.subarray(0, 400));
  const charset = /CHARSET:\s*(125[0-8])/i.exec(head);
  if (charset) return new TextDecoder(`windows-${charset[1]}`).decode(b);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { /* not UTF-8 */ }
  const sample = linesBeyondAscii(b);
  let best = null;
  for (const page of [...SINGLE_BYTE_PAGES, ...MULTI_BYTE_PAGES]) {
    let text;
    try { text = new TextDecoder(page, { fatal: MULTI_BYTE_PAGES.includes(page) }).decode(sample); } catch { continue; }
    const score = readingScore(text) + 10 * headingWords(text);
    if (!best || score > best.score) best = { page, score };
  }
  return new TextDecoder(best ? best.page : 'windows-1252').decode(b);
}

/** A bank file's bytes as text: `decodeText`, by the name every reader has used. */
export const ofxText = (bytes) => decodeText(bytes);

// Numbered characters first: `&#252;` and `&#xF6;` are ü and ö.
const ofxUnescape = (s) => s.replace(/&#[xX]?[0-9A-Fa-f]+;/g, (m) => {
  const body = m.slice(2, -1);
  const value = /^[xX]/.test(body) ? (/^[xX][0-9A-Fa-f]+$/.test(body) ? parseInt(body.slice(1), 16) : NaN)
    : (/^\d+$/.test(body) ? parseInt(body, 10) : NaN);
  return Number.isInteger(value) && value <= 0x10FFFF && !(value >= 0xD800 && value <= 0xDFFF) ? String.fromCodePoint(value) : m;
}).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

/** What follows `<TAG>` up to the next tag or line end: an SGML value has no closing tag. */
function ofxValue(tag, text) {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(text ?? '');
  const v = m?.[1].trim();
  return v ? ofxUnescape(v) : null;
}

/** Everything between `<TAG>` and `</TAG>`, for each in turn. Aggregates are closed in both versions. */
function ofxBlocks(tag, text) {
  const found = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi');
  for (const m of (text ?? '').matchAll(re)) found.push(m[1]);
  return found;
}

/** `YYYYMMDD`, any time and zone after it ignored. */
const ofxDate = (s) => (/^\d{8}/.test(s ?? '') ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

/** A sign, digits, and a point or (some banks) a comma before the decimals. */
const ofxAmount = (s, digits) => (s == null ? null : parseAmount(s.includes('.') ? s : s.replace(',', '.'), digits));

/** The bank's name when `ORG` is one: some banks put a code there ("B1"), which isn't. */
const ofxInstitution = (org) => (org && org.length >= 3 && /\p{L}/u.test(org) && !/\d/.test(org) ? org : null);

function ofxAccount(statement, list, card, organisation) {
  const currency = ofxValue('CURDEF', statement)?.toUpperCase() ?? null;
  const digits = minorDigits(currency);
  const from = ofxBlocks(card ? 'CCACCTFROM' : 'BANKACCTFROM', statement)[0] ?? '';
  const number = ofxValue('ACCTID', from);
  const kind = ofxValue('ACCTTYPE', from)?.toUpperCase();
  const type = card ? 'card' : kind === 'SAVINGS' || kind === 'MONEYMRKT' ? 'savings' : kind === 'CD' ? 'deposit' : 'current';
  let lines = ofxBlocks('STMTTRN', list).map((t) => {
    const amount = ofxAmount(ofxValue('TRNAMT', t), digits);
    if (amount == null) return null;
    const name = ofxValue('NAME', t) ?? ofxValue('NAME', ofxBlocks('PAYEE', t)[0]);
    const memo = ofxValue('MEMO', t);
    const cheque = ofxValue('CHECKNUM', t);
    return line({
      date: ofxDate(ofxValue('DTPOSTED', t) ?? ofxValue('DTUSER', t)),
      madeOn: ofxDate(ofxValue('DTUSER', t)),
      description: [name, memo === name ? null : memo, cheque ? `Cheque ${cheque}` : null].filter(Boolean).join(' · '),
      amount, ref: ofxValue('FITID', t),
    });
  }).filter(Boolean);
  // Oldest first, as a statement prints them; many banks send newest first.
  if (lines.length > 1 && lines[0].date && lines[lines.length - 1].date && lines[0].date > lines[lines.length - 1].date) lines = lines.reverse();
  const digitsOnly = (number ?? '').replace(/\D/g, '');
  const bank = organisation ?? (card ? 'Card' : 'Account');
  const acct = account({
    ref: number ? `OFX:${number.toUpperCase()}` : null, number, numbers: digitsOnly.length >= 8 ? [digitsOnly] : [],
    name: digitsOnly ? `${bank} ·· ${digitsOnly.slice(-4)}` : bank, type, owed: card, currency, lines,
  });
  const balance = ofxAmount(ofxValue('BALAMT', ofxBlocks('LEDGERBAL', statement)[0]), digits);
  if (balance != null) {
    const closing = card ? -balance : balance;
    const sum = lines.reduce((t, l) => t + l.amount, 0);
    acct.closing = closing;
    acct.opening = card ? closing + sum : closing - sum;
    acct.openingWorkedOut = true;
  }
  return acct;
}

/**
 * **OFX, QFX and QBO**: the "download transactions" file most banks offer beside the PDF. Each
 * statement aggregate is one account, each `STMTTRN` a line. The file carries the balance at its
 * end but none at its start, so the opening is worked back from the lines and the account shows
 * as the bank's own figures rather than as adding up. A card's balance owed is printed negative.
 * A statement with no accounts when the file holds no bank or card statement.
 */
export function readOfxStatement(text, { fileName = null } = {}) {
  if (!looksLikeOfx(text)) return { reader: null, fileName, accounts: [], unknownOfx: true };
  const at = text.search(/<OFX>/i);
  const body = at >= 0 ? text.slice(at) : text;
  const organisation = ofxInstitution(ofxValue('ORG', ofxBlocks('FI', body)[0]));
  const accounts = [];
  let from = null;
  let to = null;
  for (const [aggregate, card] of [['STMTRS', false], ['CCSTMTRS', true]]) {
    for (const statement of ofxBlocks(aggregate, body)) {
      const list = ofxBlocks('BANKTRANLIST', statement)[0] ?? '';
      const start = ofxDate(ofxValue('DTSTART', list));
      const end = ofxDate(ofxValue('DTEND', list));
      if (start && (!from || start < from)) from = start;
      if (end && (!to || end > to)) to = end;
      accounts.push(ofxAccount(statement, list, card, organisation));
    }
  }
  if (!accounts.length) return { reader: null, fileName, accounts: [], unknownOfx: true };
  const dates = accounts.flatMap((a) => a.lines.map((l) => l.date)).filter(Boolean).sort();
  for (const a of accounts) {
    a.check = !a.lines.length && a.closing == null ? { ok: false, checked: false, sum: 0, expected: null, messages: [] } : check(a);
  }
  return {
    reader: 'OFX', institution: organisation, country: null, general: false, fileName, holder: null,
    period: { from: from ?? dates[0] ?? null, to: to ?? dates[dates.length - 1] ?? null }, accounts,
  };
}

// ---------------------------------------------------------------------------------------------
// MT940: SWIFT's customer statement

/**
 * **MT940**: SWIFT's customer statement, the download most banks give a business account and many
 * give everyone. Plain text in tagged fields: `:25:` the account, `:60F:` the opening balance,
 * `:61:` a line with `:86:` its description, `:62F:` the closing balance. A file may hold many
 * statements, one per day or one per page (`:60M:`/`:62M:`); those of one account in one currency
 * become one account, its opening the first and its closing the last. Every figure is the bank's
 * own, so the account is checked like a PDF statement. The same as the app's StatementMT940.
 */
export const MT940_EXTENSIONS = ['sta', 'mt940', '940', 'swi'];

/** Whether this text is an MT940 file, whatever it is called. */
export function looksLikeMt940(text) {
  const head = text.slice(0, 20_000);
  return head.includes(':20:') && head.includes(':25:') && head.includes(':61:') && (head.includes(':60F:') || head.includes(':60M:'));
}

/** Text → fields in order, `{ tag, value }`, continuation lines kept. SWIFT's envelope is passed over. */
function mt940Fields(text) {
  const fields = [];
  for (const raw of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    let row = raw;
    const start = row.indexOf('{4:');
    if (start >= 0) row = row.slice(start + 3);
    const bare = trimSpaces(row);
    // The envelope's end, alone or with its trailer (`-}{5:{CHK:…}}`).
    if (row.startsWith('{') || bare === '-' || bare.startsWith('-}')) continue;
    // `:NS:` is a bank's own extra field: its own, never part of the one before.
    const m = /^:(\d{2}[A-Z]?|NS):(.*)$/.exec(row);
    if (m) fields.push({ tag: m[1], value: m[2] });
    else if (fields.length && bare) fields[fields.length - 1].value += '\n' + row;
  }
  return fields;
}

/**
 * MT940 amounts use a comma for the point and nothing for thousands: `1234,5` is 1,234.50, and
 * `100,` (the comma kept, no decimals) is 100.00.
 */
function mt940Amount(s, digits) {
  let plain = s.replace(/\./g, '').replace(/,/g, '.');
  if (plain.endsWith('.')) plain += '0';
  return parseAmount(plain, digits);
}

const yymmdd = (s) => (/^\d{6}$/.test(s) ? realDay(2000 + +s.slice(0, 2), +s.slice(2, 4), +s.slice(4, 6)) : null);

/** `C260801EUR1234,56` → the date, the currency and the amount, credit positive. */
function mt940Balance(value) {
  const m = /^([CD])(\d{6})([A-Z]{3})([\d,.]+)/.exec(trimSpaces(value));
  if (!m) return null;
  const amount = mt940Amount(m[4], minorDigits(m[3]));
  if (amount == null) return null;
  return { date: yymmdd(m[2]), currency: m[3], amount: m[1] === 'D' ? -amount : amount };
}

/**
 * One `:61:` line: value date, optional booking date (month and day), the mark (C, D, or a
 * reversal RC or RD), an optional letter, the amount, the type code and the references.
 */
function mt940Line(value, digits) {
  const cut = value.indexOf('\n');
  const first = cut < 0 ? value : value.slice(0, cut);
  // Only `//` opens the bank's reference: the customer's may hold a single slash.
  const m = /^(\d{6})(\d{4})?(RC|RD|C|D)[A-Z]?([\d,]+)([NFS][A-Z0-9]{3})(.*?)(?:\/\/(.*))?$/.exec(trimSpaces(first));
  if (!m) return null;
  const size = mt940Amount(m[4], digits);
  const valueDate = yymmdd(m[1]);
  if (size == null || !valueDate) return null;
  // A credit and a reversed debit add; a debit and a reversed credit take away.
  const signed = m[3] === 'C' || m[3] === 'RD' ? size : -size;
  let booked = valueDate;
  if (m[2]) {
    // The booking date carries no year: the value date's, or the one either side when the two
    // straddle a new year.
    const [vy, vm] = [+valueDate.slice(0, 4), +valueDate.slice(5, 7)];
    const mm = +m[2].slice(0, 2);
    const year = mm - vm > 6 ? vy - 1 : vm - mm > 6 ? vy + 1 : vy;
    booked = realDay(year, mm, +m[2].slice(2, 4)) ?? valueDate;
  }
  const reference = trimSpaces(m[6]);
  return line({
    date: booked, madeOn: booked === valueDate ? null : valueDate,
    description: cut < 0 ? '' : value.slice(cut + 1).trim(), amount: signed,
    ref: !reference || reference === 'NONREF' ? null : reference,
  });
}

/**
 * An `:86:` field as words. German banks number its parts (`?20`…`?29` the purpose, `?32` and
 * `?33` the other side's name); Dutch banks label them (`/NAME/`, `/REMI/`); the rest is free
 * text. Either way, the other side's name first, then what it was for.
 */
function mt940Description(value) {
  const flat = value.replace(/\n/g, '');
  if (flat.includes('?2') || flat.includes('?3')) {
    const parts = {};
    for (const m of flat.matchAll(/\?(\d{2})([^?]*)/g)) parts[m[1]] = (parts[m[1]] ?? '') + m[2];
    const name = trimSpaces(['32', '33'].map((k) => parts[k]).filter((v) => v != null).join(''));
    // The purpose is cut into 27-character pieces wherever they fall, words and all.
    const purpose = trimSpaces(Array.from({ length: 10 }, (_, i) => parts[String(20 + i)]).filter((v) => v != null).join(''));
    const words = [name, purpose].filter(Boolean);
    if (words.length) return collapse(words.join(' · '));
  }
  if (flat.includes('/NAME/') || flat.includes('/REMI/') || flat.includes('/CNTP/')) {
    const part = (key) => {
      const m = new RegExp(`/${key}/(.*?)(?:/(?:[A-Z]{3,4})/|$)`).exec(flat);
      return m ? trimSpaces(m[1]) : null;
    };
    // `/REMI/USTD//Rent/`: the purpose after its code, without the slashes.
    const remi = part('REMI');
    const purpose = remi == null ? null : remi.replace(/^(?:USTD|STRD)\/+/, '').replace(/^[/ ]+|[/ ]+$/g, '');
    // ING gives the other side as `/CNTP/<account>/<bank>/<name>/` instead of `/NAME/`.
    const cntp = /\/CNTP\/[^/]*\/[^/]*\/([^/]+)\//.exec(flat);
    const name = part('NAME') ?? (cntp ? trimSpaces(cntp[1]) : null);
    const words = [name, purpose].filter(Boolean);
    if (words.length) return collapse(words.join(' · '));
  }
  return collapse(value.replace(/\n/g, ' '));
}

/**
 * One MT940 file → one statement, an account for each account and currency in it. A statement
 * with no accounts when the text isn't MT940 or holds no balance to read.
 */
export function readMt940Statement(text, { fileName = null } = {}) {
  const none = { reader: null, fileName, accounts: [], unknownMt940: true };
  if (!looksLikeMt940(text)) return none;
  const order = [];
  const built = new Map();
  let number = null;
  let key = null;
  // A `:86:` belongs to the line just read before it (an `:NS:` between them aside); one after the
  // balances, or after a line that couldn't be read, is not that line's.
  let afterLine = false;
  const unread = new Map();
  for (const field of mt940Fields(text)) {
    const b = key ? built.get(key) : null;
    const lineBefore = afterLine;
    afterLine = field.tag === 'NS' && lineBefore;
    if (field.tag === '25') {
      number = field.value.trim();
      key = null;
    } else if (field.tag === '60F' || field.tag === '60M') {
      const found = number != null ? mt940Balance(field.value) : null;
      if (!found) continue;
      key = `${number}|${found.currency}`;
      if (!built.has(key)) {
        built.set(key, { number, currency: found.currency, opening: { date: found.date, amount: found.amount }, closing: null, lines: [] });
        order.push(key);
      }
    } else if (field.tag === '61') {
      if (!b) continue;
      const l = mt940Line(field.value, minorDigits(b.currency));
      if (!l) { unread.set(key, (unread.get(key) ?? 0) + 1); continue; }
      b.lines.push(l);
      afterLine = true;
    } else if (field.tag === '86') {
      // What the line before was for; a statement's own `:86:` (no line yet) says nothing.
      if (!lineBefore || !b || !b.lines.length) continue;
      const words = mt940Description(field.value);
      const last = b.lines[b.lines.length - 1];
      last.description = !last.description ? words : !words ? last.description : `${words} · ${last.description}`;
    } else if (field.tag === '62F' || field.tag === '62M') {
      const found = b ? mt940Balance(field.value) : null;
      if (found) b.closing = { date: found.date, amount: found.amount };
    }
  }
  const accounts = order.map((k) => {
    const b = built.get(k);
    const digitsOnly = b.number.replace(/[^0-9]/g, '');
    const count = unread.get(k);
    return account({
      notes: count ? [count === 1 ? '1 line could not be read' : `${count} lines could not be read`] : [],
      ref: `MT940:${b.number.toUpperCase().replace(/\s/g, '')}`, number: b.number,
      numbers: digitsOnly.length >= 8 ? [digitsOnly] : [],
      name: digitsOnly.length >= 4 ? `Account ·· ${digitsOnly.slice(-4)}` : 'Account',
      type: 'current', currency: b.currency, lines: b.lines,
      opening: b.opening?.amount ?? null, closing: b.closing?.amount ?? null,
    });
  });
  if (!accounts.length) return none;
  const earliest = (xs) => xs.filter(Boolean).sort()[0] ?? null;
  const latest = (xs) => xs.filter(Boolean).sort().pop() ?? null;
  const lineDates = accounts.flatMap((a) => a.lines.map((l) => l.date));
  for (const a of accounts) finishAccount(a);
  return {
    reader: 'MT940', institution: null, country: null, general: false, fileName, holder: null,
    // The opening balance is dated the day it stood, often the day before the first line.
    period: {
      from: earliest(lineDates) ?? earliest(order.map((k) => built.get(k).opening?.date)),
      to: latest(order.map((k) => built.get(k).closing?.date)) ?? latest(lineDates),
    },
    accounts,
  };
}

// ---------------------------------------------------------------------------------------------
// CAMT.053 and CAMT.052: the ISO 20022 statement in XML

/**
 * **CAMT.053 and CAMT.052**: the ISO 20022 statement in XML, standard in Switzerland and across
 * much of Europe. `camt.053` is the day's or month's statement (`Stmt`), `camt.052` the report
 * during the day (`Rpt`); both are read the same way, any version. Each `Stmt` is one account:
 * `Acct` names it, `Bal` gives the opening (`OPBD`, or `PRCD`, the previous closing) and closing
 * (`CLBD`) balances, each `Ntry` is a line, credit or debit by `CdtDbtInd`. Lines not yet booked
 * (`PDNG`) are left out. Statements of one account in one currency become one account. The same
 * as the app's StatementCAMT.
 */
export function looksLikeCamt(text) {
  const head = text.slice(0, 4_000);
  return head.includes('camt.053') || head.includes('camt.052') || head.includes('BkToCstmrStmt') || head.includes('BkToCstmrAcctRpt');
}

/** Text without namespace prefixes (`<ns2:Stmt>` → `<Stmt>`) or comments, so a tag is found by its name alone. */
const camtPlain = (text) => text.replace(/<!--[\s\S]*?-->/g, '').replace(/<(\/?)[A-Za-z][\w.-]*:/g, '<$1');

/** Everything inside each `<Tag …>…</Tag>` in turn, attributes allowed on the opening tag. */
function camtBlocks(tag, text) {
  return [...(text ?? '').matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
}

const camtBlock = (tag, text) => camtBlocks(tag, text)[0] ?? null;

/** A leaf's text, unescaped and trimmed; a `<![CDATA[…]]>` is its text as it stands. */
function camtLeaf(found) {
  const raw = found.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(raw);
  if (cdata) return cdata[1].trim() || null;
  return raw && !raw.includes('<') ? ofxUnescape(raw) : null;
}

function camtValue(tag, text) {
  const found = camtBlock(tag, text);
  return found == null ? null : camtLeaf(found);
}

/** A leaf's `Ccy="…"` attribute. */
const camtCurrency = (tag, text) => new RegExp(`<${tag}\\s[^>]*Ccy="([A-Z]{3})"`).exec(text ?? '')?.[1] ?? null;

/**
 * The first date in a block, as `<Dt>` or `<DtTm>`. Dates nest a `Dt` inside a `Dt`, which a block
 * can't be cut at, so the date is found by its own tag.
 */
const camtFirstDay = (text) => (text == null ? null
  : isoDay(/<(?:Dt|DtTm|FrDtTm|ToDtTm|FrDt|ToDt)>\s*(\d{4}-\d{2}-\d{2})/.exec(text)?.[1]));

/** An amount with its credit or debit mark: `DBIT` takes away. */
function camtSigned(block, digits) {
  const text = camtValue('Amt', block);
  const amount = text == null ? null : parseAmount(text, digits);
  if (amount == null) return null;
  return camtValue('CdtDbtInd', block) === 'DBIT' ? -Math.abs(amount) : Math.abs(amount);
}

/** A balance's kind: `Tp/CdOrPrtry/Cd`, or the proprietary text some banks put there. */
function camtBalanceKind(balance) {
  const type = camtBlock('Tp', balance);
  return type == null ? null : camtValue('Cd', type) ?? camtValue('Prtry', type);
}

/** One entry → one line, or null when it isn't booked yet. */
function camtLine(entry, digits) {
  const sts = camtBlock('Sts', entry);
  const status = sts == null ? null : camtValue('Cd', sts) ?? sts.trim();
  if (status === 'PDNG' || status === 'INFO') return null;
  // The entry's own amount comes before its details, which may carry amounts of their own.
  const head = entry.split('<NtryDtls')[0];
  const amount = camtSigned(head, digits);
  if (amount == null) return null;
  const details = camtBlock('TxDtls', entry) ?? '';
  const parties = camtBlock('RltdPties', details) ?? '';
  // Who was paid for money out, who paid for money in.
  const side = camtBlock(amount < 0 ? 'Cdtr' : 'Dbtr', parties);
  const other = side == null ? null : camtValue('Nm', side);
  const purpose = camtBlocks('Ustrd', camtBlock('RmtInf', details) ?? '').map(camtLeaf).filter((u) => u != null).join(' ');
  const extra = camtValue('AddtlTxInf', details) ?? camtValue('AddtlNtryInf', entry);
  let words = [other, purpose || null].filter((w) => w != null);
  if (!words.length && extra != null) words = [extra];
  const booked = camtFirstDay(camtBlock('BookgDt', head));
  const valued = camtFirstDay(camtBlock('ValDt', head));
  return line({
    date: booked ?? valued, madeOn: booked != null && valued !== booked ? valued : null,
    description: words.map(collapse).join(' · '), amount,
    ref: camtValue('AcctSvcrRef', head) ?? camtValue('NtryRef', head),
  });
}

/**
 * One CAMT file → one statement, an account for each account and currency in it. A statement with
 * no accounts when the text isn't CAMT or holds no statement.
 */
export function readCamtStatement(text, { fileName = null } = {}) {
  const none = { reader: null, fileName, accounts: [], unknownCamt: true };
  if (!looksLikeCamt(text)) return none;
  const body = camtPlain(text);
  const order = [];
  const built = new Map();
  let holder = null;
  let institution = null;
  for (const statement of [...camtBlocks('Stmt', body), ...camtBlocks('Rpt', body)]) {
    const acct = camtBlock('Acct', statement);
    if (acct == null) continue;
    // `Id` nests an `Id` for an account without an IBAN, so each is looked for in the whole.
    const othr = camtBlock('Othr', acct);
    const number = camtValue('IBAN', acct) ?? (othr == null ? null : camtValue('Id', othr));
    const balances = camtBlocks('Bal', statement);
    const currency = camtValue('Ccy', acct)
      ?? balances.map((b) => camtCurrency('Amt', b)).find((c) => c != null)
      ?? camtCurrency('Amt', statement);
    const digits = minorDigits(currency);
    const owner = camtBlock('Ownr', acct);
    const servicer = camtBlock('Svcr', acct);
    holder = holder ?? (owner == null ? null : camtValue('Nm', owner));
    institution = institution ?? (servicer == null ? null : camtValue('Nm', servicer));
    const key = `${number ?? '?'}|${currency ?? '?'}`;
    if (!built.has(key)) {
      const digitsOnly = (number ?? '').replace(/[^0-9]/g, '');
      // `Acct` holds the owner's and the bank's `Nm` too, so the account is named by its number.
      built.set(key, {
        account: account({
          ref: number != null ? `CAMT:${number.toUpperCase().replace(/\s/g, '')}` : null, number,
          numbers: digitsOnly.length >= 8 ? [digitsOnly] : [],
          name: digitsOnly.length >= 4 ? `Account ·· ${digitsOnly.slice(-4)}` : 'Account',
          type: 'current', currency,
        }),
        from: null, to: null, openingDay: null, closingDay: null,
      });
      order.push(key);
    }
    const b = built.get(key);
    // The earliest opening and the latest closing, whatever order the statements come in; a
    // report during the day (camt.052) may close on its interim balance (`ITBD`).
    let closed = null;
    let interim = null;
    for (const found of balances) {
      // A credit line printed with a balance carries an `Amt` of its own, before the balance's.
      const balance = found.replace(/<CdtLine(?:\s[^>]*)?>[\s\S]*?<\/CdtLine>/g, '');
      const kind = camtBalanceKind(balance);
      const date = camtFirstDay(balance);
      const amount = camtSigned(balance, digits);
      if (amount == null) continue;
      if (kind === 'OPBD' || kind === 'PRCD') {
        const earlier = b.account.opening == null || (date != null && b.openingDay != null && date < b.openingDay);
        if (earlier) {
          b.account.opening = amount;
          b.openingDay = date;
        }
      }
      if (kind === 'CLBD') closed = { amount, date };
      if (kind === 'ITBD') interim = { amount, date };
    }
    const last = closed ?? interim;
    if (last && (b.account.closing == null || last.date == null || b.closingDay == null || last.date >= b.closingDay)) {
      b.account.closing = last.amount;
      b.closingDay = last.date;
    }
    b.account.lines.push(...camtBlocks('Ntry', statement).map((e) => camtLine(e, digits)).filter(Boolean));
    const range = camtBlock('FrToDt', statement);
    if (range != null) {
      const from = isoDay(/<(?:FrDtTm|FrDt)>\s*(\d{4}-\d{2}-\d{2})/.exec(range)?.[1]);
      const to = isoDay(/<(?:ToDtTm|ToDt)>\s*(\d{4}-\d{2}-\d{2})/.exec(range)?.[1]);
      if (from && (!b.from || from < b.from)) b.from = from;
      if (to && (!b.to || to > b.to)) b.to = to;
    }
  }
  const accounts = order.map((key) => {
    const a = built.get(key).account;
    // Oldest first, as a statement prints them, the file's order kept within a day.
    a.lines = a.lines.map((l, i) => [l, i])
      .sort(([x, i], [y, j]) => (x.date && y.date && x.date !== y.date ? (x.date < y.date ? -1 : 1) : i - j))
      .map(([l]) => l);
    const sum = a.lines.reduce((t, l) => t + l.amount, 0);
    // One balance missing: the other worked out from the lines, and said to be.
    if (a.opening == null && a.closing != null) {
      a.opening = a.closing - sum;
      a.openingWorkedOut = true;
    } else if (a.closing == null && a.opening != null) {
      a.closing = a.opening + sum;
      a.closingWorkedOut = true;
    }
    return a;
  });
  if (!accounts.length) return none;
  const lineDates = accounts.flatMap((a) => a.lines.map((l) => l.date)).filter(Boolean).sort();
  const froms = order.map((k) => built.get(k).from).filter(Boolean).sort();
  const tos = order.flatMap((k) => [built.get(k).to, built.get(k).closingDay]).filter(Boolean).sort();
  for (const a of accounts) {
    if (institution && a.name.startsWith('Account')) a.name = institution + a.name.slice('Account'.length);
    finishAccount(a);
  }
  return {
    reader: 'CAMT', institution, country: null, general: false, fileName, holder,
    period: { from: froms[0] ?? lineDates[0] ?? null, to: tos[tos.length - 1] ?? lineDates[lineDates.length - 1] ?? null },
    accounts,
  };
}

// ---------------------------------------------------------------------------------------------
// QIF: Quicken's interchange file

/**
 * **QIF**: Quicken's old interchange file, still offered by Monzo, Barclays, Lloyds, NatWest and
 * PayPal. A `!Type:Bank` (or `CCard`, `Cash`, `Oth A`, `Oth L`) header, then one record per line,
 * each field a letter and its value (`D` date, `T` amount, `P` payee, `M` memo, `N` number) and
 * `^` to end it. It names no account number, currency or period, and gives no closing balance; an
 * "Opening Balance" record, when there is one, gives the opening. So the account is the lines.
 * The same as the app's StatementQIF.
 */
export const QIF_EXTENSIONS = ['qif'];

const trimBom = (s) => s.replace(/^[﻿\s]+|[﻿\s]+$/g, '');

/** Whether this text is a QIF file, whatever it is called. */
export function looksLikeQif(text) {
  const head = trimBom(text.slice(0, 2_000));
  return head.startsWith('!Type:') || head.startsWith('!Account') || head.startsWith('!Option');
}

/** Quicken writes `1/ 5'26` and `12/31'2025`: the apostrophe is the year's slash, spaces pad. */
const qifDate = (s) => s.replace(/'/g, '/').replace(/ /g, '');

/**
 * The file names no currency, so amounts are read at three decimals (`readDigits`), then given in
 * the main currency's when they all fit it (settleDigits): the review moves them to the currency
 * given (inCurrency), losing nothing for a three-decimal one.
 */
const QIF_READ_DIGITS = 3;

/** One section of a QIF file → its account. */
function qifAccount(section, dayFirst, places) {
  const card = section.card;
  let opening = null;
  let lines = [];
  for (const record of section.records) {
    const amount = record.amount == null ? null : csvAmount(record.amount, QIF_READ_DIGITS, null, places);
    if (amount == null) continue;
    const payee = trimSpaces(record.payee ?? '');
    // Quicken's opening balance: a record to the account itself (`L[name]`), not a line, wherever
    // it sits; a newest-first file puts it last.
    if (payee.toLowerCase() === 'opening balance' && opening == null
      && (!lines.length || (record.category ?? '').startsWith('['))) {
      opening = card ? -amount : amount;
      continue;
    }
    const words = [payee || null, record.memo === record.payee ? null : record.memo,
      record.number != null && /^[+-]?\d+$/.test(record.number) ? `Cheque ${record.number}` : null]
      .filter((w) => w != null).map(trimSpaces).filter(Boolean);
    lines.push(line({
      date: record.date == null ? null : fileDay(qifDate(record.date), dayFirst),
      description: words.join(' · '), amount,
    }));
  }
  // Oldest first, as a statement prints them.
  const dates = lines.map((l) => l.date).filter(Boolean);
  if (dates.length && dates[0] > dates[dates.length - 1]) lines = lines.reverse();
  const acct = account({
    ref: null, name: section.name || (card ? 'Card' : 'Account'), type: card ? 'card' : 'current', owed: card,
    currency: null, lines,
  });
  acct.readDigits = QIF_READ_DIGITS;
  if (opening != null) {
    const sum = lines.reduce((t, l) => t + l.amount, 0);
    acct.opening = opening;
    acct.closing = card ? opening - sum : opening + sum;
    acct.closingWorkedOut = true;
  } else {
    acct.notes.push('no balance in the file');
  }
  return acct;
}

/**
 * One QIF file → one statement, an account per account in it (a Quicken export of several sends
 * each as `!Account` then `!Type:`), or a statement with no accounts when it has no bank or card
 * lines. `dayFirstWhenUnsure` settles dates that could be read either way when nothing in the
 * file does: false when the main currency is the US dollar. Its amounts are read at three decimals,
 * then given in the main currency's (`mainCurrency`) when they all fit it, as a CSV's are.
 */
export function readQifStatement(text, { fileName = null, dayFirstWhenUnsure = true, mainCurrency = null } = {}) {
  const none = { reader: null, fileName, accounts: [], unknownQif: true };
  if (!looksLikeQif(text)) return none;
  let sections = [];
  let type = '';
  let current = {};
  // `!Option:AutoSwitch` opens a list of the accounts in the file, closed by `!Clear:AutoSwitch`:
  // declarations, not where lines go.
  let listing = false;
  let header = null;
  let inHeader = false;
  const flush = () => {
    if (current.amount == null && current.date == null) { current = {}; return; }
    if (!sections.length) sections.push({ name: null, card: type === 'ccard' || type === 'oth l', records: [] });
    sections[sections.length - 1].records.push(current);
    current = {};
  };
  for (const raw of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    const row = raw.replace(/^[﻿\t\p{Zs}]+|[﻿\t\p{Zs}]+$/gu, '');
    if (!row) continue;
    const first = row[0];
    if (first === '!') {
      const tag = row.toLowerCase();
      if (tag.startsWith('!option:autoswitch')) { listing = true; continue; }
      if (tag.startsWith('!clear:autoswitch')) { listing = false; continue; }
      if (tag.startsWith('!account')) {
        if (!listing) { header = { name: null, card: false }; inHeader = true; }
        continue;
      }
      if (tag.startsWith('!type:')) {
        flush();
        type = trimSpaces(tag.slice(6));
        const card = type === 'ccard' || type === 'oth l';
        // Each `!Type:` after an account's header starts that account; one without a header
        // starts a new one only once the last has lines.
        if (header) sections.push({ name: header.name, card: card || header.card, records: [] });
        else if (!sections.length || sections[sections.length - 1].records.length) sections.push({ name: null, card, records: [] });
        header = null;
        inHeader = false;
      }
      continue;
    }
    const rest = trimSpaces(row.slice(1));
    if (listing) continue;
    if (inHeader) {
      if (first === 'N' && header) header.name = rest;
      if (first === 'T' && header) header.card = ['ccard', 'oth l'].includes(rest.toLowerCase());
      if (first === '^') inHeader = false;
      continue;
    }
    if (!['bank', 'ccard', 'cash', 'oth a', 'oth l'].includes(type)) continue;
    if (first === 'D') current.date = rest;
    else if (first === 'T' || first === 'U') { if (current.amount == null || first === 'T') current.amount = rest; }
    else if (first === 'P') current.payee = rest;
    else if (first === 'M') current.memo = rest;
    else if (first === 'N') current.number = rest;
    else if (first === 'L') current.category = rest;
    else if (first === '^') flush();
  }
  flush();
  sections = sections.filter((sec) => sec.records.length);
  if (!sections.length) return none;

  // Quicken's apostrophe year is American, month first; decimal commas put the day first.
  const records = sections.flatMap((sec) => sec.records);
  const rawDates = records.filter((r) => r.date != null).map((r) => r.date);
  const unsure = rawDates.some((d) => d.includes("'")) ? false
    : decimalComma(records.filter((r) => r.amount != null).map((r) => r.amount)) ? true : dayFirstWhenUnsure;
  const dayFirst = dayFirstOf(rawDates.map(qifDate), unsure);
  const places = minorDigits(mainCurrency ?? null);
  const accounts = sections.map((sec) => qifAccount(sec, dayFirst, places));
  const lineDates = accounts.flatMap((a) => a.lines.map((l) => l.date)).filter(Boolean).sort();
  for (const a of accounts) {
    settleDigits(a, mainCurrency);
    finishAccount(a, a.closing == null);
  }
  return {
    reader: 'QIF', institution: null, country: null, general: false, fileName, holder: null,
    period: { from: lineDates[0] ?? null, to: lineDates[lineDates.length - 1] ?? null }, accounts,
  };
}

// ---------------------------------------------------------------------------------------------
// A currency given after reading

/**
 * The account in `currency`, its figures moved from the decimals they were read at (`readDigits`,
 * for a file that names no currency) to the currency's own: 12.500 read at three is 1250 in
 * pounds, 12 in yen. Null when that would drop a digit (12.50 in yen). Starts from the figures as
 * read, whatever currency was tried before. The same as the app's StatementAccount.inCurrency.
 */
export function inCurrency(acct, currency) {
  const from = acct.readDigits ?? minorDigits(acct.currency);
  const to = minorDigits(currency);
  const scale = 10 ** Math.abs(to - from);
  let lost = false;
  const moved = (value) => {
    if (value == null) return null;
    if (to >= from) {
      const product = value * scale;
      if (!Number.isSafeInteger(product)) lost = true;
      return product;
    }
    if (value % scale !== 0) lost = true;
    return value / scale;
  };
  const out = {
    ...acct, currency, readDigits: to, opening: moved(acct.opening), closing: moved(acct.closing),
    lines: acct.lines.map((l) => ({ ...l, amount: moved(l.amount), running: moved(l.running) })),
  };
  if (lost) return null;
  out.check = acct.check?.checked ? check(out) : acct.check;
  return out;
}

/** The decimals an account's figures are in: `readDigits` for a file that names no currency, else the currency's own. */
export const figureDigits = (acct) => acct.readDigits ?? minorDigits(acct.currency);

/**
 * The files in a zip, as { name, path, bytes }: the file's own name, and its place in the zip.
 * Stored and deflated entries, read through the browser's own DecompressionStream (Node's too),
 * so no library is needed. Folders and the Mac's __MACOSX copies are skipped.
 */
export async function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('not a zip');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = [];
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('zip directory unreadable');
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || name.split('/').pop().startsWith('._')) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) files.push({ name: name.split('/').pop(), path: name, bytes: data });
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      files.push({ name: name.split('/').pop(), path: name, bytes: new Uint8Array(await new Response(stream).arrayBuffer()) });
    }
  }
  return files;
}
