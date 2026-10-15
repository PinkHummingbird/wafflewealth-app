/* WaffleWealth on the web: History, as the app lays it out.

   What you were worth, month by month, with accounts joining and leaving and the moments you
   marked; what moved it between two months, account by account, and whether the two dates sit at
   the same point of the month; and, further down, several points side by side and how the
   forecast made then held up. Every figure comes from history.mjs, ported from the app. */
(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M, $ } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const hv = { compareFrom: null, points: null, changes: false, forecastFrom: null, run: 0, sortOwned: "biggest", sortOwed: "biggest" };

  /** Everything History reads, worked out once per draw. */
  async function work(store) {
    const { P, R, H } = await WW.engines();
    const ctx = WW.projectionContext(store);
    if (!ctx) return { waiting: true };
    const today = M.today();
    const record = S.historyRecord(store, H);
    const out = { ctx, H, P, R, today, record, base: ctx.base };
    try {
      out.reading = H.derive(record, ctx, today);
      out.days = H.days(record, ctx, today);
    } catch (error) { out.error = error; return out; }
    const markers = store.markers().map((m) => ({ id: m.name, label: m.f.label, takenOn: m.f.taken_on, createdAt: m.f.created_at || null }));
    out.markers = markers;
    try { out.marks = H.atMarkers(record, markers, ctx); } catch (e) { out.marks = []; }
    return out;
  }

  S.historyWork = work;
  S.historyView = hv;
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M } = WW;
  const ui = WW.ui;
  const S = WW.screens;

  function worth(w) {
    const months = w.reading.months, base = w.base;
    const marks = w.marks.filter((m) => m.netWorth !== 0n || m.values.size);
    const flags = marks.map((m) => ({ index: months.findIndex((x) => x.month === m.takenOn.slice(0, 7)), text: m.label })).filter((f) => f.index >= 0);
    const events = w.reading.events.map((e) => {
      const parts = [e.joined.length ? `${e.joined.join(", ")} added to the app` : "", e.left.length ? `${e.left.join(", ")} archived` : ""].filter(Boolean);
      return `<li>${esc(M.monthLabel(e.month))}: ${esc(parts.join("; "))}.</li>`;
    }).join("");
    const first = months[0], last = months[months.length - 1];
    const change = last.netWorth - first.netWorth;
    const verb = change > 0n ? "rose by" : change < 0n ? "fell by" : "held at";
    return `<div class="card"><h2>What you were worth</h2>
      <div class="chart" id="hist-chart"></div>
      <p class="cap">From ${esc(M.monthLabel(first.month))} to ${esc(M.monthLabel(last.month))}, your net worth ${verb} ${esc(ui.fmt(change === 0n ? last.netWorth : change < 0n ? -change : change, base))}.</p>
      ${events ? `<ul class="events">${events}</ul><p class="cap">Months when an account joined or left move the line by its whole balance, not by anything it earned.</p>` : ""}
      <div class="formacts"><button type="button" class="btn ghost small" data-h="mark">Mark this moment</button><span class="cap">${marks.length >= 2 ? "" : marks.length === 1 ? "Mark one more moment to compare the two." : "Mark two moments, and you can compare your net worth between them."}</span></div>
      ${w.markers.length ? `<details class="sumgroup"><summary><span>Marks (${w.markers.length})</span></summary>${w.markers.map((m) => {
        const r = w.marks.find((x) => x.id === m.id);
        return `<div class="sumrow"><span>${esc(m.label)}<small>${esc(M.monthLabel(m.takenOn.slice(0, 7)))}${m.createdAt ? ` · made ${esc(M.dayLabel(m.createdAt.slice(0, 10)))}` : ""}</small></span><span class="amt">${r && r.values.size ? esc(ui.fmt(r.netWorth, base)) : "<small>Nothing entered yet then</small>"}<span><button type="button" class="linkbtn" data-h-archive="${esc(m.id)}">Archive</button> <button type="button" class="linkbtn danger" data-h-delete="${esc(m.id)}">Delete</button></span></span></div>`;
      }).join("")}${archivedMarks()}</details>` : archivedMarks(true)}
    </div>`;
  }

  function archivedMarks(alone) {
    const away = WW.state.store.markers(true);
    if (!away.length) return "";
    const rows = away.map((m) => `<div class="sumrow"><span>${esc(m.f.label)}<small>${esc(M.monthLabel(String(m.f.taken_on).slice(0, 7)))}</small></span><span class="amt"><span><button type="button" class="linkbtn" data-h-restore="${esc(m.name)}">Put back</button> <button type="button" class="linkbtn danger" data-h-delete="${esc(m.name)}">Delete</button></span></span></div>`).join("");
    return alone ? `<details class="sumgroup"><summary><span>Archived marks (${away.length})</span></summary>${rows}</details>` : `<p class="cap">Archived: off the chart and the lists.</p>${rows}`;
  }

  function drawWorth(w) {
    const months = w.reading.months;
    const flags = w.marks.filter((m) => m.values.size).map((m) => ({ index: months.findIndex((x) => x.month === m.takenOn.slice(0, 7)), text: m.label })).filter((f) => f.index >= 0);
    ui.lineChart(document.getElementById("hist-chart"), {
      labels: months.map((m) => m.month), code: w.base, flags,
      series: [{ label: "Net worth", values: months.map((m) => Number(m.netWorth)) }],
    });
  }

  S.historyWorth = { worth, drawWorth };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const hv = S.historyView;

  function side(list, title, key, base, total) {
    if (!list.length) return "";
    const sort = hv[key];
    const moved = list.filter((c) => c.amount !== 0n), still = list.filter((c) => c.amount === 0n);
    const abs = (v) => (v < 0n ? -v : v);
    moved.sort(sort === "name" ? (a, b) => a.name.localeCompare(b.name) : sort === "smallest" ? (a, b) => (abs(a.amount) > abs(b.amount) ? 1 : -1) : (a, b) => (abs(b.amount) > abs(a.amount) ? 1 : -1));
    const largest = moved.reduce((m, c) => (abs(c.amount) > m ? abs(c.amount) : m), 0n);
    const sum = list.reduce((t, c) => t + c.amount, 0n);
    return `<details class="sumgroup" open><summary><span>${title}</span><span class="amt">${esc(ui.signed(sum, base))}</span></summary>
      ${moved.length > 1 ? `<select class="mini" data-h-sort="${key}" aria-label="Order"><option value="biggest" ${sort === "biggest" ? "selected" : ""}>Biggest move</option><option value="smallest" ${sort === "smallest" ? "selected" : ""}>Smallest move</option><option value="name" ${sort === "name" ? "selected" : ""}>Name A–Z</option></select>` : ""}
      ${moved.length ? moved.map((c) => {
        const m = S.projectionLower.movement(c);
        const width = largest === 0n ? 0 : Number((abs(c.amount) * 100n) / largest);
        const share = total.share(c);
        return `<div class="contrib"><span class="arrow ${m.up ? "up" : "down"}" aria-hidden="true">${m.up ? "↑" : "↓"}</span>
          <span class="mv-name">${esc(c.name)}<small class="${m.up ? "up" : "down"}">${esc(m.verb)}</small></span><span class="amt">${esc(ui.signed(c.amount, base))}</span>
          <span class="cbar"><i class="${m.up ? "up" : "down"}" style="width:${width}%"></i></span>
          <small class="cap2">${c.before != null ? esc(ui.compact(c.before, base)) : "—"} → ${c.after != null ? esc(ui.compact(c.after, base)) : "—"}${share != null ? ` · ${share}% of all movement` : ""}</small></div>`;
      }).join("") : `<p class="cap">Nothing here moved.</p>`}
      ${still.length ? `<details class="sumgroup"><summary><span>${still.length} account${still.length === 1 ? "" : "s"} unchanged</span></summary>${still.map((c) => `<div class="sumrow"><span>${esc(c.name)}</span><span class="amt">${esc(ui.fmt(c.after ?? 0n, base))}</span></div>`).join("")}</details>` : ""}
    </details>`;
  }

  /** Whether the two dates sit at the same point of the month, and how far each is from pay day. */
  function likeForLike(w, from, to) {
    const payDay = w.ctx.assumptions.incomeDay;
    const r = w.H.likeForLike(from, to, payDay, w.days.map((d) => d.date));
    if (!r.isWorthSaying) return "";
    const pay = r.daysAfterPayAtStart != null ? ` ${M.dayLabel(from).replace(/ \d{4}$/, "")}: pay + ${r.daysAfterPayAtStart} d · ${M.dayLabel(to).replace(/ \d{4}$/, "")}: pay + ${r.daysAfterPayAtEnd} d.` : " Pay or a bill may sit in one span and not the other.";
    return `<p class="notice-card">${esc(`${r.days} days apart.${pay}`)}</p>`;
  }

  function moved(w) {
    const months = w.reading.months;
    if (months.length < 2) return "";
    const last = months[months.length - 1].month;
    const earlier = months.slice(0, -1).map((m) => m.month);
    if (!earlier.includes(hv.compareFrom)) hv.compareFrom = earlier[earlier.length - 1];
    const a = w.H.attribution(hv.compareFrom, last, w.reading, w.record.accountsById);
    if (!a) return "";
    const base = w.base;
    const start = months.find((m) => m.month === a.from), end = months.find((m) => m.month === a.to);
    const learning = a.contributions.some((c) => c.kind !== "moved");
    return `<div class="card summary"><h2>What moved it</h2>
      <div class="sumrow"><span>Compared with<small>The month today's figures are held against</small></span><span class="amt"><select class="mini" data-h-from aria-label="Compared with">${earlier.slice().reverse().map((m) => `<option value="${m}" ${m === hv.compareFrom ? "selected" : ""}>${esc(M.monthLabel(m))}</option>`).join("")}</select></span></div>
      <div class="sumrow big"><span>Change<small>${esc(M.monthLabel(a.from))} → ${esc(M.monthLabel(a.to))}</small></span><span class="amt">${esc(ui.signed(a.totalChange, base))}</span></div>
      <p class="cap"><span class="up">↑</span> lifted your net worth · <span class="down">↓</span> lowered it</p>
      ${side(a.owned, "What you own", "sortOwned", base, a)}${side(a.owed, "What you owe", "sortOwed", base, a)}
      ${learning ? `<div class="sumrow"><span>Money that moved</span><span class="amt">${esc(ui.signed(a.moved, base))}</span></div>
        ${a.learned !== 0n ? `<div class="sumrow"><span>Accounts added to the app</span><span class="amt">${esc(ui.signed(a.learned, base))}</span></div>` : ""}
        ${a.left !== 0n ? `<div class="sumrow"><span>Accounts archived</span><span class="amt">${esc(ui.signed(a.left, base))}</span></div>` : ""}` : ""}
      ${likeForLike(w, start.newest || `${a.from}-28`, end.newest || w.today)}
    </div>`;
  }

  S.historyMoved = { moved, likeForLike };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const hv = S.historyView;

  function sideBySide(w) {
    const H = w.H, base = w.base;
    const available = H.resolvedPoints(w.reading, w.days);
    const ids = new Set(available.map((r) => H.pointId(r.point)));
    if (!hv.points || hv.points.some((id) => !ids.has(id))) {
      const months = available.filter((r) => r.point.kind === "month");
      hv.points = months.slice(-2).map((r) => H.pointId(r.point));
    }
    const chosen = available.filter((r) => hv.points.includes(H.pointId(r.point)));
    const cmp = H.compare(chosen.map((r) => r.point), available, w.record.accountsById);
    const pick = `<details class="sumgroup picker"><summary><span>Compare ${chosen.length} of up to 4</span></summary>
      ${[["month", "Months"], ["day", "Days recorded"]].map(([k, t]) => `<p class="cap">${t}</p><div class="segs">${available.filter((r) => r.point.kind === k).slice().reverse().map((r) => {
        const id = H.pointId(r.point), on = hv.points.includes(id);
        return `<button type="button" class="segbtn" data-h-point="${esc(id)}" aria-pressed="${on}" ${!on && hv.points.length >= 4 ? "disabled" : ""}>${esc(H.pointColumnTitle(r.point))}</button>`;
      }).join("")}</div>`).join("")}${hv.points.length >= 4 ? `<p class="cap">Limit 4: turn one off to add another.</p>` : ""}</details>`;
    if (!cmp) return `<div class="card"><h2>Side by side</h2>${pick}<p class="cap">Choose two points or more.</p></div>`;
    const cols = cmp.columns;
    const head = hv.changes ? cols.slice(1).map((c, i) => `from ${H.pointColumnTitle(cols[i].point)}`).concat("Total") : cols.map((c) => H.pointColumnTitle(c.point)).concat("Change");
    const cells = (values) => {
      if (hv.changes) {
        const steps = values.slice(1).map((v, i) => (v == null || values[i] == null ? null : v - values[i]));
        const t = values.filter((v) => v != null);
        return steps.concat(t.length > 1 ? t[t.length - 1] - t[0] : null).map((v) => `<td>${v == null ? "—" : esc(ui.compact(v, base, true))}</td>`).join("");
      }
      const t = values.filter((v) => v != null);
      return values.map((v) => `<td>${v == null ? "—" : esc(ui.compact(v, base))}</td>`).join("") + `<td>${t.length > 1 ? esc(ui.compact(t[t.length - 1] - t[0], base, true)) : "—"}</td>`;
    };
    const rows = (list, title, pick) => `<tr class="grp"><th>${title}</th>${cells(cols.map(pick))}</tr>` + list.map((r) => `<tr><th>${esc(r.name)}</th>${cells(r.values)}</tr>`).join("");
    const owned = cmp.rows.filter((r) => r.accountKind === "ASSET"), owed = cmp.rows.filter((r) => r.accountKind === "LIABILITY");
    const biggest = cmp.rows.find((r) => r.change != null && r.change !== 0n);
    const gaps = cmp.rows.some((r) => r.values.some((v) => v == null));
    return `<div class="card"><h2>Side by side</h2>${pick}
      <div class="segs"><button type="button" class="segbtn" data-h-mode="values" aria-pressed="${!hv.changes}">Values</button><button type="button" class="segbtn" data-h-mode="changes" aria-pressed="${hv.changes}">What changed</button></div>
      ${S.historyMoved.likeForLike(w, cols[0].effectiveDate, cols[cols.length - 1].effectiveDate)}
      <div class="proj-scroll"><table class="proj-table snap"><thead><tr><th></th>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>
        <tr class="grp"><th>Net worth</th>${cells(cols.map((c) => c.netWorth))}</tr>
        ${owned.length ? rows(owned, "What you own", (c) => c.owned) : ""}${owed.length ? rows(owed, "What you owe", (c) => c.owed) : ""}</tbody></table></div>
      <p class="cap">${esc(H.pointColumnTitle(cols[0].point))} → ${esc(H.pointColumnTitle(cols[cols.length - 1].point))}: ${esc(ui.signed(cmp.netWorthChange, base))}${biggest ? ` · biggest: ${esc(biggest.name)} ${biggest.change > 0n ? "↑" : "↓"}` : ""}</p>
      <p class="cap foot">${esc(base)}, rounded · + = net worth up${gaps ? " · — = not in the app yet, so rows won't add up" : ""}</p></div>`;
  }

  S.historySide = { sideBySide };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const hv = S.historyView;

  /** The input history and the planned items, as the forecast reads them. */
  function inputs(store) {
    const versions = store.history().map((v) => ({ validFrom: v.f.valid_from, base: v.f.base_currency_code, incomeMinor: BigInt(v.f.monthly_income_minor), spendingMinor: BigInt(v.f.monthly_spending_minor),
      raisePct: v.f.annual_raise_pct, raiseMonth: Number(v.f.raise_effective_month), spendingGrowthPct: v.f.annual_spending_growth_pct, returnPct: v.f.annual_return_pct }));
    const rateVersions = store.rateHistory().map((v) => ({ quote: v.f.quote_code, rate: String(v.f.rate), validFrom: v.f.valid_from }));
    const plannedAll = store.of("PlannedItem").map((p) => ({ id: p.name, name: p.f.name, direction: p.f.direction, amountMinor: BigInt(p.f.amount_minor), currency: p.f.currency_code || null,
      firstDate: p.f.first_date, frequency: p.f.frequency, endsOn: p.f.ends_on || null, growthPct: p.f.growth_pct || "0", createdAt: p.f.created_at, archivedAt: p.f.archived_at || null }));
    return { versions, rateVersions, plannedAll };
  }

  function forecast(w) {
    const store = WW.state.store, base = w.base;
    const { versions, rateVersions, plannedAll } = inputs(store);
    const starts = w.H.availableStarts(versions, w.today);
    if (!starts.length) return { html: `<div class="card"><h2>How the forecast held up</h2><p class="cap">Nothing to compare yet. The app keeps what you tell it from now on, and needs a past month to compare against.</p></div>` };
    if (!starts.includes(hv.forecastFrom)) hv.forecastFrom = starts[0];
    const accounts = store.accounts().map((a) => ({ id: a.name, currency: a.f.currency_code }));
    const ctx = { ...w.ctx, scales: { ...w.ctx.scales } };
    for (const v of rateVersions) if (ctx.scales[v.quote] == null) ctx.scales[v.quote] = M.scale(v.quote);
    let r, note = "";
    try {
      r = w.H.forecastReview({ versions, rateVersions, plannedAll, record: w.record, history: w.reading, ctx, today: w.today, from: hv.forecastFrom, inUse: accounts });
    } catch (error) { r = null; note = "The app couldn't rebuild its forecast from that month. Try a later month."; }
    const select = `<div class="sumrow"><span>Expected from<small>The month whose projection is held against what followed</small></span><span class="amt"><select class="mini" data-h-forecast aria-label="Expected from">${starts.slice().reverse().map((m) => `<option value="${m}" ${m === hv.forecastFrom ? "selected" : ""}>${esc(M.monthLabel(m))}</option>`).join("")}</select></span></div>`;
    if (r && !r.ok) note = `Nothing kept before ${M.monthLabel(r.firstKnown)}, so the app can't say for months before it.`;
    if (!r || !r.ok || r.points.length < 1) return { html: `<div class="card summary"><h2>How the forecast held up</h2>${select}<p class="cap">${esc(note)}</p></div>` };
    const last = r.points[r.points.length - 1];
    const c = r.inputChanges;
    const changes = [c.assumptionsEdited && "the assumptions were edited", c.accountsJoined.length && `${c.accountsJoined.join(", ")} joined`, c.accountsLeft.length && `${c.accountsLeft.join(", ")} ${c.accountsLeft.length === 1 ? "was" : "were"} archived`,
      c.ratesChanged.length && `rates changed for ${c.ratesChanged.join(", ")}`, c.plannedAdded.length && `${c.plannedAdded.join(", ")} ${c.plannedAdded.length === 1 ? "was" : "were"} planned later`].filter(Boolean);
    return {
      html: `<div class="card summary"><h2>How the forecast held up</h2>${select}
        <div class="chart" id="fc-chart"></div>
        <p class="verdict">Expected ${esc(ui.fmt(last.expected, base))} by ${esc(M.monthLabel(last.month))}; it came to ${esc(ui.fmt(last.actual, base))}.</p>
        ${changes.length ? `<p class="cap">Part of the gap is from changes you made since: ${esc(changes.join("; "))}.</p>` : ""}</div>`,
      chart: { labels: r.points.map((p) => p.month), code: base, series: [{ label: "What happened", values: r.points.map((p) => Number(p.actual)) }, { label: `Expected from ${M.monthLabel(r.from)}`, values: r.points.map((p) => Number(p.expected)) }] },
    };
  }

  S.historyForecast = { forecast };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M, $ } = WW;
  const ui = WW.ui;
  const S = WW.screens;
  const hv = S.historyView;
  const box = $("history-body");
  box.dataset.screen = "1";

  async function render() {
    const store = WW.state.store;
    if (!store) return;
    const run = ++hv.run;
    const w = await S.historyWork(store);
    if (run !== hv.run) return;
    if (w.waiting) { box.innerHTML = `<p class="empty">History appears once WaffleWealth on your iPhone has sent your accounts and balances.</p>`; return; }
    if (w.error) {
      box.innerHTML = w.error.kind === "missingRate" ? `<div class="emptyscreen"><h2>Needs a ${esc(w.error.code)} exchange rate</h2><p>An account's history is in ${esc(w.error.code)}, and there's no rate to show it in ${esc(w.base)}.</p><button type="button" class="btn" data-h="rates">Enter the rate</button></div>`
        : `<p class="error">History couldn't be worked out from these figures.</p>`;
      return;
    }
    const months = w.reading ? w.reading.months : [];
    if (months.length < 2 && !w.markers.length) {
      const so = months.length ? ` So far: ${M.monthLabel(months[0].month)}, ${ui.fmt(months[0].netWorth, w.base)}.` : "";
      box.innerHTML = `<div class="emptyscreen"><h2>Nothing to look back on yet</h2><p>History is built from the balances you record. Once two months have one, this screen says what changed and which account did it.${esc(so)}</p><button type="button" class="btn" data-h="accounts">Update a balance</button></div>`;
      return;
    }
    const fc = S.historyForecast.forecast(w);
    box.innerHTML = `<div class="stack1">${S.historyWorth.worth(w)}${S.historyMoved.moved(w)}
      <details class="card sumgroup more"><summary><span>More ways to look back</span><span class="cap">Several months side by side, and what the app expected</span></summary>
        <div class="stack1">${S.historySide.sideBySide(w)}${fc.html}</div></details></div>`;
    S.historyWorth.drawWorth(w);
    if (fc.chart) {
      const more = box.querySelector("details.more");
      const draw = () => ui.lineChart(document.getElementById("fc-chart"), fc.chart);
      if (more.open) draw(); else more.addEventListener("toggle", draw, { once: true });
    }
    if (hv.moreOpen) box.querySelector("details.more").open = true;
  }

  box.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-h],[data-h-archive],[data-h-restore],[data-h-delete],[data-h-point],[data-h-mode]");
    if (!t) return;
    const store = WW.state.store;
    const marker = (id) => store.rows.get(id);
    try {
      if (t.dataset.h === "accounts") return WW.show("money");
      if (t.dataset.h === "rates") return WW.show("money", { page: "currencies" });
      if (t.dataset.h === "mark") {
        const today = M.today();
        const label = window.prompt(`Name this moment. A bookmark on ${M.monthLabel(today.slice(0, 7))}, to compare from later. Keep the date as its name, or call it something you'll remember.`, `Mark ${M.dayLabel(today)}`);
        if (!label || !label.trim()) return;
        await store.addMarker(label.slice(0, 60), today);
      }
      if (t.dataset.hArchive) await store.setMarkerArchived(marker(t.dataset.hArchive), true);
      if (t.dataset.hRestore) await store.setMarkerArchived(marker(t.dataset.hRestore), false);
      if (t.dataset.hDelete) {
        const m = marker(t.dataset.hDelete);
        if (!window.confirm(`${m.f.label} goes for good. It keeps no figures of its own, so nothing else changes. Archive keeps it instead.`)) return;
        await store.drop(m);
      }
      if (t.dataset.hPoint) {
        hv.moreOpen = true;
        const id = t.dataset.hPoint;
        hv.points = hv.points.includes(id) ? hv.points.filter((x) => x !== id) : [...hv.points, id].slice(0, 4);
      }
      if (t.dataset.hMode) { hv.moreOpen = true; hv.changes = t.dataset.hMode === "changes"; }
    } catch (error) { $("work-error").hidden = false; $("work-error").textContent = WW.C.explain(error); }
    render();
  });
  box.addEventListener("change", (e) => {
    if (e.target.matches("[data-h-from]")) hv.compareFrom = e.target.value;
    else if (e.target.matches("[data-h-forecast]")) { hv.forecastFrom = e.target.value; hv.moreOpen = true; }
    else if (e.target.matches("[data-h-sort]")) hv[e.target.dataset.hSort] = e.target.value;
    else return;
    render();
  });

  WW.PAGES.__history = render;
  S.history = { render };
})();
