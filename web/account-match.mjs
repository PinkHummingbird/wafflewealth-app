/* WaffleWealth on the web: which of your accounts a statement account is, the app's AccountMatch.

   For an account made by hand before its first statement: the review pre-selects the best guess,
   and you can always choose a new account instead. Nothing is joined until you add the statement.

   - choosable: the accounts it may go into (StatementStore.choosable): not archived, the same
     currency, the same kind (a card or anything owed goes to what you owe), not already linked to
     a statement account; in the accounts' own order.
   - rank: each signal adds points and says why. The name's last four digits (3), a balance the
     statement also shows (3), the bank's name (2), the kind of account (1), else a balance within a
     tenth of the statement's (1), the only one (1).
   - preselected: the top one when it scores 3 or more and leads the next by 2 or more.

   Words are ASCII letters and digits, any case. Amounts are BigInt. Checked against the app's own
   answers in web/tests/account-match.test.mjs. */

const POINTS = { endsIn: 3, balanceMatches: 3, bank: 2, type: 1, balanceClose: 1, onlyOne: 1 };
const STOP = new Set(["BANK", "BANKING", "THE", "AND", "LTD", "PLC", "INC", "LIMITED", "GROUP", "CORP",
  "PJSC", "BHD", "BERHAD", "UAE", "INTL", "GENERAL", "OFX"]);
const TYPE_WORDS = {
  card: ["CARD", "CREDIT"], savings: ["SAVING", "SAVINGS", "SAVER"],
  deposit: ["DEPOSIT", "FIXED", "TERM"], current: ["CURRENT", "CHECKING", "CHEQUE"],
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const words = (text) => String(text ?? "").split(/[^A-Za-z0-9]+/).filter(Boolean);
const lastFour = (s) => String(s ?? "").replace(/[^0-9]/g, "").slice(-4);
const big = (v) => (v == null ? null : BigInt(v));
const abs = (v) => (v < 0n ? -v : v);

/** The words a reason is shown in. */
export function reasonText(r) {
  switch (r.kind) {
    case "endsIn": return `Ends in ${r.value}`;
    case "bank": return `Name has ${r.value}`;
    case "type": return `Name says ${r.value}`;
    case "balanceMatches": return `Balance on ${Number(r.value.slice(8))} ${MONTHS[Number(r.value.slice(5, 7)) - 1]} matches`;
    case "balanceClose": return "Balance is close";
    case "onlyOne": return `Your only ${r.value} account`;
    default: return "";
  }
}

/**
 * The accounts a statement account may go into.
 * - accounts: [{ id, name, kind, currency, displayOrder, archived, linked, latest: { value, date } | null }]
 */
export function choosable(account, accounts) {
  if (!account.currency) return [];
  const kind = account.owed ? "LIABILITY" : "ASSET";
  return accounts
    .filter((a) => !a.archived && !a.linked && a.currency === account.currency && a.kind === kind)
    .sort((a, b) => (Number(a.displayOrder) - Number(b.displayOrder)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** What the statement says the account held, or owed, at the end of `day` (BigInt), or null. */
export function balanceOn(account, day, last) {
  if (day >= last && account.closing != null) return big(account.closing);
  if (account.opening == null) return null;
  const moved = account.lines.filter((l) => (l.date ?? last) <= day).reduce((s, l) => s + BigInt(l.amount), 0n);
  return account.owed ? big(account.opening) - moved : big(account.opening) + moved;
}

const close = (value, figure) => abs(value - figure) <= abs(figure) / 10n;

/**
 * Best first; ties keep the order given. `among` are the accounts that can be chosen.
 * Returns [{ account, score, reasons: [{ kind, value? }] }].
 */
export function rank(account, statement, among) {
  const endings = [...new Set([account.number, ...(account.numbers || [])].map(lastFour).filter((e) => e.length === 4))].sort();
  const bankWords = words(statement.institution ?? statement.reader)
    .filter((w) => w.length >= 3 && /^[A-Za-z]+$/.test(w) && !STOP.has(w.toUpperCase()));
  const dated = account.lines.map((l) => l.date).filter(Boolean).sort();
  const from = statement.period?.from ?? dated[0] ?? null;
  const to = statement.period?.to ?? (account.lines.length ? account.lines[account.lines.length - 1].date : null) ?? null;
  const typeWords = TYPE_WORDS[account.type] || [];
  const scored = among.map((candidate, index) => {
    const name = words(candidate.name);
    const upper = new Set(name.map((w) => w.toUpperCase()));
    const reasons = [];
    const ending = endings.find((e) => name.some((w) => /^[0-9]+$/.test(w) && w.endsWith(e)));
    if (ending) reasons.push({ kind: "endsIn", value: ending });
    const word = bankWords.find((w) => upper.has(w.toUpperCase()));
    if (word) reasons.push({ kind: "bank", value: word });
    if (typeWords.some((w) => upper.has(w))) reasons.push({ kind: "type", value: account.type });
    const latest = candidate.latest;
    if (latest) {
      const value = BigInt(latest.value);
      const held = from && to && from <= latest.date && latest.date <= to ? balanceOn(account, latest.date, to) : null;
      if (held != null && held === value) reasons.push({ kind: "balanceMatches", value: latest.date });
      else if ([account.opening, account.closing].some((f) => f != null && close(value, BigInt(f)))) reasons.push({ kind: "balanceClose" });
    }
    if (among.length === 1) reasons.push({ kind: "onlyOne", value: candidate.currency });
    return { account: candidate, score: reasons.reduce((s, r) => s + POINTS[r.kind], 0), reasons, index };
  });
  return scored.sort((a, b) => (b.score - a.score) || (a.index - b.index)).map(({ index, ...c }) => c);
}

/** The accounts this statement account could go into, best first. */
export function candidates(account, statement, accounts) {
  return rank(account, statement, choosable(account, accounts));
}

/** The account id to pre-select, or null for a new account. */
export function preselected(list) {
  const [top, next] = list;
  if (!top || top.score < 3) return null;
  if (next && top.score - next.score < 2) return null;
  return top.account.id;
}

/** For the accounts of one statement in order: an account pre-selected once isn't again. */
export function preselectedFor(lists) {
  const taken = new Set();
  return lists.map((list) => {
    const id = preselected(list);
    if (!id || taken.has(id)) return null;
    taken.add(id);
    return id;
  });
}
