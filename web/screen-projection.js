/* WaffleWealth on the web: the Projection tab, as the app lays it out.

   The figure and where it is heading, the line with the lines you choose beside it and the
   months the readings land in flagged on it, how far ahead it runs, Target, FIRE and Breakdown
   as tiles, the three figures that move the line most as sliders, what changed since last
   month, what lands in the next thirty days, and the summary. Every figure comes from the
   engine and readings ported from the app (projection.mjs, readings.mjs, history.mjs). */
(function () {
  "use strict";
  const WW = globalThis.WW;
  const { $, esc, M } = WW;
  const ui = WW.ui;

  const SERIES_KEY = "ww.projectionSeries";
  const view = { preview: null, undo: null, comingAll: false, run: 0 };

  /** The engines' inputs and answers for the screen, worked out once per draw. */
  async function work(store, override) {
    const ctx0 = WW.projectionContext(store);
    if (!ctx0) return { waiting: true };
    const ctx = override ? { ...ctx0, assumptions: { ...ctx0.assumptions, ...override } } : ctx0;
    const { P, R, H } = await WW.engines();
    const today = M.today();
    const out = { ctx, P, R, H, today, base: ctx.base };
    try {
      out.projection = P.project(ctx, today);
    } catch (error) {
      out.error = error;
      return out;
    }
    const safe = (fn) => { try { return fn(); } catch (e) { return null; } };
    const target = store.target();
    out.target = target;
    out.targetAnswer = target ? safe(() => R.target(ctx, today, target.f.amount_minor, target.f.basis || "NET_WORTH")) : null;
    out.enough = safe(() => R.enough(ctx, today, ctx.assumptions.withdrawalPct || "4", "AVAILABLE"));
    out.debts = ctx.accounts.filter((a) => a.kind === "LIABILITY" && a.latestMinor != null)
      .map((a) => safe(() => R.debtClearance(a.latestMinor, a.income, today)));
    out.runway = safe(() => R.runway(ctx, today));
    out.breakdown = safe(() => R.breakdown(ctx, out.projection, today));
    out.coming = safe(() => R.comingUp(ctx, today)) || [];
    out.groups = store.groups().map((g) => ({ ...g, line: safe(() => R.groupLine(g.accountIds, ctx, out.projection, today)) }));
    out.staleMonths = R.monthsSinceNewestBalance(ctx, today);
    out.savingsRate = R.savingsRate(out.projection, ctx.assumptions.incomeMinor);
    out.changePct = R.changePercent(out.projection);
    out.since = safe(() => sinceLastTime(store, ctx, H, today));
    return out;
  }

  /** The record History reads, from iCloud's rows. */
  function record(store, H) {
    const accounts = store.of("Account").map((a) => ({ id: a.name, name: a.f.name, kind: a.f.kind, currency: a.f.currency_code, archivedAt: a.f.archived_at || null }));
    const withdrawn = new Set(store.of("BalanceWithdrawal").map((w) => w.name.replace(/^withdrawal-/, "")));
    const balances = store.of("Balance").filter((b) => !withdrawn.has(b.name))
      .map((b) => ({ id: b.name, accountId: b.f.account_id, valueMinor: BigInt(b.f.value_minor), asOfDate: b.f.as_of_date, createdAt: b.f.created_at }));
    return H.makeRecord(accounts, balances);
  }

  function sinceLastTime(store, ctx, H, today) {
    const rec = record(store, H);
    const allRates = { ...ctx };
    const reading = H.derive(rec, allRates, today);
    if (!reading || reading.months.length < 2) return null;
    const from = reading.months[reading.months.length - 2].month, to = reading.months[reading.months.length - 1].month;
    return H.attribution(from, to, reading, rec.accountsById);
  }

  WW.screens = WW.screens || {};
  WW.screens.projectionWork = work;
  WW.screens.historyRecord = record;
  WW.screens.projectionView = view;
  WW.screens.SERIES_KEY = SERIES_KEY;
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const view = S.projectionView;

  const eye = (on) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>${on ? '<path d="M3 3l18 18"/>' : ""}</svg>`;
  const info = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.5v.5" stroke-linecap="round"/></svg>`;

  function hero(w) {
    const p = w.projection, base = w.base;
    const now = p.months[0].netWorth, then = p.months[p.months.length - 1].netWorth;
    const span = p.months.length - 1;
    return `<div class="hero2">
      <div class="hero-label">Net worth
        <button type="button" class="iconbtn" data-act="hide" aria-label="${ui.isHidden() ? "Show amounts" : "Hide amounts"}">${eye(ui.isHidden())}</button>
        <button type="button" class="iconbtn" data-page="sum" aria-label="How this number is made">${info}</button>
      </div>
      <div class="hero-figure">${esc(ui.compactCoded(now, base))}</div>
      <div class="hero-exact">${esc(ui.fmt(now, base))}</div>
      ${span > 0 ? `<div class="hero-then">→ ${esc(ui.compactCoded(then, base))} in ${esc(ui.months(span))}</div>` : ""}
    </div>`;
  }

  /** At most one notice, the most serious: old balances, then a line with no income or spending. */
  function notice(w) {
    const a = w.ctx.assumptions;
    if (w.staleMonths != null && w.staleMonths >= 2) {
      const newest = w.ctx.accounts.map((x) => x.latestDate).filter(Boolean).sort().pop();
      return `<div class="notice-card"><p>Your newest balance is from ${esc(M.monthLabel(newest.slice(0, 7)))}, about ${esc(ui.months(w.staleMonths))} ago. Everything on this screen starts from that figure.</p>
        <button type="button" class="linkbtn" data-go="accounts">Update your balances</button></div>`;
    }
    if (BigInt(a.incomeMinor) === 0n && BigInt(a.spendingMinor) === 0n) {
      return `<div class="notice-card"><p>The chart leaves out what you earn and spend: you haven't told the app either yet.</p>
        <button type="button" class="linkbtn" data-page="assumptions">Set income and spending</button></div>`;
    }
    return "";
  }

  S.projectionParts = { hero, notice };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M } = WW;
  const ui = WW.ui;
  const S = WW.screens;

  /** The lines the chart can draw, offered only where they say something. */
  function offered(w) {
    const p = w.projection, ret = String(w.ctx.assumptions.returnPct);
    const months = p.months;
    const list = [{ id: "netWorth", label: "Net worth", values: months.map((m) => Number(m.netWorth)) }];
    if (months.some((m) => m.locked !== 0n)) {
      list.push({ id: "available", label: "Can be reached", values: months.map((m) => Number(m.available)) });
      list.push({ id: "locked", label: "Cannot be reached", values: months.map((m) => Number(m.locked)) });
    }
    if (months.some((m) => m.invested !== 0n)) {
      list.push({ id: "invested", label: Number(ret) === 0 ? "Set to grow" : `Growing at ${ui.pct(ret)}`, values: months.map((m) => Number(m.invested)) });
    }
    for (const g of w.groups) if (g.line) list.push({ id: `group:${g.id}`, label: g.name, values: g.line.map(Number) });
    return list;
  }

  function chosen(list) {
    const stored = (ui.read(S.SERIES_KEY) || "netWorth,available").split(",");
    const picked = list.filter((s) => stored.includes(s.id));
    return picked.length ? picked : [list[0]];
  }

  /** Target, FIRE and the month every debt is paid off, where each lands inside the horizon. */
  function flags(w) {
    const out = [];
    const span = w.projection.months.length - 1;
    const inside = (a) => a && (a.kind === "reached" || a.kind === "clears") && a.offset <= span;
    if (inside(w.targetAnswer)) out.push({ index: w.targetAnswer.offset, text: `Target · ${ui.monthAxis(w.targetAnswer.month)}`, page: "target" });
    if (inside(w.enough)) out.push({ index: w.enough.offset, text: `FIRE · ${ui.monthAxis(w.enough.month)}`, page: "fire" });
    if (w.debts.length && w.debts.every((d) => d && (d.kind === "clears" || d.kind === "alreadyClear")) && w.debts.some((d) => d.kind === "clears")) {
      const last = w.debts.filter((d) => d.kind === "clears").sort((a, b) => b.offset - a.offset)[0];
      if (last.offset <= span) out.push({ index: last.offset, text: `Debt-free · ${ui.monthAxis(last.month)}` });
    }
    return out;
  }

  function horizonPicker(w) {
    const h = Number(w.ctx.assumptions.horizonMonths);
    const custom = ![12, 24, 36].includes(h);
    const seg = [[12, "1 yr"], [24, "2 yr"], [36, "3 yr"]].map(([m, t]) =>
      `<button type="button" class="segbtn" data-horizon="${m}" aria-pressed="${h === m}">${t}</button>`).join("");
    const years = Math.floor(h / 12), months = h % 12;
    const opts = (n, sel, unit) => Array.from({ length: n }, (_, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${i} ${unit}${i === 1 ? "" : "s"}</option>`).join("");
    return `<div class="horizon"><span class="k">How far ahead</span>
      <div class="segs">${seg}<button type="button" class="segbtn" data-horizon="custom" aria-pressed="${custom}">Custom</button></div>
      ${custom ? `<div class="custom-h"><label>For <select data-h="y">${opts(11, years, "year")}</select></label> <select data-h="m" aria-label="and months">${opts(12, months, "month")}</select></div>` : ""}
    </div>`;
  }

  function chartCard(w) {
    const list = offered(w), shown = chosen(list);
    const chips = list.map((s) => `<button type="button" class="segbtn chipline" data-series="${esc(s.id)}" aria-pressed="${shown.includes(s)}">${esc(s.label)}</button>`).join("");
    return { html: `<div class="card proj-card">
      <div class="chart" id="proj-chart" role="img" aria-label="${esc(shown.map((s) => s.label).join(", "))}, ${esc(M.monthLabel(w.projection.months[0].month))} to ${esc(M.monthLabel(w.projection.months[w.projection.months.length - 1].month))}"></div>
      <div class="series">${chips}<button type="button" class="segbtn chipline add" data-page="groups">+ Group</button></div>
      ${horizonPicker(w)}
    </div>`, shown };
  }

  function drawChart(w, shown) {
    ui.lineChart(document.getElementById("proj-chart"), {
      labels: w.projection.months.map((m) => m.month), code: w.base, flags: flags(w),
      series: shown.map((s, k) => ({ label: s.label, values: s.values, cls: k ? `s${k}` : "" })),
    });
  }

  S.projectionChart = { offered, chosen, chartCard, drawChart };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M } = WW;
  const ui = WW.ui;
  const S = WW.screens;

  const QUALIFIER = { NET_WORTH: "", INVESTED: " growing", CASH: " not growing", AVAILABLE: " in reach" };

  function tile(page, title, answer, fact) {
    return `<button type="button" class="tile" data-page="${page}"><span class="t">${esc(title)}</span><span class="a">${esc(answer)}</span><span class="f">${esc(fact)}</span><span class="chev" aria-hidden="true">›</span></button>`;
  }

  function tiles(w) {
    const base = w.base, span = w.projection.months.length - 1;
    let target;
    if (!w.target) target = tile("target", "Target", "Set an amount", "When your money reaches it");
    else {
      const a = w.targetAnswer || { kind: "none" };
      const answer = a.kind === "reached" ? ui.months(a.offset, true) : a.kind === "alreadyMet" ? "Already there"
        : a.kind === "beyondCap" ? "Not within 50 years" : a.kind === "notRising" ? "Not on these numbers" : "—";
      target = tile("target", "Target", answer, `${ui.compactCoded(w.target.f.amount_minor, base)}${QUALIFIER[w.target.f.basis] || ""}`);
    }
    const e = w.enough || { kind: "none" };
    const fire = tile("fire", "FIRE", e.kind === "reached" ? ui.months(e.offset, true) : e.kind === "alreadyEnough" ? "Already there"
      : e.kind === "beyondCap" ? "Not within 50 years" : e.kind === "notClosing" ? "Not on these numbers" : e.kind === "noSpending" ? "Needs your monthly spending" : "—",
      e.kind === "reached" ? M.monthLabel(e.month) : "Financial independence");
    const change = w.projection.months[span].netWorth - w.projection.months[0].netWorth;
    const breakdown = tile("breakdown", "Breakdown", ui.compact(change, base, true), `${base} in ${ui.months(span)}`);
    return `<div class="tiles">${target}${fire}${breakdown}</div>`;
  }

  /** A slider's range: twice the saved figure, at least 10,000, in about a hundred round steps. */
  function moneyRange(minor, code) {
    const unit = 10 ** M.scale(code);
    const max = Math.max(2 * Number(minor), 10000 * unit);
    const raw = max / 100, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((f) => f * mag).find((s) => s >= raw);
    return { max: Math.ceil(max / step) * step, step };
  }

  function controls(w, saved) {
    const a = w.ctx.assumptions, base = w.base;
    const inc = moneyRange(saved.incomeMinor, base), sp = moneyRange(saved.spendingMinor, base);
    const retMax = Math.max(15, Math.ceil(Number(saved.returnPct)));
    const span = w.projection.months.length - 1;
    const end = w.projection.months[span].netWorth;
    return `<div class="card live">
      <div class="outcome"><span>In ${esc(ui.months(span))}</span> <b id="live-end">${esc(ui.compactCoded(end, base))}</b> <span id="live-moved" class="moved"></span>
        ${S.projectionView.undo ? `<button type="button" class="linkbtn" data-act="undo">Undo</button>` : ""}</div>
      ${slider("income", "Income a month", Number(a.incomeMinor), inc, ui.fmt(a.incomeMinor, base))}
      ${slider("spending", "Spending a month", Number(a.spendingMinor), sp, ui.fmt(a.spendingMinor, base))}
      ${slider("return", "Yearly return", Number(a.returnPct), { max: retMax, step: 0.5 }, ui.pct(a.returnPct, 2))}
      <button type="button" class="rowlink" data-page="assumptions"><span>Raise, growth and more</span><span class="cap">Income &amp; spending ›</span></button>
    </div>`;
  }

  function slider(id, label, value, range, shown) {
    return `<div class="slider"><label for="sl-${id}">${esc(label)}</label><button type="button" class="pill" data-page="assumptions" id="sl-${id}-v">${esc(shown)}</button>
      <input type="range" id="sl-${id}" data-slider="${id}" min="0" max="${range.max}" step="${range.step}" value="${Math.min(value, range.max)}"></div>`;
  }

  S.projectionCards = { tiles, controls };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M } = WW;
  const ui = WW.ui;
  const S = WW.screens;

  /** The word and arrow a move wears, here and in History. */
  function movement(c) {
    if (c.kind === "firstTracked") return { verb: "New", up: c.amount >= 0n };
    if (c.kind === "archived") return { verb: "Archived", up: c.amount >= 0n };
    const up = c.amount > 0n;
    if (c.accountKind === "LIABILITY") return { verb: up ? "Paid down" : "More owed", up };
    return { verb: up ? "Grew" : "Fell", up };
  }

  function moverRow(c, base) {
    const m = movement(c);
    return `<div class="mover"><span class="arrow ${m.up ? "up" : "down"}" aria-hidden="true">${m.up ? "↑" : "↓"}</span>
      <span class="mv-name">${esc(c.name)}<small class="${m.up ? "up" : "down"}">${esc(m.verb)}</small></span>
      <span class="amt">${esc(ui.signed(c.amount, base))}</span></div>`;
  }

  function since(w) {
    const a = w.since;
    if (!a) return "";
    const movers = a.movers.slice(0, 3);
    return `<button type="button" class="card since" data-go="history">
      <div class="since-head"><span>Since ${esc(M.monthLabel(a.from))}</span><b>${esc(ui.signed(a.totalChange, w.base))}</b><span class="chev" aria-hidden="true">›</span></div>
      ${movers.length ? movers.map((c) => moverRow(c, w.base)).join("") : `<p class="cap">Nothing moved between ${esc(M.monthLabel(a.from))} and ${esc(M.monthLabel(a.to))}.</p>`}
    </button>`;
  }

  function coming(w) {
    if (!w.coming.length) return "";
    const all = S.projectionView.comingAll;
    const list = all ? w.coming : w.coming.slice(0, 3);
    return `<div class="card list coming">
      <button type="button" class="head rowlink" data-go="planned"><h2>Coming up · next 30 days</h2><span class="chev" aria-hidden="true">›</span></button>
      ${list.map((l) => `<div class="row plain"><div class="main"><span class="t">${esc(l.name)}</span><span class="d">${esc(M.dayLabel(l.date))}</span></div><div class="end"><span class="amt">${esc(ui.signed(l.amount, w.base))}</span></div></div>`).join("")}
      ${w.coming.length > 3 ? `<button type="button" class="linkbtn" data-act="coming">${all ? "Show fewer" : `Show ${w.coming.length - 3} more`}</button>` : ""}
    </div>`;
  }

  const runwayText = (r) => !r ? "—" : r.kind === "alreadyOut" ? "Already below zero today"
    : r.kind === "runsOut" ? `Lasts ${ui.months(r.offset)}, to ${M.monthLabel(r.month)}`
    : r.kind === "never" ? "Doesn't run out on these numbers" : "More than 50 years";

  function line(label, value, base, cap = "") {
    return `<div class="sumrow"><span>${esc(label)}${cap ? `<small>${esc(cap)}</small>` : ""}</span><span class="amt">${esc(ui.signed(value, base))}</span></div>`;
  }

  function summary(w) {
    const p = w.projection, base = w.base, b = w.breakdown;
    const span = p.months.length - 1;
    const end = p.months[span].netWorth, change = end - p.months[0].netWorth;
    const savings = BigInt(w.ctx.assumptions.incomeMinor) - BigInt(w.ctx.assumptions.spendingMinor);
    const times = (n) => (n === 1 ? "Planned, once" : `Planned, ${n} times`);
    let groups = "";
    if (b && span > 0) {
      const ins = [["Income", b.income], b.interestEarned !== 0n && ["Interest & dividends", b.interestEarned]].filter(Boolean);
      const outs = [["Spending", -b.spending], b.interestCharged !== 0n && ["Interest & fees on debts", -b.interestCharged]].filter(Boolean);
      const plannedIn = b.planned.filter((x) => x.total > 0n), plannedOut = b.planned.filter((x) => x.total < 0n);
      const totalIn = ins.reduce((t, [, v]) => t + v, 0n) + plannedIn.reduce((t, x) => t + x.total, 0n);
      const totalOut = outs.reduce((t, [, v]) => t + v, 0n) + plannedOut.reduce((t, x) => t + x.total, 0n);
      const grows = b.accounts.filter((x) => x.growth !== 0n);
      groups = `
        <details class="sumgroup"><summary><span>Money in</span><span class="amt">${esc(ui.signed(totalIn, base))}</span></summary>
          ${ins.map(([l, v]) => line(l, v, base)).join("")}${plannedIn.map((x) => line(x.name, x.total, base, times(x.times))).join("")}</details>
        <details class="sumgroup"><summary><span>Money out</span><span class="amt">${esc(ui.signed(totalOut, base))}</span></summary>
          ${outs.map(([l, v]) => line(l, v, base)).join("")}${plannedOut.map((x) => line(x.name, x.total, base, times(x.times))).join("")}</details>
        ${b.growth !== 0n ? `<details class="sumgroup"><summary><span>Investment growth</span><span class="amt">${esc(ui.signed(b.growth, base))}</span></summary>
          ${grows.map((x) => line(x.name, x.growth, base, `${ui.compact(x.now, base)} → ${ui.compact(x.then, base)}${x.kind === "LIABILITY" ? " owed" : ""}`)).join("")}</details>` : ""}`;
    }
    const locked = p.months.some((m) => m.locked !== 0n);
    const rate = w.savingsRate;
    return `<div class="card summary">
      <h2>In ${esc(ui.months(span))}</h2>
      <div class="sumrow big"><span>Total</span><span class="amt">${esc(ui.fmt(end, base))}</span></div>
      <div class="sumrow big"><span>Change</span><span class="amt">${esc(ui.signed(change, base))}${w.changePct != null ? ` <small>(${esc(ui.pct(w.changePct.toString()))})</small>` : ""}</span></div>
      ${groups}
      <div class="sumrow sep"><span>Monthly savings</span><span class="amt">${esc(ui.signed(savings, base))}${rate != null ? `<small>${esc(ui.pct(rate.toString()))} of income</small>` : ""}</span></div>
      <div class="sumrow"><span>If income stopped<small>This counts everything except income: your spending, planned money and investment growth all keep going.${locked ? " It spends only money you could reach: anything locked away is left out until the month it becomes available." : ""}</small></span><span class="amt plain">${esc(runwayText(w.runway))}</span></div>
    </div>`;
  }

  S.projectionLower = { since, coming, summary, movement, moverRow };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const view = S.projectionView;
  let last = null;

  async function render() {
    const store = WW.state.store, body = document.getElementById("proj-body");
    if (!store || !body) return;
    const run = ++view.run;
    const w = await S.projectionWork(store, view.preview);
    if (run !== view.run) return;
    last = w;
    if (w.waiting) {
      body.innerHTML = `<p class="empty">Your projection appears here once WaffleWealth on your iPhone has sent your income, spending and accounts: open the app with “Keep a copy in iCloud” on.</p>`;
      return;
    }
    if (!w.ctx.accounts.length) {
      body.innerHTML = `<div class="emptyscreen"><h2>Add your first account</h2><p>This screen draws your net worth forward, month by month, from whatever you have today. One account is enough to start. Add it in WaffleWealth on your iPhone.</p></div>`;
      return;
    }
    if (w.error) {
      const code = w.error.code;
      body.innerHTML = w.error.kind === "missingRate"
        ? `<div class="emptyscreen"><h2>Needs a ${esc(code)} exchange rate</h2><p>One of your accounts is in ${esc(code)}. Until the app has a ${esc(code)}→${esc(w.base)} exchange rate it won't guess what that account is worth.</p><button type="button" class="btn" data-go="settings">Enter the rate</button></div>`
        : `<div class="emptyscreen"><h2>Can't project these numbers</h2><p>An amount is too large to work with, and the app would rather say so than show a wrong line.</p></div>`;
      return;
    }
    WW.state.projection = w.projection;
    const saved = WW.projectionContext(store).assumptions;
    const chart = S.projectionChart.chartCard(w);
    const L = S.projectionLower;
    body.innerHTML = `${S.projectionParts.notice(w)}${S.projectionParts.hero(w)}${chart.html}${S.projectionCards.tiles(w)}
      ${S.projectionCards.controls(w, saved)}${L.since(w)}${L.coming(w)}${L.summary(w)}
      <p class="cap foot">Worked out here, the same way WaffleWealth on your iPhone works it out, to the last ${w.base === "JPY" ? "yen" : "cent"}. It reports figures and doesn't advise.</p>`;
    S.projectionChart.drawChart(w, chart.shown);
  }

  /** Dragging a slider redraws the line from figures in memory; letting go saves them. */
  async function preview(input) {
    const id = input.getAttribute("data-slider"), v = input.value;
    const base = last.base;
    const change = id === "income" ? { incomeMinor: BigInt(Math.round(Number(v))) } : id === "spending" ? { spendingMinor: BigInt(Math.round(Number(v))) } : { returnPct: String(Number(v)) };
    view.preview = { ...(view.preview || {}), ...change };
    const label = document.getElementById(`sl-${id}-v`);
    label.textContent = id === "return" ? ui.pct(v, 2) : ui.fmt(BigInt(Math.round(Number(v))), base);
    const ctx = { ...last.ctx, assumptions: { ...WW.projectionContext(WW.state.store).assumptions, ...view.preview } };
    const p = last.P.project(ctx, last.today);
    const span = p.months.length - 1, before = last.projection.months[span].netWorth, end = p.months[span].netWorth;
    document.getElementById("live-end").textContent = ui.compactCoded(end, base);
    document.getElementById("live-moved").textContent = end === before ? "" : `(${ui.compact(end - before, base, true)})`;
    const shown = S.projectionChart.chosen(S.projectionChart.offered({ ...last, projection: p, groups: [] }));
    S.projectionChart.drawChart({ ...last, projection: p, targetAnswer: null, enough: null, debts: [] }, shown);
  }

  async function commit() {
    const store = WW.state.store, change = view.preview;
    if (!change) return;
    const a = store.assumptions().f;
    view.undo = { monthly_income_minor: a.monthly_income_minor, monthly_spending_minor: a.monthly_spending_minor, annual_return_pct: a.annual_return_pct };
    const fields = {};
    if ("incomeMinor" in change) fields.monthly_income_minor = Number(change.incomeMinor);
    if ("spendingMinor" in change) fields.monthly_spending_minor = Number(change.spendingMinor);
    if ("returnPct" in change) fields.annual_return_pct = change.returnPct;
    try {
      await store.patchAssumptions(fields);
    } catch (error) {
      view.undo = null;
      WW.$("work-error").hidden = false;
      WW.$("work-error").textContent = WW.C.explain(error);
    }
    view.preview = null;
    WW.render();
  }

  async function act(e) {
    const t = e.target.closest("[data-act],[data-page],[data-go],[data-series],[data-horizon]");
    if (!t) return;
    const store = WW.state.store;
    if (t.dataset.page) return WW.openPage(t.dataset.page);
    if (t.dataset.go) return WW.show(t.dataset.go);
    if (t.dataset.series) {
      const list = S.projectionChart.offered(last).map((s) => s.id);
      const on = new Set(S.projectionChart.chosen(S.projectionChart.offered(last)).map((s) => s.id));
      if (on.has(t.dataset.series)) { if (on.size > 1) on.delete(t.dataset.series); } else on.add(t.dataset.series);
      ui.write(S.SERIES_KEY, list.filter((id) => on.has(id)).join(","));
      return render();
    }
    if (t.dataset.horizon) {
      const months = t.dataset.horizon === "custom" ? 48 : Number(t.dataset.horizon);
      try { await store.patchAssumptions({ horizon_months: months }); } catch (error) { WW.$("work-error").hidden = false; WW.$("work-error").textContent = WW.C.explain(error); }
      return WW.render();
    }
    switch (t.dataset.act) {
      case "hide": return ui.setHidden(!ui.isHidden());
      case "coming": view.comingAll = !view.comingAll; return render();
      case "undo": {
        const back = view.undo; view.undo = null;
        if (back) await store.patchAssumptions(back);
        return WW.render();
      }
    }
  }

  function wire() {
    const body = document.getElementById("proj-body");
    body.addEventListener("click", act);
    body.addEventListener("input", (e) => { if (e.target.matches("[data-slider]")) preview(e.target); });
    body.addEventListener("change", async (e) => {
      if (e.target.matches("[data-slider]")) return commit();
      if (e.target.matches("[data-h]")) {
        const y = Number(body.querySelector('[data-h="y"]').value), m = Number(body.querySelector('[data-h="m"]').value);
        await WW.state.store.patchAssumptions({ horizon_months: Math.min(120, Math.max(1, y * 12 + m)) });
        WW.render();
      }
    });
  }

  S.projection = { render, wire, last: () => last };
  wire();
})();
