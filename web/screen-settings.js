/* WaffleWealth on the web: Settings, as the app lays it out, and the rest of Income & spending.

   The main currency (changing it restates income, spending, planned amounts that follow it and
   the target, and re-expresses every rate, exactly as the app does), appearance, hiding amounts,
   exchange rates, saving your figures as files in the app's formats, and what stays on the
   phone. Income & spending gains pay day, the historical references and the rates. */
(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M, $ } = WW;
  const ui = WW.ui;
  const S = WW.screens;

  /** Assumptions.changeBaseCurrency, as one request iCloud keeps whole. */
  async function changeBase(newBase, typedRate) {
    const store = WW.state.store, { P } = await WW.engines(), Dec = P.Dec;
    const oldBase = store.baseCurrency();
    if (newBase === oldBase) return;
    const rates = store.rates();
    const row = rates.find((r) => r.code === newBase);
    const pivot = typedRate ? Dec.of(typedRate) : row ? Dec.of(row.rate) : null;
    if (!pivot || pivot.sign() <= 0) throw { reason: `Enter how many ${oldBase} one ${newBase} is worth first.` };
    const now = M.stamp();
    const out = [];
    const history = store.rateHistory();
    const version = (code, rate, source) => {
      const last = history.filter((v) => v.f.quote_code === code).pop();
      if (!last || String(last.f.rate) !== rate || last.f.source !== source) {
        out.push({ name: M.uuid().replace(/-/g, ""), type: "FXRateVersion", f: { quote_code: code, rate, source, valid_from: now, written_order: Date.now() + out.length } });
      }
    };
    for (const r of rates.filter((x) => x.code !== newBase)) {
      const derived = Dec.of(r.rate).div(pivot).round(10).toString();
      out.push({ name: `rate-${r.code}`, type: "FXRate", tag: r.record.tag, f: { rate: derived, source: r.source, updated_at: now } });
      version(r.code, derived, r.source);
    }
    const pivotSource = row ? row.source : "MANUAL";
    const inverse = Dec.int(1).div(pivot).round(10).toString();
    const oldRow = store.rows.get(`rate-${oldBase}`);
    out.push({ name: `rate-${oldBase}`, type: "FXRate", tag: oldRow ? oldRow.tag : undefined, f: { rate: inverse, source: pivotSource, updated_at: now } });
    version(oldBase, inverse, pivotSource);
    const shift = M.scale(newBase) - M.scale(oldBase);
    const conv = (minor) => {
      const v = Dec.int(minor).div(pivot).shift(shift).round(0).exactInt64();
      if (v == null) throw { reason: "An amount would be too large in that currency." };
      return Number(v);
    };
    const a = store.assumptions();
    const f = { ...a.f, base_currency_code: newBase, monthly_income_minor: conv(a.f.monthly_income_minor), monthly_spending_minor: conv(a.f.monthly_spending_minor), updated_at: now };
    out.push({ name: a.name, type: "Assumptions", tag: a.tag, f });
    const line = { written_order: Date.now() + out.length, valid_from: now };
    for (const k of ["base_currency_code", "monthly_income_minor", "monthly_spending_minor", "annual_raise_pct", "raise_effective_month", "annual_spending_growth_pct", "annual_return_pct"]) line[k] = f[k];
    out.push({ name: M.uuid().replace(/-/g, ""), type: "AssumptionVersion", f: line });
    for (const p of store.of("PlannedItem").filter((x) => !x.f.currency_code)) out.push({ name: p.name, type: "PlannedItem", tag: p.tag, f: { ...p.f, amount_minor: conv(p.f.amount_minor) } });
    const t = store.target();
    if (t) out.push({ name: t.name, type: "Target", tag: t.tag, f: { ...t.f, amount_minor: conv(t.f.amount_minor), updated_at: now } });
    const saved = await store.backend.save(out, { atomic: true });
    for (const r of saved) store.rows.set(r.name, r);
    if (row) await store.drop(row.record);
  }

  S.changeBase = changeBase;
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M, $ } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const sv = { newBase: null, note: "", exportOpen: false };
  const THEME = "ww.theme";
  const applyTheme = () => {
    const t = ui.read(THEME);
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
  };
  applyTheme();

  function render() {
    const store = WW.state.store, box = $("settings-body");
    if (!store) return;
    box.dataset.screen = "1";
    if (box.contains(document.activeElement) && document.activeElement.matches("input")) return;
    const base = store.baseCurrency(), a = store.assumptions();
    const theme = ui.read(THEME) || "system";
    const needsRate = sv.newBase && sv.newBase !== base && !store.rows.get(`rate-${sv.newBase}`);
    box.innerHTML = `<div class="stack1">
      <div class="card summary"><h2>Currency</h2>
        <div class="sumrow"><span>Main currency<small>Every total is shown in it.</small></span><span class="amt"><select class="mini" id="set-base" ${a ? "" : "disabled"}>${M.currencies().map((c) => `<option ${c === (sv.newBase || base) ? "selected" : ""}>${c}</option>`).join("")}</select></span></div>
        ${sv.newBase && sv.newBase !== base ? `<form id="base-form" class="sumrow"><span>${needsRate ? `1 ${esc(sv.newBase)} = how many ${esc(base)}?` : `Switch to ${esc(sv.newBase)}?`}<small>Every other rate, your monthly income and spending, planned amounts in ${esc(base)} and the target will be restated in ${esc(sv.newBase)}.</small></span>
          <span class="amt row-inline">${needsRate ? `<input class="rate" id="base-rate" inputmode="decimal" aria-label="Rate">` : ""}<button type="submit" class="btn small">Switch</button><button type="button" class="linkbtn" data-set="cancel-base">Cancel</button></span></form>` : ""}
        <p class="cap foot">Changing it restates what you have typed, and needs a rate.</p></div>
      <div class="card list"><button type="button" class="rowlink" data-set="assumptions"><span>Income &amp; spending<small class="cap2">Income, spending, pay rises, growth and pay day</small></span><span class="cap">›</span></button></div>
      <div class="card"><h2>Appearance</h2><div class="segs">${[["system", "System"], ["light", "Light"], ["dark", "Dark"]].map(([k, l]) => `<button type="button" class="segbtn" data-theme-set="${k}" aria-pressed="${theme === k}">${l}</button>`).join("")}</div></div>
      <div class="card"><h2>Privacy</h2><label class="check"><input type="checkbox" id="set-hide" ${ui.isHidden() ? "checked" : ""}> Hide amounts</label>
        <p class="cap">Hidden amounts show as dots, on this browser. Locking with Face ID is set on your iPhone.</p></div>
      ${S.ratesSection(store)}
      <div class="card summary"><h2>Save your figures</h2>
        <div class="formacts wrap"><button type="button" class="btn ghost small" data-export="csv">Balances as a spreadsheet</button><button type="button" class="btn ghost small" data-export="json">Everything as a file</button><button type="button" class="btn ghost small" data-export="open">An encrypted copy</button></div>
        ${sv.exportOpen ? `<form id="backup-form" class="two" novalidate><div class="field"><label for="bk-pass">Passphrase</label><input type="password" id="bk-pass" autocomplete="new-password"></div>
          <div class="field"><label for="bk-pass2">Confirm passphrase</label><input type="password" id="bk-pass2" autocomplete="new-password"></div>
          <div class="formacts"><button type="submit" class="btn small">Save the encrypted copy</button><span class="err" id="bk-err"></span></div>
          <p class="cap">At least 8 characters. Without it nobody can open the file, including you.</p></form>` : ""}
        <p class="cap foot">Made here, in the formats the app saves. The encrypted copy needs its passphrase to open, and WaffleWealth can't load it back in yet: keep the spreadsheet or the full file too.</p></div>
      <div class="card"><h2>On your iPhone</h2><p class="cap">The Face ID lock, the monthly reminder to update balances, and reading statements that are pictures of their pages work in WaffleWealth on your iPhone. Everything else is here too.</p></div>
      ${sv.note ? `<p class="ok">${esc(sv.note)}</p>` : ""}<p class="error" id="set-error" role="alert" hidden></p>
    </div>`;
  }

  S.settingsView = sv;
  S.settings = { render, applyTheme, THEME };
  WW.PAGES.__settings = render;
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { M, $ } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const sv = S.settingsView;
  const box = $("settings-body");
  const fail = (error) => { const el = $("set-error"); if (el) { el.hidden = false; el.textContent = error && error.reason && !error.ckErrorCode ? error.reason : WW.C.explain(error); } };

  const exporter = () => globalThis.WWExport || import("./export.mjs?v=23");

  function download(name, data, type) {
    const blob = new Blob([data], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async function snapshot() {
    const X = await exporter();
    const store = WW.state.store;
    return { X, snap: X.snapshot([...store.rows.values()], { now: M.stamp(), scaleOf: M.scale, nameOf: M.currencyName }) };
  }

  box.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-set],[data-theme-set],[data-export]");
    if (!t) return;
    try {
      if (t.dataset.set === "assumptions") return WW.show("settings", { page: "assumptions" });
      if (t.dataset.set === "cancel-base") { sv.newBase = null; return S.settings.render(); }
      if (t.dataset.themeSet) { ui.write(S.settings.THEME, t.dataset.themeSet === "system" ? null : t.dataset.themeSet); S.settings.applyTheme(); return S.settings.render(); }
      const day = M.today();
      if (t.dataset.export === "csv") { const { X, snap } = await snapshot(); download(`WaffleWealth balances ${day}.csv`, X.csv(snap, (k) => (M.accountCategory(k) || {}).name), "text/csv"); }
      if (t.dataset.export === "json") { const { X, snap } = await snapshot(); download(`WaffleWealth ${day}.json`, X.json(snap), "application/json"); }
      if (t.dataset.export === "open") { sv.exportOpen = !sv.exportOpen; S.settings.render(); }
    } catch (error) { fail(error); }
  });
  box.addEventListener("change", (e) => {
    if (e.target.id === "set-base") { sv.newBase = e.target.value; sv.note = ""; S.settings.render(); }
    if (e.target.id === "set-hide") ui.setHidden(e.target.checked);
  });
  box.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      if (e.target.id === "base-form") {
        const typed = $("base-rate") ? $("base-rate").value.trim().replace(/,/g, "") : null;
        if (typed != null && !(/^\d+(\.\d+)?$/.test(typed) && Number(typed) > 0)) throw { reason: "Enter a rate greater than zero." };
        const to = sv.newBase;
        await S.changeBase(to, typed);
        sv.newBase = null; sv.note = `Everything is now shown in ${to}.`;
        WW.render();
      }
      if (e.target.id === "backup-form") {
        const p1 = $("bk-pass").value, p2 = $("bk-pass2").value;
        if ([...p1].length < 8) { $("bk-err").textContent = "At least 8 characters."; return; }
        if (p1 !== p2) { $("bk-err").textContent = "The passphrases don't match."; return; }
        $("bk-err").textContent = "Encrypting…";
        const { X, snap } = await snapshot();
        const bytes = await X.seal(X.json(snap), p1);
        download(`WaffleWealth backup ${M.today()}.wwbackup`, bytes, "application/octet-stream");
        sv.exportOpen = false; sv.note = "The encrypted copy is saved.";
        S.settings.render();
      }
    } catch (error) { fail(error); }
  });
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M } = WW;
  const S = WW.screens;
  const REFERENCE = [["US large companies", "10.4%", "1996–2025, dividends reinvested", "S&P 500 total return"],
    ["US large companies, after inflation", "7.4%", "1996–2025, dividends reinvested, CPI-adjusted", "S&P 500 total return"],
    ["US large companies", "10.0%", "1928–2025, dividends reinvested", "S&P 500 total return"]];
  const INFLATION = [["US prices", "2.5%", "1996–2025, consumer prices", "US CPI-U"], ["US prices", "3.1%", "1928–2025, consumer prices", "US CPI-U"]];
  const refs = (list) => list.map(([n, p, period, src]) => `<div class="sumrow"><span>${esc(n)}<small>${esc(period)} · ${esc(src)}</small></span><span class="amt">${esc(p)}</span></div>`).join("");

  function more(arg, box) {
    const store = WW.state.store, a = store.assumptions();
    if (!a || (box.contains(document.activeElement) && document.activeElement.matches("input,select"))) return;
    const day = a.f.income_day == null ? "" : String(a.f.income_day);
    box.innerHTML = `<div class="stack1">
      <div class="card summary"><h2>Pay day</h2>
        <div class="sumrow"><span>Pay lands on<small>Changes no projected figure. History uses it to say how far each date sits from pay.</small></span><span class="amt"><select class="mini" id="as-payday"><option value="">Not set</option>${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${String(i + 1) === day ? "selected" : ""}>${i + 1}${["st", "nd", "rd"][((i + 1) % 10) - 1] && ![11, 12, 13].includes(i + 1) ? ["st", "nd", "rd"][((i + 1) % 10) - 1] : "th"}</option>`).join("")}</select></span></div></div>
      <details class="card sumgroup"><summary><span>Historical market returns</span></summary>${refs(REFERENCE)}<p class="cap">What these did, over the years named. Not what yours will do, and not a recommendation.</p></details>
      <details class="card sumgroup"><summary><span>Historical inflation</span></summary>${refs(INFLATION)}<p class="cap">What prices did, over the years named. Your own costs (rent, school fees, a mortgage) move differently from an index.</p></details>
      ${S.ratesSection(store)}
      <div class="card list"><button type="button" class="rowlink" data-go-settings><span>Main currency<small class="cap2">In ${esc(store.baseCurrency())}. Change it in Settings.</small></span><span class="cap">›</span></button></div>
    </div>`;
  }

  WW.PAGES.assumptions.render = more;
  const box = document.getElementById("assumptions-more");
  box.addEventListener("change", async (e) => {
    if (e.target.id !== "as-payday") return;
    try { await WW.state.store.patchAssumptions({ income_day: e.target.value ? Number(e.target.value) : null }); } catch (error) { WW.$("work-error").hidden = false; WW.$("work-error").textContent = WW.C.explain(error); }
  });
  box.addEventListener("click", (e) => { if (e.target.closest("[data-go-settings]")) WW.show("settings"); });
})();
