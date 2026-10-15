/* WaffleWealth on the web: what the screens share.

   Figures written as the app writes them (short "AED 510k", exact "AED 1,234.56", hidden as
   dots), spans of months in words, percentages, and one line chart with a crosshair that every
   screen draws with. Loaded after app.js; everything hangs off `WW.ui`. */
(function () {
  "use strict";
  const WW = globalThis.WW;
  const M = WW.M;
  const esc = WW.esc;
  const MINUS = "−";

  // ---- hiding amounts, as the app's eye does ----

  const HIDE_KEY = "ww.hideAmounts";
  const read = (key) => { try { return localStorage.getItem(key); } catch (e) { return null; } };
  const write = (key, value) => { try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) { /* private window */ } };
  let hidden = read(HIDE_KEY) === "1";
  const rawFormat = M.format, rawSigned = M.formatSigned;
  M.format = (minor, code) => (hidden ? `${code} •••••` : rawFormat(minor, code));
  M.formatSigned = (minor, code) => (hidden ? `${code} •••••` : rawSigned(minor, code));

  function setHidden(on) {
    hidden = Boolean(on);
    write(HIDE_KEY, hidden ? "1" : null);
    WW.render();
  }

  // ---- figures ----

  const num = (v) => (typeof v === "bigint" ? Number(v) : Number(v || 0));

  /** "510k", "1.23M", "1B": three significant figures, exact below a thousand, zero as "0". */
  function compact(minor, code, signed = false) {
    if (hidden) return "•••••";
    const m = num(minor);
    if (m === 0) return "0";
    const sign = m < 0 ? MINUS : signed ? "+" : "";
    const value = Math.abs(m) / 10 ** M.scale(code);
    const units = [[1e9, "B"], [1e6, "M"], [1e3, "k"]];
    for (let i = 0; i < units.length; i++) {
      const [threshold, suffix] = units[i];
      if (value < threshold) continue;
      const q = value / threshold;
      const places = q < 10 ? 2 : q < 100 ? 1 : 0;
      const text = String(Number(q.toFixed(places)));
      if (text === "1000" && i > 0) return `${sign}1${units[i - 1][1]}`;
      return sign + text + suffix;
    }
    return sign + M.plain(Math.abs(m), code);
  }
  const compactCoded = (minor, code, signed = false) => (hidden ? `${code} •••••` : `${code} ${compact(minor, code, signed)}`);
  const fmt = (minor, code) => M.format(num(minor), code);
  const signed = (minor, code) => M.formatSigned(num(minor), code);

  /** "8 years 3 months"; short: "8 yr 3 mo". */
  function months(n, short = false) {
    const y = Math.floor(n / 12), r = n % 12;
    const parts = [];
    if (y > 0) parts.push(short ? `${y} yr` : y === 1 ? "1 year" : `${y} years`);
    if (r > 0) parts.push(short ? `${r} mo` : r === 1 ? "1 month" : `${r} months`);
    return parts.length ? parts.join(" ") : short ? "0 mo" : "0 months";
  }

  /** A percentage as the app writes one: one decimal, trailing zeros dropped, a true minus. */
  function pct(value, places = 1) {
    if (value == null) return "";
    const n = Number(String(value));
    const text = String(Number(n.toFixed(places)));
    return (text.startsWith("-") ? MINUS + text.slice(1) : text) + "%";
  }

  const monthShort = (ym) => M.monthLabel(ym).replace(/^(\w{3})\w*/, "$1");
  const monthAxis = (ym) => `${monthShort(ym).slice(0, 3)} '${ym.slice(2, 4)}`;

  WW.ui = { MINUS, compact, compactCoded, fmt, signed, months, pct, num, monthShort, monthAxis,
    isHidden: () => hidden, setHidden, read, write };
})();

(function () {
  "use strict";
  const WW = globalThis.WW;
  const { esc, M } = WW;
  const ui = WW.ui;

  function niceTicks(lo, hi, count) {
    if (lo === hi) { lo -= 1; hi += 1; }
    const raw = (hi - lo) / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
    const ticks = [];
    for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }

  let charts = 0;
  /**
   * A line chart with a crosshair: every line gets a dot at the month under the pointer, and the
   * tip lists each line's figure that month.
   * - labels: one per point ("YYYY-MM" or "YYYY-MM-DD"); tipTitle(i) names a point.
   * - series: [{ label, values (minor units, numbers; null = no point), dashed, cls }]
   * - flags: [{ index, text, page }] drawn on the first line.
   */
  function lineChart(box, { labels, series, code, flags = [], tipTitle, height }) {
    if (!box || !labels.length) return;
    const id = `c${++charts}`;
    const W = Math.max(280, box.clientWidth || 640), H = height || (W < 500 ? 210 : 250);
    const pad = { l: 52, r: 14, t: flags.length ? 26 : 10, b: 26 };
    const all = series.flatMap((s) => s.values.filter((v) => v != null));
    const ticks = niceTicks(Math.min(...all), Math.max(...all), 4);
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const n = labels.length;
    const x = (i) => pad.l + (n === 1 ? (W - pad.l - pad.r) / 2 : (i / (n - 1)) * (W - pad.l - pad.r));
    const y = (v) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
    const path = (values) => {
      let d = "", pen = false;
      values.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
      return d;
    };
    const step = Math.max(1, Math.ceil((n - 1) / 4));
    const at = [...new Set([0, ...Array.from({ length: n }, (_, i) => i).filter((i) => i % step === 0), n - 1])];
    const xLabel = (l) => (l.length > 7 ? `${Number(l.slice(8, 10))} ${ui.monthShort(l.slice(0, 7)).slice(0, 3)}` : ui.monthAxis(l));
    const first = series[0];
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" aria-hidden="true">
      ${ticks.map((t) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(ui.compact(t, code))}</text>`).join("")}
      ${lo < 0 && hi > 0 ? `<line class="zero" x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}"/>` : ""}
      ${at.map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${esc(xLabel(labels[i]))}</text>`).join("")}
      ${first ? `<path class="wash" d="${path(first.values)}L${x(n - 1)},${y(lo)}L${x(0)},${y(lo)}Z"/>` : ""}
      ${series.map((s, k) => `<path class="${k === 0 ? "line" : "avail"} ${s.cls || ""}" d="${path(s.values)}"/>`).join("")}
      ${flags.map((f) => `<g class="flag" data-page="${esc(f.page || "")}"><line x1="${x(f.index)}" x2="${x(f.index)}" y1="${pad.t - 4}" y2="${y(first.values[f.index] ?? lo)}"/><text x="${x(f.index)}" y="${pad.t - 10}" text-anchor="${f.index > n * 0.75 ? "end" : f.index < n * 0.25 ? "start" : "middle"}">${esc(f.text)}</text></g>`).join("")}
      <line class="cross" id="${id}-cross" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/>
      ${series.map((s, k) => `<circle class="dot ${k ? "dot-avail" : ""} ${s.cls || ""}" id="${id}-dot${k}" r="4.5" visibility="hidden"/>`).join("")}
      <rect class="hit" x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t}" fill="transparent"/>
    </svg><div class="tip" hidden></div>`;
    const svg = box.querySelector("svg"), tip = box.querySelector(".tip"), cross = box.querySelector(`#${id}-cross`);
    const show = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const px = (clientX - rect.left) * (W / (rect.width || W));
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1))));
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
      let top = H;
      series.forEach((s, k) => {
        const dot = box.querySelector(`#${id}-dot${k}`), v = s.values[i];
        if (v == null) { dot.setAttribute("visibility", "hidden"); return; }
        dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(v)); dot.setAttribute("visibility", "visible");
        top = Math.min(top, y(v));
      });
      tip.hidden = false;
      tip.innerHTML = `${esc(tipTitle ? tipTitle(i) : M.monthLabel(labels[i]))}${series.map((s) => (s.values[i] == null ? "" : `<br>${esc(s.label)} <b>${esc(M.format(s.values[i], code))}</b>`)).join("")}`;
      tip.style.left = `${(x(i) / W) * 100}%`;
      tip.style.top = `${(top / H) * (rect.height || H)}px`;
    };
    const hide = () => {
      cross.setAttribute("visibility", "hidden");
      series.forEach((_, k) => box.querySelector(`#${id}-dot${k}`).setAttribute("visibility", "hidden"));
      tip.hidden = true;
    };
    const hit = box.querySelector(".hit");
    hit.addEventListener("pointermove", (e) => show(e.clientX));
    hit.addEventListener("pointerdown", (e) => show(e.clientX));
    hit.addEventListener("pointerleave", hide);
    box.querySelectorAll(".flag[data-page]").forEach((g) => {
      if (!g.getAttribute("data-page")) return;
      g.style.cursor = "pointer";
      g.addEventListener("click", () => WW.openPage(g.getAttribute("data-page")));
    });
  }

  ui.lineChart = lineChart;
  ui.niceTicks = niceTicks;
})();
