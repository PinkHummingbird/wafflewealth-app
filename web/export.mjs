/* WaffleWealth on the web: saving your figures as files, in the app's own formats.

   - The spreadsheet of balances (the app's CSVExport): one row per balance not taken back, the
     account's facts first, CRLF line ends, and a cell that looks like a formula guarded with '.
   - Everything as a file (the app's ExportSnapshot, format "wafflewealth", version 5): pretty,
     sorted keys, as the app's JSONEncoder writes it.
   - The encrypted copy (the app's EncryptedBackup): "WWBK", version 1, PBKDF2-HMAC-SHA256 rounds
     (600,000) big-endian, a 16-byte salt, then AES-256-GCM as nonce, ciphertext and tag. Made
     here in the browser with its own cryptography; the passphrase never leaves the page.

   Pure: each takes plain records ({ name, type, f }) and returns text or bytes, so it is tested
   on its own (web/tests/export.test.mjs). */

const CSV_HEADER = ["account", "kind", "category", "currency", "invested", "income_basis", "income_rate_pct", "income_amount",
  "income_frequency", "income_reinvested", "available_from_age", "available_from_month", "archived_at", "value", "as_of_date", "source", "recorded_at"];

const FORMULA = new Set(["=", "+", "-", "@", "\t", "\r"]);
export function quoted(field) {
  const text = field && FORMULA.has(field[0]) ? `'${field}` : field;
  return /[,"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Minor units as a plain amount: "-1234.50". */
export function plainAmount(minor, scale) {
  const v = BigInt(minor), neg = v < 0n, digits = String(neg ? -v : v).padStart(scale + 1, "0");
  const text = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  return neg ? `-${text}` : text;
}

/**
 * What the export reads, from iCloud's records: { exportedAt, assumptions, currencies, fxRates,
 * accounts, balances, plannedItems, target }, ordered as the app orders them.
 * - records: every record of the zone; scaleOf(code), nameOf(code) for the currencies.
 */
export function snapshot(records, { now, scaleOf, nameOf }) {
  const of = (type) => records.filter((r) => r.type === type);
  const withdrawn = new Set(of("BalanceWithdrawal").map((w) => w.name.replace(/^withdrawal-/, "")));
  const a = (records.find((r) => r.name === "assumptions-1") || { f: {} }).f;
  const accounts = of("Account").sort((x, y) => (Number(x.f.display_order) - Number(y.f.display_order)) || String(x.f.created_at).localeCompare(String(y.f.created_at)));
  const balances = of("Balance").filter((b) => !withdrawn.has(b.name))
    .sort((x, y) => String(x.f.account_id).localeCompare(String(y.f.account_id)) || String(y.f.as_of_date).localeCompare(String(x.f.as_of_date)) || String(y.f.created_at).localeCompare(String(x.f.created_at)));
  const rates = of("FXRate").sort((x, y) => x.name.localeCompare(y.name));
  const codes = new Set([a.base_currency_code, ...accounts.map((x) => x.f.currency_code), ...rates.map((r) => r.name.replace(/^rate-/, "")),
    ...of("PlannedItem").map((p) => p.f.currency_code).filter(Boolean)].filter(Boolean));
  const target = records.find((r) => r.name === "target-1");
  const n = (v) => (v == null ? null : Number(v));
  return {
    format: "wafflewealth", version: 5, exported_at: now,
    assumptions: {
      id: 1, base_currency_code: a.base_currency_code, monthly_income_minor: n(a.monthly_income_minor), monthly_spending_minor: n(a.monthly_spending_minor),
      annual_raise_pct: a.annual_raise_pct, raise_effective_month: n(a.raise_effective_month), annual_spending_growth_pct: a.annual_spending_growth_pct,
      annual_return_pct: a.annual_return_pct, annual_withdrawal_pct: a.annual_withdrawal_pct || "4", horizon_months: n(a.horizon_months),
      fx_auto_refresh: false, fx_refreshed_at: null, birth_year: n(a.birth_year), birth_month: n(a.birth_month), income_day: n(a.income_day),
      fire_interest_pct: a.fire_interest_pct ?? null, fire_growth_pct: a.fire_growth_pct ?? null, updated_at: a.updated_at,
    },
    currencies: [...codes].map((code, i) => ({ code, name: nameOf(code), minor_unit_scale: scaleOf(code), display_order: i })),
    fx_rates: rates.map((r) => ({ quote_code: r.name.replace(/^rate-/, ""), rate: String(r.f.rate), source: r.f.source || "MANUAL", updated_at: r.f.updated_at })),
    accounts: accounts.map((x) => ({
      id: x.name, name: x.f.name, kind: x.f.kind, currency_code: x.f.currency_code, is_invested: Number(x.f.is_invested) === 1,
      category: x.f.category ?? null, income_basis: x.f.income_basis ?? null, income_rate_pct: x.f.income_rate_pct ?? null,
      income_amount_minor: n(x.f.income_amount_minor), income_frequency: x.f.income_frequency ?? null,
      available_from_age: n(x.f.available_from_age), available_from_month: x.f.available_from_month ?? null,
      income_reinvested: Number(x.f.income_reinvested) === 1, display_order: n(x.f.display_order), archived_at: x.f.archived_at ?? null, created_at: x.f.created_at,
    })),
    balances: balances.map((b) => ({ id: b.name, account_id: b.f.account_id, value_minor: n(b.f.value_minor), as_of_date: b.f.as_of_date, source: b.f.source, created_at: b.f.created_at })),
    planned_items: of("PlannedItem").sort((x, y) => String(x.f.first_date).localeCompare(String(y.f.first_date))).map((p) => ({
      id: p.name, name: p.f.name, direction: p.f.direction, amount_minor: n(p.f.amount_minor), currency_code: p.f.currency_code ?? null, category: p.f.category ?? null,
      first_date: p.f.first_date, frequency: p.f.frequency, ends_on: p.f.ends_on ?? null, archived_at: p.f.archived_at ?? null,
      display_order: n(p.f.display_order), created_at: p.f.created_at, growth_pct: p.f.growth_pct || "0",
    })),
    target: target ? { id: 1, amount_minor: n(target.f.amount_minor), basis: target.f.basis, by_month: target.f.by_month ?? null, created_at: target.f.created_at, updated_at: target.f.updated_at } : null,
  };
}

/** The balances spreadsheet, as the app writes it. `categoryName(key)` names a category. */
export function csv(snap, categoryName) {
  const scales = new Map(snap.currencies.map((c) => [c.code, c.minor_unit_scale]));
  const lines = [CSV_HEADER.map(quoted).join(",")];
  for (const a of snap.accounts) {
    const scale = scales.get(a.currency_code) ?? 2;
    const head = [a.name, a.kind, (a.category && categoryName(a.category)) || a.category || "", a.currency_code, a.is_invested ? "true" : "false",
      a.income_basis || "", a.income_rate_pct || "", a.income_amount_minor == null ? "" : plainAmount(a.income_amount_minor, scale), a.income_frequency || "",
      a.income_basis == null ? "" : a.income_reinvested ? "true" : "false", a.available_from_age == null ? "" : String(a.available_from_age),
      a.available_from_month || "", a.archived_at || ""];
    for (const b of snap.balances.filter((x) => x.account_id === a.id)) {
      lines.push([...head, plainAmount(b.value_minor, scale), b.as_of_date, b.source, b.created_at].map(quoted).join(","));
    }
  }
  return lines.join("\r\n") + "\r\n";
}

/** JSON as the app's encoder writes it: two-space indent, " : ", keys sorted, slashes as they are. */
export function json(value, indent = "") {
  const inner = indent + "  ";
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length ? `[\n${value.map((v) => inner + json(v, inner)).join(",\n")}\n${indent}]` : "[\n\n" + indent + "]";
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return keys.length ? `{\n${keys.map((k) => `${inner}${JSON.stringify(k)} : ${json(value[k], inner)}`).join(",\n")}\n${indent}}` : "{\n\n" + indent + "}";
  }
  return JSON.stringify(value);
}

export const ROUNDS = 600_000;

/** The encrypted copy: bytes the app's EncryptedBackup.open reads. */
export async function seal(text, passphrase, { subtle = globalThis.crypto.subtle, random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)), rounds = ROUNDS } = {}) {
  if ([...passphrase].length < 8) throw new Error("At least 8 characters.");
  const salt = random(16), nonce = random(12);
  const material = await subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle.deriveKey({ name: "PBKDF2", salt, iterations: rounds, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, new TextEncoder().encode(text)));
  const out = new Uint8Array(4 + 1 + 4 + 16 + 12 + sealed.length);
  out.set(new TextEncoder().encode("WWBK"), 0);
  out[4] = 1;
  new DataView(out.buffer).setUint32(5, rounds, false);
  out.set(salt, 9);
  out.set(nonce, 25);
  out.set(sealed, 37);
  return out;
}
