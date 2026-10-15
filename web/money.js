/* WaffleWealth on the web: money, dates and categories.
   The app's rules, in the browser: an amount is a whole number of the currency's smallest unit
   (cents, fils), never a fraction of a float; a currency has the decimals Intl says it has, the
   same table the iPhone uses; a date is a calendar day, YYYY-MM-DD, with no time zone. */
(function () {
  "use strict";

  const scaleCache = new Map();

  /** How many decimals a currency is written with: 2 for USD, 0 for JPY, 3 for KWD. */
  function scale(code) {
    if (scaleCache.has(code)) return scaleCache.get(code);
    let digits = 2;
    try {
      digits = new Intl.NumberFormat("en-US", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits;
    } catch (e) { /* an unknown code keeps two */ }
    scaleCache.set(code, digits);
    return digits;
  }

  /** Every currency the browser knows, with the nine the app leads with first. */
  function currencies() {
    const lead = ["AED", "USD", "SGD", "EUR", "GBP", "HKD", "CAD", "IDR", "JPY"];
    let all = [];
    try { all = Intl.supportedValuesOf("currency"); } catch (e) { all = []; }
    const rest = all.filter((c) => !lead.includes(c)).sort();
    return lead.concat(rest);
  }

  function currencyName(code) {
    try { return new Intl.DisplayNames(["en"], { type: "currency" }).of(code) || code; } catch (e) { return code; }
  }

  /** Text typed into an amount field → minor units, or a reason it isn't one.
      "1,234.5" in USD → { ok: true, minor: 123450 }. Grouping commas and spaces are ignored;
      more decimals than the currency has is refused rather than rounded. */
  function parseAmount(text, code) {
    const digits = scale(code);
    const cleaned = String(text || "").replace(/[\s,  ']/g, "");
    if (cleaned === "") return { ok: false, reason: "empty" };
    if (!/^\d*(\.\d*)?$/.test(cleaned) || cleaned === ".") return { ok: false, reason: "Type a number, like 1,250.00." };
    const [whole, fraction = ""] = cleaned.split(".");
    if (fraction.length > digits) {
      return { ok: false, reason: digits === 0 ? `${code} has no decimals.` : `${code} takes at most ${digits} decimal${digits === 1 ? "" : "s"}.` };
    }
    const minorText = (whole || "0") + fraction.padEnd(digits, "0");
    const big = BigInt(minorText);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, reason: "That's larger than WaffleWealth can hold." };
    return { ok: true, minor: Number(big) };
  }

  /** Minor units → "1,234.50", grouped, with exactly the currency's decimals. */
  function plain(minor, code) {
    const digits = scale(code);
    const negative = minor < 0;
    const text = String(Math.abs(Math.trunc(minor))).padStart(digits + 1, "0");
    const whole = digits ? text.slice(0, -digits) : text;
    const fraction = digits ? text.slice(-digits) : "";
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (negative ? "-" : "") + grouped + (digits ? "." + fraction : "");
  }

  /** "USD 1,234.50", as the app writes a figure. */
  function format(minor, code) {
    const text = plain(minor, code);
    return text.startsWith("-") ? `\u2212${code}\u00A0${text.slice(1)}` : `${code}\u00A0${text}`;
  }

  /** "+USD 1,234.50" or "−USD 1,234.50". */
  function formatSigned(minor, code) {
    return minor > 0 ? "+" + format(minor, code) : format(minor, code);
  }

  /** Minor units → the text an amount field shows when editing: "1250.5" → "1,250.50". */
  function editable(minor, code) { return plain(Math.abs(minor), code); }

  /** Today on this computer, as a calendar day. */
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function isDay(text) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const [y, m, d] = text.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /** "2026-09-03" → "3 Sep 2026". */
  function dayLabel(text) {
    if (!isDay(text)) return text || "";
    const [y, m, d] = text.split("-").map(Number);
    return `${d} ${shortMonths[m - 1]} ${y}`;
  }

  /** "2026-09" → "September 2026". */
  function monthLabel(ym) {
    const [y, m] = ym.split("-").map(Number);
    return `${monthNames[m - 1]} ${y}`;
  }

  /** The app's own timestamp: ISO 8601 with milliseconds, in UTC. */
  function stamp(date) { return (date || new Date()).toISOString(); }

  /** A new record name, as the app makes them: a lowercase UUID. */
  function uuid() {
    if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID().toLowerCase();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function bytes(count) {
    if (count < 1024) return `${count} bytes`;
    if (count < 1024 * 1024) return `${Math.round(count / 1024)} KB`;
    return `${(count / (1024 * 1024)).toFixed(1)} MB`;
  }

  /* The app's categories for money in and money out (PlannedCategories in the app's code).
     A label and nothing more: nothing in WaffleWealth's arithmetic reads one. */
  const categories = {
    in: [
      ["P_SALARY", "Salary & wages"], ["P_BONUS", "Bonus"], ["P_SEVERANCE", "Severance & gratuity"],
      ["P_DIVIDEND", "Dividend & interest"], ["P_RENTAL", "Rental income"], ["P_SALE", "Something sold"],
      ["P_MATURITY", "Deposit maturing"], ["P_REFUND", "Refund & rebate"], ["P_GIFT_IN", "Gift & inheritance"],
      ["P_OTHER_IN", "Other"],
    ],
    out: [
      ["P_RENT", "Rent"], ["P_MORTGAGE", "Mortgage payment"], ["P_HOME", "Home & repairs"],
      ["P_UTILITIES", "Bills & utilities"], ["P_SCHOOL", "Tuition & school"], ["P_FAMILY", "Family support"],
      ["P_INSURANCE", "Insurance"], ["P_TAX", "Tax"], ["P_LOAN", "Loan repayment"], ["P_CAR", "Car"],
      ["P_TRAVEL", "Travel & holiday"], ["P_MEDICAL", "Medical"], ["P_EVENT", "Wedding & big day"],
      ["P_SUBSCRIPTION", "Subscription"], ["P_GIFT_OUT", "Gift & giving"], ["P_OTHER_OUT", "Other"],
    ],
  };

  function categoryName(key) {
    for (const list of [categories.in, categories.out]) {
      const hit = list.find(([k]) => k === key);
      if (hit) return hit[1];
    }
    return null;
  }

  /** A percentage as typed ("5", "3.5", "-1", "5 %") → the plain decimal string the app stores.
      Up to four decimals, above -100 and at most 100. */
  function parsePercent(text) {
    const cleaned = String(text ?? "").replace(/%/g, "").replace(/\s+/g, "");
    if (!cleaned) return { ok: true, value: "0" };
    if (!/^-?\d{1,3}(\.\d{1,4})?$/.test(cleaned)) return { ok: false, reason: "Type a number, like 5 or 3.5." };
    const n = Number(cleaned);
    if (n <= -100 || n > 100) return { ok: false, reason: "Use a figure between -100 and 100." };
    // The app's own form: no leading zeros, no trailing ones after the point.
    let value = cleaned.replace(/^(-?)0+(\d)/, "$1$2");
    if (value.includes(".")) value = value.replace(/0+$/, "").replace(/\.$/, "");
    if (value === "-0") value = "0";
    return { ok: true, value };
  }

  globalThis.WWMoney = {
    parsePercent,
    scale, currencies, currencyName, parseAmount, plain, format, formatSigned, editable,
    today, isDay, dayLabel, monthLabel, stamp, uuid, bytes, categories, categoryName,
  };
})();
