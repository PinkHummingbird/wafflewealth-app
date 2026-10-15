/* WaffleWealth on the web: a statement, confirmed here, as the records the iPhone would keep.

   A port of the app's StatementStore.save, kept to the letter so a statement added on the web
   and one added on the phone are the same rows: for each account chosen, the account it became
   last time (found by its bank reference) or a new one; a balance on each month end inside the
   statement and on its last day, worked out from the opening balance and the lines; the link
   from the bank reference to the account; and every line. Pure: it takes what the page knows
   and returns plain records, so it is tested on its own (web/tests/statement-save.test.mjs).

   Statements come from ../statements/readers.js, which reads the same banks the app reads. */

/** The default for each account read: kept when there is a closing balance, it isn't a deposit
    that has closed, and it isn't an empty account with nothing in it (the app's includedByDefault). */
export function includedByDefault(account) {
  return account.closing != null && !account.closed && !(account.closing === 0 && account.lines.length === 0);
}

const monthOf = (day) => day.slice(0, 7);
const nextMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const lastDayOf = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

/** What the account held, or owed, on each month end strictly inside the statement and on its
    last day: the opening balance moved by every line up to that day. Without an opening balance
    only the closing one is known. Never negative: a card in credit owes nothing. */
export function balancePoints(account, last) {
  const clamp = (v) => Math.max(v, 0);
  const points = [];
  const dates = account.lines.map((l) => l.date).filter(Boolean).sort();
  if (account.opening != null && dates.length) {
    for (let month = monthOf(dates[0]); month < monthOf(last); month = nextMonth(month)) {
      const end = lastDayOf(month);
      const moved = account.lines.filter((l) => (l.date ?? last) <= end).reduce((t, l) => t + l.amount, 0);
      points.push({ date: end, value: clamp(account.owed ? account.opening - moved : account.opening + moved) });
    }
  }
  if (account.closing != null) points.push({ date: last, value: clamp(account.closing) });
  return points;
}

/** A rate as the app stores one: a plain decimal string, or null when there is none worth keeping. */
function plainRate(text) {
  const t = String(text ?? '').replace(/%/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '').replace(/^0+(?=\d)/, '') : t.replace(/^0+(?=\d)/, '');
  return Number(v) > 0 ? v : null;
}

/** The account's interest, paid out as cash: monthly for savings, yearly for a deposit. */
function income(account) {
  const rate = account.owed ? null : plainRate(account.ratePct);
  if (!rate) return { income_basis: null, income_rate_pct: null, income_amount_minor: null, income_frequency: null, income_reinvested: 0 };
  return { income_basis: 'RATE', income_rate_pct: rate, income_amount_minor: null,
    income_frequency: account.type === 'deposit' ? 'ANNUAL' : 'MONTHLY', income_reinvested: 0 };
}

/** A deposit that ends after this month is out of reach until the month it ends. */
function availableFromMonth(account, today) {
  if (account.owed || account.type !== 'deposit' || !account.closes) return null;
  return monthOf(account.closes) > monthOf(today) ? monthOf(account.closes) : null;
}

/**
 * The records for one statement.
 *
 * - `statement`: as readers.js returns it, its lines labelled (labelLines).
 * - `choices`: one per account, `{ include, name }`, in the statement's order.
 * - `sha256`: the file's fingerprint, made as the app makes it.
 * - `known`: what's already in iCloud: `accountByRef(ref)` → an Account record or null,
 *   `nextDisplayOrder` → the number after the highest account's.
 * - `uuid()`, `now` (ISO timestamp), `today` (YYYY-MM-DD).
 *
 * Returns `{ records, created, updated, balances, lines }`. Records are { name, type, f }.
 */
export function recordsForStatement({ statement, choices, sha256, known, uuid, now, today }) {
  const records = [];
  const statementId = uuid();
  records.push({ name: statementId, type: 'Statement', f: {
    reader: statement.reader ?? 'General', institution: statement.institution ?? null, file_name: statement.fileName ?? null,
    file_sha256: sha256, period_from: statement.period?.from ?? null, period_to: statement.period?.to ?? null, read_at: now,
  } });
  const result = { records, created: [], updated: [], balances: 0, lines: 0 };
  let order = known.nextDisplayOrder;
  statement.accounts.forEach((account, index) => {
    const choice = choices[index];
    if (!choice || !choice.include) return;
    const lastLine = account.lines.length ? account.lines[account.lines.length - 1].date : null;
    const asOf = statement.period?.to ?? lastLine;
    if (!account.currency || !asOf) return;
    const points = balancePoints(account, asOf);
    if (!points.length) return;
    const existing = account.ref ? known.accountByRef(account.ref) : null;
    const balance = (accountId, point) => ({ name: uuid(), type: 'Balance', f: {
      account_id: accountId, value_minor: point.value, as_of_date: point.date, source: 'STATEMENT', created_at: now,
    } });
    let accountId;
    if (existing) {
      accountId = existing.name;
      for (const point of points) records.push(balance(accountId, point));
      result.updated.push(existing.f.name);
    } else {
      accountId = uuid();
      const name = String(choice.name ?? account.name).trim();
      records.push({ name: accountId, type: 'Account', f: {
        name, kind: account.owed ? 'LIABILITY' : 'ASSET', currency_code: account.currency, is_invested: 0,
        display_order: order++, archived_at: null, created_at: now, category: null,
        ...income(account), available_from_age: null, available_from_month: availableFromMonth(account, today),
      } });
      for (const point of points) records.push(balance(accountId, point));
      if (account.ref) {
        records.push({ name: `statement-account-${accountId}`, type: 'StatementAccount', f: { ref: account.ref, created_at: now } });
      }
      result.created.push(name);
    }
    result.balances += points.length;
    account.lines.forEach((line, position) => {
      records.push({ name: uuid(), type: 'StatementLine', f: {
        statement_id: statementId, account_id: accountId, position, posted_on: line.date ?? null, made_on: line.madeOn ?? null,
        description: line.description, amount_minor: line.amount, running_minor: line.running ?? null, ref: line.ref ?? null,
        line_kind: line.label ?? null, foreign_currency: line.foreign?.currency ?? null, foreign_minor: line.foreign?.amount ?? null,
      } });
    });
    result.lines += account.lines.length;
  });
  return result;
}

/** What makes a file the same file, as the app reckons it: the bytes, and for a CSV its name
    too (Wise's empty currency files are identical byte for byte and differ only in name). */
export async function fingerprint(name, bytes, subtle = globalThis.crypto.subtle) {
  const identity = /\.csv$/i.test(name)
    ? new Uint8Array([...new TextEncoder().encode(name), ...bytes])
    : bytes;
  const digest = new Uint8Array(await subtle.digest('SHA-256', identity));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}
