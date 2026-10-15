/* WaffleWealth on the web: the page.
   Signed out, it says what it is and offers Apple's sign-in. Signed in, it shows the three
   lists the iPhone shares through iCloud — documents, transactions and accounts — and writes
   to them exactly as the app would. "Look around" runs the same page on made-up numbers kept
   in this tab. */
(function () {
  "use strict";
  const M = globalThis.WWMoney;
  const C = globalThis.WWCloud;

  /* The CloudKit container the app uses, and the web token from Apple's CloudKit Console
     (API Access › Tokens). A web token is meant to sit in a page: it only lets this site's
     address ask Apple to sign a person in, and every record still needs that person's own
     sign-in. Until it is filled in, the page offers the example only. */
  const CONFIG = {
    container: "iCloud.com.wafflewealth.app",
    apiToken: "a8bee4eeb30d69c311199f153391978ce2e4f4ae15d907e6fdd0fb8e96ef697b",
    environment: "production",
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const TABS = ["projection", "documents", "transactions", "accounts", "plan"];
  const state = { store: null, tab: "documents", editing: null, balanceFor: null, accountFor: null, plannedEditing: null, review: null, open: new Set() };

  /* ---------- starting ---------- */

  function showWelcome() {
    $("welcome").hidden = false;
    $("private").hidden = false;
    $("workspace").hidden = true;
    $("apple-sign-out-button").hidden = true;
    $("leave-example").hidden = true;
    state.store = null;
  }

  async function open(backend) {
    state.store = new C.Store(backend);
    $("welcome").hidden = true;
    $("private").hidden = true;
    $("workspace").hidden = false;
    const example = backend.kind === "example";
    $("who").textContent = example ? "Example numbers, in this tab only" : "Signed in to your iCloud";
    $("who").classList.toggle("example", example);
    $("apple-sign-out-button").hidden = example;
    $("leave-example").hidden = !example;
    resetForm();
    await reload();
  }

  async function reload(refreshOnly) {
    if (!state.store) return;
    setBusy(true);
    showError(null);
    try {
      if (refreshOnly) await state.store.refresh(); else await state.store.load();
    } catch (error) {
      showError(C.explain(error));
    } finally {
      setBusy(false);
    }
    render();
  }

  function setBusy(on) { $("busy").hidden = !on; }
  function showError(text) { $("work-error").hidden = !text; $("work-error").textContent = text || ""; }

  async function startICloud() {
    if (!CONFIG.apiToken) {
      $("not-ready").hidden = false;
      $("apple-sign-in-button").hidden = true;
      return;
    }
    const backend = new C.CloudBackend(CONFIG);
    try {
      const signedIn = await backend.start();
      if (signedIn) {
        await open(backend);
        whenOut(backend);
      } else {
        whenIn(backend);
      }
    } catch (error) {
      $("start-error").hidden = false;
      $("start-error").textContent = C.explain(error);
    }
  }

  /* Apple's buttons do the signing in and out; the page follows. */
  function whenIn(backend) {
    backend.whenSignedIn().then(async () => {
      await open(backend);
      whenOut(backend);
    });
  }

  function whenOut(backend) {
    backend.whenSignedOut().then(async () => {
      showWelcome();
      // The sign-in button is drawn again by asking who is signed in.
      try { await backend.reauth(); } catch (e) { /* the button stays as it was */ }
      whenIn(backend);
    });
  }

  /* ---------- tabs ---------- */

  function choose(tab) {
    state.tab = tab;
    if (tab === "projection" && state.projection) requestAnimationFrame(() => drawProjection(state.projection));
    for (const name of TABS) {
      $(`tab-${name}`).setAttribute("aria-selected", String(name === tab));
      $(`panel-${name}`).hidden = name !== tab;
    }
  }

  /* ---------- rendering ---------- */

  function render() {
    const store = state.store;
    if (!store) return;
    $("updated").textContent = store.loadedAt ? `Updated ${store.loadedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "";
    $("nothing-yet").hidden = !(store.zoneMissing || store.accounts().length === 0) || store.backend.kind === "example";
    renderDocuments();
    renderTransactions();
    renderAccounts();
    renderPlan();
    renderProjection();
    fillAccountSelect();
  }

  const STATUS = {
    NEW: ["Not added yet", "new"],
    ADDED: ["Added to your money", "added"],
    KEPT: ["Kept", ""],
    NOT_READ: ["Couldn't be read", ""],
  };

  function renderDocuments() {
    const docs = state.store.documents();
    const fresh = docs.filter((d) => d.f.status === "NEW").length;
    $("n-new").hidden = fresh === 0;
    $("n-new").textContent = String(fresh);
    $("docs-count").textContent = docs.length ? `${docs.length} kept` : "";
    if (!docs.length) {
      $("docs").innerHTML = `<p class="empty">Nothing here yet. Statements you upload appear here, and on your iPhone under Activity.</p>`;
      return;
    }
    $("docs").innerHTML = docs.map((d) => {
      const [label, cls] = STATUS[d.f.status] || [d.f.status, ""];
      const when = d.f.added_at ? new Date(d.f.added_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "";
      const from = d.f.added_from === "WEB" ? "Uploaded here" : "Added on iPhone";
      // A phone's file is an attachment with a link; one sent from here is in pieces, joined on click.
      const download = d.file && d.file.downloadURL
        ? `<a class="linkbtn" href="${esc(d.file.downloadURL.replace("${f}", encodeURIComponent(d.f.file_name)))}" download="${esc(d.f.file_name)}" rel="noreferrer">Download</a>`
        : Number(d.f.parts) > 0 ? `<button type="button" class="linkbtn" data-download-doc="${esc(d.name)}">Download</button>` : "";
      const readable = d.f.status === "NEW" && /\.(pdf|csv|zip)$/i.test(d.f.file_name) && (Number(d.f.parts) > 0 || (d.file && d.file.downloadURL));
      const read = readable ? `<button type="button" class="linkbtn" data-read-doc="${esc(d.name)}">Read here</button>` : "";
      return `<div class="row">
        <span class="ic" aria-hidden="true">${icon(d.f.file_name)}</span>
        <div class="main"><span class="t">${esc(d.f.file_name)}</span>
          <span class="d">${esc(when)} · ${esc(M.bytes(Number(d.f.byte_count) || 0))} · ${esc(from)}${d.f.note ? " · " + esc(d.f.note) : ""}</span>
          <span class="acts">${read}${download}<button type="button" class="linkbtn danger" data-remove-doc="${esc(d.name)}">Remove</button></span></div>
        <div class="end"><span class="pill ${cls}">${esc(label)}</span></div>
      </div>`;
    }).join("");
  }

  function icon(name) {
    const ext = String(name).split(".").pop().toLowerCase();
    if (ext === "pdf") return "PDF";
    if (ext === "csv" || ext === "xlsx" || ext === "xls") return "CSV";
    if (ext === "zip") return "ZIP";
    if (["png", "jpg", "jpeg", "heic"].includes(ext)) return "IMG";
    return "DOC";
  }

  const KIND = { own: "Between your accounts", interest: "Interest" };

  /* Transactions, grouped as the app groups them (ActivityGroups): by month, a row per account;
     by account, a row per month. A row is what moved through that account that month; open it
     for its lines. Moves between your own accounts are listed but counted apart. */
  function grouping() {
    try { return localStorage.getItem("ww.grouping") === "account" ? "account" : "month"; } catch (e) { return "month"; }
  }

  function setGrouping(value) {
    try { localStorage.setItem("ww.grouping", value); } catch (e) { /* remembered for this visit only */ }
    state.open.clear();
    renderTransactions();
  }

  function accountTitle(id) {
    if (!id) return "No account";
    const a = state.store.rows.get(id);
    return a && a.type === "Account" ? a.f.name : "An account no longer here";
  }

  function renderTransactions() {
    const store = state.store;
    const all = store.activity();
    $("txns-count").textContent = all.length ? `${all.length} in all` : "";
    const by = grouping();
    $(by === "account" ? "group-account" : "group-month").checked = true;
    if (!all.length) {
      $("txns").innerHTML = `<p class="empty">No transactions yet. Add one with the form; it appears on your iPhone under Activity. Statements you add show their lines here too.</p>`;
      return;
    }
    const entries = all.map((entry) => {
      const r = entry.record;
      return {
        id: r.name, day: entry.day, minor: Number(r.f.amount_minor), source: entry,
        account: r.f.account_id || null,
        currency: entry.kind === "auto" ? r.currency : r.f.currency_code,
        between: entry.kind === "auto" && r.f.line_kind === "own",
      };
    });
    const order = store.accounts().map((a) => a.name);
    let html = "";
    if (by === "account") {
      for (const section of C.Groups.byAccount(entries, order)) {
        html += `<div class="month"><h3>${esc(accountTitle(section.account))}</h3></div>`;
        html += section.movements.map((m) => movementRow(m, M.monthLabel(m.month))).join("");
      }
    } else {
      for (const section of C.Groups.byMonth(entries, order)) {
        const totals = new Map();
        for (const m of section.movements) {
          const t = totals.get(m.currency) || { in: 0, out: 0 };
          t.in += m.in; t.out += m.out;
          totals.set(m.currency, t);
        }
        const tot = [...totals].map(([code, v]) => [v.in ? `In ${M.format(v.in, code)}` : "", v.out ? `Out ${M.format(v.out, code)}` : ""].filter(Boolean).join(" · ")).filter(Boolean).join("<br>");
        html += `<div class="month"><h3>${esc(M.monthLabel(section.month))}</h3><span class="tot">${tot}</span></div>`;
        html += section.movements.map((m) => movementRow(m, m.account ? accountTitle(m.account) : `No account · ${m.currency}`)).join("");
      }
    }
    $("txns").innerHTML = html;
  }

  function movementRow(m, title) {
    const open = state.open.has(m.key);
    const parts = [m.in ? `In ${M.format(m.in, m.currency)}` : "", m.out ? `Out ${M.format(m.out, m.currency)}` : "",
      `${m.entries.length} line${m.entries.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
    const between = m.between ? `<span class="d">Between your accounts ${esc(M.formatSigned(m.between, m.currency))}</span>` : "";
    let detail = "";
    if (open) {
      const figs = [["Money in", m.in], ["Money out", m.out], ["Net", m.net], ["Between your accounts", m.between]]
        .filter(([, v]) => v !== 0)
        .map(([k, v]) => `<span>${k} <b>${esc(k === "Net" || k === "Between your accounts" ? M.formatSigned(v, m.currency) : M.format(v, m.currency))}</b></span>`).join("");
      const hasAuto = m.entries.some((e) => e.source.kind === "auto");
      detail = `<div class="mv-open">
        ${figs ? `<div class="mv-figs">${figs}</div>` : ""}
        ${m.between ? `<p class="foot">Money moved between your own accounts is listed, but not counted as money in or out.</p>` : ""}
        ${hasAuto ? `<p class="legend"><span class="pill auto">Auto</span> read from statements you added. <span class="pill">Manual</span> typed by you, here or on your iPhone.</p>` : ""}
        ${m.entries.map((e) => (e.source.kind === "manual" ? manualRow(e.source.record) : autoRow(e.source.record))).join("")}
      </div>`;
    }
    return `<div class="row clickable${open ? " editing" : ""}" data-movement="${esc(m.key)}" tabindex="0" role="button" aria-expanded="${open}" aria-label="${esc(title)}, ${open ? "close" : "open"}">
      <span class="ic chev${open ? " open" : ""}" aria-hidden="true"><svg viewBox="0 0 20 20" width="18" height="18"><path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <div class="main"><span class="t">${esc(title)}</span><span class="d">${esc(parts)}</span>${between}</div>
      <div class="end"><span class="amt${m.net > 0 ? " in" : ""}">${esc(M.formatSigned(m.net, m.currency))}</span></div>
    </div>${detail}`;
  }

  function manualRow(t) {
    const store = state.store;
    const incoming = t.f.amount_minor > 0;
    const category = M.categoryName(t.f.category);
    const title = t.f.note || category || (incoming ? "Money in" : "Money out");
    const account = t.f.account_id && store.account(t.f.account_id);
    const detail = [M.dayLabel(t.f.occurred_on), t.f.note && category, account && account.f.name, t.f.source === "WEB" ? "Added here" : "From iPhone"].filter(Boolean).join(" · ");
    return `<div class="row clickable${state.editing && state.editing.name === t.name ? " editing" : ""}" data-edit="${esc(t.name)}" tabindex="0" role="button" aria-label="Edit ${esc(title)}">
      <span class="ic" aria-hidden="true">${incoming ? "↙" : "↗"}</span>
      <div class="main"><span class="t">${esc(title)}</span><span class="d">${esc(detail)}</span></div>
      <div class="end"><span class="amt${incoming ? " in" : ""}">${esc(M.formatSigned(t.f.amount_minor, t.f.currency_code))}</span><span class="pill">Manual</span></div>
    </div>`;
  }

  /* A line read from a statement: what the bank printed, read-only. */
  function autoRow(l) {
    const minor = Number(l.f.amount_minor);
    const own = l.f.line_kind === "own";
    const incoming = minor > 0 && !own;
    const detail = [M.dayLabel(l.f.posted_on), l.accountName, KIND[l.f.line_kind]].filter(Boolean).join(" · ");
    return `<div class="row">
      <span class="ic" aria-hidden="true">${own ? "⇄" : minor > 0 ? "↙" : "↗"}</span>
      <div class="main"><span class="t">${esc(l.f.description)}</span><span class="d">${esc(detail)}</span></div>
      <div class="end"><span class="amt${incoming ? " in" : ""}">${esc(M.formatSigned(minor, l.currency))}</span><span class="pill auto">Auto</span></div>
    </div>`;
  }

  function renderAccounts() {
    const store = state.store;
    const accounts = store.accounts();
    // What each currency adds up to: own less owe. No exchange rates here — those live on the
    // phone — so a total is per currency, never mixed.
    const sums = new Map();
    for (const a of accounts) {
      const latest = store.latest(a.name);
      if (!latest) continue;
      const code = a.f.currency_code;
      const sign = a.f.kind === "LIABILITY" ? -1 : 1;
      sums.set(code, (sums.get(code) || 0) + sign * Number(latest.f.value_minor));
    }
    $("totals").innerHTML = [...sums].map(([code, v]) => `<div><div class="v">${esc(M.format(v, code))}</div><div class="k">In ${esc(code)}: owned less owed</div></div>`).join("");
    if (!accounts.length) {
      $("accts").innerHTML = `<p class="empty">No accounts here yet. They come from WaffleWealth on your iPhone once “Keep a copy in iCloud” is on.</p>`;
      return;
    }
    const section = (kind, title) => {
      const list = accounts.filter((a) => a.f.kind === kind);
      if (!list.length) return "";
      return `<div class="month"><h3>${title}</h3></div>` + list.map((a) => {
        const latest = store.latest(a.name);
        const value = latest ? M.format(Number(latest.f.value_minor), a.f.currency_code) : "No balance yet";
        const asOf = latest ? `As of ${M.dayLabel(latest.f.as_of_date)}` : "";
        const open = state.balanceFor === a.name;
        const editing = state.accountFor === a.name;
        const form = open ? `<form class="inline-form" data-balance-form="${esc(a.name)}" novalidate>
            <div class="field"><label for="bal-amount">New balance (${esc(a.f.currency_code)})</label><input id="bal-amount" inputmode="decimal" autocomplete="off" placeholder="0.00"><span class="err" id="bal-amount-err"></span></div>
            <div class="field"><label for="bal-day">As of</label><input type="date" id="bal-day" value="${esc(M.today())}"><span class="err" id="bal-day-err"></span></div>
            <button type="submit" class="btn small">Save to iCloud</button>
            <button type="button" class="linkbtn" data-cancel-balance>Cancel</button>
          </form>` : "";
        return `<div class="row">
          <span class="ic" aria-hidden="true">${esc(a.f.currency_code)}</span>
          <div class="main"><span class="t">${esc(a.f.name)}</span><span class="d">${a.f.kind === "LIABILITY" ? '<span class="pill owed">Owed</span> ' : ""}${Number(a.f.is_invested) ? "Grows at your return rate · " : ""}${esc(asOf)}</span>
            ${open || editing ? "" : `<span class="acts"><button type="button" class="linkbtn" data-balance="${esc(a.name)}">Update balance</button><button type="button" class="linkbtn" data-account-edit="${esc(a.name)}">Edit</button></span>`}</div>
          <div class="end"><span class="amt">${esc(value)}</span></div>
          ${form}${editing ? accountForm(a) : ""}
        </div>`;
      }).join("");
    };
    $("accts").innerHTML = section("ASSET", "What you own") + section("LIABILITY", "What you owe");
    const away = store.archivedAccounts();
    $("accts-away").innerHTML = away.length ? `<div class="month"><h3>Put away</h3></div>` + away.map((a) => `<div class="row">
        <span class="ic" aria-hidden="true">${esc(a.f.currency_code)}</span>
        <div class="main"><span class="t">${esc(a.f.name)}</span><span class="acts"><button type="button" class="linkbtn" data-account-restore="${esc(a.name)}">Put back</button></span></div>
      </div>`).join("") : "";
    if (state.balanceFor) { const input = $("bal-amount"); if (input) input.focus(); }
    if (state.accountFor) { const input = $("acc-name"); if (input) input.focus(); }
  }

  function accountForm(a) {
    return `<form class="inline-form" data-account-form="${esc(a.name)}" novalidate>
      <div class="field"><label for="acc-name">Name</label><input id="acc-name" maxlength="60" autocomplete="off" value="${esc(a.f.name)}"><span class="err" id="acc-name-err"></span></div>
      <label class="check"><input type="checkbox" id="acc-invested" ${Number(a.f.is_invested) ? "checked" : ""}> Grows at your return rate (an investment)</label>
      <button type="submit" class="btn small">Save to iCloud</button>
      <button type="button" class="linkbtn" data-cancel-account>Cancel</button>
      <button type="button" class="linkbtn danger" data-account-away="${esc(a.name)}">Put away</button>
    </form>`;
  }

  /* ---------- the transaction form ---------- */

  function fillCurrencySelect(selected) {
    const select = $("txn-currency");
    if (!select.options.length) {
      select.innerHTML = M.currencies().map((c) => `<option value="${c}">${c} · ${esc(M.currencyName(c))}</option>`).join("");
    }
    select.value = selected;
  }

  function fillAccountSelect() {
    const select = $("txn-account");
    const current = select.value;
    const accounts = state.store ? state.store.accounts() : [];
    select.innerHTML = `<option value="">No account</option>` + accounts.map((a) => `<option value="${esc(a.name)}">${esc(a.f.name)} (${esc(a.f.currency_code)})</option>`).join("");
    if (accounts.some((a) => a.name === current)) select.value = current;
  }

  function fillCategories(direction, selected) {
    const list = direction === "in" ? M.categories.in : M.categories.out;
    $("txn-category").innerHTML = `<option value="">Not said</option>` + list.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join("");
    $("txn-category").value = list.some(([k]) => k === selected) ? selected : "";
  }

  const direction = () => ($("dir-in").checked ? "in" : "out");

  function resetForm() {
    state.editing = null;
    $("txn-title").textContent = "Add a transaction";
    $("txn-save").textContent = "Save to iCloud";
    $("txn-cancel").hidden = true;
    $("txn-delete").hidden = true;
    $("dir-out").checked = true;
    $("txn-amount").value = "";
    $("txn-day").value = M.today();
    $("txn-note").value = "";
    fillCategories("out", "");
    fillCurrencySelect(state.store ? state.store.usualCurrency() : "USD");
    if (state.store) fillAccountSelect();
    $("txn-account").value = "";
    clearFieldErrors();
  }

  function editTransaction(name) {
    const t = state.store.rows.get(name);
    if (!t) return;
    state.editing = t;
    const incoming = t.f.amount_minor > 0;
    $("txn-title").textContent = "Edit transaction";
    $("txn-save").textContent = "Save changes";
    $("txn-cancel").hidden = false;
    $("txn-delete").hidden = false;
    $(incoming ? "dir-in" : "dir-out").checked = true;
    fillCurrencySelect(t.f.currency_code);
    $("txn-amount").value = M.editable(t.f.amount_minor, t.f.currency_code);
    $("txn-day").value = t.f.occurred_on;
    fillAccountSelect();
    $("txn-account").value = t.f.account_id || "";
    fillCategories(incoming ? "in" : "out", t.f.category);
    $("txn-note").value = t.f.note || "";
    clearFieldErrors();
    $("txn-ok").hidden = true;
    renderTransactions();
    $("txn-amount").focus();
  }

  function clearFieldErrors() {
    for (const id of ["txn-amount", "txn-day", "txn-account", "txn-note"]) {
      $(`${id}-err`).textContent = "";
      $(id).removeAttribute("aria-invalid");
    }
    $("txn-error").hidden = true;
  }

  async function submitTransaction(event) {
    event.preventDefault();
    clearFieldErrors();
    $("txn-ok").hidden = true;
    const currency = $("txn-currency").value;
    const draft = {
      direction: direction(),
      amount: M.parseAmount($("txn-amount").value, currency),
      currency,
      day: $("txn-day").value,
      accountId: $("txn-account").value || null,
      category: $("txn-category").value || null,
      note: $("txn-note").value,
    };
    const problems = state.store.checkTransaction(draft);
    const map = { amount: "txn-amount", day: "txn-day", account: "txn-account", note: "txn-note" };
    let first = null;
    for (const [key, text] of Object.entries(problems)) {
      const id = map[key];
      if (!id) continue;
      $(`${id}-err`).textContent = text;
      $(id).setAttribute("aria-invalid", "true");
      first = first || id;
    }
    if (first) { $(first).focus(); return; }
    $("txn-save").disabled = true;
    try {
      const editing = state.editing;
      await state.store.saveTransaction(draft, editing);
      resetForm();
      render();
      $("txn-ok").hidden = false;
      $("txn-ok").textContent = state.store.backend.kind === "example"
        ? "Saved, in this tab. With iCloud it would be on your iPhone the next time WaffleWealth opens."
        : editing ? "Changes saved to iCloud." : "Saved to iCloud. It'll be on your iPhone the next time WaffleWealth opens.";
      $("txn-amount").focus();
    } catch (error) {
      $("txn-error").hidden = false;
      $("txn-error").textContent = C.explain(error);
      if (["CONFLICT", "ATOMIC_ERROR"].includes(error && error.ckErrorCode)) reload(true);
    } finally {
      $("txn-save").disabled = false;
    }
  }

  async function deleteEditing() {
    const t = state.editing;
    if (!t || !confirm("Delete this transaction? It goes from your iPhone too.")) return;
    try {
      await state.store.deleteRecord(t);
      resetForm();
      render();
    } catch (error) {
      $("txn-error").hidden = false;
      $("txn-error").textContent = C.explain(error);
    }
  }

  /* ---------- documents ---------- */

  async function upload(files) {
    const store = state.store;
    if (!store || !files.length) return;
    const problems = [];
    const ok = [];
    $("upload-ok").hidden = true;
    $("upload-problems").hidden = true;
    for (const file of files) {
      const wrong = store.checkFile(file);
      if (wrong) { problems.push(`${file.name}: ${wrong}`); continue; }
      $("uploading").hidden = false;
      $("uploading").textContent = `Uploading ${file.name}…`;
      try {
        await store.uploadDocument(file, (done, of) => {
          if (of > 1) $("uploading").textContent = `Uploading ${file.name}… ${Math.round((done / of) * 100)}%`;
        });
        ok.push(file.name);
        renderDocuments();
      } catch (error) {
        problems.push(`${file.name}: ${C.explain(error)}`);
      }
    }
    $("uploading").hidden = true;
    if (ok.length) {
      $("upload-ok").hidden = false;
      $("upload-ok").textContent = (ok.length === 1 ? `${ok[0]} is in your iCloud.` : `${ok.length} files are in your iCloud.`)
        + " Choose “Read here” to add it to your money now, or do it on your iPhone under Activity."
        + (store.backend.kind === "example" ? " (Example: kept in this tab only.)" : "");
    }
    if (problems.length) {
      $("upload-problems").hidden = false;
      $("upload-problems").innerHTML = problems.map((p) => `<li>${esc(p)}</li>`).join("");
    }
  }

  async function removeDocument(name) {
    const d = state.store.rows.get(name);
    if (!d || !confirm(`Remove ${d.f.file_name}? It goes from your iCloud and your iPhone. Anything it added to your money stays.`)) return;
    try {
      await state.store.deleteRecord(d);
      renderDocuments();
    } catch (error) {
      showError(C.explain(error));
    }
  }

  async function downloadDocument(name) {
    const d = state.store.rows.get(name);
    if (!d) return;
    try {
      const blob = await state.store.documentFile(d);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = d.f.file_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      showError(C.explain(error));
    }
  }

  /* ---------- reading a statement here ---------- */

  /* The reading code is loaded only when it's wanted: it brings PDF.js with it. Tests hand in
     their own (WWStatementModules). */
  async function statementModules() {
    if (globalThis.WWStatementModules) return globalThis.WWStatementModules;
    const [read, save] = await Promise.all([import("./statement-read.mjs?v=13"), import("./statement-save.mjs?v=13")]);
    return { ...read, ...save };
  }

  async function readHere(name) {
    const store = state.store;
    const doc = store.rows.get(name);
    if (!doc) return;
    state.review = { doc, reading: true, statements: [], problems: [], choices: [] };
    renderReview();
    if ($("review").scrollIntoView) $("review").scrollIntoView({ block: "nearest" });
    try {
      const mods = await statementModules();
      const bytes = await store.documentBytes(doc);
      const { statements, problems } = await mods.readDocument(doc.f.file_name, bytes);
      state.review = {
        doc, reading: false, problems, mods,
        statements: statements.map((st) => ({ ...st, already: store.statementRead(st.sha256) })),
      };
      state.review.choices = state.review.statements.map((st) => st.accounts.map((a) => ({
        include: !st.already && mods.includedByDefault(a) && !(a.check && a.check.checked && !a.check.ok),
        name: a.name,
      })));
    } catch (error) {
      state.review = { doc, reading: false, statements: [], choices: [], problems: [C.explain(error)] };
    }
    renderReview();
  }

  function checkNote(a) {
    const c = a.check || {};
    if (c.ok) return `<span class="note good">Adds up: the opening balance and every line come to the closing balance.</span>`;
    if (c.checked) return `<span class="note bad">Doesn't add up: the lines come to ${esc(M.format(c.expected, a.currency))}, the statement says ${esc(M.format(a.closing, a.currency))}. Left out unless you include it; your iPhone can read it too.</span>`;
    return `<span class="note">No opening balance printed, so there's nothing to check the lines against.</span>`;
  }

  function renderReview() {
    const box = $("review");
    const r = state.review;
    box.hidden = !r;
    if (!r) { box.innerHTML = ""; return; }
    const store = state.store;
    if (r.reading) { box.innerHTML = `<h2>Reading ${esc(r.doc.f.file_name)}…</h2><p class="cap">Here in your browser. The file isn't sent anywhere to be read.</p>`; return; }
    let html = `<h2>${esc(r.doc.f.file_name)}</h2>`;
    if (r.problems.length) html += `<ul class="error" style="margin:8px 0;padding-left:20px">${r.problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`;
    let anything = false;
    r.statements.forEach((st, si) => {
      const period = st.period && st.period.to ? `${st.period.from ? M.dayLabel(st.period.from) + " to " : "To "}${M.dayLabel(st.period.to)}` : "Dates not found";
      html += `<div class="month"><h3>${esc(st.institution || "Statement")} · ${esc(period)}</h3></div>`;
      if (st.already) { html += `<p class="empty">Already added to your money, here or on your iPhone.</p>`; return; }
      st.accounts.forEach((a, ai) => {
        const choice = r.choices[si][ai];
        const known = a.ref ? store.accountByRef(a.ref) : null;
        if (choice.include) anything = true;
        const closing = a.closing != null && a.currency ? M.format(a.closing, a.currency) : "No closing balance";
        html += `<div class="review-acct">
          <input type="checkbox" id="rv-${si}-${ai}" data-review-include="${si}:${ai}" ${choice.include ? "checked" : ""} aria-label="Add ${esc(a.name)}">
          <div class="main">
            ${known ? `<label class="t" for="rv-${si}-${ai}">${esc(known.f.name)}</label><span class="note">Adds to this account, as last time.</span>`
              : `<div class="field"><label for="rv-name-${si}-${ai}">New account</label><input id="rv-name-${si}-${ai}" data-review-name="${si}:${ai}" maxlength="60" value="${esc(choice.name)}"></div>`}
            <span class="note">${a.owed ? "Owed · " : ""}${a.lines.length} line${a.lines.length === 1 ? "" : "s"}</span>
            ${checkNote(a)}
          </div>
          <div class="end"><span class="amt">${esc(closing)}</span></div>
        </div>`;
      });
    });
    html += `<div class="formacts" style="margin-top:12px">
      ${r.statements.some((st) => !st.already) ? `<button type="button" class="btn" id="review-add" ${anything ? "" : "disabled"}>Add to your money</button>` : ""}
      <button type="button" class="linkbtn" id="review-cancel">${r.statements.some((st) => !st.already) ? "Cancel" : "Close"}</button>
    </div><p class="error" id="review-error" role="alert" hidden></p>`;
    box.innerHTML = html;
  }

  async function addReviewed() {
    const r = state.review;
    const store = state.store;
    if (!r || !r.mods) return;
    for (const [si, list] of r.choices.entries()) {
      for (const [ai, choice] of list.entries()) {
        const known = r.statements[si].accounts[ai].ref && store.accountByRef(r.statements[si].accounts[ai].ref);
        const name = (choice.name || "").trim();
        if (choice.include && !known && (name.length < 1 || name.length > 60)) {
          $("review-error").hidden = false;
          $("review-error").textContent = "Give each new account a name, up to 60 characters.";
          return;
        }
      }
    }
    $("review-add").disabled = true;
    try {
      const records = [];
      const totals = { created: [], updated: [], balances: 0, lines: 0 };
      let order = store.nextDisplayOrder();
      r.statements.forEach((st, si) => {
        if (st.already) return;
        const out = r.mods.recordsForStatement({
          statement: st, choices: r.choices[si], sha256: st.sha256,
          known: { accountByRef: (ref) => store.accountByRef(ref), nextDisplayOrder: order },
          uuid: M.uuid, now: M.stamp(), today: M.today(),
        });
        order += out.created.length;
        records.push(...out.records);
        totals.created.push(...out.created); totals.updated.push(...out.updated);
        totals.balances += out.balances; totals.lines += out.lines;
      });
      await store.saveStatement(records, r.doc);
      state.review = null;
      render();
      const parts = [totals.created.length ? `${totals.created.length} new account${totals.created.length === 1 ? "" : "s"}` : "",
        totals.updated.length ? `${totals.updated.join(", ")} brought up to date` : "",
        `${totals.balances} balance${totals.balances === 1 ? "" : "s"}`, `${totals.lines} line${totals.lines === 1 ? "" : "s"}`].filter(Boolean);
      $("upload-ok").hidden = false;
      $("upload-ok").textContent = `Added to your money: ${parts.join(", ")}.` + (store.backend.kind === "example" ? " (Example: kept in this tab only.)" : " Your iPhone has them the next time WaffleWealth opens.");
    } catch (error) {
      $("review-error").hidden = false;
      $("review-error").textContent = C.explain(error);
      $("review-add").disabled = false;
      if (["CONFLICT", "ATOMIC_ERROR"].includes(error && error.ckErrorCode)) reload(true);
    }
  }

  /* ---------- balances ---------- */

  async function submitBalance(form) {
    const accountId = form.getAttribute("data-balance-form");
    const account = state.store.account(accountId);
    if (!account) return;
    const amount = M.parseAmount($("bal-amount").value, account.f.currency_code);
    const day = $("bal-day").value;
    const problems = state.store.checkBalance(accountId, amount, day);
    $("bal-amount-err").textContent = problems.amount || "";
    $("bal-day-err").textContent = problems.day || "";
    if (problems.amount || problems.day || problems.account) return;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await state.store.recordBalance(accountId, amount.minor, day);
      state.balanceFor = null;
      renderAccounts();
    } catch (error) {
      button.disabled = false;
      $("bal-amount-err").textContent = C.explain(error);
    }
  }

  /* ---------- projection: worked out here, exactly as the app works it out ---------- */

  async function projectionModule() {
    if (globalThis.WWProjection) return globalThis.WWProjection;
    return import("./projection.mjs?v=13");
  }

  /** What the app's engine reads, from iCloud's records. Nil until the phone has sent its settings. */
  function projectionContext(store) {
    const a = store.assumptions();
    if (!a) return null;
    const base = a.f.base_currency_code;
    const codes = new Set([base]);
    const accounts = store.accounts().map((acc) => {
      const latest = store.latest(acc.name);
      codes.add(acc.f.currency_code);
      return {
        kind: acc.f.kind, currency: acc.f.currency_code, invested: Number(acc.f.is_invested) === 1,
        latestMinor: latest ? Number(latest.f.value_minor) : null,
        income: acc.f.income_basis ? {
          basis: acc.f.income_basis, ratePct: acc.f.income_rate_pct || "0", amountMinor: Number(acc.f.income_amount_minor || 0),
          frequency: acc.f.income_frequency || "ANNUAL", reinvested: Number(acc.f.income_reinvested) === 1,
        } : null,
        availableFromAge: acc.f.available_from_age == null ? null : Number(acc.f.available_from_age),
        availableFromMonth: acc.f.available_from_month || null,
      };
    });
    const planned = store.planned(false).map((p) => {
      if (p.f.currency_code) codes.add(p.f.currency_code);
      return { direction: p.f.direction, amountMinor: Number(p.f.amount_minor), currency: p.f.currency_code || null,
        firstDate: p.f.first_date, frequency: p.f.frequency, endsOn: p.f.ends_on || null, growthPct: p.f.growth_pct || "0" };
    });
    const rates = {};
    for (const r of store.of("FXRate")) {
      const code = r.name.replace(/^rate-/, "");
      if (code !== base) { rates[code] = String(r.f.rate); codes.add(code); }
    }
    const scales = {};
    for (const code of codes) scales[code] = M.scale(code);
    return {
      base, scales, rates, accounts, planned,
      assumptions: {
        incomeMinor: Number(a.f.monthly_income_minor), spendingMinor: Number(a.f.monthly_spending_minor),
        raisePct: a.f.annual_raise_pct, raiseMonth: Number(a.f.raise_effective_month), spendingGrowthPct: a.f.annual_spending_growth_pct,
        returnPct: a.f.annual_return_pct, horizonMonths: Number(a.f.horizon_months),
        birthYear: a.f.birth_year == null ? null : Number(a.f.birth_year), birthMonth: a.f.birth_month == null ? null : Number(a.f.birth_month),
      },
    };
  }

  let projectionRun = 0;
  async function renderProjection() {
    const store = state.store;
    const body = $("proj-body");
    if (!store) return;
    const run = ++projectionRun;
    const ctx = projectionContext(store);
    if (!ctx) {
      body.innerHTML = `<p class="empty">Your projection appears here once WaffleWealth on your iPhone has sent your income, spending and accounts: open the app with “Keep a copy in iCloud” on.</p>`;
      return;
    }
    let result;
    try {
      const mod = await projectionModule();
      result = mod.project(ctx, M.today());
    } catch (error) {
      if (run !== projectionRun) return;
      const code = error && error.code;
      body.innerHTML = `<p class="error">${esc(error && error.kind === "missingRate"
        ? `There's no exchange rate for ${code} yet, so the projection can't count money held in it. Add one on your iPhone, under Currencies.`
        : "The projection couldn't be worked out from these figures.")}</p>`;
      return;
    }
    if (run !== projectionRun) return;
    state.projection = result;
    drawProjection(result);
  }

  function drawProjection(p) {
    const base = p.base;
    const months = p.months.map((m) => ({ ...m, nw: Number(m.netWorth), av: Number(m.available), locked: Number(m.locked) }));
    const first = months[0], last = months[months.length - 1];
    const hasLocked = months.some((m) => m.locked !== 0);
    const change = last.nw - first.nw;
    const span = months.length - 1;
    const anyInterest = months.some((m) => m.interest !== 0n);
    const anyPlanned = months.some((m) => m.planned !== 0n);
    const anyGrowth = months.some((m) => m.growth !== 0n);
    const cols = [["Income", "income"], ["Spending", "spending"], anyPlanned && ["Planned", "planned"], anyGrowth && ["Growth", "growth"], anyInterest && ["Interest", "interest"]].filter(Boolean);
    $("proj-body").innerHTML = `
      <div class="proj-hero">
        <div><div class="k">Net worth now</div><div class="v">${esc(M.format(first.nw, base))}</div></div>
        <div><div class="k">In ${esc(M.monthLabel(last.month))}, ${span} month${span === 1 ? "" : "s"} ahead</div><div class="v">${esc(M.format(last.nw, base))}</div>
          <div class="d">${esc(M.formatSigned(change, base))} from now${hasLocked ? ` · ${esc(M.format(last.av, base))} of it within reach` : ""}</div></div>
      </div>
      ${hasLocked ? `<div class="chart-legend"><span><i></i>Net worth</span><span><i class="avail"></i>Available, without what's locked</span></div>` : ""}
      <div class="chart" id="proj-chart" role="img" aria-label="Net worth, ${esc(M.monthLabel(first.month))} to ${esc(M.monthLabel(last.month))}: from ${esc(M.format(first.nw, base))} to ${esc(M.format(last.nw, base))}"></div>
      <p class="cap" style="font-size:0.8rem;color:var(--ink-2);margin:6px 0 0">Worked out here from your accounts, income, spending and plans, the same way WaffleWealth on your iPhone works it out, to the last ${base === "JPY" ? "yen" : "cent"}. It reports figures and doesn't advise.</p>
      <details class="proj-months"><summary>Month by month</summary>
        <div class="proj-scroll"><table class="proj-table"><thead><tr><th>Month</th>${cols.map(([t]) => `<th>${t}</th>`).join("")}<th>Net worth</th></tr></thead>
        <tbody>${months.map((m) => `<tr><td>${esc(M.monthLabel(m.month))}${m.offset === 0 ? " (now)" : ""}</td>${cols.map(([, k]) => `<td>${m.offset === 0 ? "" : esc(M.format(Number(m[k]), base))}</td>`).join("")}<td>${esc(M.format(m.nw, base))}</td></tr>`).join("")}</tbody></table></div>
      </details>`;
    drawChart($("proj-chart"), months, base, hasLocked);
  }

  const compact = (minor, base) => {
    const value = minor / 10 ** M.scale(base);
    return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  };

  function niceTicks(lo, hi, count) {
    if (lo === hi) { lo -= 1; hi += 1; }
    const raw = (hi - lo) / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
    const start = Math.floor(lo / step) * step;
    const ticks = [];
    for (let v = start; v <= hi + step * 0.001; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }

  function drawChart(box, months, base, hasLocked) {
    if (!box) return;
    const W = Math.max(280, box.clientWidth || 640), H = W < 500 ? 200 : 240;
    const pad = { l: 52, r: 14, t: 10, b: 26 };
    const values = months.flatMap((m) => (hasLocked ? [m.nw, m.av] : [m.nw]));
    const ticks = niceTicks(Math.min(...values), Math.max(...values), 4);
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const x = (i) => pad.l + (months.length === 1 ? 0 : (i / (months.length - 1)) * (W - pad.l - pad.r));
    const y = (v) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
    const path = (key) => months.map((m, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(m[key]).toFixed(1)}`).join("");
    const labelAt = [0, Math.floor((months.length - 1) / 2), months.length - 1].filter((v, i, a) => a.indexOf(v) === i);
    const short = (ym) => M.monthLabel(ym).replace(/^(\w{3})\w*/, "$1");
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" aria-hidden="true">
      ${ticks.map((t) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(compact(t, base))}</text>`).join("")}
      ${labelAt.map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === months.length - 1 ? "end" : "middle"}">${esc(short(months[i].month))}</text>`).join("")}
      <path class="wash" d="${path("nw")}L${x(months.length - 1)},${y(lo)}L${x(0)},${y(lo)}Z"/>
      ${hasLocked ? `<path class="avail" d="${path("av")}"/>` : ""}
      <path class="line" d="${path("nw")}"/>
      <line class="cross" id="proj-cross" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/>
      ${hasLocked ? `<circle class="dot dot-avail" id="proj-dot-av" r="4.5" visibility="hidden"/>` : ""}
      <circle class="dot" id="proj-dot" r="4.5" visibility="hidden"/>
      <rect id="proj-hit" x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent"/>
    </svg><div class="tip" id="proj-tip" hidden></div>`;
    const svg = box.querySelector("svg");
    const show = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const scale = W / (rect.width || W);
      const px = (clientX - rect.left) * scale;
      const i = Math.max(0, Math.min(months.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (months.length - 1))));
      const m = months[i];
      const cross = box.querySelector("#proj-cross"), dot = box.querySelector("#proj-dot"), tip = box.querySelector("#proj-tip");
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(m.nw)); dot.setAttribute("visibility", "visible");
      const dotAv = box.querySelector("#proj-dot-av");
      if (dotAv) { dotAv.setAttribute("cx", x(i)); dotAv.setAttribute("cy", y(m.av)); dotAv.setAttribute("visibility", "visible"); }
      tip.hidden = false;
      tip.innerHTML = `${esc(M.monthLabel(m.month))}<br>Net worth <b>${esc(M.format(m.nw, base))}</b>${hasLocked ? `<br>Available <b>${esc(M.format(m.av, base))}</b>` : ""}`;
      tip.style.left = `${(x(i) / W) * 100}%`;
      tip.style.top = `${(y(m.nw) / H) * (rect.height || H)}px`;
    };
    const hide = () => {
      for (const id of ["proj-cross", "proj-dot", "proj-dot-av"]) box.querySelector(`#${id}`)?.setAttribute("visibility", "hidden");
      box.querySelector("#proj-tip").hidden = true;
    };
    const hit = box.querySelector("#proj-hit");
    hit.addEventListener("pointermove", (e) => show(e.clientX));
    hit.addEventListener("pointerdown", (e) => show(e.clientX));
    hit.addEventListener("pointerleave", hide);
  }

  /* ---------- plan: income and spending, planned items ---------- */

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function renderPlan() {
    const store = state.store;
    const a = store.assumptions();
    $("plan-form").hidden = !a;
    $("plan-waiting").hidden = Boolean(a);
    const base = store.baseCurrency();
    if (a && !$("plan-form").contains(document.activeElement)) {
      $("plan-base").textContent = `In ${base}, your base currency. The projection itself is drawn on your iPhone.`;
      $("as-income").value = M.editable(Number(a.f.monthly_income_minor), base);
      $("as-spending").value = M.editable(Number(a.f.monthly_spending_minor), base);
      $("as-raise").value = a.f.annual_raise_pct;
      $("as-growth").value = a.f.annual_spending_growth_pct;
      $("as-ret").value = a.f.annual_return_pct;
      if (!$("as-raise-month").options.length) $("as-raise-month").innerHTML = MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
      $("as-raise-month").value = String(a.f.raise_effective_month);
    }
    if (!$("pi-frequency").options.length) {
      $("pi-frequency").innerHTML = C.FREQUENCIES.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join("");
      $("pi-currency").innerHTML = M.currencies().map((c) => `<option value="${c}">${c} · ${esc(M.currencyName(c))}</option>`).join("");
      resetPlanned();
    }
    // A new item starts in the base currency, which may only be known once the phone's settings arrive.
    if (!state.plannedEditing && !$("pi-name").value && !$("pi-amount").value) $("pi-currency").value = base;
    const active = store.planned(false);
    const away = store.planned(true);
    $("planned-count").textContent = active.length ? `${active.length} planned` : "";
    $("planned").innerHTML = active.length ? active.map((p) => plannedRow(p, base)).join("")
      : `<p class="empty">Nothing planned yet. Add money you know is coming in or going out: a bonus, school fees, a car.</p>`;
    $("planned-away").innerHTML = away.length ? `<div class="month"><h3>Put away</h3></div>` + away.map((p) => plannedRow(p, base, true)).join("") : "";
  }

  /* A planned item as the app shows one: its name, the next date it lands on ("Completed" once
     it has none), then its facts as tags, tinted by the side the money is on (accent in, blue
     out), and the amount in plain ink: a payment planned is not a mistake, so it isn't coloured. */
  const TAG_FREQUENCY = { MONTHLY: "Monthly", QUARTERLY: "Quarterly", SEMIANNUAL: "Half-yearly", ANNUAL: "Yearly" };

  function plannedRow(p, base, away) {
    const code = p.f.currency_code || base;
    const incoming = p.f.direction === "IN";
    const tint = incoming ? "accent" : "owed";
    const next = away ? null : C.nextOccurrence(p, M.today());
    const when = away ? (p.f.frequency === "ONCE" ? M.dayLabel(p.f.first_date) : `From ${M.dayLabel(p.f.first_date)}`) : next ? M.dayLabel(next) : "Completed";
    const tags = [
      M.categoryName(p.f.category) ? `<span class="tag ${tint}">${esc(M.categoryName(p.f.category))}</span>` : "",
      p.f.frequency !== "ONCE" ? `<span class="tag ${tint}"><span aria-hidden="true">↻</span> ${esc(TAG_FREQUENCY[p.f.frequency] || p.f.frequency)}</span>` : "",
      p.f.frequency !== "ONCE" && p.f.growth_pct && Number(p.f.growth_pct) !== 0 ? `<span class="tag ${tint}"><span aria-hidden="true">↗</span> Rises ${esc(p.f.growth_pct)}%/yr</span>` : "",
    ].join("");
    const inBase = p.f.currency_code && p.f.currency_code !== base ? `<span class="d">in ${esc(code)}</span>` : "";
    const acts = away
      ? `<button type="button" class="linkbtn" data-planned-restore="${esc(p.name)}">Put back</button><button type="button" class="linkbtn danger" data-planned-delete="${esc(p.name)}">Delete</button>`
      : `<button type="button" class="linkbtn" data-planned-edit="${esc(p.name)}">Edit</button><button type="button" class="linkbtn" data-planned-away="${esc(p.name)}">Put away</button>`;
    return `<div class="row plain${state.plannedEditing && state.plannedEditing.name === p.name ? " editing" : ""}">
      <div class="main"><span class="t">${esc(p.f.name)}</span><span class="d">${esc(when)}</span>
        ${tags ? `<span class="tags">${tags}</span>` : ""}<span class="acts">${acts}</span></div>
      <div class="end"><span class="amt">${esc(M.formatSigned(incoming ? Number(p.f.amount_minor) : -Number(p.f.amount_minor), code))}</span>${inBase}</div>
    </div>`;
  }

  const plannedDirection = () => ($("pi-in").checked ? "IN" : "OUT");

  function fillPlannedCategories(selected) {
    const list = plannedDirection() === "IN" ? M.categories.in : M.categories.out;
    $("pi-category").innerHTML = `<option value="">Not said</option>` + list.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join("");
    $("pi-category").value = list.some(([k]) => k === selected) ? selected : "";
  }

  function showEnds() { $("pi-ends-field").hidden = $("pi-frequency").value === "ONCE"; }

  function resetPlanned() {
    state.plannedEditing = null;
    $("pi-title").textContent = "Add a planned item";
    $("pi-cancel").hidden = true;
    $("pi-out").checked = true;
    for (const id of ["pi-name", "pi-amount", "pi-ends", "pi-growth"]) $(id).value = "";
    $("pi-first").value = M.today();
    $("pi-frequency").value = "ONCE";
    $("pi-currency").value = state.store ? state.store.baseCurrency() : "USD";
    fillPlannedCategories("");
    showEnds();
    clearErrors("pi", ["name", "amount", "firstDate", "frequency", "endsOn", "growth"]);
  }

  function editPlanned(name) {
    const p = state.store.rows.get(name);
    if (!p) return;
    state.plannedEditing = p;
    const code = p.f.currency_code || state.store.baseCurrency();
    $("pi-title").textContent = "Edit planned item";
    $("pi-cancel").hidden = false;
    $(p.f.direction === "IN" ? "pi-in" : "pi-out").checked = true;
    $("pi-name").value = p.f.name;
    $("pi-currency").value = code;
    $("pi-amount").value = M.editable(Number(p.f.amount_minor), code);
    $("pi-first").value = p.f.first_date;
    $("pi-frequency").value = p.f.frequency;
    $("pi-ends").value = p.f.ends_on || "";
    $("pi-growth").value = p.f.growth_pct && p.f.growth_pct !== "0" ? p.f.growth_pct : "";
    fillPlannedCategories(p.f.category);
    showEnds();
    clearErrors("pi", ["name", "amount", "firstDate", "frequency", "endsOn", "growth"]);
    $("pi-ok").hidden = true;
    renderPlan();
    $("pi-name").focus();
  }

  function clearErrors(prefix, keys) {
    for (const key of keys) { const el = $(`${prefix}-${key}-err`); if (el) el.textContent = ""; }
    const error = $(`${prefix === "as" ? "plan" : prefix}-error`);
    if (error) error.hidden = true;
  }

  function showProblems(prefix, problems) {
    let first = null;
    for (const [key, text] of Object.entries(problems)) {
      const el = $(`${prefix}-${key}-err`);
      if (el) { el.textContent = text; first = first || el; }
    }
    if (first) { const input = first.parentElement.querySelector("input, select"); if (input) input.focus(); }
    return Boolean(first);
  }

  function savedMessage(id, text) {
    $(id).hidden = false;
    $(id).textContent = state.store.backend.kind === "example" ? "Saved, in this tab. With iCloud it would be on your iPhone the next time WaffleWealth opens." : text;
  }

  async function submitAssumptions(event) {
    event.preventDefault();
    const store = state.store;
    const base = store.baseCurrency();
    clearErrors("as", ["income", "spending", "raise", "raiseMonth", "growth", "ret"]);
    $("plan-ok").hidden = true;
    const draft = {
      income: M.parseAmount($("as-income").value, base),
      spending: M.parseAmount($("as-spending").value, base),
      raise: M.parsePercent($("as-raise").value),
      raiseMonth: Number($("as-raise-month").value),
      growth: M.parsePercent($("as-growth").value),
      ret: M.parsePercent($("as-ret").value),
    };
    if (showProblems("as", store.checkAssumptions(draft))) return;
    $("plan-save").disabled = true;
    try {
      await store.saveAssumptions(draft);
      savedMessage("plan-ok", "Saved to iCloud. Your iPhone redraws the projection with it the next time WaffleWealth opens.");
      renderPlan();
    } catch (error) {
      $("plan-error").hidden = false;
      $("plan-error").textContent = C.explain(error);
      if (["CONFLICT", "ATOMIC_ERROR"].includes(error && error.ckErrorCode)) reload(true);
    } finally {
      $("plan-save").disabled = false;
    }
  }

  async function submitPlanned(event) {
    event.preventDefault();
    const store = state.store;
    clearErrors("pi", ["name", "amount", "firstDate", "frequency", "endsOn", "growth"]);
    $("pi-ok").hidden = true;
    const currency = $("pi-currency").value;
    const draft = {
      direction: plannedDirection(),
      name: $("pi-name").value,
      amount: M.parseAmount($("pi-amount").value, currency),
      currency,
      firstDate: $("pi-first").value,
      frequency: $("pi-frequency").value,
      endsOn: $("pi-frequency").value === "ONCE" ? "" : $("pi-ends").value,
      growth: M.parsePercent($("pi-growth").value),
      category: $("pi-category").value || null,
    };
    if (showProblems("pi", store.checkPlanned(draft))) return;
    $("pi-save").disabled = true;
    try {
      const editing = state.plannedEditing;
      await store.savePlanned(draft, editing);
      resetPlanned();
      renderPlan();
      savedMessage("pi-ok", editing ? "Changes saved to iCloud." : "Saved to iCloud. It'll be on your iPhone the next time WaffleWealth opens.");
    } catch (error) {
      $("pi-error").hidden = false;
      $("pi-error").textContent = C.explain(error);
      if (["CONFLICT", "ATOMIC_ERROR"].includes(error && error.ckErrorCode)) reload(true);
    } finally {
      $("pi-save").disabled = false;
    }
  }

  async function plannedAction(kind, name) {
    const p = state.store.rows.get(name);
    if (!p) return;
    try {
      if (kind === "edit") return editPlanned(name);
      if (kind === "away") await state.store.setPlannedArchived(p, true);
      if (kind === "restore") await state.store.setPlannedArchived(p, false);
      if (kind === "delete") {
        if (!confirm(`Delete “${p.f.name}”? It goes from your iPhone too.`)) return;
        await state.store.deleteRecord(p);
      }
      if (state.plannedEditing && state.plannedEditing.name === name) resetPlanned();
      renderPlan();
    } catch (error) {
      showError(C.explain(error));
    }
  }

  async function submitAccount(form) {
    const account = state.store.account(form.getAttribute("data-account-form"));
    if (!account) return;
    const draft = { name: $("acc-name").value, invested: $("acc-invested").checked };
    const problems = state.store.checkAccount(draft);
    $("acc-name-err").textContent = problems.name || "";
    if (problems.name) return;
    try {
      await state.store.saveAccount(account, draft);
      state.accountFor = null;
      render();
    } catch (error) {
      $("acc-name-err").textContent = C.explain(error);
    }
  }

  async function setAccountAway(name, away) {
    const account = state.store.rows.get(name);
    if (!account) return;
    if (away && !confirm(`Put “${account.f.name}” away? It leaves your totals and the projection, and keeps its history. You can put it back.`)) return;
    try {
      await state.store.saveAccount(account, { name: account.f.name, invested: Number(account.f.is_invested) === 1, archived: away });
      state.accountFor = null;
      render();
    } catch (error) {
      showError(C.explain(error));
    }
  }

  /* ---------- wiring ---------- */

  function wire() {
    $("try-example").addEventListener("click", () => open(new C.MemoryBackend()));
    $("leave-example").addEventListener("click", showWelcome);
    $("refresh").addEventListener("click", () => reload(true));
    for (const name of TABS) {
      $(`tab-${name}`).addEventListener("click", () => choose(name));
    }
    // Arrow keys move between the tabs, as a tab list should.
    document.querySelector(".chips").addEventListener("keydown", (e) => {
      const order = TABS;
      const i = order.indexOf(state.tab);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const next = order[(i + (e.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
        choose(next);
        $(`tab-${next}`).focus();
      }
    });

    const drop = $("drop");
    $("file").addEventListener("change", (e) => { upload([...e.target.files]); e.target.value = ""; });
    for (const type of ["dragenter", "dragover"]) drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add("over"); });
    for (const type of ["dragleave", "drop"]) drop.addEventListener(type, () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); upload([...(e.dataTransfer ? e.dataTransfer.files : [])]); });

    $("docs").addEventListener("click", (e) => {
      const button = e.target.closest("[data-remove-doc]");
      if (button) removeDocument(button.getAttribute("data-remove-doc"));
      const download = e.target.closest("[data-download-doc]");
      if (download) downloadDocument(download.getAttribute("data-download-doc"));
      const read = e.target.closest("[data-read-doc]");
      if (read) readHere(read.getAttribute("data-read-doc"));
    });

    $("txn-form").addEventListener("submit", submitTransaction);
    $("txn-cancel").addEventListener("click", () => { resetForm(); renderTransactions(); });
    $("txn-delete").addEventListener("click", deleteEditing);
    for (const id of ["dir-in", "dir-out"]) $(id).addEventListener("change", () => fillCategories(direction(), $("txn-category").value));
    $("txn-account").addEventListener("change", () => {
      const account = state.store && state.store.account($("txn-account").value);
      if (account) fillCurrencySelect(account.f.currency_code);
    });
    const txns = $("txns");
    const activate = (target) => {
      const row = target.closest("[data-edit]");
      if (row) { editTransaction(row.getAttribute("data-edit")); return true; }
      const movement = target.closest("[data-movement]");
      if (movement) {
        const key = movement.getAttribute("data-movement");
        if (state.open.has(key)) state.open.delete(key); else state.open.add(key);
        renderTransactions();
        return true;
      }
      return false;
    };
    txns.addEventListener("click", (e) => activate(e.target));
    txns.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target.closest("[data-edit], [data-movement]")) { e.preventDefault(); activate(e.target); }
    });
    for (const id of ["group-month", "group-account"]) $(id).addEventListener("change", (e) => setGrouping(e.target.value));

    const accts = $("accts");
    accts.addEventListener("click", (e) => {
      const open = e.target.closest("[data-balance]");
      if (open) { state.balanceFor = open.getAttribute("data-balance"); state.accountFor = null; renderAccounts(); return; }
      if (e.target.closest("[data-cancel-balance]")) { state.balanceFor = null; renderAccounts(); return; }
      const edit = e.target.closest("[data-account-edit]");
      if (edit) { state.accountFor = edit.getAttribute("data-account-edit"); state.balanceFor = null; renderAccounts(); return; }
      if (e.target.closest("[data-cancel-account]")) { state.accountFor = null; renderAccounts(); return; }
      const away = e.target.closest("[data-account-away]");
      if (away) setAccountAway(away.getAttribute("data-account-away"), true);
    });
    accts.addEventListener("submit", (e) => {
      const form = e.target.closest("[data-balance-form]");
      if (form) { e.preventDefault(); submitBalance(form); return; }
      const accountForm = e.target.closest("[data-account-form]");
      if (accountForm) { e.preventDefault(); submitAccount(accountForm); }
    });
    $("accts-away").addEventListener("click", (e) => {
      const back = e.target.closest("[data-account-restore]");
      if (back) setAccountAway(back.getAttribute("data-account-restore"), false);
    });

    const review = $("review");
    review.addEventListener("change", (e) => {
      const box = e.target.closest("[data-review-include]");
      if (!box || !state.review) return;
      const [si, ai] = box.getAttribute("data-review-include").split(":").map(Number);
      state.review.choices[si][ai].include = box.checked;
      renderReview();
    });
    review.addEventListener("input", (e) => {
      const input = e.target.closest("[data-review-name]");
      if (!input || !state.review) return;
      const [si, ai] = input.getAttribute("data-review-name").split(":").map(Number);
      state.review.choices[si][ai].name = input.value;
    });
    review.addEventListener("click", (e) => {
      if (e.target.closest("#review-add")) addReviewed();
      if (e.target.closest("#review-cancel")) { state.review = null; renderReview(); }
    });

    $("plan-form").addEventListener("submit", submitAssumptions);
    $("pi-form").addEventListener("submit", submitPlanned);
    $("pi-cancel").addEventListener("click", () => { resetPlanned(); renderPlan(); });
    for (const id of ["pi-in", "pi-out"]) $(id).addEventListener("change", () => fillPlannedCategories($("pi-category").value));
    $("pi-frequency").addEventListener("change", showEnds);
    for (const id of ["planned", "planned-away"]) {
      $(id).addEventListener("click", (e) => {
        for (const kind of ["edit", "away", "restore", "delete"]) {
          const button = e.target.closest(`[data-planned-${kind}]`);
          if (button) { plannedAction(kind, button.getAttribute(`data-planned-${kind}`)); return; }
        }
      });
    }

    let resizing = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizing);
      resizing = setTimeout(() => { if (state.tab === "projection" && state.projection) drawProjection(state.projection); }, 150);
    });

    // Coming back to the tab is when a phone's change is most likely waiting.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.store && state.store.backend.kind === "icloud") reload(true);
    });
  }

  wire();
  choose("documents");
  resetForm();
  if (new URLSearchParams(location.search).has("example")) {
    open(new C.MemoryBackend());
  } else if (globalThis.CloudKit) {
    startICloud();
  } else {
    window.addEventListener("cloudkitloaded", startICloud, { once: true });
    // A blocked or failed script never fires the event: say so rather than wait forever.
    const script = $("cloudkit-js");
    if (script) script.addEventListener("error", () => {
      if (!CONFIG.apiToken) { $("not-ready").hidden = false; return; }
      $("start-error").hidden = false;
      $("start-error").textContent = "Apple's iCloud library didn't load. Check the connection, or whether something in the browser blocks it.";
    });
    if (!CONFIG.apiToken) { $("not-ready").hidden = false; $("apple-sign-in-button").hidden = true; }
  }

  globalThis.WWApp = { state, open, render, reload, CONFIG, startICloud };
})();
