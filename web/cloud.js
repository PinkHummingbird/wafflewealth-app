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
    "income_amount_minor", "income_reinvested", "available_from_age",
  ]);
  const NULLABLE = {
    Transaction: ["account_id", "category", "note"],
    Document: ["status_note", "status_at", "note"],
  };

  /** A plain record → CloudKit JS's shape. */
  function toCloud(record) {
    const fields = {};
    const nulls = [];
    for (const [key, value] of Object.entries(record.f)) {
      if (value === null || value === undefined || value === "") {
        if ((NULLABLE[record.type] || []).includes(key)) nulls.push(key);
        continue;
      }
      fields[key] = INTEGER.has(key) ? { value: Math.trunc(value), type: "INT64" } : { value: String(value), type: "STRING" };
    }
    fields.nulls = { value: nulls.sort().join(","), type: "STRING" };
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
          return "The file couldn't reach Apple's storage server: something in this browser or network stopped it. An ad or privacy blocker, a VPN or a work network can do this. Try another browser, or turn the blocker off for this page, and upload again.";
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
        records.map((r) => ({ recordName: r.name, recordChangeTag: r.tag })), { zoneID: ZONE });
      if (response.hasErrors) throw response.errors[0];
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
      doc("ex-d1", "Current account, September.pdf", 184_320, 2, "NEW"),
      doc("ex-d2", "Savings statement Q3.pdf", 96_256, 12, "ADDED"),
    ];
  }

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
      for (const record of result.changed) this.rows.set(record.name, record);
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
      await this.backend.remove([record]);
      this.rows.delete(record.name);
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

    /** Uploads a file as a document. The iPhone reads it the next time WaffleWealth opens. */
    async uploadDocument(file) {
      const record = {
        name: M.uuid(), type: "Document", upload: file,
        f: { file_name: file.name, byte_count: file.size, added_at: M.stamp(), added_from: "WEB", status: "NEW", status_note: null, status_at: null, note: null },
      };
      const [saved] = await this.backend.save([record]);
      this.rows.set(saved.name, saved);
      return saved;
    }
  }

  globalThis.WWCloud = { CloudBackend, MemoryBackend, Store, explain, toCloud, fromCloud, ZONE };
})();
