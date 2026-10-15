/* WaffleWealth on the web: the records, and where they live.
   With iCloud, they live in the user's own private CloudKit database, in the zone the iPhone
   app keeps in step ("WaffleWealth"), reached through Apple's CloudKit JS after the user signs
   in with their Apple ID. This site has no server: the page talks to Apple and nothing else.
   For "Look around", they live in this tab's memory and are made up.

   A record here is plain: { name, type, tag, f: { column: value }, file }. Field names are the
   app's own column names. iCloud has no null, so the columns that are empty are named in a
   "nulls" field, exactly as the app writes them. */
(function () {
  "use strict";
  const M = globalThis.WWMoney;

  const ZONE = { zoneName: "WaffleWealth" };
  const INTEGER = new Set([
    "amount_minor", "value_minor", "byte_count", "is_invested", "display_order",
    "income_amount_minor", "income_reinvested", "available_from_age", "parts", "part",
    "monthly_income_minor", "monthly_spending_minor", "raise_effective_month", "horizon_months",
    "birth_year", "birth_month", "income_day", "written_order",
  ]);
  /* Fields held as raw bytes: a piece of a document's file (see `uploadDocument`). */
  const BYTES = new Set(["data"]);
  /* Record types the app keeps as rows, which carry the "nulls" field. A document's pieces are
     not rows anywhere: the iPhone joins them back into the file. */
  const PIECE = "DocumentPart";
  /* One piece of a file: half a megabyte, which is about 700 KB once written as text, well
     inside iCloud's one-megabyte limit for a record. */
  const PIECE_BYTES = 512 * 1024;
  const NULLABLE = {
    Transaction: ["account_id", "category", "note"],
    Document: ["status_note", "status_at", "note"],
    Account: ["archived_at", "category", "income_basis", "income_rate_pct", "income_amount_minor", "income_frequency",
      "available_from_age", "available_from_month"],
    PlannedItem: ["ends_on", "archived_at", "currency_code", "category"],
    Assumptions: ["birth_year", "birth_month", "income_day", "fire_interest_pct", "fire_growth_pct"],
  };
  /* The parts of the assumptions the projection reads: a change to any of them is a new line
     of history, exactly as the app appends one (AssumptionVersion.appendIfChanged). */
  const ENGINE_FIELDS = ["base_currency_code", "monthly_income_minor", "monthly_spending_minor", "annual_raise_pct",
    "raise_effective_month", "annual_spending_growth_pct", "annual_return_pct"];

  /** A plain record → CloudKit JS's shape. */
  function toCloud(record) {
    const fields = {};
    const nulls = [];
    for (const [key, value] of Object.entries(record.f)) {
      if (value === null || value === undefined || value === "") {
        if ((NULLABLE[record.type] || []).includes(key)) nulls.push(key);
        continue;
      }
      fields[key] = INTEGER.has(key) ? { value: Math.trunc(value), type: "INT64" }
        : BYTES.has(key) ? { value: String(value), type: "BYTES" }
        : { value: String(value), type: "STRING" };
    }
    if (record.type !== PIECE) fields.nulls = { value: nulls.sort().join(","), type: "STRING" };
    if (record.upload) fields.file = { value: record.upload };
    const out = { recordType: record.type, recordName: record.name, fields };
    if (record.tag) out.recordChangeTag = record.tag;
    return out;
  }

  /** CloudKit JS's shape → a plain record. */
  function fromCloud(raw) {
    const f = {};
    let file = null;
    for (const [key, field] of Object.entries(raw.fields || {})) {
      if (key === "nulls") continue;
      if (key === "file") { file = field.value || null; continue; }
      f[key] = field.value;
    }
    const nulls = raw.fields && raw.fields.nulls && raw.fields.nulls.value;
    if (nulls) for (const key of String(nulls).split(",")) if (key && !(key in f)) f[key] = null;
    return { name: raw.recordName, type: raw.recordType, tag: raw.recordChangeTag, f, file };
  }

  function codeOf(error) {
    return (error && (error.ckErrorCode || error.serverErrorCode || error.code)) || "";
  }

  /** A sentence for a CloudKit failure, in the page's words. */
  function explain(error) {
    const code = codeOf(error);
    // The whole error, for whoever opens the browser's console; the page shows a sentence.
    if (error && globalThis.console) console.warn("WaffleWealth: iCloud error", code, error);
    switch (code) {
      case "AUTHENTICATION_REQUIRED": case "AUTHENTICATION_FAILED":
        return "You're signed out of iCloud. Sign in again to carry on.";
      case "ACCESS_DENIED": case "NOT_ALLOWED":
        return "iCloud said no. If Advanced Data Protection is on for your Apple ID, turn on “Access iCloud Data on the Web” in your iPhone's Settings › your name › iCloud, then sign in again.";
      case "QUOTA_EXCEEDED":
        return "Your iCloud storage is full, so this can't be saved. Free some space and try again.";
      case "CONFLICT": case "ATOMIC_ERROR":
        return "This changed somewhere else a moment ago. The page has the latest now: please try again.";
      case "UNEXPECTED_SERVER_RESPONSE":
        // Apple's library says this when a file's bytes never reached Apple's storage server:
        // the browser stopped the request before it left. Saving records still works.
        if (/NETWORK_ERROR/.test(String(error && (error.reason || error.message)))) {
          return "The file couldn't reach Apple's storage server, so it wasn't kept. Nothing else is affected: try again in a moment.";
        }
        break;
      case "NETWORK_ERROR": case "SERVICE_UNAVAILABLE": case "THROTTLED": case "TRY_AGAIN_LATER":
        return "iCloud couldn't be reached. Check the connection and try again.";
      case "ZONE_NOT_FOUND":
        return "There's nothing from WaffleWealth in this iCloud yet.";
      default:
        break;
    }
    return "iCloud: " + ((error && (error.reason || error.message)) || "something went wrong") + (code ? ` (${code})` : "");
  }

  /* ---------- the real one: the user's private iCloud ---------- */

  class CloudBackend {
    constructor(config) {
      this.config = config;
      this.kind = "icloud";
    }

    /** Sets CloudKit JS up and finds out whether someone is signed in. Resolves to true or false. */
    async start() {
      const CK = globalThis.CloudKit;
      if (!CK) throw { reason: "Apple's CloudKit script didn't load. Check the connection, or that nothing in the browser blocks it." };
      CK.configure({
        containers: [{
          containerIdentifier: this.config.container,
          apiTokenAuth: {
            apiToken: this.config.apiToken,
            persist: true,
            signInButton: { id: "apple-sign-in-button", theme: "black" },
            signOutButton: { id: "apple-sign-out-button", theme: "white-with-outline" },
          },
          environment: this.config.environment,
        }],
      });
      this.container = CK.getDefaultContainer();
      this.db = this.container.privateCloudDatabase;
      const user = await this.container.setUpAuth();
      return Boolean(user);
    }

    whenSignedIn() { return this.container.whenUserSignsIn(); }
    whenSignedOut() { return this.container.whenUserSignsOut(); }
    async reauth() { return Boolean(await this.container.setUpAuth()); }

    async ensureZone() {
      const response = await this.db.saveRecordZones([ZONE]);
      if (response && response.hasErrors) throw response.errors[0];
    }

    /** Everything in the zone (or everything since `token`). */
    async fetch(token) {
      const changed = [];
      const deleted = [];
      let syncToken = token || undefined;
      for (let round = 0; round < 200; round++) {
        let response;
        try {
          response = await this.db.fetchRecordZoneChanges({ zoneID: ZONE, syncToken });
        } catch (error) {
          if (codeOf(error) === "ZONE_NOT_FOUND") return { changed, deleted, token: null, zoneMissing: true };
          throw error;
        }
        if (response.hasErrors) {
          const error = response.errors[0];
          if (codeOf(error) === "ZONE_NOT_FOUND") return { changed, deleted, token: null, zoneMissing: true };
          throw error;
        }
        const zone = (response.zones || [])[0] || {};
        if (codeOf(zone) === "ZONE_NOT_FOUND") return { changed, deleted, token: null, zoneMissing: true };
        for (const raw of zone.records || []) {
          if (raw.deleted) deleted.push(raw.recordName);
          else changed.push(fromCloud(raw));
        }
        syncToken = zone.syncToken;
        if (!zone.moreComing) break;
      }
      return { changed, deleted, token: syncToken, zoneMissing: false };
    }

    async save(records) {
      const attempt = () => this.db.saveRecords(records.map(toCloud), { zoneID: ZONE });
      let response;
      try {
        response = await attempt();
      } catch (error) {
        if (codeOf(error) !== "ZONE_NOT_FOUND") throw error;
        await this.ensureZone();
        response = await attempt();
      }
      if (response.hasErrors) {
        const error = response.errors[0];
        if (codeOf(error) !== "ZONE_NOT_FOUND") throw error;
        await this.ensureZone();
        response = await attempt();
        if (response.hasErrors) throw response.errors[0];
      }
      return response.records.map(fromCloud);
    }

    async remove(records) {
      const response = await this.db.deleteRecords(
        records.map((r) => (r.tag ? { recordName: r.name, recordChangeTag: r.tag } : { recordName: r.name })), { zoneID: ZONE });
      if (response.hasErrors) throw response.errors[0];
    }

    /** Named records in full, the pieces of a file included. */
    async fetchRecords(names) {
      const response = await this.db.fetchRecords(names.map((recordName) => ({ recordName, zoneID: ZONE })), { zoneID: ZONE });
      if (response.hasErrors) throw response.errors[0];
      return response.records.map(fromCloud);
    }
  }

  /* ---------- the example: made up, in this tab only ---------- */

  class MemoryBackend {
    constructor() {
      this.kind = "example";
      this.rows = new Map();
      this.counter = 1;
      for (const record of exampleRecords()) this.rows.set(record.name, record);
    }
    async start() { return true; }
    async reauth() { return true; }
    whenSignedIn() { return new Promise(() => {}); }
    whenSignedOut() { return new Promise(() => {}); }
    async ensureZone() {}
    async fetch() {
      return { changed: [...this.rows.values()].map((r) => structuredCloneSafe(r)), deleted: [], token: "example", zoneMissing: false };
    }
    async save(records) {
      return records.map((record) => {
        const copy = { name: record.name, type: record.type, tag: `t${this.counter++}`, f: { ...record.f }, file: null };
        const prior = this.rows.get(record.name);
        if (record.upload) {
          copy.file = { downloadURL: URL.createObjectURL(record.upload), size: record.upload.size };
        } else if (prior) {
          copy.file = prior.file;
        }
        this.rows.set(record.name, copy);
        return structuredCloneSafe(copy);
      });
    }
    async remove(records) { for (const r of records) this.rows.delete(r.name); }
    async fetchRecords(names) {
      return names.map((n) => this.rows.get(n)).filter(Boolean).map((r) => structuredCloneSafe(r));
    }
  }

  function structuredCloneSafe(record) {
    return { ...record, f: { ...record.f }, file: record.file ? { ...record.file } : null };
  }

  /** A made-up position like the app's own example: USD, with money in GBP and DKK. */
  function exampleRecords() {
    const now = new Date();
    const day = (offset) => { const d = new Date(now); d.setDate(d.getDate() - offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    const at = (offset) => { const d = new Date(now); d.setDate(d.getDate() - offset); return d.toISOString(); };
    const account = (name, label, kind, code, order, extra) => ({
      name, type: "Account", tag: "x", file: null,
      f: Object.assign({ name: label, kind, currency_code: code, is_invested: 0, display_order: order, archived_at: null, created_at: at(90), category: null, income_reinvested: 0 }, extra || {}),
    });
    const balance = (name, accountId, minor, offset) => ({
      name, type: "Balance", tag: "x", file: null,
      f: { account_id: accountId, value_minor: minor, as_of_date: day(offset), source: "MANUAL", created_at: at(offset) },
    });
    const txn = (name, accountId, minor, code, offset, category, note) => ({
      name, type: "Transaction", tag: "x", file: null,
      f: { account_id: accountId, occurred_on: day(offset), amount_minor: minor, currency_code: code, category, note, source: offset % 2 ? "APP" : "WEB", created_at: at(offset), updated_at: at(offset) },
    });
    const line = (name, accountId, position, minor, offset, kind, description) => ({
      name, type: "StatementLine", tag: "x", file: null,
      f: { statement_id: "ex-s1", account_id: accountId, position, posted_on: day(offset), made_on: null, description, amount_minor: minor, running_minor: null, ref: null, line_kind: kind, foreign_currency: null, foreign_minor: null },
    });
    const doc = (name, file, size, offset, status) => ({
      name, type: "Document", tag: "x", file: null,
      f: { file_name: file, byte_count: size, added_at: at(offset), added_from: "WEB", status, status_note: null, status_at: status === "NEW" ? null : at(offset - 1), note: null },
    });
    return [
      account("ex-current", "Current account", "ASSET", "USD", 0),
      account("ex-savings", "Savings (UK)", "ASSET", "GBP", 1),
      account("ex-pension", "Pension", "ASSET", "DKK", 2, { is_invested: 1, available_from_age: 60 }),
      account("ex-car", "Car loan", "LIABILITY", "USD", 3),
      balance("ex-b1", "ex-current", 4_650_000, 40), balance("ex-b2", "ex-current", 4_800_000, 9),
      balance("ex-b3", "ex-savings", 1_200_000, 9), balance("ex-b4", "ex-pension", 41_000_000, 30),
      balance("ex-b5", "ex-car", 2_310_000, 40), balance("ex-b6", "ex-car", 2_200_000, 9),
      txn("ex-t1", "ex-current", 620_000, "USD", 3, "P_SALARY", null),
      txn("ex-t2", "ex-current", -185_000, "USD", 4, "P_RENT", "October rent"),
      txn("ex-t3", "ex-car", -110_000, "USD", 6, "P_LOAN", null),
      txn("ex-t4", null, -4_250, "USD", 8, "P_SUBSCRIPTION", "Streaming"),
      txn("ex-t5", "ex-savings", 50_000, "GBP", 35, "P_DIVIDEND", "Interest"),
      line("ex-l1", "ex-current", 0, -6_420, 5, "out", "Corner Grocer"),
      line("ex-l2", "ex-current", 1, -50_000, 5, "own", "To Savings (UK)"),
      line("ex-l3", "ex-current", 2, 112, 1, "interest", "Interest earned"),
      { name: "assumptions-1", type: "Assumptions", tag: "x", file: null, f: {
        base_currency_code: "USD", monthly_income_minor: 1_800_000, monthly_spending_minor: 1_150_000, annual_raise_pct: "3",
        raise_effective_month: 4, annual_spending_growth_pct: "2", annual_return_pct: "5", horizon_months: 24, updated_at: at(60),
        birth_year: null, birth_month: null, annual_withdrawal_pct: "4", income_day: 25, fire_interest_pct: null, fire_growth_pct: null } },
      { name: "exversion1", type: "AssumptionVersion", tag: "x", file: null, f: {
        base_currency_code: "USD", monthly_income_minor: 1_800_000, monthly_spending_minor: 1_150_000, annual_raise_pct: "3",
        raise_effective_month: 4, annual_spending_growth_pct: "2", annual_return_pct: "5", valid_from: at(60), written_order: 1 } },
      { name: "ex-p1", type: "PlannedItem", tag: "x", file: null, f: {
        name: "Car insurance", direction: "OUT", amount_minor: 96_000, currency_code: null, category: "P_INSURANCE",
        first_date: day(-40), frequency: "ANNUAL", ends_on: null, growth_pct: "0", archived_at: null, display_order: 0, created_at: at(80) } },
      { name: "ex-p2", type: "PlannedItem", tag: "x", file: null, f: {
        name: "Year-end bonus", direction: "IN", amount_minor: 900_000, currency_code: null, category: "P_BONUS",
        first_date: day(-70), frequency: "ONCE", ends_on: null, growth_pct: "0", archived_at: null, display_order: 1, created_at: at(80) } },
      doc("ex-d1", "Current account, September.pdf", 184_320, 2, "NEW"),
      doc("ex-d2", "Savings statement Q3.pdf", 96_256, 12, "ADDED"),
    ];
  }

  /* How often a planned item comes round, as the app names it. */
  const FREQUENCIES = [["ONCE", "Once"], ["MONTHLY", "Every month"], ["QUARTERLY", "Every 3 months"],
    ["SEMIANNUAL", "Every 6 months"], ["ANNUAL", "Every year"]];

  /* ---------- the records, read the way the app reads them ---------- */

  class Store {
    constructor(backend) {
      this.backend = backend;
      this.rows = new Map();
      this.token = null;
      this.zoneMissing = false;
      this.loadedAt = null;
    }

    async load() {
      const result = await this.backend.fetch(null);
      this.rows = new Map();
      this.take(result);
    }

    async refresh() {
      if (!this.token) return this.load();
      this.take(await this.backend.fetch(this.token));
    }

    take(result) {
      for (const record of result.changed) {
        // A piece is kept without its bytes: they're fetched again only to download the file.
        if (record.type === PIECE) record.f = { document_id: record.f.document_id, part: record.f.part };
        this.rows.set(record.name, record);
      }
      for (const name of result.deleted) this.rows.delete(name);
      this.token = result.token;
      this.zoneMissing = result.zoneMissing;
      this.loadedAt = new Date();
    }

    of(type) { return [...this.rows.values()].filter((r) => r.type === type); }

    /** Accounts still in use, in the app's order. */
    accounts() {
      return this.of("Account")
        .filter((a) => !a.f.archived_at)
        .sort((a, b) => (a.f.display_order - b.f.display_order) || String(a.f.created_at).localeCompare(String(b.f.created_at)));
    }

    account(name) {
      const record = this.rows.get(name);
      return record && record.type === "Account" ? record : null;
    }

    /** Balances that stand — none taken back — newest first, as the app reads them. */
    balances(accountId) {
      const withdrawn = new Set(this.of("BalanceWithdrawal").map((w) => w.name.replace(/^withdrawal-/, "")));
      return this.of("Balance")
        .filter((b) => b.f.account_id === accountId && !withdrawn.has(b.name))
        .sort((a, b) => String(b.f.as_of_date).localeCompare(String(a.f.as_of_date)) || String(b.f.created_at).localeCompare(String(a.f.created_at)));
    }

    latest(accountId) { return this.balances(accountId)[0] || null; }

    transactions() {
      return this.of("Transaction")
        .sort((a, b) => String(b.f.occurred_on).localeCompare(String(a.f.occurred_on)) || String(b.f.created_at).localeCompare(String(a.f.created_at)));
    }

    /** Lines read from statements, each with its account's currency. Lines with no date are
        listed under their account in the app, never here. */
    statementLines() {
      return this.of("StatementLine")
        .filter((l) => l.f.posted_on)
        .map((l) => {
          const account = this.rows.get(l.f.account_id);
          return { ...l, currency: account && account.type === "Account" ? account.f.currency_code : null, accountName: account ? account.f.name : null };
        })
        .filter((l) => l.currency);
    }

    /** Typed transactions and statement lines in one list, the app's order: newest day first;
        on one day, typed ones first (newest typed first), then the statement's own order. */
    activity() {
      const manual = this.transactions().map((t) => ({ kind: "manual", day: t.f.occurred_on, record: t }));
      const auto = this.statementLines().map((l) => ({ kind: "auto", day: l.f.posted_on, record: l }));
      return manual.concat(auto).sort((a, b) => {
        if (a.day !== b.day) return String(b.day).localeCompare(String(a.day));
        if (a.kind !== b.kind) return a.kind === "manual" ? -1 : 1;
        if (a.kind === "manual") return String(b.record.f.created_at).localeCompare(String(a.record.f.created_at));
        return String(a.record.f.statement_id).localeCompare(String(b.record.f.statement_id)) || (a.record.f.position - b.record.f.position);
      });
    }

    documents() {
      return this.of("Document").sort((a, b) => String(b.f.added_at).localeCompare(String(a.f.added_at)));
    }

    /** The currency most of the accounts are in: a sensible start for a new transaction. */
    usualCurrency() {
      const counts = new Map();
      for (const a of this.accounts()) counts.set(a.f.currency_code, (counts.get(a.f.currency_code) || 0) + 1);
      let best = "USD", most = 0;
      for (const [code, n] of counts) if (n > most) { best = code; most = n; }
      return best;
    }

    // ---- writing ----

    /** Checks a transaction the way the app does, and says what's wrong in a sentence. */
    checkTransaction(draft) {
      const problems = {};
      if (!draft.amount.ok) problems.amount = draft.amount.reason === "empty" ? "Type an amount." : draft.amount.reason;
      else if (draft.amount.minor === 0) problems.amount = "An amount of zero isn't a transaction.";
      if (!M.isDay(draft.day)) problems.day = "Choose a date.";
      if (draft.accountId && !this.account(draft.accountId)) problems.account = "That account isn't in WaffleWealth any more.";
      if ((draft.note || "").trim().length > 200) problems.note = "Keep the note to 200 characters.";
      if (!/^[A-Z]{3}$/.test(draft.currency)) problems.currency = "Choose a currency.";
      return problems;
    }

    async saveTransaction(draft, existing) {
      const signed = draft.direction === "in" ? draft.amount.minor : -draft.amount.minor;
      const list = draft.direction === "in" ? M.categories.in : M.categories.out;
      const category = list.some(([k]) => k === draft.category) ? draft.category : null;
      const now = M.stamp();
      const record = {
        name: existing ? existing.name : M.uuid(),
        type: "Transaction",
        tag: existing ? existing.tag : undefined,
        f: {
          account_id: draft.accountId || null,
          occurred_on: draft.day,
          amount_minor: signed,
          currency_code: draft.currency,
          category,
          note: (draft.note || "").trim() || null,
          source: existing ? existing.f.source : "WEB",
          created_at: existing ? existing.f.created_at : now,
          updated_at: now,
        },
      };
      const [saved] = await this.backend.save([record]);
      this.rows.set(saved.name, saved);
      return saved;
    }

    async deleteRecord(record) {
      // A document goes with its pieces, the document first so no phone sees it half there.
      await this.backend.remove([record]);
      this.rows.delete(record.name);
      if (record.type === "Document") {
        const pieces = Store.pieceNames(record).map((name) => this.rows.get(name) || { name });
        if (pieces.length) {
          try { await this.backend.remove(pieces); } catch (e) { /* left over in iCloud; harmless */ }
          for (const piece of pieces) this.rows.delete(piece.name);
        }
      }
    }

    checkBalance(accountId, amount, day) {
      const problems = {};
      if (!this.account(accountId)) problems.account = "That account isn't in WaffleWealth any more.";
      if (!amount.ok) problems.amount = amount.reason === "empty" ? "Type the balance." : amount.reason;
      if (!M.isDay(day)) problems.day = "Choose a date.";
      return problems;
    }

    /** A new balance for an account: added, never edited, exactly as the app records one. */
    async recordBalance(accountId, minor, day) {
      const record = {
        name: M.uuid(), type: "Balance",
        f: { account_id: accountId, value_minor: Math.abs(minor), as_of_date: day, source: "MANUAL", created_at: M.stamp() },
      };
      const [saved] = await this.backend.save([record]);
      this.rows.set(saved.name, saved);
      return saved;
    }

    static maxBytes = 25 * 1024 * 1024;

    checkFile(file) {
      if (!file || !file.size) return "That file is empty.";
      if (file.size > Store.maxBytes) return "Files up to 25 MB can be kept.";
      if (!file.name || file.name.length > 200) return "That file's name is too long.";
      return null;
    }

    // ---- income and spending (the app's assumptions) ----

    /** The one row of settings, as the iPhone sent it. Null until the phone has. */
    assumptions() { return this.rows.get("assumptions-1") || null; }

    /** The currency income, spending and a planned item without its own are in. */
    baseCurrency() {
      const a = this.assumptions();
      return a ? a.f.base_currency_code : this.usualCurrency();
    }

    checkAssumptions(draft) {
      const problems = {};
      for (const key of ["income", "spending"]) {
        if (!draft[key].ok) problems[key] = draft[key].reason === "empty" ? "Type an amount, or 0." : draft[key].reason;
      }
      for (const key of ["raise", "growth", "ret"]) {
        if (!draft[key].ok) problems[key] = draft[key].reason;
      }
      if (!(draft.raiseMonth >= 1 && draft.raiseMonth <= 12)) problems.raiseMonth = "Choose a month.";
      return problems;
    }

    /** Writes the settings and, when a figure the projection reads changed, a new line of
        history after it, as the app does. Everything else in the row is kept as it was. */
    async saveAssumptions(draft) {
      const existing = this.assumptions();
      if (!existing) throw { reason: "Your iPhone hasn't sent its settings yet. Open WaffleWealth with iCloud on, then try again." };
      const now = M.stamp();
      const f = {
        ...existing.f,
        monthly_income_minor: draft.income.minor,
        monthly_spending_minor: draft.spending.minor,
        annual_raise_pct: draft.raise.value,
        raise_effective_month: draft.raiseMonth,
        annual_spending_growth_pct: draft.growth.value,
        annual_return_pct: draft.ret.value,
        updated_at: now,
      };
      const [saved] = await this.backend.save([{ name: existing.name, type: "Assumptions", tag: existing.tag, f }]);
      this.rows.set(saved.name, saved);
      const latest = this.history()[this.history().length - 1];
      const changed = !latest || ENGINE_FIELDS.some((k) => String(latest.f[k]) !== String(f[k]));
      if (changed) {
        const line = { name: M.uuid().replace(/-/g, ""), type: "AssumptionVersion", f: { written_order: Date.now(), valid_from: now } };
        for (const k of ENGINE_FIELDS) line.f[k] = f[k];
        const [kept] = await this.backend.save([line]);
        this.rows.set(kept.name, kept);
      }
      return saved;
    }

    /** The input history, oldest first: by when it took effect, then the order it was written. */
    history() {
      return this.of("AssumptionVersion").sort((a, b) =>
        String(a.f.valid_from).localeCompare(String(b.f.valid_from)) || (Number(a.f.written_order) || 0) - (Number(b.f.written_order) || 0));
    }

    // ---- planned items ----

    planned(archived) {
      return this.of("PlannedItem")
        .filter((p) => Boolean(p.f.archived_at) === Boolean(archived))
        .sort((a, b) => String(a.f.first_date).localeCompare(String(b.f.first_date)) || String(a.f.created_at).localeCompare(String(b.f.created_at)));
    }

    checkPlanned(draft) {
      const problems = {};
      const name = (draft.name || "").trim();
      if (name.length < 1 || name.length > 60) problems.name = "Give it a name, up to 60 characters.";
      if (!draft.amount.ok) problems.amount = draft.amount.reason === "empty" ? "Type an amount." : draft.amount.reason;
      if (!M.isDay(draft.firstDate)) problems.firstDate = "Choose a date.";
      if (!FREQUENCIES.some(([k]) => k === draft.frequency)) problems.frequency = "Choose how often.";
      if (draft.endsOn) {
        if (!M.isDay(draft.endsOn)) problems.endsOn = "Choose a date, or leave it empty.";
        else if (M.isDay(draft.firstDate) && draft.endsOn < draft.firstDate) problems.endsOn = "It can't stop before it starts.";
      }
      if (!draft.growth.ok) problems.growth = draft.growth.reason;
      else if (Number(draft.growth.value) <= -100) problems.growth = "Use a rise above -100%.";
      return problems;
    }

    async savePlanned(draft, existing) {
      const list = draft.direction === "IN" ? M.categories.in : M.categories.out;
      const base = this.baseCurrency();
      const order = existing ? existing.f.display_order
        : this.of("PlannedItem").reduce((m, p) => Math.max(m, Number(p.f.display_order) || 0), -1) + 1;
      const record = {
        name: existing ? existing.name : M.uuid(),
        type: "PlannedItem",
        tag: existing ? existing.tag : undefined,
        f: {
          ...(existing ? existing.f : {}),
          name: draft.name.trim(),
          direction: draft.direction,
          amount_minor: draft.amount.minor,
          currency_code: draft.currency && draft.currency !== base ? draft.currency : (existing && existing.f.currency_code === base ? base : null),
          category: list.some(([k]) => k === draft.category) ? draft.category : null,
          first_date: draft.firstDate,
          frequency: draft.frequency,
          ends_on: draft.frequency === "ONCE" ? null : (draft.endsOn || null),
          growth_pct: draft.growth.value,
          archived_at: existing ? existing.f.archived_at : null,
          display_order: order,
          created_at: existing ? existing.f.created_at : M.stamp(),
        },
      };
      const [saved] = await this.backend.save([record]);
      this.rows.set(saved.name, saved);
      return saved;
    }

    /** Put away, or back in use. A planned item is deleted only once it is put away, as in the app. */
    async setPlannedArchived(item, archived) {
      const [saved] = await this.backend.save([{ name: item.name, type: "PlannedItem", tag: item.tag,
        f: { ...item.f, archived_at: archived ? M.stamp() : null } }]);
      this.rows.set(saved.name, saved);
      return saved;
    }

    // ---- accounts ----

    archivedAccounts() { return this.of("Account").filter((a) => a.f.archived_at); }

    checkAccount(draft) {
      const name = (draft.name || "").trim();
      return name.length < 1 || name.length > 60 ? { name: "Give it a name, up to 60 characters." } : {};
    }

    /** A new name, whether it grows at the return rate, or put away. Currency and kind are
        changed in the app, which checks them against the balances already recorded. */
    async saveAccount(account, draft) {
      const f = { ...account.f, name: draft.name.trim(), is_invested: draft.invested ? 1 : 0 };
      if ("archived" in draft) f.archived_at = draft.archived ? M.stamp() : null;
      const [saved] = await this.backend.save([{ name: account.name, type: "Account", tag: account.tag, f }]);
      this.rows.set(saved.name, saved);
      return saved;
    }

    static pieceNames(document) {
      const count = Number(document.f.parts) || 0;
      return Array.from({ length: count }, (_, n) => `documentpart-${document.name}-${n}`);
    }

    /** Uploads a file as a document. The iPhone reads it the next time WaffleWealth opens.

        **In pieces, inside ordinary records.** Apple's file server for iCloud (where an
        attachment would go) only lets Apple's own websites send to it, so a file from here goes
        as half-megabyte pieces in records of their own, through the same door every other
        record uses, and the iPhone joins them back together. The pieces go first and the
        document last, so a phone never sees a document whose pieces aren't all there; if the
        upload stops half way, the pieces already sent are taken back. `progress(done, of)`
        is told after each piece. */
    async uploadDocument(file, progress) {
      const name = M.uuid();
      const bytes = await readBytes(file);
      const count = Math.max(1, Math.ceil(bytes.length / PIECE_BYTES));
      const sent = [];
      try {
        for (let n = 0; n < count; n++) {
          const piece = {
            name: `documentpart-${name}-${n}`, type: PIECE,
            f: { document_id: name, part: n, data: toBase64(bytes.subarray(n * PIECE_BYTES, (n + 1) * PIECE_BYTES)) },
          };
          const [saved] = await this.backend.save([piece]);
          sent.push(saved);
          if (progress) progress(n + 1, count);
        }
        const record = {
          name, type: "Document",
          f: { file_name: file.name, byte_count: file.size, added_at: M.stamp(), added_from: "WEB", status: "NEW", status_note: null, status_at: null, note: null, parts: count },
        };
        const [saved] = await this.backend.save([record]);
        this.rows.set(saved.name, saved);
        for (const piece of sent) this.rows.set(piece.name, { ...piece, f: { document_id: name, part: piece.f.part } });
        return saved;
      } catch (error) {
        if (sent.length) { try { await this.backend.remove(sent); } catch (e) { /* left over; harmless */ } }
        throw error;
      }
    }

    /** The file of a document, as a Blob: from its pieces, or from the attachment a phone sent. */
    async documentFile(document) {
      if (document.file && document.file.downloadURL) return null; // a plain link does it
      const names = Store.pieceNames(document);
      if (!names.length) throw { reason: "This file isn't in iCloud yet. Open WaffleWealth on your iPhone and try again." };
      const pieces = await this.backend.fetchRecords(names);
      pieces.sort((a, b) => a.f.part - b.f.part);
      if (pieces.length !== names.length) throw { reason: "Part of this file is missing from iCloud." };
      return new Blob(pieces.map((p) => fromBase64(p.f.data)));
    }
  }

  /** A file's bytes. FileReader where Blob#arrayBuffer is missing (older Safari). */
  function readBytes(file) {
    if (typeof file.arrayBuffer === "function") return file.arrayBuffer().then((b) => new Uint8Array(b));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  function toBase64(bytes) {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(text);
  }

  function fromBase64(text) {
    const binary = atob(String(text));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  globalThis.WWCloud = { CloudBackend, MemoryBackend, Store, explain, toCloud, fromCloud, ZONE, toBase64, fromBase64, PIECE_BYTES, FREQUENCIES };
})();
