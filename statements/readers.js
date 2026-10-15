// Reads bank statements from the text a PDF already holds. Pure functions: no network, no
// storage, no PDF library. The page hands in text items with positions (from PDF.js), this
// file rebuilds the rows a person sees, and a reader for the bank turns them into accounts,
// balances and lines. Amounts are whole numbers of the currency's smallest unit, never floats.

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
const ZERO_DIGITS = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'PYG', 'XAF', 'XOF']);
const THREE_DIGITS = new Set(['BHD', 'KWD', 'OMR', 'JOD', 'TND', 'LYD', 'IQD']);
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
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
    const [a, b] = dayFirst ? [+m[1], +m[2]] : [+m[2], +m[1]];
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return b >= 1 && b <= 12 && a >= 1 && a <= 31 ? iso(y, b, a) : null;
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
  let previous = acct.opening;
  acct.lines.forEach((line, index) => {
    if (line.running == null || previous == null) { previous = line.running ?? null; return; }
    const after = acct.owed ? previous - line.amount : previous + line.amount;
    if (after !== line.running) messages.push({ kind: 'line', index, expected: after, got: line.running });
    previous = line.running;
  });
  const checked = expected != null && acct.closing != null;
  return { ok: checked && messages.length === 0, checked, sum, expected, messages };
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

const GeneralTable = {
  id: 'General',
  institution: null,
  country: null,
  recognises: () => true,
  read(pages) {
    const rows = allRows(pages);
    const all = text(rows);
    const full = all.match(/\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)? [A-Za-z]{3,9} \d{4}|[A-Za-z]{3,9} \d{1,2}, \d{4})\b/g) ?? [];
    const dates = full.map((d) => parseDate(d)).filter(Boolean).sort();
    const to = dates[dates.length - 1] ?? null;
    const year = to ? +to.slice(0, 4) : null;
    const codes = (all.match(new RegExp(ISO.source, 'g')) ?? []);
    const counts = codes.reduce((m, c) => m.set(c, (m.get(c) ?? 0) + 1), new Map());
    const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const digits = minorDigits(currency);
    // A card statement prints what you spend as a plain figure: that is money out, and what
    // the statement calls the balance is what you owe.
    const owed = /minimum payment|credit limit|card limit/i.test(all);

    let columns = null;
    let lastRow = null;
    let opening = null;
    let closingStated = null;
    const lines = [];
    let headerUntil = -1;
    let firstHeader = null;
    rows.forEach((row, index) => {
      const c = row.cells;
      // A header can stand on two or three rows ("Amount" over "(Incl. VAT)" beside "Date"):
      // its words are gathered from the rows within a line's height of this one.
      const near = rows.filter((r, j) => Math.abs(j - index) <= 3 && Math.abs(r.y - row.y) <= 14 && r.page === row.page);
      const found = {};
      for (const cell of near.flatMap((r) => r.cells)) {
        for (const [key, re] of Object.entries(HEADER)) if (!found[key] && re.test(cell.s)) found[key] = cell;
      }
      if (found.date && found.description && (found.amount || found.out || found.in)) {
        columns = found;
        if (firstHeader == null) firstHeader = Math.min(...near.map((r) => rows.indexOf(r)));
        headerUntil = Math.max(...near.map((r) => rows.indexOf(r)));
        return;
      }
      if (index <= headerUntil) return;
      if (/opening balance|balance b\/f|brought forward|previous balance|balance previous statement/i.test(row.text)) {
        const v = parseAmount(c[c.length - 1].s, digits);
        if (v != null && opening == null) opening = v;
        return;
      }
      if (/closing balance|balance c\/f|carried forward|grand total|new balance/i.test(row.text)) {
        const v = parseAmount(c[c.length - 1].s, digits);
        if (v != null) closingStated = v;
        return;
      }
      if (!columns) return;
      const date = parseDate(c[0].s, { year, before: to });
      const figures = c.filter((x) => isAmount(x.s) && x.x >= (columns.description?.x2 ?? columns.date.x2));
      if (!date || !figures.length) {
        // Words just under a line, in the description's column, carry its description on.
        const lastLine = lines[lines.length - 1];
        const under = lastRow && lastRow.page === row.page && lastRow.y - row.y < 30
          && Math.abs(c[0].x - (columns.description?.x ?? c[0].x)) < 20;
        if (lastLine && under && !figures.length) { lastLine.description += ' · ' + cellsText(c); lastRow = row; }
        return;
      }
      const madeOn = c[1] ? parseDate(c[1].s, { year, before: to }) : null;
      // Each figure goes to the column it sits nearest, and only when it sits near one: print
      // in a margin, or a number in a merchant's name, is left alone. Two in one column: the
      // nearer wins.
      const distance = (cell, col) => Math.abs((col.x + col.x2) / 2 - (cell.x + cell.x2) / 2);
      const taken = {};
      for (const f of figures) {
        const [key, col] = Object.entries(columns)
          .filter(([k]) => ['amount', 'out', 'in', 'balance'].includes(k))
          .sort(([, a], [, b]) => distance(f, a) - distance(f, b))[0] ?? [];
        if (!key || distance(f, col) > 45) continue;
        if (!taken[key] || distance(f, col) < distance(taken[key], col)) taken[key] = f;
      }
      let amount = null;
      let running = null;
      for (const [key, f] of Object.entries(taken)) {
        const v = parseAmount(f.s, digits);
        if (key === 'balance') running = v;
        else if (key === 'out') amount = -Math.abs(v);
        else if (key === 'in') amount = Math.abs(v);
        else if (key === 'amount') amount = owed ? -v : /DR$/i.test(f.s) ? -Math.abs(v) : v;
      }
      if (amount == null) return;
      const before = lines.length ? lines[lines.length - 1].running : opening;
      if (!owed && running != null && before != null && before + amount !== running && before - amount === running) amount = -amount;
      lines.push(line({
        date, madeOn,
        description: cellsText(c.filter((x) => !Object.values(taken).includes(x) && x.x2 <= Math.max(...Object.values(columns).map((k) => k.x2)) + 10).slice(madeOn ? 2 : 1)),
        amount, running,
      }));
      lastRow = row;
    });
    const closing = closingStated ?? (lines.length ? lines[lines.length - 1].running : null);
    if (opening == null && lines[0]?.running != null) opening = lines[0].running - (owed ? -lines[0].amount : lines[0].amount);
    // Named from what sits above the table: the bank and the number's last four (owner's ruling,
    // 15 October 2026), so next month's statement from the same account finds it again.
    const top = rows.slice(0, firstHeader ?? 15);
    const bank = bankName(top);
    const number = accountNumber(top);
    const named = bank ? (owed ? `${bank} card` : bank) : (owed ? 'Card' : 'Account');
    const acct = account({
      ref: bank && number ? `General:${bank.toLowerCase()}:${last4(number)}` : null,
      number, numbers: number ? [number] : [],
      name: number ? `${named} ·· ${last4(number)}` : named,
      type: owed ? 'card' : 'current', owed, currency, opening, closing, lines,
      notes: ['read as a plain table: check each line'],
    });
    const from = [dates[0], lines[0]?.date].filter(Boolean).sort()[0] ?? null;
    return { holder: null, period: { from, to }, accounts: lines.length ? [acct] : [], institution: bank };
  },
};

export const READERS = [UAEWio, UAEEmiratesIslamic, SGCitibank, SGUOB];
export { GeneralTable };

// ---------------------------------------------------------------------------------------------
// Reading a statement, and seeing it beside the others

/** Pages of rows → one statement: who read it, the holder, the period, the accounts. */
export function readStatement(pages, { fileName = null } = {}) {
  const hasText = pages.some((rows) => rows.length > 0);
  if (!hasText) return { reader: null, picture: true, fileName, accounts: [] };
  const reader = READERS.find((r) => r.recognises(pages)) ?? GeneralTable;
  const read = reader.read(pages);
  for (const a of read.accounts) a.check = check(a);
  return {
    reader: reader.id, institution: read.institution ?? reader.institution, country: reader.country, general: reader === GeneralTable,
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
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency));
}

// ---------------------------------------------------------------------------------------------
// CSV files, and the zips they come in

/** CSV text → rows of fields. Quotes, doubled quotes inside them, and line breaks in a quoted field. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const t = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
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

export const CSV_READERS = [INTLWise];

/** One CSV file → one statement, or a statement with no accounts when no reader knows it. */
export function readCsvStatement(text, { fileName = null } = {}) {
  const rows = parseCsv(text);
  const reader = rows.length ? CSV_READERS.find((r) => r.recognises(rows[0])) : null;
  if (!reader) return { reader: null, fileName, accounts: [], unknownCsv: true };
  const read = reader.read(rows, fileName);
  for (const a of read.accounts) {
    a.check = check(a);
    // No lines: nothing to check and no balance known. Not a failure; not a pass either.
    if (!a.lines.length) a.check = { ok: false, checked: false, sum: 0, expected: null, messages: [] };
  }
  return {
    reader: reader.id, institution: reader.institution, country: reader.country, general: false,
    fileName, holder: read.holder, period: read.period, accounts: read.accounts,
  };
}

/**
 * The files in a zip, as { name, bytes }. Stored and deflated entries, read through the
 * browser's own DecompressionStream (Node's too), so no library is needed. Folders and the
 * Mac's __MACOSX copies are skipped.
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
    if (method === 0) files.push({ name: name.split('/').pop(), bytes: data });
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      files.push({ name: name.split('/').pop(), bytes: new Uint8Array(await new Response(stream).arrayBuffer()) });
    }
  }
  return files;
}
