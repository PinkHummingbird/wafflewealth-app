/* WaffleWealth on the web: Your money, as the app lays it out.

   Accounts with their tags, what each debt clears by and when locked money unlocks, filtered by
   side and currency and sorted per section; an account on its own page (its recorded balances,
   where it heads on its own terms, entries taken back and put back, its statement lines); the
   account form in full; updating every balance at once; currencies; and planned items filtered
   and sorted as the app does. */
(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const mv = { side: "all", currency: "", plannedSide: "all" };
  const FREQ = { MONTHLY: "monthly", QUARTERLY: "quarterly", SEMIANNUAL: "twice a year", ANNUAL: "yearly" };

  /** The tags under an account's name, as the app writes them. */
  function tags(acc, ret) {
    const out = [];
    const cat = M.accountCategory(acc.f.category);
    if (cat) out.push(`<span class="tag">${esc(cat.tag)}</span>`);
    if (Number(acc.f.is_invested)) out.push(`<span class="tag accent">${Number(ret) === 0 ? "Set to grow" : `Grows ${esc(ui.pct(ret))}/yr`}</span>`);
    if (acc.f.income_basis) {
      const owed = acc.f.kind === "LIABILITY";
      const what = acc.f.income_basis === "RATE" ? `${ui.pct(acc.f.income_rate_pct, 3)}/yr` : ui.fmt(acc.f.income_amount_minor || 0, acc.f.currency_code);
      out.push(`<span class="tag ${owed ? "owed" : ""}">${owed ? "Costs" : "Earns"} ${esc(what)}</span>`);
      out.push(`<span class="tag">${Number(acc.f.income_reinvested) ? "Compounds" : "Paid"} ${esc(FREQ[acc.f.income_frequency] || "yearly")}</span>`);
    }
    return out.join("");
  }

  /** The debt's clearing line and the money's unlocking line, from the readings. */
  function lines(acc, w) {
    const out = [];
    if (!w || !w.R) return "";
    const ctxAcc = w.ctx && w.ctx.accounts.find((a) => a.id === acc.name);
    if (acc.f.kind === "LIABILITY" && ctxAcc && ctxAcc.latestMinor != null) {
      const c = w.R.debtClearance(ctxAcc.latestMinor, ctxAcc.income, w.today);
      const text = { clears: c.month && `Paid off by ${M.monthLabel(c.month)}`, neverAtThisPayment: "The payment covers the interest and no more: it never clears",
        growing: "Growing: more is being added than paid off", beyondCap: "More than 50 years to clear at this payment" }[c.kind];
      if (text) out.push(`<span class="d ${c.kind === "growing" ? "down" : ""}">${esc(text)}</span>`);
    }
    if (acc.f.kind === "ASSET" && (acc.f.available_from_age != null || acc.f.available_from_month)) {
      const a = w.ctx.assumptions;
      const birth = a.birthYear != null && a.birthMonth != null ? `${a.birthYear}-${String(a.birthMonth).padStart(2, "0")}` : null;
      if (acc.f.available_from_age != null && !birth) out.push(`<span class="d">Add your date of birth to date this</span>`);
      else {
        const unlock = acc.f.available_from_age != null ? `${Number(birth.slice(0, 4)) + Number(acc.f.available_from_age)}-${birth.slice(5)}` : acc.f.available_from_month;
        if (unlock > w.today.slice(0, 7)) out.push(`<span class="d">Available from ${esc(M.monthLabel(unlock))}</span>`);
      }
    }
    return out.join("");
  }

  S.moneyParts = { mv, tags, lines, FREQ };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M, $ } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const P = S.moneyParts, mv = P.mv;
  const SORTS = [["largest", "Largest first"], ["smallest", "Smallest first"], ["name", "Name A–Z"], ["type", "Type"]];

  async function accounts() {
    const store = WW.state.store;
    if (!store) return;
    let w = null;
    try { w = await S.projectionWork(store); } catch (e) { w = null; }
    const all = store.accounts();
    const base = store.baseCurrency();
    const inBase = new Map();
    if (w && w.R && w.ctx) {
      try { const s = w.R.netWorthSum(w.ctx); for (const l of [...s.assets, ...s.debts]) inBase.set(l.id, l.inBase); } catch (e) { /* a rate is missing */ }
    }
    const codes = [...new Set(all.map((a) => a.f.currency_code))];
    if (mv.currency && !codes.includes(mv.currency)) mv.currency = "";
    const shown = all.filter((a) => (mv.side === "all" || a.f.kind === (mv.side === "assets" ? "ASSET" : "LIABILITY")) && (!mv.currency || a.f.currency_code === mv.currency));
    // The top card: net worth, a filtered subtotal, the currency strip.
    let top = "";
    if (w && w.projection) top = `<div class="sumrow big"><span>Net worth</span><span class="amt">${esc(ui.fmt(w.projection.months[0].netWorth, base))}</span></div>`;
    else if (w && w.error && w.error.kind === "missingRate") top = `<div class="sumrow big"><span>Net worth</span><span class="amt plain">Needs a ${esc(w.error.code)} rate</span></div>`;
    if ((mv.side !== "all" || mv.currency) && shown.length) {
      const total = shown.reduce((t, a) => t + (inBase.get(a.name) || 0n) * (a.f.kind === "LIABILITY" ? -1n : 1n), 0n);
      const label = `${mv.side === "assets" ? "Assets" : mv.side === "liabilities" ? "Liabilities" : ""}${mv.currency ? `${mv.side === "all" ? "In" : " in"} ${mv.currency}` : ""}`;
      top += `<div class="sumrow"><span>${esc(label)}</span><span class="amt">${esc(ui.fmt(total, base))}</span></div>`;
    }
    if (codes.length > 1 && w && w.R && w.ctx) {
      try {
        const stakes = w.R.currencyStakes(w.ctx);
        const strip = stakes.slice(0, 3).map((x) => `${x.code} ${x.share == null ? "" : ui.pct(x.share, 0)}`).join(" · ") + (stakes.length > 3 ? ` · +${stakes.length - 3} more` : "");
        top += `<button type="button" class="rowlink" data-page="currencies"><span>${codes.length} currencies<small class="cap2">${esc(strip)}</small></span><span class="cap">›</span></button>`;
      } catch (e) { /* a rate is missing: the strip waits */ }
    }
    $("totals").innerHTML = top;
    const tools = `<div class="tools">
      <div class="segs">${[["all", "All"], ["assets", "Assets"], ["liabilities", "Liabilities"]].map(([k, l]) => `<button type="button" class="segbtn" data-side="${k}" aria-pressed="${mv.side === k}">${l}</button>`).join("")}</div>
      ${codes.length > 1 ? `<select data-currency aria-label="Currency"><option value="">All currencies</option>${codes.sort().map((c) => `<option ${c === mv.currency ? "selected" : ""}>${c}</option>`).join("")}</select>` : ""}
      <span class="grow"></span>
      ${all.length >= 2 ? `<button type="button" class="btn ghost small" data-page="update">Update balances</button>` : ""}
      <button type="button" class="btn small" data-page="account-new">+ Add account</button></div>`;
    if (!all.length) {
      $("accts").innerHTML = tools + `<div class="emptyscreen"><h2>No accounts yet</h2><p>Everything you own and everything you owe, each in its own currency. Add the one you use most first.</p></div>`;
    } else {
      const ret = w && w.ctx ? w.ctx.assumptions.returnPct : "0";
      $("accts").innerHTML = tools + section("ASSET", "What you own", shown, all, inBase, base, ret, w) + section("LIABILITY", "What you owe", shown, all, inBase, base, ret, w);
    }
    const away = store.archivedAccounts();
    $("accts-away").innerHTML = away.length ? `<details class="sumgroup"><summary><span>Archived (${away.length})</span></summary>${away.map((a) => `<div class="row">
        <span class="ic" aria-hidden="true">${esc(a.f.currency_code)}</span>
        <div class="main"><span class="t">${esc(a.f.name)}</span><span class="d">${a.f.kind === "LIABILITY" ? "Liability" : "Asset"}${M.accountCategory(a.f.category) ? ` · ${esc(M.accountCategory(a.f.category).name)}` : ""} · ${esc(a.f.currency_code)}</span>
          <span class="acts"><button type="button" class="linkbtn" data-account-restore="${esc(a.name)}">Restore</button><button type="button" class="linkbtn danger" data-account-delete="${esc(a.name)}">Remove for good</button></span></div></div>`).join("")}
        <p class="cap foot">Out of the projection, history intact; restoring brings all of it back. Removing one throws that history away for good.</p></details>` : "";
    if (WW.state.balanceFor) { const input = $("bal-amount"); if (input) input.focus(); }
  }

  function section(kind, title, shown, all, inBase, base, ret, w) {
    const whole = all.filter((a) => a.f.kind === kind);
    let list = shown.filter((a) => a.f.kind === kind);
    if (!whole.length || (!list.length && shown.length && WW.screens.moneyParts.mv.side !== "all")) return "";
    const key = `ww.accountSort.${kind}`, sort = ui.read(key) || "largest";
    const value = (a) => Number(inBase.get(a.name) ?? (WW.state.store.latest(a.name) ? WW.state.store.latest(a.name).f.value_minor : 0));
    list = [...list].sort(sort === "name" ? (a, b) => a.f.name.localeCompare(b.f.name) : sort === "type" ? (a, b) => String(M.accountCategory(a.f.category)?.name || "~").localeCompare(String(M.accountCategory(b.f.category)?.name || "~")) || a.f.name.localeCompare(b.f.name)
      : sort === "smallest" ? (a, b) => value(a) - value(b) : (a, b) => value(b) - value(a));
    const head = `<div class="month sec"><h3>${title}</h3>${whole.length > 1 ? `<select data-sort="${kind}" aria-label="Order">${SORTS.map(([k, l]) => `<option value="${k}" ${k === sort ? "selected" : ""}>${l}</option>`).join("")}</select>` : ""}</div>`;
    const body = list.length ? list.map((a) => row(a, base, ret, w, inBase)).join("") : `<p class="empty">Nothing here matches that.</p>`;
    const foot = list.length < whole.length ? `<p class="cap foot">Showing ${list.length} of ${whole.length}. The totals above are the whole file's.</p>` : "";
    return head + body + foot;
  }

  function row(a, base, ret, w, inBase) {
    const store = WW.state.store;
    const latest = store.latest(a.name);
    const own = latest ? ui.fmt(Number(latest.f.value_minor), a.f.currency_code) : "No balance yet";
    const foreign = a.f.currency_code !== base ? (inBase.has(a.name) ? ui.fmt(inBase.get(a.name), base) : "Needs a rate") : "";
    const open = WW.state.balanceFor === a.name;
    const form = open ? `<form class="inline-form" data-balance-form="${esc(a.name)}" novalidate>
        <div class="field"><label for="bal-amount">${a.f.kind === "LIABILITY" ? "Owed today" : "Balance today"} (${esc(a.f.currency_code)})</label><input id="bal-amount" inputmode="decimal" autocomplete="off" placeholder="0.00"><span class="err" id="bal-amount-err"></span></div>
        <div class="field"><label for="bal-day">As of</label><input type="date" id="bal-day" value="${esc(M.today())}"><span class="err" id="bal-day-err"></span></div>
        <button type="submit" class="btn small">Save to iCloud</button>
        <button type="button" class="linkbtn" data-cancel-balance>Cancel</button>
        ${latest ? `<p class="cap">Last recorded: ${esc(own)} · ${esc(M.dayLabel(latest.f.as_of_date))}. Earlier entries stay in the list.</p>` : ""}
      </form>` : "";
    return `<div class="row acct">
      <span class="ic" aria-hidden="true">${esc(a.f.currency_code)}</span>
      <div class="main"><button type="button" class="t linklike" data-page="account" data-arg="${esc(a.name)}">${esc(a.f.name)}</button>
        <span class="tags">${a.f.kind === "LIABILITY" ? '<span class="tag owed">Owed</span>' : ""}${P.tags(a, ret)}</span>${P.lines(a, w)}
        ${open ? "" : `<span class="acts"><button type="button" class="linkbtn" data-balance="${esc(a.name)}">Update balance</button><button type="button" class="linkbtn" data-account-edit="${esc(a.name)}">Edit</button></span>`}</div>
      <div class="end"><span class="amt">${esc(own)}</span>${foreign ? `<span class="d">${esc(foreign)}</span>` : ""}</div>
      ${form}</div>`;
  }

  S.money = { accounts };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { $ } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const mv = S.moneyParts.mv;
  const panel = $("panel-money");

  // Ahead of the page's own handlers (capture), so Edit opens the full form.
  panel.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-page],[data-side],[data-account-edit],[data-account-delete],[data-planned-side],[data-planned-delete]");
    if (!t) return;
    const store = WW.state.store;
    if (t.dataset.page) { e.stopPropagation(); return WW.openPage(t.dataset.page, t.dataset.arg || null); }
    if (t.dataset.side) { mv.side = t.dataset.side; return S.money.accounts(); }
    if (t.dataset.plannedSide) { mv.plannedSide = t.dataset.plannedSide; return WW.render(); }
    if (t.dataset.accountEdit) { e.stopPropagation(); return WW.openPage("account-edit", t.dataset.accountEdit); }
    if (t.dataset.accountDelete) {
      e.stopPropagation();
      const acc = store.account(t.dataset.accountDelete);
      if (!acc || !window.confirm(`Remove ${acc.f.name} for good? Every balance it ever had goes with it.`)) return;
      try { await store.deleteAccount(acc); } catch (error) { $("work-error").hidden = false; $("work-error").textContent = WW.C.explain(error); }
      return WW.render();
    }
    if (t.dataset.plannedDelete) {
      e.stopPropagation();
      const item = store.rows.get(t.dataset.plannedDelete);
      if (!item || !window.confirm(`Remove ${item.f.name} for good? Its occurrences leave the projection for good.`)) return;
      try { await store.deletePlanned(item); } catch (error) { $("work-error").hidden = false; $("work-error").textContent = WW.C.explain(error); }
      return WW.render();
    }
  }, true);
  panel.addEventListener("change", (e) => {
    if (e.target.matches("[data-currency]")) { mv.currency = e.target.value; S.money.accounts(); }
    if (e.target.matches("[data-sort]")) { ui.write(`ww.accountSort.${e.target.dataset.sort}`, e.target.value); S.money.accounts(); }
    if (e.target.matches("[data-planned-sort]")) { ui.write("ww.plannedSort", e.target.value); WW.render(); }
    if (e.target.matches("[data-planned-filter]")) { ui.write("ww.plannedFilter", e.target.value); WW.render(); }
  });
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M, $ } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const P = S.moneyParts;
  const av = { spanKey: "ww.accountLineSpan", moreBalances: false, moreLines: false };
  const SOURCE = { MANUAL: "Manual", SCREENSHOT: "Screenshot", STATEMENT: "Statement" };

  function alone(acc, w) {
    const store = WW.state.store, code = acc.f.currency_code, owed = acc.f.kind === "LIABILITY";
    const span = ui.read(av.spanKey) || "past";
    const seg = [["past", "So far"], ["12", "1 yr"], ["60", "5 yr"], ["120", "10 yr"]].map(([k, l]) => `<button type="button" class="segbtn" data-span="${k}" aria-pressed="${span === k}">${l}</button>`).join("");
    let body = "", chart = null;
    if (span === "past") {
      const balances = store.balances(acc.name).map((b) => ({ id: b.name, asOfDate: b.f.as_of_date, createdAt: b.f.created_at, valueMinor: BigInt(b.f.value_minor) }));
      const t = w.H.recordedTrack(balances, acc.f.kind);
      if (!t.points.length) body = `<p class="empty">No balances recorded yet.</p>`;
      else {
        const first = t.points[0], last = t.points[t.points.length - 1];
        const verb = owed ? (t.totalChange >= 0n ? "Paid down by" : "More owed by") : t.totalChange >= 0n ? "Grew by" : "Fell by";
        body = `<div class="sumrow"><span>First recorded<small>${esc(M.dayLabel(first.date))}</small></span><span class="amt">${esc(ui.fmt(owed ? -first.value : first.value, code))}</span></div>
          <div class="sumrow"><span>Latest<small>${esc(M.dayLabel(last.date))}</small></span><span class="amt">${esc(ui.fmt(owed ? -last.value : last.value, code))}</span></div>
          ${t.points.length > 1 ? `<div class="sumrow"><span>${verb}<small>Over ${esc(t.spanDays)} days</small></span><span class="amt">${esc(ui.fmt(t.totalChange < 0n ? -t.totalChange : t.totalChange, code))}${t.changePercent != null ? `<small>${esc(ui.pct(t.changePercent))}</small>` : ""}</span></div>` : ""}
          ${t.biggestMove ? `<div class="sumrow"><span>Biggest day<small>${esc(M.dayLabel(t.biggestMove.date))}</small></span><span class="amt">${esc(ui.signed(t.biggestMove.change, code))}</span></div>` : ""}`;
        if (t.points.length > 1) chart = { labels: t.points.map((p) => p.date), series: [{ label: acc.f.name, values: t.points.map((p) => Number(owed ? -p.value : p.value)) }], code, tipTitle: (i) => M.dayLabel(t.points[i].date) };
        body += `<p class="cap foot">Every balance recorded for this account, one point per day. Between two points the line just joins them: nothing is known about the days between.</p>`;
      }
    } else {
      const ctxAcc = w.ctx.accounts.find((a) => a.id === acc.name);
      const months = Number(span);
      if (!ctxAcc || ctxAcc.latestMinor == null) body = `<p class="empty">Record a balance first.</p>`;
      else {
        const signed = ctxAcc.kind === "ASSET" ? ctxAcc.latestMinor : -ctxAcc.latestMinor;
        const l = w.R.accountLine({ balanceMinor: signed, currency: code, invested: ctxAcc.invested, income: ctxAcc.income, returnPct: w.ctx.assumptions.returnPct, today: w.today, months });
        const verb = owed ? (l.totalChange >= 0n ? "Pays down by" : "More owed by") : l.totalChange >= 0n ? "Grows by" : "Falls by";
        const mag = (v) => (v < 0n ? -v : v);
        const kept = ctxAcc.income && ctxAcc.income.reinvested;
        body = `<div class="sumrow big"><span>In ${esc(ui.months(months))}</span><span class="amt">${esc(ui.fmt(owed ? -l.atHorizon : l.atHorizon, code))}</span></div>
          <div class="sumrow"><span>${verb}</span><span class="amt">${esc(ui.fmt(mag(l.totalChange), code))}${l.changePercent != null ? `<small>${esc(ui.pct(l.changePercent))}</small>` : ""}</span></div>
          ${l.totalGrowth !== 0n ? `<div class="sumrow"><span>from rising in value</span><span class="amt">${esc(ui.signed(l.totalGrowth, code))}</span></div>` : ""}
          ${l.totalPaid !== 0n ? `<div class="sumrow"><span>${kept ? "from interest, kept in" : "from interest, paid out"}</span><span class="amt">${esc(ui.signed(kept ? l.totalRetained : l.totalPaid, code))}</span></div>` : ""}
          ${l.compoundedInterest !== 0n && kept ? `<div class="sumrow"><span>Principal interest<small>What the rate pays on the balance it started with</small></span><span class="amt">${esc(ui.fmt(l.simpleInterest, code))}</span></div>
            <div class="sumrow"><span>Compound interest<small>What it pays on what it has earned since</small></span><span class="amt">${esc(ui.fmt(l.compoundedInterest, code))}</span></div>` : ""}
          <p class="cap foot">${l.isFlat ? "Nothing in this account moves it on its own." : ctxAcc.invested ? "It also grows at the growth rate under Income & spending, which is a guess." : kept ? "Its own rate and what it pays, nothing else." : "Payments are taken as cash, so the balance does not rise from them."}</p>`;
        if (!l.isFlat) chart = { labels: l.months.map((m) => m.month), series: [{ label: acc.f.name, values: l.months.map((m) => Number(owed ? -m.value : m.value)) }], code };
      }
    }
    return { html: `<div class="card summary"><h2>This account alone</h2><div class="segs">${seg}</div>${chart ? `<div class="chart" id="acct-chart"></div>` : ""}${body}
      <p class="cap">Its own interest and growth only. Money you add or spend belongs to the whole picture, not to one account.</p></div>`, chart };
  }

  S.accountAlone = { alone, av, SOURCE };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M, $ } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const P = S.moneyParts, A = S.accountAlone, av = A.av;

  async function account(id, box) {
    const store = WW.state.store, acc = store.account(id);
    if (!acc) { box.innerHTML = `<p class="empty">This account isn't in WaffleWealth any more.</p>`; return; }
    const w = await S.projectionWork(store);
    const code = acc.f.currency_code, base = store.baseCurrency();
    const latest = store.latest(id);
    let inBase = "";
    if (code !== base && w.R && w.ctx && latest) {
      try { const l = w.R.netWorthSum(w.ctx); const x = [...l.assets, ...l.debts].find((y) => y.id === id); inBase = x ? ui.fmt(x.inBase, base) : ""; } catch (e) { inBase = "Needs a rate"; }
    }
    const ret = w.ctx ? w.ctx.assumptions.returnPct : "0";
    const head = `<div class="card answer"><span class="k">${acc.f.kind === "LIABILITY" ? "Owed" : "Balance"}${latest ? ` · ${esc(M.dayLabel(latest.f.as_of_date))}` : ""}</span>
      <span class="v">${esc(latest ? ui.fmt(Number(latest.f.value_minor), code) : "No balance yet")}</span>${inBase ? `<span class="d">${esc(inBase)}</span>` : ""}
      <span class="tags">${acc.f.kind === "LIABILITY" ? '<span class="tag owed">Owed</span>' : ""}${P.tags(acc, ret)}</span>${w.R ? P.lines(acc, w) : ""}
      ${acc.f.archived_at ? `<p class="cap">Account archived.</p>` : ""}
      <div class="formacts">${acc.f.archived_at ? `<button type="button" class="btn small" data-acct="restore">Restore</button>` : `<button type="button" class="btn small" data-acct="balance">Update balance</button><button type="button" class="btn ghost small" data-acct="edit">Edit</button><button type="button" class="linkbtn" data-acct="away">Archive</button>`}</div>
      ${av.balanceOpen ? `<form class="inline-form" id="acct-balance-form" novalidate><div class="field"><label for="ab-amount">${acc.f.kind === "LIABILITY" ? "Owed today" : "Balance today"} (${esc(code)})</label><input id="ab-amount" inputmode="decimal" autocomplete="off"><span class="err" id="ab-amount-err"></span></div>
        <button type="submit" class="btn small">Save to iCloud</button><button type="button" class="linkbtn" data-acct="cancel">Cancel</button><p class="cap">Recorded as of today, ${esc(M.dayLabel(M.today()))}. Earlier entries stay in the list.</p></form>` : ""}</div>`;
    const a = w.H && w.R && w.ctx ? A.alone(acc, w) : { html: "", chart: null };
    // Every entry, newest first, with the step from the one before.
    const entries = store.balances(id);
    const shownEntries = av.moreBalances ? entries : entries.slice(0, 5);
    const step = (i) => (i + 1 < entries.length ? Number(entries[i].f.value_minor) - Number(entries[i + 1].f.value_minor) : null);
    const balances = `<div class="card list"><h2>Balances</h2>${shownEntries.map((b, i) => `<div class="row plain"><div class="main"><span class="t">${esc(M.dayLabel(b.f.as_of_date))}</span><span class="d">${esc(A.SOURCE[b.f.source] || "Manual")} · entered ${esc(M.dayLabel(String(b.f.created_at).slice(0, 10)))}</span>
        ${entries.length > 1 ? `<span class="acts"><button type="button" class="linkbtn" data-withdraw="${esc(b.name)}">Remove this entry</button></span>` : ""}</div>
      <div class="end"><span class="amt">${esc(ui.fmt(Number(b.f.value_minor), code))}</span>${step(i) != null && step(i) !== 0 ? `<span class="d">${esc(ui.signed(step(i), code))}</span>` : ""}</div></div>`).join("")}
      ${entries.length > 5 ? `<button type="button" class="linkbtn" data-acct="more">${av.moreBalances ? "Show fewer" : `Show ${entries.length - 5} more`}</button>` : ""}
      <p class="cap foot">Typed one wrong? Remove it: everything goes back to what it was without it, and you can put it back.</p></div>`;
    const removed = store.withdrawn(id);
    const removedCard = removed.length ? `<details class="card sumgroup"><summary><span>${removed.length} removed entr${removed.length === 1 ? "y" : "ies"}</span></summary>
      ${removed.map((b) => `<div class="sumrow"><span>${esc(M.dayLabel(b.f.as_of_date))}<small>${esc(ui.fmt(Number(b.f.value_minor), code))}</small></span><span class="amt"><button type="button" class="linkbtn" data-putback="${esc(b.name)}">Put back</button></span></div>`).join("")}
      <p class="cap foot">Removed entries count for nothing. Put one back and every figure returns to what it said.</p></details>` : "";
    const lines = store.statementLines().filter((l) => l.f.account_id === id);
    const LABEL = { in: "Money in", out: "Money out", own: "Between your accounts", interest: "Interest" };
    const linesShown = av.moreLines ? lines : lines.slice(0, 20);
    const linesCard = lines.length ? `<div class="card list"><h2>From statements</h2>${linesShown.map((l) => `<div class="row plain"><div class="main"><span class="t">${esc(l.f.description)}</span><span class="d">${esc(M.dayLabel(l.f.posted_on || l.f.made_on || ""))} · ${esc(LABEL[l.f.line_kind] || "")}${l.f.foreign_currency ? ` · ${esc(ui.fmt(Number(l.f.foreign_minor), l.f.foreign_currency))}` : ""}</span></div><div class="end"><span class="amt">${esc(ui.signed(Number(l.f.amount_minor), code))}</span></div></div>`).join("")}
      ${lines.length > 20 ? `<button type="button" class="linkbtn" data-acct="lines">${av.moreLines ? "Show fewer" : `All ${lines.length} lines`}</button>` : ""}
      <p class="cap foot">Money between your own accounts is marked, so it isn't counted as money in or out.</p></div>` : "";
    box.innerHTML = `<div class="stack1">${head}${a.html}${balances}${removedCard}${linesCard}</div>`;
    if (a.chart) ui.lineChart(document.getElementById("acct-chart"), a.chart);
    if (av.balanceOpen) { const i = document.getElementById("ab-amount"); if (i) i.focus(); }
  }

  WW.PAGES.account = { title: (id) => (WW.state.store && WW.state.store.account(id) ? WW.state.store.account(id).f.name : "Account"), render: account };
  S.accountPage = { account };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { M, $ } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const av = S.accountAlone.av;

  /** The app's check on a figure ten times the last, or a tenth of it (BalanceJump). */
  function jump(next, last) {
    if (last == null || last === 0) return null;
    const was = Math.abs(last), now = Math.abs(next);
    if (now >= was * 10) return `${Math.floor(now / was).toLocaleString("en")}× the last balance`;
    if (now * 10 <= was) return "a tenth of the last balance or less";
    return null;
  }

  const body = $("page-body");
  const here = () => WW.state.page && WW.state.page.name === "account";
  const fail = (error) => { $("work-error").hidden = false; $("work-error").textContent = WW.C.explain(error); };
  body.addEventListener("click", async (e) => {
    if (!here()) return;
    const t = e.target.closest("[data-span],[data-acct],[data-withdraw],[data-putback]");
    if (!t) return;
    const store = WW.state.store, id = WW.state.page.arg, acc = store.account(id);
    try {
      if (t.dataset.span) ui.write(av.spanKey, t.dataset.span);
      if (t.dataset.acct === "balance") av.balanceOpen = true;
      if (t.dataset.acct === "cancel") av.balanceOpen = false;
      if (t.dataset.acct === "more") av.moreBalances = !av.moreBalances;
      if (t.dataset.acct === "lines") av.moreLines = !av.moreLines;
      if (t.dataset.acct === "edit") return WW.openPage("account-edit", id);
      if (t.dataset.acct === "away") await store.saveAccount(acc, { name: acc.f.name, invested: Number(acc.f.is_invested) === 1, archived: true });
      if (t.dataset.acct === "restore") await store.saveAccount(acc, { name: acc.f.name, invested: Number(acc.f.is_invested) === 1, archived: false });
      if (t.dataset.withdraw) {
        const b = store.rows.get(t.dataset.withdraw);
        if (!window.confirm(`Remove this entry? ${ui.fmt(Number(b.f.value_minor), acc.f.currency_code)} on ${M.dayLabel(b.f.as_of_date)}. Everything goes back to what it was without it, and you can put it back.`)) return;
        await store.withdrawBalance(b);
      }
      if (t.dataset.putback) await store.putBackBalance(store.rows.get(t.dataset.putback));
    } catch (error) { return fail(error); }
    WW.render();
  });
  body.addEventListener("submit", async (e) => {
    if (!here() || e.target.id !== "acct-balance-form") return;
    e.preventDefault();
    const store = WW.state.store, id = WW.state.page.arg, acc = store.account(id);
    const amount = M.parseAmount(document.getElementById("ab-amount").value, acc.f.currency_code);
    document.getElementById("ab-amount-err").textContent = amount.ok ? "" : amount.reason === "empty" ? "Type the balance." : amount.reason;
    if (!amount.ok) return;
    const latest = store.latest(id);
    const j = jump(amount.minor, latest ? Number(latest.f.value_minor) : null);
    if (j && !window.confirm(`Check this figure. That's ${j} (${ui.fmt(Number(latest.f.value_minor), acc.f.currency_code)}). Save anyway?`)) return;
    try { await store.recordBalance(id, amount.minor, M.today()); av.balanceOpen = false; } catch (error) { return fail(error); }
    WW.render();
  });
  S.balanceJump = jump;
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M, $ } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const FREQS = [["MONTHLY", "Monthly"], ["QUARTERLY", "Quarterly"], ["SEMIANNUAL", "Half-yearly"], ["ANNUAL", "Yearly"]];

  const opt = (v, label, sel) => `<option value="${esc(v)}" ${String(v) === String(sel) ? "selected" : ""}>${esc(label)}</option>`;
  const radio = (name, v, label, sel) => `<input type="radio" name="${name}" id="${name}-${v}" value="${v}" ${v === sel ? "checked" : ""}><label for="${name}-${v}">${label}</label>`;

  function form(id, box) {
    const store = WW.state.store, acc = id ? store.account(id) : null;
    const open = box.querySelector("#account-form");
    if (open && open.dataset.for === String(id || "new")) return;
    if (id && !acc) { box.innerHTML = `<p class="empty">This account isn't in WaffleWealth any more.</p>`; return; }
    const f = acc ? acc.f : { name: "", kind: "ASSET", currency_code: store.baseCurrency(), is_invested: 0, category: null, income_basis: null, income_frequency: "ANNUAL", income_reinvested: 0 };
    const a = store.assumptions() ? store.assumptions().f : {};
    const latest = acc ? store.latest(acc.name) : null;
    const ret = a.annual_return_pct || "0";
    const y0 = Number(M.today().slice(0, 4));
    const mode = f.available_from_age != null ? "age" : f.available_from_month ? "month" : "now";
    const cats = (kind) => (kind === "LIABILITY" ? [["What you owe", M.accountCategories.liability]] : [["Investments", M.accountCategories.invested], ["Cash & everything else", M.accountCategories.cash]]);
    const catOptions = (kind) => `<option value="">None</option>` + cats(kind).map(([g, list]) => `<optgroup label="${g}">${list.map(([k, n]) => opt(k, n, f.category)).join("")}</optgroup>`).join("");
    const bm = a.birth_month || 1, by = a.birth_year || y0 - 35;
    const um = f.available_from_month ? Number(f.available_from_month.slice(5)) : 1, uy = f.available_from_month ? Number(f.available_from_month.slice(0, 4)) : y0 + 1;
    box.innerHTML = `<form class="card f" id="account-form" novalidate data-for="${esc(id || "new")}">
      <div class="field"><label for="af-name">Name</label><input id="af-name" maxlength="60" autocomplete="off" value="${esc(f.name)}"><span class="err" id="af-name-err"></span></div>
      <div class="seg" role="radiogroup" aria-label="This is">${radio("af-kind", "ASSET", "Something you own", f.kind)}${radio("af-kind", "LIABILITY", "A debt you owe", f.kind)}</div>
      <p class="cap" id="af-kind-cap"></p>
      <div class="two">
        <div class="field"><label for="af-currency">Currency</label><select id="af-currency">${M.currencies().map((c) => opt(c, `${c} · ${M.currencyName(c)}`, f.currency_code)).join("")}</select><span class="err" id="af-currency-err"></span><span class="cap" id="af-currency-note"></span></div>
        <div class="field"><label for="af-balance" id="af-balance-label">Balance today</label><input id="af-balance" inputmode="decimal" autocomplete="off" value="${latest ? esc(M.editable(Number(latest.f.value_minor), f.currency_code)) : ""}" placeholder="0"><span class="err" id="af-balance-err"></span></div>
      </div>
      <div class="field"><label for="af-category">Category</label><select id="af-category">${catOptions(f.kind)}</select><span class="cap">A label for your own reading. It changes no figure.</span></div>
      <div id="af-rate-box" hidden><div class="field"><label for="af-rate" id="af-rate-label"></label><input id="af-rate" inputmode="decimal" autocomplete="off"><span class="err" id="af-rate-err"></span><span class="cap" id="af-rate-cap"></span></div></div>
      <fieldset class="group" id="af-grow-box"><legend>How it grows on its own</legend>
        <label class="check"><input type="checkbox" id="af-invested" ${Number(f.is_invested) ? "checked" : ""}> ${Number(ret) === 0 ? "Set to grow" : `Grows ${esc(ui.pct(ret))} a year on its own`}</label>
        <p class="cap">Savings and deposits that only pay interest: leave this off and set the rate under interest. The growth rate is set under Income &amp; spending.</p></fieldset>
      <fieldset class="group" id="af-when-box"><legend>When you can use it</legend>
        <div class="seg" role="radiogroup">${radio("af-when", "now", "Any time", mode)}${radio("af-when", "age", "From an age", mode)}${radio("af-when", "month", "From a month", mode)}</div>
        <div class="two" id="af-age-box"><div class="field"><label for="af-age">Age</label><input id="af-age" inputmode="numeric" value="${f.available_from_age ?? 60}"></div>
          <div class="field"><label>Born in</label><span class="row-inline"><select id="af-bm" aria-label="Month of birth">${MONTHS.map((m, i) => opt(i + 1, m, bm)).join("")}</select><select id="af-by" aria-label="Year of birth">${Array.from({ length: 85 }, (_, i) => y0 - 16 - i).map((y) => opt(y, y, by)).join("")}</select></span></div></div>
        <div class="two" id="af-month-box"><div class="field"><label>From</label><span class="row-inline"><select id="af-um" aria-label="Month">${MONTHS.map((m, i) => opt(i + 1, m, um)).join("")}</select><select id="af-uy" aria-label="Year">${Array.from({ length: 61 }, (_, i) => y0 + i).map((y) => opt(y, y, uy)).join("")}</select></span></div></div>
        <span class="err" id="af-availability-err"></span><span class="err" id="af-birth-err"></span>
        <p class="cap" id="af-when-cap"></p></fieldset>
      <fieldset class="group"><legend>Interest &amp; dividends</legend>
        <label class="check"><input type="checkbox" id="af-pays" ${f.income_basis ? "checked" : ""}> <span id="af-pays-label">Pays interest or dividends</span></label>
        <div id="af-income-box">
          <div class="seg" role="radiogroup">${radio("af-basis", "RATE", "A yearly %", f.income_basis || "RATE")}${radio("af-basis", "AMOUNT", "A fixed amount", f.income_basis || "RATE")}</div>
          <div class="two"><div class="field" id="af-rate-pct-box"><label for="af-income-rate">Rate per year (%)</label><input id="af-income-rate" inputmode="decimal" value="${esc(f.income_rate_pct || "")}"></div>
            <div class="field" id="af-income-amount-box"><label for="af-income-amount">Each payment</label><input id="af-income-amount" inputmode="decimal" value="${f.income_amount_minor != null ? esc(M.editable(Number(f.income_amount_minor), f.currency_code)) : ""}"></div>
            <div class="field"><label for="af-freq">Paid</label><select id="af-freq">${FREQS.map(([k, l]) => opt(k, l, f.income_frequency || "ANNUAL")).join("")}</select></div></div>
          <label class="check"><input type="checkbox" id="af-kept" ${Number(f.income_reinvested) ? "checked" : ""}> <span id="af-kept-label">Stays in the account</span></label>
          <p class="notice-card" id="af-twice" hidden><b>This balance grows twice.</b> It rises at the growth rate and its payments stay in it too. That's right for a fund that reinvests; for a savings account, leave growth off.</p>
          <span class="err" id="af-income-err"></span></div></fieldset>
      <div class="formacts"><button type="submit" class="btn">Save to iCloud</button><button type="button" class="linkbtn" data-af="cancel">Cancel</button></div>
      <p class="error" id="af-error" role="alert" hidden></p></form>`;
    S.accountFormUpdate();
  }

  S.accountForm = form;
  S.accountFormConst = { MONTHS, FREQS };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M, $ } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const val = (id) => document.getElementById(id);
  const checked = (name) => (document.querySelector(`input[name="${name}"]:checked`) || {}).value;

  /** Shows what applies to the choices made so far, as the app's form does. */
  S.accountFormUpdate = function update() {
    if (!val("account-form")) return;
    const store = WW.state.store, base = store.baseCurrency();
    const id = WW.state.page && WW.state.page.name === "account-edit" ? WW.state.page.arg : null;
    const acc = id ? store.account(id) : null;
    const kind = checked("af-kind"), owed = kind === "LIABILITY", code = val("af-currency").value;
    val("af-kind-cap").textContent = owed ? "Money you have to pay back: the app takes these away." : "Money or things that are yours: the app adds these up.";
    val("af-balance-label").textContent = `${owed ? "Owed today" : "Balance today"} (${code})`;
    val("af-grow-box").hidden = owed;
    val("af-when-box").hidden = owed;
    const when = checked("af-when");
    val("af-age-box").hidden = when !== "age";
    val("af-month-box").hidden = when !== "month";
    val("af-when-cap").textContent = when === "now" ? "Money you could reach today. Change this if you can't yet: a pension you can't draw until an age, or a deposit the bank holds until a date."
      : "It stays in your net worth: it is your money. If your income stopped, it could be lived on only from the month it unlocks.";
    const cur = val("af-category").value;
    const valid = new Set((owed ? M.accountCategories.liability : [...M.accountCategories.invested, ...M.accountCategories.cash]).map(([k]) => k));
    if (val("af-category").dataset.kind !== kind) {
      val("af-category").dataset.kind = kind;
      const groups = owed ? [["What you owe", M.accountCategories.liability]] : [["Investments", M.accountCategories.invested], ["Cash & everything else", M.accountCategories.cash]];
      val("af-category").innerHTML = `<option value="">None</option>` + groups.map(([g, list]) => `<optgroup label="${g}">${list.map(([k, n]) => `<option value="${k}" ${k === cur && valid.has(cur) ? "selected" : ""}>${esc(n)}</option>`).join("")}</optgroup>`).join("");
    }
    val("af-pays-label").textContent = owed ? "Charges interest or fees" : "Pays interest or dividends";
    val("af-kept-label").textContent = owed ? "Added to what you owe" : "Stays in the account";
    const pays = val("af-pays").checked, basis = checked("af-basis");
    val("af-income-box").hidden = !pays;
    val("af-rate-pct-box").hidden = basis !== "RATE";
    val("af-income-amount-box").hidden = basis !== "AMOUNT";
    val("af-twice").hidden = !(pays && !owed && val("af-invested").checked && val("af-kept").checked);
    const needsRate = code !== base && !store.rows.get(`rate-${code}`);
    val("af-rate-box").hidden = !needsRate;
    val("af-rate-label").textContent = `1 ${code} = how many ${base}`;
    val("af-rate-cap").textContent = `There is no ${code} rate yet. Enter how many ${base} one ${code} is worth. You can change it later in Settings.`;
    let note = "";
    if (acc && code !== acc.f.currency_code) {
      note = M.scale(code) !== M.scale(acc.f.currency_code)
        ? `${acc.f.currency_code} keeps ${M.scale(acc.f.currency_code)} decimals and ${code} keeps ${M.scale(code)}, so a balance recorded in one cannot be read in the other. To move this account to ${code}, archive it and add a new one.`
        : `Every balance this account has recorded will be read as ${code}: the figures themselves do not change.`;
    }
    val("af-currency-note").textContent = note;
  };

  async function submit(e) {
    e.preventDefault();
    const store = WW.state.store, base = store.baseCurrency();
    const editing = WW.state.page.name === "account-edit" ? store.account(WW.state.page.arg) : null;
    const kind = checked("af-kind"), code = val("af-currency").value;
    for (const k of ["name", "balance", "currency", "rate", "availability", "birth", "income"]) { const el = val(`af-${k}-err`); if (el) el.textContent = ""; }
    if (editing && code !== editing.f.currency_code && M.scale(code) !== M.scale(editing.f.currency_code)) { val("af-currency-err").textContent = "Archive it and add a new account in that currency instead."; return; }
    const balanceText = val("af-balance").value.trim();
    const balance = M.parseAmount(balanceText || "0", code);
    const pays = val("af-pays").checked, basis = checked("af-basis");
    const when = kind === "ASSET" ? checked("af-when") : "now";
    const draft = {
      name: val("af-name").value, kind, currency: code, invested: kind === "ASSET" && val("af-invested").checked, category: val("af-category").value || null,
      balance: editing && !balanceText ? null : balance,
      income: pays ? { basis, rate: M.parsePercent(val("af-income-rate").value), amount: M.parseAmount(val("af-income-amount").value, code), frequency: val("af-freq").value, reinvested: val("af-kept").checked } : null,
      availability: { mode: when, age: Number(val("af-age").value), month: `${val("af-uy").value}-${String(val("af-um").value).padStart(2, "0")}` },
      birthYear: Number(val("af-by").value), birthMonth: Number(val("af-bm").value),
      rate: !val("af-rate-box").hidden ? (val("af-rate").value.trim().replace(/,/g, "") || "0") : null,
    };
    if (draft.income && basis === "RATE" && draft.income.rate.ok && !(Number(draft.income.rate.value) > 0)) draft.income.rate = { ok: false, reason: "Enter a rate greater than zero." };
    const problems = store.checkAccountDraft(draft);
    for (const [k, v] of Object.entries(problems)) { const el = val(`af-${k}-err`); if (el) el.textContent = v; }
    if (Object.keys(problems).length) return;
    try {
      if (draft.rate) await store.setRate(code, draft.rate);
      if (when === "age") await store.patchAssumptions({ birth_year: draft.birthYear, birth_month: draft.birthMonth });
      const saved = editing ? await store.updateAccount(editing, draft) : await store.createAccount(draft);
      WW.show("money", { page: "account", arg: saved.name });
    } catch (error) {
      val("af-error").hidden = false; val("af-error").textContent = WW.C.explain(error);
    }
  }

  const body = $("page-body");
  const here = () => WW.state.page && ["account-edit", "account-new"].includes(WW.state.page.name);
  body.addEventListener("change", (e) => { if (here()) S.accountFormUpdate(); });
  body.addEventListener("submit", (e) => { if (here() && e.target.id === "account-form") submit(e); });
  body.addEventListener("click", (e) => { if (here() && e.target.closest('[data-af="cancel"]')) WW.show("money"); });

  WW.PAGES["account-new"] = { title: () => "New account", render: (arg, box) => S.accountForm(null, box) };
  WW.PAGES["account-edit"] = { title: () => "Edit account", render: (id, box) => S.accountForm(id, box) };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M, $ } = WW;
  const ui = WW.ui;
  const S = WW.screens;

  function update(arg, box) {
    if (box.querySelector("#update-form")) return;
    const store = WW.state.store, all = store.accounts();
    const row = (a) => {
      const latest = store.latest(a.name);
      return `<div class="row plain"><div class="main"><span class="t">${esc(a.f.name)}</span><span class="d">${latest ? `${esc(ui.fmt(Number(latest.f.value_minor), a.f.currency_code))} · ${esc(M.dayLabel(latest.f.as_of_date))}` : "No balance yet"}</span></div>
        <div class="end ub"><input data-ub="${esc(a.name)}" inputmode="decimal" autocomplete="off" aria-label="${esc(a.f.name)}, ${a.f.currency_code}" placeholder="${esc(a.f.currency_code)}">
          ${latest ? `<button type="button" class="linkbtn" data-same="${esc(a.name)}">No change</button>` : ""}<span class="err" data-ub-err="${esc(a.name)}"></span></div></div>`;
    };
    const part = (kind, title) => { const list = all.filter((a) => a.f.kind === kind); return list.length ? `<div class="month"><h3>${title}</h3></div>${list.map(row).join("")}` : ""; };
    box.innerHTML = `<form class="card list" id="update-form" novalidate>
      <div class="formacts"><button type="button" class="btn ghost small" data-same="all">All unchanged</button><span class="cap">Then edit the ones that moved.</span></div>
      ${part("ASSET", "Assets")}${part("LIABILITY", "Liabilities")}
      <div class="formacts"><button type="submit" class="btn" id="ub-save" disabled>Save to iCloud</button></div>
      <p class="cap">Each is recorded as of today, ${esc(M.dayLabel(M.today()))}. Earlier entries stay.</p>
      <p class="error" id="ub-error" role="alert" hidden></p></form>`;
  }

  const body = $("page-body");
  const here = () => WW.state.page && WW.state.page.name === "update";
  const typed = () => [...body.querySelectorAll("[data-ub]")].filter((i) => i.value.trim());
  const refresh = () => { const b = $("ub-save"); if (b) b.disabled = typed().length === 0; };
  body.addEventListener("input", (e) => { if (here()) refresh(); });
  body.addEventListener("click", (e) => {
    if (!here()) return;
    const t = e.target.closest("[data-same]");
    if (!t) return;
    const store = WW.state.store;
    const fill = (id) => { const latest = store.latest(id), input = body.querySelector(`[data-ub="${id}"]`); if (latest && input) input.value = M.editable(Number(latest.f.value_minor), store.account(id).f.currency_code); };
    if (t.dataset.same === "all") store.accounts().forEach((a) => fill(a.name)); else fill(t.dataset.same);
    refresh();
  });
  body.addEventListener("submit", async (e) => {
    if (!here() || e.target.id !== "update-form") return;
    e.preventDefault();
    const store = WW.state.store, list = [], warn = [];
    let bad = false;
    for (const input of typed()) {
      const acc = store.account(input.dataset.ub), amount = M.parseAmount(input.value, acc.f.currency_code);
      const err = body.querySelector(`[data-ub-err="${acc.name}"]`);
      err.textContent = amount.ok ? "" : amount.reason;
      if (!amount.ok) { bad = true; continue; }
      const latest = store.latest(acc.name);
      const j = S.balanceJump(amount.minor, latest ? Number(latest.f.value_minor) : null);
      if (j) warn.push(`${acc.f.name}: ${j} (${ui.fmt(Number(latest.f.value_minor), acc.f.currency_code)})`);
      list.push({ accountId: acc.name, minor: amount.minor });
    }
    if (bad || !list.length) return;
    if (warn.length && !window.confirm(`Check ${warn.length === 1 ? "this figure" : `${warn.length} figures`}.\n${warn.join("\n")}\nSave anyway?`)) return;
    try {
      await store.recordBalances(list);
      body.innerHTML = "";
      WW.show("money");
    } catch (error) { $("ub-error").hidden = false; $("ub-error").textContent = WW.C.explain(error); }
  });

  WW.PAGES.update = { title: () => "Update balances", render: update };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M, $ } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const cv = { code: null, dir: "falls", by: "10", note: "" };

  /** The rates section, shared by Currencies and Settings: one row per foreign currency in use. */
  function ratesSection(store) {
    const base = store.baseCurrency();
    const inUse = [...new Set(store.accounts().map((a) => a.f.currency_code))].filter((c) => c !== base).sort();
    const rows = new Map(store.rates().map((r) => [r.code, r]));
    const codes = [...new Set([...inUse, ...rows.keys()])].filter((c) => c !== base).sort();
    if (!codes.length) return `<div class="card"><h2>Exchange rates</h2><p class="cap">Everything is in ${esc(base)}, so no rate is needed.</p></div>`;
    return `<form class="card summary" id="rates-form" novalidate><h2>Exchange rates</h2>
      ${codes.map((c) => { const r = rows.get(c); return `<div class="sumrow"><span>1 ${esc(c)} =${inUse.includes(c) ? "" : "<small>Not used by an account</small>"}</span><span class="amt row-inline"><input class="rate" data-rate="${esc(c)}" inputmode="decimal" value="${r ? esc(r.rate) : ""}" placeholder="0" aria-label="${esc(c)} in ${esc(base)}"> ${esc(base)}
        ${r ? `<span class="segs"><button type="button" class="segbtn" data-src="${esc(c)}:AUTO" aria-pressed="${r.source === "AUTO"}">Auto</button><button type="button" class="segbtn" data-src="${esc(c)}:MANUAL" aria-pressed="${r.source !== "AUTO"}">Manual</button></span>` : ""}</span></div>`; }).join("")}
      <div class="formacts"><button type="submit" class="btn small">Save rates to iCloud</button><button type="button" class="btn ghost small" data-fetch-rates>Fetch today's rates</button></div>
      <p class="cap">Auto follows the daily rate when it's fetched. Manual holds the number where you put it, and typing into a row switches it to Manual on its own. Fetching asks open.er-api.com for today's reference rates: only your main currency code (${esc(base)}) is sent.</p>
      ${cv.note ? `<p class="ok">${esc(cv.note)}</p>` : ""}<p class="error" id="rates-error" role="alert" hidden></p></form>`;
  }

  async function currencies(arg, box) {
    const store = WW.state.store;
    const w = await S.projectionWork(store);
    if (w.waiting) { box.innerHTML = S.pageHelpers.waiting; return; }
    const base = w.base;
    let stakes = null, error = w.error;
    if (!error) { try { stakes = w.R.currencyStakes(w.ctx); } catch (e) { error = e; } }
    let share = "";
    if (stakes) {
      share = stakes.length <= 1 ? `<p class="cap">Everything is in ${esc(stakes[0] ? stakes[0].code : base)}.</p>`
        : stakes.map((x) => `<div class="sumrow"><span>${esc(x.code)}<small>${esc(M.currencyName(x.code))}</small></span><span class="amt">${esc(ui.fmt(x.minorInBase, base))}${x.share != null ? `<small>${esc(ui.pct(x.share))}</small>` : ""}</span></div>`).join("");
    } else if (error && error.kind === "missingRate") share = `<p class="cap">Add a ${esc(error.code)} rate below to see the shares.</p>`;
    const foreign = stakes ? stakes.map((x) => x.code).filter((c) => c !== base) : [];
    if (!foreign.includes(cv.code)) cv.code = foreign[0] || null;
    let shock = "";
    if (cv.code) {
      const move = Number(cv.by) * (cv.dir === "falls" ? -1 : 1);
      let result = "";
      try {
        const now = w.projection.months[0].netWorth, then = w.R.shockedNetWorth(w.ctx, cv.code, String(move), w.today);
        result = `Net worth would be ${ui.fmt(then, base)} (${ui.signed(then - now, base)})`;
      } catch (e) { result = ""; }
      shock = `<div class="card summary"><h2>If a currency moved</h2>
        <div class="row-inline wrap"><label>If <select data-cv="code">${foreign.map((c) => `<option ${c === cv.code ? "selected" : ""}>${c}</option>`).join("")}</select></label>
          <select data-cv="dir" aria-label="Moves"><option value="falls" ${cv.dir === "falls" ? "selected" : ""}>falls</option><option value="rises" ${cv.dir === "rises" ? "selected" : ""}>rises</option></select>
          <label>by <input data-cv="by" class="rate" inputmode="decimal" value="${esc(cv.by)}">%</label></div>
        <p class="verdict">${esc(result)}</p>
        <p class="cap foot">A negative share is money owed in that currency. This reads today's position at a rate you name; it changes nothing.</p></div>`;
    }
    box.innerHTML = `<div class="stack1"><div class="card summary"><h2>Share of net worth</h2>${share}</div>${shock}${ratesSection(store)}</div>`;
  }

  S.currencyView = cv;
  S.ratesSection = ratesSection;
  WW.PAGES.currencies = { title: () => "Currencies", render: currencies };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { M, $ } = WW;
  const S = WW.screens;
  const cv = S.currencyView;
  const errorOf = () => document.querySelector("#rates-form #rates-error");
  const fail = (error) => { const el = errorOf(); if (el) { el.hidden = false; el.textContent = error && error.plain ? error.plain : WW.C.explain(error); } };

  /** Today's reference rates, as the app fetches them: the base code is all that is sent, and a
      rate pinned to Manual is left alone. The feed quotes per unit of the base; a rate here is
      the base per unit of the other currency, rounded to ten places, as the app rounds it. */
  async function fetchRates() {
    const store = WW.state.store, base = store.baseCurrency();
    const { P } = await WW.engines();
    let text;
    try {
      const response = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw { plain: `The rate service answered with ${response.status}. Your rates are unchanged.` };
      text = await response.text();
    } catch (error) {
      throw error && error.plain ? error : { plain: "Couldn't reach the rate service. Your rates are unchanged." };
    }
    let body;
    try { body = JSON.parse(text); } catch (e) { throw { plain: "The rate service sent something this page couldn't read." }; }
    if (body.result && body.result !== "success") throw { plain: `The rate service refused: ${body["error-type"] || body.result}.` };
    if (body.base_code !== base) throw { plain: `The rate service doesn't quote ${base}. Enter its rates by hand.` };
    const raw = new Map([...text.matchAll(/"([A-Z]{3})"\s*:\s*([0-9.eE+-]+)/g)].map((m) => [m[1], m[2]]));
    const pinned = new Set(store.rates().filter((r) => r.source === "MANUAL").map((r) => r.code));
    const inUse = [...new Set(store.accounts().map((a) => a.f.currency_code))].filter((c) => c !== base && !pinned.has(c));
    const written = [];
    for (const code of inUse) {
      let t = raw.get(code);
      if (!t) continue;
      if (/e/i.test(t)) t = Number(t).toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
      const perBase = P.Dec.of(t);
      if (perBase.sign() <= 0) continue;
      const rate = P.Dec.int(1).div(perBase).round(10);
      if (rate.sign() <= 0) continue;
      await store.setRate(code, rate.toString(), "AUTO");
      written.push(code);
    }
    const left = [...pinned].filter((c) => store.accounts().some((a) => a.f.currency_code === c));
    return written.length ? `Updated ${written.join(", ")}.${left.length ? ` ${left.join(", ")} ${left.length === 1 ? "is" : "are"} set to Manual and left alone.` : ""}`
      : left.length ? `Nothing changed: ${left.join(", ")} ${left.length === 1 ? "is" : "are"} set to Manual, so the daily rate doesn't touch ${left.length === 1 ? "it" : "them"}.` : "Nothing to update.";
  }

  document.addEventListener("click", async (e) => {
    const form = e.target.closest("#rates-form");
    if (!form) return;
    const store = WW.state.store;
    const src = e.target.closest("[data-src]");
    try {
      if (src) {
        const [code, source] = src.dataset.src.split(":");
        const r = store.rates().find((x) => x.code === code);
        if (r) await store.setRate(code, r.rate, source);
        if (source === "AUTO") cv.note = await fetchRates();
        return WW.render();
      }
      if (e.target.closest("[data-fetch-rates]")) { cv.note = await fetchRates(); return WW.render(); }
    } catch (error) { fail(error); }
  });
  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "rates-form") return;
    e.preventDefault();
    const store = WW.state.store;
    try {
      for (const input of e.target.querySelectorAll("[data-rate]")) {
        const code = input.dataset.rate, text = input.value.trim().replace(/,/g, "");
        if (!text) continue;
        if (!/^\d+(\.\d+)?$/.test(text) || !(Number(text) > 0)) throw { plain: `Enter a ${code} rate greater than zero.` };
        const current = store.rates().find((x) => x.code === code);
        if (!current || Number(current.rate) !== Number(text)) await store.setRate(code, text.replace(/^0+(?=\d)/, ""), "MANUAL");
      }
      cv.note = "Rates saved.";
      WW.render();
    } catch (error) { fail(error); }
  });
  $("page-body").addEventListener("change", (e) => {
    const t = e.target.closest("[data-cv]");
    if (!t || !WW.state.page || WW.state.page.name !== "currencies") return;
    if (t.dataset.cv === "by" && !(Number(t.value) >= 0 && Number(t.value) < 100)) return;
    cv[t.dataset.cv] = t.value;
    WW.render();
  });
  S.fetchRates = fetchRates;
})();
