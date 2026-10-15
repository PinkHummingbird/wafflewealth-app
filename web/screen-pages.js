/* WaffleWealth on the web: the pages Projection opens, as the app lays them out.

   How the net worth figure is made, groups of accounts, Target, FIRE and Breakdown. */
(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M } = WW;
  const ui = WW.ui;
  const S = WW.screens;

  const fail = (box, error) => { box.innerHTML = `<p class="error">${esc(WW.C.explain(error))}</p>`; };
  const waiting = `<p class="empty">This appears once WaffleWealth on your iPhone has sent your income, spending and accounts.</p>`;

  // ---- How this number is made ----

  async function sum(arg, box) {
    const w = await S.projectionWork(WW.state.store);
    if (w.waiting || w.error) { box.innerHTML = w.waiting ? waiting : ""; return; }
    const s = w.R.netWorthSum(w.ctx), base = w.base;
    const row = (l, sign) => `<div class="sumrow"><span>${esc(l.name)}${l.rate ? `<small>${esc(ui.fmt(l.own, l.currency))} at 1 ${esc(l.currency)} = ${esc(l.rate)} ${esc(base)}</small>` : ""}</span><span class="amt">${esc(ui.fmt(sign * l.inBase, base))}</span></div>`;
    box.innerHTML = `<div class="card summary">
      <details class="sumgroup" open><summary><span>What you own <small class="n">${s.assets.length}</small></span><span class="amt">${esc(ui.fmt(s.owned, base))}</span></summary>
        ${s.assets.map((l) => row(l, 1n)).join("")}</details>
      <details class="sumgroup"><summary><span>Less what you owe <small class="n">${s.debts.length}</small></span><span class="amt">${esc(ui.fmt(-s.owed, base))}</span></summary>
        ${s.debts.map((l) => row(l, -1n)).join("")}</details>
      <div class="sumrow big"><span><b>Net worth</b></span><span class="amt">${esc(ui.fmt(s.netWorth, base))}</span></div>
      <p class="cap foot">In ${esc(base)}. Open a total to see its accounts.</p></div>`;
  }

  // ---- Groups ----

  const groupView = { editing: null };

  function groups(arg, box) {
    const store = WW.state.store;
    const accounts = store.accounts();
    const name = (id) => (store.account(id) ? store.account(id).f.name : null);
    const list = store.groups();
    const ed = groupView.editing;
    const form = ed ? `<form class="card f" id="group-form" novalidate>
        <h2>${ed.id ? "Edit group" : "New group"}</h2>
        <div class="field"><label for="g-name">Name</label><input id="g-name" maxlength="40" value="${esc(ed.name)}" placeholder="Retirement, Singapore, the house…"><span class="err" id="g-name-err"></span></div>
        <fieldset class="checks"><legend>Accounts</legend>
          ${[...accounts.filter((a) => a.f.kind === "ASSET"), ...accounts.filter((a) => a.f.kind !== "ASSET")].map((a) => `<label><input type="checkbox" value="${esc(a.name)}" ${ed.accountIds.includes(a.name) ? "checked" : ""}> ${esc(a.f.name)}${a.f.kind === "LIABILITY" ? ' <span class="tag owed">Owed</span>' : ""}</label>`).join("")}
          <span class="err" id="g-accounts-err"></span></fieldset>
        <p class="cap">The line is what these accounts become on their own. What you save each month and anything planned sits in no account, so it isn't in a group's line.</p>
        <div class="formacts"><button type="submit" class="btn">Save to iCloud</button><button type="button" class="linkbtn" data-g="cancel">Cancel</button>
          ${ed.id ? `<button type="button" class="linkbtn danger" data-g="delete">Delete group</button>` : ""}</div>
        <p class="error" id="g-error" role="alert" hidden></p></form>` : "";
    box.innerHTML = `<div class="stack1">${form}<div class="card list">
      ${list.length ? list.map((g) => `<div class="row plain"><div class="main"><span class="t">${esc(g.name)}</span><span class="d">${esc(g.accountIds.map(name).filter(Boolean).join(", ") || "No accounts at the moment")}</span></div>
        <div class="end"><button type="button" class="linkbtn" data-g-edit="${esc(g.id)}">Edit</button></div></div>`).join("")
        : `<p class="empty">Put accounts together under one name and see where they head as a line of their own.</p>`}
      ${ed ? "" : `<button type="button" class="btn ghost small" data-g="new">+ New group</button>`}</div></div>`;
  }

  async function groupClick(e) {
    const store = WW.state.store;
    const t = e.target.closest("[data-g],[data-g-edit]");
    if (!t) return;
    if (t.dataset.gEdit) {
      const g = store.groups().find((x) => x.id === t.dataset.gEdit);
      groupView.editing = { id: g.id, name: g.name, accountIds: g.accountIds, record: g.record };
    } else if (t.dataset.g === "new") groupView.editing = { id: null, name: "", accountIds: [] };
    else if (t.dataset.g === "cancel") groupView.editing = null;
    else if (t.dataset.g === "delete") {
      const ed = groupView.editing;
      if (!window.confirm(`Delete this group? ${ed.name} and its line go. Its accounts and every figure stay as they are.`)) return;
      try { await store.drop(ed.record); groupView.editing = null; } catch (error) { return fail(document.getElementById("page-body"), error); }
    }
    WW.render();
  }

  async function groupSubmit(e) {
    if (e.target.id !== "group-form") return;
    e.preventDefault();
    const store = WW.state.store, ed = groupView.editing;
    const draft = { name: document.getElementById("g-name").value, accountIds: [...e.target.querySelectorAll('.checks input:checked')].map((i) => i.value) };
    const problems = store.checkGroup(draft);
    document.getElementById("g-name-err").textContent = problems.name || "";
    document.getElementById("g-accounts-err").textContent = problems.accounts || "";
    if (Object.keys(problems).length) return;
    try {
      const saved = await store.saveGroup(draft, ed.record || null);
      if (!ed.id) {
        const on = (ui.read(S.SERIES_KEY) || "netWorth,available").split(",");
        ui.write(S.SERIES_KEY, [...on, `group:${saved.name}`].join(","));
      }
      groupView.editing = null;
      WW.render();
    } catch (error) {
      const el = document.getElementById("g-error"); el.hidden = false; el.textContent = WW.C.explain(error);
    }
  }

  WW.PAGES.sum = { title: () => "How this number is made", render: sum };
  WW.PAGES.groups = { title: () => "Groups", render: groups };
  const body = document.getElementById("page-body");
  body.addEventListener("click", (e) => { if (WW.state.page && WW.state.page.name === "groups") groupClick(e); });
  body.addEventListener("submit", (e) => { if (WW.state.page && WW.state.page.name === "groups") groupSubmit(e); });
  S.pageHelpers = { fail, waiting };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const QUAL = { NET_WORTH: "", INVESTED: " growing", CASH: " not growing", AVAILABLE: " in reach" };

  async function target(arg, box) {
    const store = WW.state.store;
    const w = await S.projectionWork(store);
    if (w.waiting) { box.innerHTML = S.pageHelpers.waiting; return; }
    if (w.error) w.projection = { months: [{ locked: 0n }] };
    const t = store.target(), base = w.base, today = w.today;
    const ret = ui.pct(w.ctx.assumptions.returnPct);
    const locked = w.projection.months.some((m) => m.locked !== 0n);
    const basis = t ? t.f.basis || "NET_WORTH" : "NET_WORTH";
    const options = [["NET_WORTH", "Net worth"], ["INVESTED", `Growing at ${ret}`], basis === "CASH" && ["CASH", `Not growing at ${ret}`], (locked || basis === "AVAILABLE") && ["AVAILABLE", "Money you can reach"]].filter(Boolean);
    let answer = "";
    if (t) {
      const a = w.targetAnswer || { kind: "error" };
      const head = a.kind === "reached" ? M.monthLabel(a.month) : a.kind === "alreadyMet" ? "Already there" : a.kind === "beyondCap" ? "Not within 50 years" : a.kind === "notRising" ? "Not on these numbers" : "Can't say right now";
      const line = a.kind === "reached" ? `${ui.months(a.offset)} from now, on these numbers` : a.kind === "notRising" ? "The line isn't heading there on these numbers." : a.kind === "beyondCap" ? "It gets closer, but not within fifty years." : "";
      answer = `<div class="card answer"><span class="k">Reaches ${esc(ui.fmt(t.f.amount_minor, base))}${esc(QUAL[basis])}</span><span class="v">${esc(head)}</span>${line ? `<span class="d">${esc(line)}</span>` : ""}</div>`;
    }
    const settings = `<form class="card f" id="target-form" novalidate>
      <div class="two">
        <div class="field"><label for="t-amount">Amount (${esc(base)})</label><input id="t-amount" inputmode="decimal" autocomplete="off" value="${t ? esc(M.editable(Number(t.f.amount_minor), base)) : ""}" placeholder="0"><span class="err" id="t-amount-err"></span></div>
        <div class="field"><label for="t-basis">Measured on</label><select id="t-basis">${options.map(([k, l]) => `<option value="${k}" ${k === basis ? "selected" : ""}>${esc(l)}</option>`).join("")}</select><span class="cap">Which figure has to reach the amount</span></div>
      </div>
      <div class="formacts"><button type="submit" class="btn">Save to iCloud</button>${t ? `<button type="button" class="linkbtn" data-t="clear">Clear the target</button>` : ""}</div>
      ${t ? "" : `<p class="cap">Name an amount and the app says which month your money reaches it.</p>`}
      <p class="error" id="t-error" role="alert" hidden></p></form>`;
    let take = "";
    if (t) {
      const by = t.f.by_month;
      if (w.error) take = "";
      else if (!by) take = `<div class="card"><h2>What it would take</h2><button type="button" class="btn ghost small" data-t="aim">Pick a month to aim for</button>
        <p class="cap">Pick a month and the app says what reaching the amount by then would take: saving more each month, or a higher yearly return. One at a time, never both.</p></div>`;
      else {
        const y0 = Number(today.slice(0, 4));
        const years = Array.from({ length: 51 }, (_, i) => y0 + i);
        const s = w.R.requiredSaving(w.ctx, today, t.f.amount_minor, basis, by);
        const r = w.R.requiredReturn(w.ctx, today, t.f.amount_minor, basis, by);
        const income = BigInt(w.ctx.assumptions.incomeMinor);
        const saveText = s.kind === "requires" ? `${ui.fmt(s.extraMonthlyMinor, base)} a month${income > 0n && s.extraMonthlyMinor > income ? ", more than your income" : ""}` : s.kind === "alreadyMet" ? "Already there by then" : "Can't be done by then";
        const retText = r.kind === "requires" ? `${ui.pct(r.annualPct, 2)} a year` : r.kind === "alreadyMet" ? "Already there by then" : "Can't be done by then";
        take = `<div class="card summary"><h2>What it would take</h2>
          <div class="sumrow"><span>By</span><span class="amt row-inline"><select data-t="month" aria-label="Month">${MONTHS.map((m, i) => `<option value="${i + 1}" ${Number(by.slice(5, 7)) === i + 1 ? "selected" : ""}>${m}</option>`).join("")}</select>
            <select data-t="year" aria-label="Year">${years.map((y) => `<option ${Number(by.slice(0, 4)) === y ? "selected" : ""}>${y}</option>`).join("")}</select>
            <button type="button" class="iconbtn" data-t="nodeadline" aria-label="No month">✕</button></span></div>
          <div class="sumrow"><span>Save more</span><span class="amt plain">${esc(saveText)}</span></div>
          <div class="sumrow"><span>Or a yearly return of</span><span class="amt plain">${esc(retText)}</span></div>
          <p class="cap foot">Each line holds everything else as it stands and moves one thing. The app states the figure and stops.</p></div>`;
      }
    }
    box.innerHTML = `<div class="stack1">${answer}${settings}${take}</div>`;
  }

  async function save(change) {
    const store = WW.state.store, t = store.target();
    try {
      await store.setTarget({ amountMinor: t ? t.f.amount_minor : null, basis: t ? t.f.basis : "NET_WORTH", ...change });
      WW.render();
    } catch (error) {
      const el = document.getElementById("t-error"); if (el) { el.hidden = false; el.textContent = WW.C.explain(error); }
    }
  }

  function wire() {
    const body = document.getElementById("page-body");
    const here = () => WW.state.page && WW.state.page.name === "target";
    body.addEventListener("submit", (e) => {
      if (!here() || e.target.id !== "target-form") return;
      e.preventDefault();
      const store = WW.state.store, base = store.baseCurrency();
      const text = document.getElementById("t-amount").value.trim();
      const basis = document.getElementById("t-basis").value;
      if (!text || text === "0") return save({ amountMinor: null });
      const amount = M.parseAmount(text, base);
      document.getElementById("t-amount-err").textContent = amount.ok ? "" : amount.reason;
      if (amount.ok) save({ amountMinor: amount.minor, basis });
    });
    body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-t]");
      if (!here() || !b) return;
      const today = M.today();
      if (b.dataset.t === "clear") save({ amountMinor: null });
      if (b.dataset.t === "aim") {
        const [y, m] = today.split("-").map(Number), i = y * 12 + m - 1 + 60;
        save({ byMonth: `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}` });
      }
      if (b.dataset.t === "nodeadline") save({ byMonth: null });
    });
    body.addEventListener("change", (e) => {
      if (!here() || !e.target.matches('[data-t="month"],[data-t="year"]')) return;
      const m = body.querySelector('[data-t="month"]').value, y = body.querySelector('[data-t="year"]').value;
      save({ byMonth: `${y}-${String(m).padStart(2, "0")}` });
    });
  }

  WW.PAGES.target = { title: () => "Target", render: target };
  wire();
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const bview = { today: false, reach: false };

  const row = (label, value, base, cap = "") => `<div class="sumrow"><span>${esc(label)}${cap ? `<small>${esc(cap)}</small>` : ""}</span><span class="amt">${esc(ui.signed(value, base))}</span></div>`;

  /** Where an account's interest went, in the app's words. */
  function kept(a) {
    if (a.kind === "LIABILITY") return a.retained !== 0n ? "Added to what's owed" : "Paid from cash";
    if (a.retained === 0n) return "Paid out as cash";
    return a.retained === a.paid ? "Kept in the account" : "Partly kept";
  }

  function flows(w) {
    const b = w.breakdown, base = w.base, span = b.horizonMonths;
    const times = (n) => (n === 1 ? "Planned, once" : `Planned, ${n} times`);
    const payers = b.accounts.filter((a) => a.paid !== 0n);
    const earners = payers.filter((a) => a.paid > 0n), chargers = payers.filter((a) => a.paid < 0n);
    const pin = b.planned.filter((x) => x.total > 0n), pout = b.planned.filter((x) => x.total < 0n);
    const tin = b.income + b.interestEarned + pin.reduce((t, x) => t + x.total, 0n);
    const tout = -b.spending - b.interestCharged + pout.reduce((t, x) => t + x.total, 0n);
    const growers = b.accounts.filter((a) => a.growth !== 0n);
    return `<div class="card summary"><h2>Money over ${esc(ui.months(span))}</h2>
      <details class="sumgroup" open><summary><span>Money in</span><span class="amt">${esc(ui.signed(tin, base))}</span></summary>
        ${row("Income", b.income, base)}
        ${b.interestEarned !== 0n ? `<details class="sumgroup"><summary><span>Interest &amp; dividends</span><span class="amt">${esc(ui.signed(b.interestEarned, base))}</span></summary>${earners.map((a) => row(a.name, a.paid, base, kept(a))).join("")}</details>` : ""}
        ${pin.map((x) => row(x.name, x.total, base, times(x.times))).join("")}</details>
      <details class="sumgroup" open><summary><span>Money out</span><span class="amt">${esc(ui.signed(tout, base))}</span></summary>
        ${row("Spending", -b.spending, base)}
        ${b.interestCharged !== 0n ? `<details class="sumgroup"><summary><span>Interest &amp; fees on debts</span><span class="amt">${esc(ui.signed(-b.interestCharged, base))}</span></summary>${chargers.map((a) => row(a.name, a.paid, base, kept(a))).join("")}</details>` : ""}
        ${pout.map((x) => row(x.name, x.total, base, times(x.times))).join("")}</details>
      ${b.growth !== 0n ? `<details class="sumgroup"><summary><span>Investment growth</span><span class="amt">${esc(ui.signed(b.growth, base))}</span></summary>
        ${growers.map((a) => row(a.name, a.growth, base, `${ui.compact(a.now, base)} → ${ui.compact(a.then, base)}${a.kind === "LIABILITY" ? " owed" : ""}`)).join("")}</details>` : ""}
      <p class="cap foot">Each month is rounded on its own, so these can miss the change above in the last digit.</p></div>`;
  }

  S.breakdownParts = { flows, bview, row };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const P = S.breakdownParts;

  function distribution(w) {
    const base = w.base, bv = P.bview;
    const span = w.breakdown.horizonMonths;
    let slices, extra = "";
    if (bv.today) {
      slices = w.R.netWorthSum(w.ctx).assets.filter((a) => a.inBase > 0n).map((a) => ({ name: a.name, value: a.inBase }));
    } else {
      const h = w.R.horizonHoldings(w.breakdown, w.ctx, w.projection);
      slices = h.holdings.filter((x) => !bv.reach || x.reachable).map((x) => ({ name: x.name, value: x.value }));
      if (h.unassigned > 0n) slices.push({ name: "Saved by then", note: "In no account yet", value: h.unassigned });
      else if (h.unassigned < 0n) extra = `<div class="sumrow"><span>Drawn down by then<small>From an account the app can't name</small></span><span class="amt">${esc(ui.signed(h.unassigned, base))}</span></div>`;
    }
    slices.sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));
    if (slices.length > 8) {
      const rest = slices.slice(8).reduce((t, s) => t + s.value, 0n);
      slices = [...slices.slice(0, 8), { name: "Other", value: rest }];
    }
    const total = slices.reduce((t, s) => t + s.value, 0n);
    const share = (v) => (total === 0n ? 0 : Number((v * 1000n) / total) / 10);
    const locked = w.projection.months.some((m) => m.locked !== 0n);
    return `<div class="card"><h2>What you own, by account</h2>
      <div class="segs"><button type="button" class="segbtn" data-b="today" aria-pressed="${bv.today}">Today</button><button type="button" class="segbtn" data-b="horizon" aria-pressed="${!bv.today}">In ${esc(ui.months(span))}</button>
        ${locked && !bv.today ? `<span class="gap"></span><button type="button" class="segbtn" data-b="all" aria-pressed="${!bv.reach}">All money</button><button type="button" class="segbtn" data-b="reach" aria-pressed="${bv.reach}">Can be reached</button>` : ""}</div>
      ${total === 0n ? `<p class="empty">Nothing owned to split.</p>` : `<div class="stackbar" role="img" aria-label="Share of what you own, by account">${slices.map((s, i) => `<span class="seg c${i % 9}" style="width:${share(s.value)}%"></span>`).join("")}</div>
      <div class="dist-legend">${slices.map((s, i) => `<div class="sumrow"><span><i class="sw c${i % 9}"></i>${esc(s.name)}${s.note ? `<small>${esc(s.note)}</small>` : ""}</span><span class="amt">${esc(ui.fmt(s.value, base))}<small>${share(s.value)}%</small></span></div>`).join("")}${extra}</div>`}
    </div>`;
  }

  function reach(w) {
    const now = w.projection.months[0];
    if (now.locked === 0n) return "";
    const birth = w.ctx.assumptions.birthYear ? `${w.ctx.assumptions.birthYear}-${String(w.ctx.assumptions.birthMonth).padStart(2, "0")}` : null;
    const lockedAccounts = w.ctx.accounts.filter((a) => {
      const unlock = a.availableFromAge != null ? (birth ? `${Number(birth.slice(0, 4)) + a.availableFromAge}-${birth.slice(5)}` : null) : a.availableFromMonth;
      a._unlock = unlock;
      return unlock && unlock > w.today.slice(0, 7);
    });
    return `<div class="card summary"><h2>What you can reach</h2>
      <div class="sumrow"><span>Can be reached</span><span class="amt">${esc(ui.fmt(now.available, w.base))}</span></div>
      <div class="sumrow"><span>Locked away</span><span class="amt">${esc(ui.fmt(now.locked, w.base))}</span></div>
      ${lockedAccounts.map((a) => `<div class="sumrow"><span>${esc(a.name)}<small>Available from ${esc(M.monthLabel(a._unlock))}</small></span><span class="amt">${esc(ui.fmt(a.latestMinor, a.currency))}</span></div>`).join("")}
      <p class="cap foot">Locked money counts in your net worth. “If income stopped” can spend it from the month it unlocks.</p></div>`;
  }

  function levers(w) {
    const a = w.ctx.assumptions, base = w.base;
    const up = (v) => `${ui.pct(v, 2)} → ${ui.pct(String(Number(v) + 1), 2)}`;
    const label = { investmentReturn: `Growth rate ${up(a.returnPct)}`, raise: `Yearly raise ${up(a.raisePct)}`, spendingGrowth: `Spending growth ${up(a.spendingGrowthPct)}`, income: "Income +1%", spending: "Spending +1%" };
    let list;
    try { list = w.R.levers(w.ctx, w.today); } catch (e) { return ""; }
    return `<details class="card sumgroup lev"><summary><span>Change one thing</span><span class="cap">effect in ${esc(ui.months(w.breakdown.horizonMonths))}</span></summary>
      ${list.map((l) => `<div class="sumrow"><span>${esc(label[l.kind])}</span><span class="amt">${esc(ui.signed(l.deltaMinor, base))}</span></div>`).join("")}
      <p class="cap foot">Rates move by a point; amounts by one percent of themselves. The app ranks by effect and can't say which is easier to change.</p></details>`;
  }

  function monthly(w) {
    const base = w.base;
    const parts = (m) => [["Money in", m.income], ["Money out", -m.spending], ["Investment growth", m.growth], ["Interest & dividends", m.interest], ["Planned items", m.planned]].filter(([, v]) => v !== 0n);
    return `<details class="card sumgroup"><summary><span>Monthly detail in ${esc(base)}</span></summary>
      ${w.projection.months.slice(1).map((m) => {
        const p = parts(m);
        return `<details class="sumgroup"><summary><span>${esc(M.monthLabel(m.month))}</span><span class="amt">${esc(ui.fmt(m.netWorth, base))}<small>${esc(ui.signed(m.change, base))}</small></span></summary>
          ${p.length ? p.map(([l, v]) => P.row(l, v, base)).join("") : `<p class="cap">Nothing moved this month.</p>`}</details>`;
      }).join("")}</details>`;
  }

  S.breakdownMore = { distribution, reach, levers, monthly };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc } = WW;
  const ui = WW.ui;
  const S = WW.screens;

  async function breakdown(arg, box) {
    const w = await S.projectionWork(WW.state.store);
    if (w.waiting || w.error || !w.breakdown) { box.innerHTML = w.waiting ? S.pageHelpers.waiting : `<p class="empty">Breakdown needs the projection, which can't be worked out from these figures yet.</p>`; return; }
    const h = Number(w.ctx.assumptions.horizonMonths), base = w.base;
    const span = w.projection.months.length - 1;
    const end = w.projection.months[span].netWorth, change = end - w.projection.months[0].netWorth;
    const sum = w.R.netWorthSum(w.ctx);
    const M2 = S.breakdownMore;
    box.innerHTML = `<div class="stack1">
      <div class="segs">${[[12, "1 yr"], [24, "2 yr"], [36, "3 yr"]].map(([m, t]) => `<button type="button" class="segbtn" data-bh="${m}" aria-pressed="${h === m}">${t}</button>`).join("")}${[12, 24, 36].includes(h) ? "" : `<button type="button" class="segbtn" aria-pressed="true">${esc(ui.months(h, true))}</button>`}</div>
      <div class="card summary"><h2>In ${esc(ui.months(span))}</h2>
        <div class="sumrow big"><span>Total</span><span class="amt">${esc(ui.fmt(end, base))}</span></div>
        <div class="sumrow big"><span>Change</span><span class="amt">${esc(ui.signed(change, base))}${w.changePct != null ? ` <small>(${esc(ui.pct(w.changePct.toString()))})</small>` : ""}</span></div></div>
      ${S.breakdownParts.flows(w)}
      <div class="tiles two"><div class="tile static"><span class="t">Assets</span><span class="a">${esc(ui.fmt(sum.owned, base))}</span><span class="f">What you own, today</span></div>
        <div class="tile static"><span class="t">Liabilities</span><span class="a">${esc(ui.fmt(sum.owed, base))}</span><span class="f">What you owe, today</span></div></div>
      ${M2.distribution(w)}${M2.reach(w)}${M2.levers(w)}${M2.monthly(w)}</div>`;
  }

  const body = document.getElementById("page-body");
  body.addEventListener("click", async (e) => {
    if (!WW.state.page || WW.state.page.name !== "breakdown") return;
    const t = e.target.closest("[data-bh],[data-b]");
    if (!t) return;
    if (t.dataset.bh) { await WW.state.store.patchAssumptions({ horizon_months: Number(t.dataset.bh) }); return WW.render(); }
    const bv = S.breakdownParts.bview;
    if (t.dataset.b === "today") bv.today = true;
    if (t.dataset.b === "horizon") bv.today = false;
    if (t.dataset.b === "all") bv.reach = false;
    if (t.dataset.b === "reach") bv.reach = true;
    WW.render();
  });

  WW.PAGES.breakdown = { title: () => "Breakdown", render: breakdown };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const KEY = { basis: "ww.fireBasis", pot: "ww.fireWhatIfPot", spend: "ww.fireWhatIfSpend", save: "ww.fireWhatIfSave", ret: "ww.fireWhatIfReturn" };

  /** The question asked three ways: of the assumptions, of the record, or of figures typed here. */
  function asked(w, store) {
    const a = w.ctx.assumptions, pct = a.withdrawalPct || "4";
    const rec = S.historyRecord(store, w.H);
    let pace = null;
    try { pace = w.H.realisedPace(w.H.derive(rec, w.ctx, w.today), rec.accountsById); } catch (e) { pace = null; }
    let basis = ui.read(KEY.basis) || "assumptions";
    if (basis === "happened" && !pace) basis = "assumptions";
    const whatIf = {
      potMinor: BigInt(ui.read(KEY.pot) || String(w.projection.months[0].available)),
      monthlySpendingMinor: BigInt(ui.read(KEY.spend) || String(a.spendingMinor)),
      monthlySavingMinor: BigInt(ui.read(KEY.save) || String(BigInt(a.incomeMinor) - BigInt(a.spendingMinor))),
      annualReturnPct: ui.read(KEY.ret) || String(a.returnPct), annualSpendingGrowthPct: String(a.spendingGrowthPct),
    };
    let ctx = w.ctx;
    if (basis === "happened") ctx = { ...ctx, assumptions: { ...a, incomeMinor: BigInt(a.spendingMinor) + pace.perMonth, returnPct: "0", raisePct: "0" } };
    if (basis === "whatif") ctx = w.R.scenarioContext(w.ctx, whatIf);
    let answer;
    try { answer = w.R.enough(ctx, w.today, pct, "AVAILABLE"); } catch (e) { answer = { kind: "error" }; }
    let other = null;
    if (basis !== "whatif") {
      try {
        other = basis === "assumptions" ? (pace ? w.R.enoughAtPace(w.ctx, w.today, pct, pace.perMonth) : null) : w.R.enough(w.ctx, w.today, pct);
      } catch (e) { other = null; }
    }
    return { basis, pace, whatIf, ctx, answer, other, pct };
  }

  const headline = (a) => a.kind === "reached" ? M.monthLabel(a.month) : a.kind === "alreadyEnough" ? "Already" : a.kind === "beyondCap" ? "Not within 50 years"
    : a.kind === "notClosing" ? "Never, on these numbers" : a.kind === "noSpending" ? "Needs your monthly spending" : "Can't be worked out right now";
  const short = (a) => a.kind === "reached" ? `${M.monthLabel(a.month)}, ${ui.months(a.offset)}` : headline(a);

  function answerCard(w, q) {
    const a = q.answer, rate = ui.pct(q.pct, 2);
    const names = { assumptions: "My assumptions", happened: "What's happened", whatif: "What if" };
    const line = a.kind === "reached" ? `${ui.months(a.offset)} from now. From then, drawing ${rate} of it a year covers your spending.`
      : a.kind === "alreadyEnough" ? `What you can reach already covers the year ahead, drawing ${rate} of it.`
      : a.kind === "notClosing" ? "Spending grows as fast as the money." : "";
    return `<div class="card answer"><span class="k">When · ${esc(names[q.basis])}</span><span class="k2">Covers your spending from</span>
      <span class="v">${esc(headline(a))}</span>${line ? `<span class="d">${esc(line)}</span>` : ""}
      ${a.kind === "noSpending" ? `<button type="button" class="linkbtn" data-page="assumptions">Add what a month costs under Income &amp; spending to get an answer</button>` : ""}
      ${a.kind === "reached" ? `<div class="sumrow"><span>Pot needed then</span><span class="amt">${esc(ui.fmt(a.covering, w.base))}</span></div>` : ""}
      ${q.other ? `<p class="cap">${q.basis === "assumptions" ? "What's happened" : "My assumptions"}: ${esc(short(q.other))}.</p>` : ""}</div>`;
  }

  function basisCard(w, q) {
    const months = w.H && q.pace == null ? (() => { try { const r = w.H.derive(S.historyRecord(WW.state.store, w.H), w.ctx, w.today); return r ? r.months.length : 0; } catch (e) { return 0; } })() : 0;
    return `<div class="card"><h2>Based on</h2><div class="segs">
      <button type="button" class="segbtn" data-fire-basis="assumptions" aria-pressed="${q.basis === "assumptions"}">My assumptions</button>
      <button type="button" class="segbtn" data-fire-basis="happened" aria-pressed="${q.basis === "happened"}" ${q.pace ? "" : "disabled"}>What's happened</button>
      <button type="button" class="segbtn" data-fire-basis="whatif" aria-pressed="${q.basis === "whatif"}">What if</button></div>
      ${q.pace ? "" : `<p class="cap">“What's happened” needs 3 months of recorded balances: ${months} so far.</p>`}
      ${q.basis === "happened" ? `<div class="sumrow"><span>Added each month</span><span class="amt">${esc(ui.signed(q.pace.perMonth, w.base))}</span></div>
        <div class="sumrow"><span>Measured over</span><span class="amt plain">${esc(M.monthLabel(q.pace.from))} to ${esc(M.monthLabel(q.pace.to))}</span></div>` : ""}
      ${q.basis === "whatif" ? whatIfForm(w, q) : ""}</div>`;
  }

  function whatIfForm(w, q) {
    const base = w.base, s = q.whatIf;
    const f = (id, label, value) => `<div class="field"><label for="fw-${id}">${label}</label><input id="fw-${id}" data-fw="${id}" inputmode="decimal" autocomplete="off" value="${esc(value)}"><span class="err" id="fw-${id}-err"></span></div>`;
    return `<div class="two">${f("pot", `What you have (${esc(base)})`, M.editable(Number(s.potMinor), base))}${f("spend", `A month costs (${esc(base)})`, M.editable(Number(s.monthlySpendingMinor), base))}</div>
      <div class="two">${f("save", `You add a month (${esc(base)})`, (s.monthlySavingMinor < 0n ? "-" : "") + M.editable(Number(s.monthlySavingMinor), base))}${f("ret", "Yearly return (%)", s.annualReturnPct)}</div>
      <button type="button" class="linkbtn" data-fire="reset">Start from my figures again</button><p class="cap">None of this is saved to your file.</p>`;
  }

  S.fireParts = { asked, answerCard, basisCard, KEY };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const F = S.fireParts;

  function withdrawalCard(q) {
    const r = Number(q.pct);
    return `<div class="card"><h2>What you'd take out each year</h2><div class="segs">${["3", "3.5", "4", "5"].map((v) => `<button type="button" class="segbtn" data-fire-pct="${v}" aria-pressed="${Number(v) === r}">${v}%</button>`).join("")}</div>
      <p class="cap">At ${esc(ui.pct(q.pct, 2))} a year the pot is ${esc(String(Number((100 / r).toFixed(1))))}× a year's spending.</p></div>`;
  }

  function ratesCard(w, q) {
    if (q.basis === "whatif" || !["reached", "alreadyEnough"].includes(q.answer.kind)) return "";
    const a = w.ctx.assumptions, own = a.fireInterestPct != null && a.fireGrowthPct != null;
    return `<div class="card"><h2>After FIRE, the pot earns</h2><div class="segs">
      <button type="button" class="segbtn" data-fire-rates="accounts" aria-pressed="${!own}">Your accounts' rates</button>
      <button type="button" class="segbtn" data-fire-rates="fire" aria-pressed="${own}">Rates for FIRE</button></div>
      ${own ? `<div class="two"><div class="field"><label for="fr-i">Interest a year (%)</label><input id="fr-i" data-fr="i" inputmode="decimal" value="${esc(a.fireInterestPct)}"></div>
        <div class="field"><label for="fr-g">Capital growth a year (%)</label><input id="fr-g" data-fr="g" inputmode="decimal" value="${esc(a.fireGrowthPct)}"></div></div><p class="error" id="fr-err" hidden></p>` : ""}</div>`;
  }

  function flowCard(w, q) {
    const a = q.answer;
    if (!["reached", "alreadyEnough"].includes(a.kind)) return "";
    let f;
    try { f = w.R.enoughFlow(q.ctx, w.today, q.pct, a.kind === "reached" ? a.offset : 0, "AVAILABLE"); } catch (e) { f = null; }
    if (!f) return "";
    const base = w.base, as = q.ctx.assumptions;
    const parts = f.fireInterest != null
      ? `<div class="sumrow"><span>Interest at ${esc(ui.pct(as.fireInterestPct, 2))}</span><span class="amt">${esc(ui.fmt(f.fireInterest, base))}</span></div><div class="sumrow"><span>Capital growth at ${esc(ui.pct(as.fireGrowthPct, 2))}</span><span class="amt">${esc(ui.fmt(f.fireGrowth, base))}</span></div>`
      : `<div class="sumrow"><span>Of the pot, growing at ${esc(ui.pct(as.returnPct, 2))}</span><span class="amt">${esc(ui.fmt(f.growing, base))}</span></div>`;
    const earn = f.yearlyReturn, take = f.yearlyWithdrawal;
    const verdict = earn > take ? `Earn ${ui.fmt(earn, base)} > Take out ${ui.fmt(take, base)}. Net ${ui.signed(earn - take, base)} a year.`
      : earn < take ? `Earn ${ui.fmt(earn, base)} < Take out ${ui.fmt(take, base)}. Net ${ui.signed(earn - take, base)} a year.`
      : `Earn ${ui.fmt(earn, base)} = Take out ${ui.fmt(take, base)}. The pot holds its level.`;
    return `<div class="card summary"><h2>That year, in and out</h2><p class="cap">The first year after ${esc(M.monthLabel(f.month))}</p>
      <div class="sumrow"><span>The pot</span><span class="amt">${esc(ui.fmt(f.pot, base))}</span></div>
      <details class="sumgroup"><summary><span>Total pot growth${f.earnedPct != null ? ` at ${esc(ui.pct(f.earnedPct))}` : ""}</span><span class="amt">${esc(ui.fmt(earn, base))}</span></summary>${parts}</details>
      <div class="sumrow"><span>Take out at ${esc(ui.pct(q.pct, 2))}</span><span class="amt">${esc(ui.fmt(take, base))}</span></div>
      <div class="sumrow"><span>Spending that year</span><span class="amt">${esc(ui.fmt(f.yearOfSpending, base))}</span></div>
      <p class="verdict">${esc(verdict)}</p></div>`;
  }

  async function fire(arg, box) {
    const store = WW.state.store;
    const w = await S.projectionWork(store);
    if (w.waiting || w.error) { box.innerHTML = w.waiting ? S.pageHelpers.waiting : ""; return; }
    const q = F.asked(w, store);
    box.innerHTML = `<div class="stack1"><p class="cap sub">Financial independence</p>${F.answerCard(w, q)}${F.basisCard(w, q)}${withdrawalCard(q)}${ratesCard(w, q)}${flowCard(w, q)}</div>`;
  }

  const body = document.getElementById("page-body");
  const here = () => WW.state.page && WW.state.page.name === "fire";
  const err = (error) => { const el = document.getElementById("fr-err") || document.getElementById("work-error"); el.hidden = false; el.textContent = WW.C.explain(error); };
  body.addEventListener("click", async (e) => {
    if (!here()) return;
    const t = e.target.closest("[data-fire-basis],[data-fire-pct],[data-fire-rates],[data-fire]");
    if (!t) return;
    const store = WW.state.store;
    try {
      if (t.dataset.fireBasis) ui.write(F.KEY.basis, t.dataset.fireBasis);
      if (t.dataset.firePct) await store.patchAssumptions({ annual_withdrawal_pct: t.dataset.firePct });
      if (t.dataset.fireRates === "accounts") await store.patchAssumptions({ fire_interest_pct: null, fire_growth_pct: null });
      if (t.dataset.fireRates === "fire") await store.patchAssumptions({ fire_interest_pct: "0", fire_growth_pct: String(store.assumptions().f.annual_return_pct) });
      if (t.dataset.fire === "reset") for (const k of ["pot", "spend", "save", "ret"]) ui.write(F.KEY[k], null);
    } catch (error) { return err(error); }
    WW.render();
  });
  body.addEventListener("change", async (e) => {
    if (!here()) return;
    const store = WW.state.store, base = store.baseCurrency();
    const fw = e.target.closest("[data-fw]"), fr = e.target.closest("[data-fr]");
    if (fw) {
      const id = fw.dataset.fw, text = fw.value.trim();
      if (id === "ret") {
        const p = M.parsePercent(text);
        document.getElementById("fw-ret-err").textContent = p.ok ? "" : p.reason;
        if (!p.ok) return;
        ui.write(F.KEY.ret, p.value);
      } else {
        const negative = id === "save" && text.startsWith("-");
        const amount = M.parseAmount(text.replace(/^-/, ""), base);
        document.getElementById(`fw-${id}-err`).textContent = amount.ok ? "" : amount.reason;
        if (!amount.ok) return;
        ui.write(F.KEY[id], String(negative ? -amount.minor : amount.minor));
      }
      return WW.render();
    }
    if (fr) {
      const i = M.parsePercent(document.getElementById("fr-i").value), g = M.parsePercent(document.getElementById("fr-g").value);
      if (!i.ok || !g.ok) return err({ reason: (i.ok ? g : i).reason });
      if ([i, g].some((p) => Math.abs(Number(p.value)) > 100)) return err({ reason: "Use a rate between −100% and 100%." });
      try { await store.patchAssumptions({ fire_interest_pct: i.value, fire_growth_pct: g.value }); } catch (error) { return err(error); }
      WW.render();
    }
  });

  WW.PAGES.fire = { title: () => "FIRE", render: fire };
})();
