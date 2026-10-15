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

  const state = { store: null, tab: "documents", editing: null, balanceFor: null };

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
    for (const name of ["documents", "transactions", "accounts"]) {
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
    fillAccountSelect();
  }

  const STATUS = {
    NEW: ["Waiting for your iPhone", "new"],
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
      return `<div class="row">
        <span class="ic" aria-hidden="true">${icon(d.f.file_name)}</span>
        <div class="main"><span class="t">${esc(d.f.file_name)}</span>
          <span class="d">${esc(when)} · ${esc(M.bytes(Number(d.f.byte_count) || 0))} · ${esc(from)}${d.f.note ? " · " + esc(d.f.note) : ""}</span>
          <span class="acts">${download}<button type="button" class="linkbtn danger" data-remove-doc="${esc(d.name)}">Remove</button></span></div>
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

  function renderTransactions() {
    const store = state.store;
    const all = store.activity();
    $("txns-count").textContent = all.length ? `${all.length} in all` : "";
    $("txns-legend").hidden = !all.some((e) => e.kind === "auto");
    if (!all.length) {
      $("txns").innerHTML = `<p class="empty">No transactions yet. Add one with the form; it appears on your iPhone under Activity. Statements you add show their lines here too.</p>`;
      return;
    }
    const months = new Map();
    for (const entry of all) {
      const key = String(entry.day).slice(0, 7);
      if (!months.has(key)) months.set(key, []);
      months.get(key).push(entry);
    }
    let html = "";
    for (const [ym, list] of months) {
      // In and out per currency. A move between your own accounts is listed and not counted;
      // interest is money in; everything else counts by its sign.
      const totals = new Map();
      for (const entry of list) {
        const r = entry.record;
        if (entry.kind === "auto" && r.f.line_kind === "own") continue;
        const code = entry.kind === "auto" ? r.currency : r.f.currency_code;
        const minor = Number(r.f.amount_minor);
        const sum = totals.get(code) || { in: 0, out: 0 };
        if (minor > 0) sum.in += minor; else sum.out -= minor;
        totals.set(code, sum);
      }
      const tot = [...totals].map(([code, v]) => [v.in ? `In ${M.format(v.in, code)}` : "", v.out ? `Out ${M.format(v.out, code)}` : ""].filter(Boolean).join(" · ")).filter(Boolean).join("<br>");
      html += `<div class="month"><h3>${esc(M.monthLabel(ym))}</h3><span class="tot">${tot}</span></div>`;
      html += list.map((entry) => entry.kind === "manual" ? manualRow(entry.record) : autoRow(entry.record)).join("");
    }
    $("txns").innerHTML = html;
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
        const form = open ? `<form class="inline-form" data-balance-form="${esc(a.name)}" novalidate>
            <div class="field"><label for="bal-amount">New balance (${esc(a.f.currency_code)})</label><input id="bal-amount" inputmode="decimal" autocomplete="off" placeholder="0.00"><span class="err" id="bal-amount-err"></span></div>
            <div class="field"><label for="bal-day">As of</label><input type="date" id="bal-day" value="${esc(M.today())}"><span class="err" id="bal-day-err"></span></div>
            <button type="submit" class="btn small">Save to iCloud</button>
            <button type="button" class="linkbtn" data-cancel-balance>Cancel</button>
          </form>` : "";
        return `<div class="row">
          <span class="ic" aria-hidden="true">${esc(a.f.currency_code)}</span>
          <div class="main"><span class="t">${esc(a.f.name)}</span><span class="d">${a.f.kind === "LIABILITY" ? '<span class="pill owed">Owed</span> ' : ""}${esc(asOf)}</span>
            ${open ? "" : `<span class="acts"><button type="button" class="linkbtn" data-balance="${esc(a.name)}">Update balance</button></span>`}</div>
          <div class="end"><span class="amt">${esc(value)}</span></div>
          ${form}
        </div>`;
      }).join("");
    };
    $("accts").innerHTML = section("ASSET", "What you own") + section("LIABILITY", "What you owe");
    if (state.balanceFor) { const input = $("bal-amount"); if (input) input.focus(); }
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
        + (store.backend.kind === "example" ? " (Example: kept in this tab only.)" : " Open WaffleWealth on your iPhone and it's under Activity.");
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

  /* ---------- wiring ---------- */

  function wire() {
    $("try-example").addEventListener("click", () => open(new C.MemoryBackend()));
    $("leave-example").addEventListener("click", showWelcome);
    $("refresh").addEventListener("click", () => reload(true));
    for (const name of ["documents", "transactions", "accounts"]) {
      $(`tab-${name}`).addEventListener("click", () => choose(name));
    }
    // Arrow keys move between the tabs, as a tab list should.
    document.querySelector(".chips").addEventListener("keydown", (e) => {
      const order = ["documents", "transactions", "accounts"];
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
    txns.addEventListener("click", (e) => {
      const row = e.target.closest("[data-edit]");
      if (row) editTransaction(row.getAttribute("data-edit"));
    });
    txns.addEventListener("keydown", (e) => {
      const row = e.target.closest("[data-edit]");
      if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); editTransaction(row.getAttribute("data-edit")); }
    });

    const accts = $("accts");
    accts.addEventListener("click", (e) => {
      const open = e.target.closest("[data-balance]");
      if (open) { state.balanceFor = open.getAttribute("data-balance"); renderAccounts(); return; }
      if (e.target.closest("[data-cancel-balance]")) { state.balanceFor = null; renderAccounts(); }
    });
    accts.addEventListener("submit", (e) => {
      const form = e.target.closest("[data-balance-form]");
      if (form) { e.preventDefault(); submitBalance(form); }
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
