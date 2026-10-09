/* WaffleWealth: the browser sketch of the app's engine.
   Same shape as the app, written independently for the page: income and spending are step
   functions (a raise lands in one calendar month each year, spending rises once per
   projection year), the invested balances grow at the annual return divided by twelve,
   interest or dividends are paid on a cadence as cash unless kept in the account, a
   liability's charge goes out of cash while its balance stays, and money available only
   from an age counts in net worth but not in what you could reach. Planned items land as
   cash in the calendar month they fall in, never in today's month 0, and earn nothing. Runs in a browser or in
   Node; nothing here talks to a network. */
(function (root) {
  "use strict";

  const FREQ = { monthly: 1, quarterly: 3, yearly: 12 };
  const PLANNED_STEP = { once: 0, monthly: 1, quarterly: 3, halfyearly: 6, yearly: 12 };

  /* "YYYY-MM-DD" to {y, m, d}, m from 1. Null when the field is empty or half typed. */
  function parseDay(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || "");
    return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
  }
  const monthIndex = (day) => day.y * 12 + (day.m - 1);
  const dayKey = (day) => monthIndex(day) * 32 + day.d;
  /* `months` after `day`, measured from it, with the day kept where the month allows: a
     monthly item on the 31st stays on the 31st of the months that have one. */
  function addMonths(day, months) {
    const idx = monthIndex(day) + months, y = Math.floor(idx / 12), m = (idx % 12) + 1;
    const last = new Date(y, m, 0).getDate();
    return { y, m, d: Math.min(day.d, last) };
  }

  /* Each date an item lands on after today, up to `months` ahead, with its signed amount.
     Dates on or before today are already in the balances, so they are skipped. */
  function occurrences(item, start, months) {
    const first = parseDay(item.first);
    const amount = Number(item.amount) || 0;
    if (!first || !(amount > 0)) return [];
    const today = { y: start.getFullYear(), m: start.getMonth() + 1, d: start.getDate() };
    const lastMonth = monthIndex(today) + months;
    const step = PLANNED_STEP[item.frequency] || 0;
    const end = step && item.endsOn ? parseDay(item.endsOn) : null;
    const sign = item.direction === "in" ? 1 : -1;
    const rise = step ? (Number(item.risePct) || 0) / 100 : 0;
    const out = [];
    let n = 0;
    if (step) {
      const behind = monthIndex(today) - monthIndex(first);
      if (behind > 0) n = Math.floor(behind / step);
    }
    for (;;) {
      const date = step ? addMonths(first, n * step) : first;
      if (monthIndex(date) > lastMonth) break;
      if (end && dayKey(date) > dayKey(end)) break;
      if (dayKey(date) > dayKey(today)) {
        const years = Math.max(0, Math.floor((monthIndex(date) - monthIndex(first)) / 12));
        const value = Math.round(amount * Math.pow(1 + rise, years));
        out.push({ offset: Math.max(1, monthIndex(date) - monthIndex(today)), date, amount: sign * value });
      }
      if (!step) break;
      n += 1;
    }
    return out;
  }

  /* The soonest date an item still lands on, looking ten years ahead, or null when it is done. */
  function nextDate(item, start) {
    const next = occurrences(item, start, 120)[0];
    return next ? new Date(next.date.y, next.date.m - 1, next.date.d) : null;
  }

  function monthsUntilAvailable(account, age) {
    if (account.availableFromAge == null || age == null) return 0;
    return Math.max(0, Math.round((account.availableFromAge - age) * 12));
  }

  /* One month to `months` ahead. Returns one point per month, month 0 being today. */
  function project(state, months, start, options) {
    const incomeBase = options && options.incomeOverride != null ? options.incomeOverride : state.income;
    const r = (state.returnPct || 0) / 100 / 12;
    const y = start.getFullYear(), m0 = start.getMonth();
    const at = (i) => new Date(y, m0 + i, 1);

    // Working balances. Plain cash is one pool: the sum of assets that neither grow nor pay.
    let cash = 0;
    const held = [];
    for (const a of state.accounts) {
      const value = Number(a.value) || 0;
      if (a.kind === "asset" && !a.invested && !a.pays) { cash += value; continue; }
      held.push({ a, bal: value, unlock: a.kind === "asset" ? monthsUntilAvailable(a, state.age) : 0 });
    }

    const totals = (i, parts) => {
      let assets = 0, owed = 0, locked = 0;
      const lockedBy = {};
      for (const h of held) {
        if (h.a.kind === "liability") { owed += h.bal; continue; }
        assets += h.bal;
        if (h.unlock > i) { locked += h.bal; lockedBy[h.a.id] = h.bal; }
      }
      const netWorth = cash + assets - owed;
      return { i, date: at(i), netWorth, available: netWorth - locked, locked, lockedBy, cash, parts };
    };

    // Planned money, bucketed by the month it lands in. Money in less money out.
    // Kept as two sums, not one, so the month can say what came in and what went out.
    const plannedByMonth = new Map();
    for (const item of state.planned || []) {
      for (const o of occurrences(item, start, months)) {
        const slot = plannedByMonth.get(o.offset) || { in: 0, out: 0 };
        if (o.amount > 0) slot.in += o.amount; else slot.out -= o.amount;
        plannedByMonth.set(o.offset, slot);
      }
    }

    /* Every source kept apart. Money in is income + paidOut + plannedIn; money out is
       spending + chargesPaid + plannedOut. kept and chargesAdded never touch cash: they move
       an account's own balance. So each month, net worth changes by exactly
       in - out + growth + kept - chargesAdded. */
    // `by` holds each account's own share of the parts that belong to one account, keyed by id.
    const zeroParts = () => ({ income: 0, spending: 0, growth: 0, paidOut: 0, kept: 0, chargesPaid: 0, chargesAdded: 0, plannedIn: 0, plannedOut: 0,
      by: { growth: {}, paidOut: {}, kept: {}, chargesPaid: {}, chargesAdded: {} } });
    const add = (parts, key, id, amount) => { parts[key] += amount; parts.by[key][id] = (parts.by[key][id] || 0) + amount; };
    const points = [totals(0, zeroParts())];
    let raises = 0;
    for (let i = 1; i <= months; i++) {
      const parts = zeroParts();
      const mon = at(i).getMonth() + 1;
      if (mon === Number(state.raiseMonth)) raises += 1;
      const income = incomeBase * Math.pow(1 + (state.raisePct || 0) / 100, raises);
      const spending = state.spending * Math.pow(1 + (state.spendingGrowthPct || 0) / 100, Math.floor((i - 1) / 12));

      for (const h of held) {
        const a = h.a;
        // An account either grows at the assumed return or earns on its own terms. The page
        // only offers one, and the engine holds to it if a state ever carries both.
        if (a.kind === "asset" && a.invested && !a.pays && r) {
          const g = h.bal * r; h.bal += g; add(parts, "growth", a.id, g);
        }
        if (a.pays) {
          const n = FREQ[a.pays.frequency] || 1;
          if (i % n === 0) {
            const amount = a.pays.basis === "amount"
              ? Number(a.pays.amount) || 0
              : h.bal * ((Number(a.pays.ratePct) || 0) / 100) * (n / 12);
            if (a.kind === "asset") {
              if (a.pays.reinvested) { h.bal += amount; add(parts, "kept", a.id, amount); }
              else { cash += amount; add(parts, "paidOut", a.id, amount); }
            } else {
              if (a.pays.reinvested) { h.bal += amount; add(parts, "chargesAdded", a.id, amount); }
              else { cash -= amount; add(parts, "chargesPaid", a.id, amount); }
            }
          }
        }
      }

      // Planned money is cash, like what is saved: it never joins the invested pool.
      const planned = plannedByMonth.get(i) || { in: 0, out: 0 };
      cash += income - spending + planned.in - planned.out;
      parts.income = income; parts.spending = spending;
      parts.plannedIn = planned.in; parts.plannedOut = planned.out;
      points.push(totals(i, parts));
    }
    return points;
  }

  /* The month the money you could reach runs out if income stopped today. Null past 50 years. */
  function runway(state, start) {
    const pts = project(state, 600, start, { incomeOverride: 0 });
    for (const p of pts) if (p.available <= 0) return p.i;
    return null;
  }

  /* The first month net worth reaches the target. Null past 50 years. */
  function reaches(state, start) {
    if (!(state.target > 0)) return null;
    const pts = project(state, 600, start);
    for (const p of pts) if (p.netWorth >= state.target) return p;
    return null;
  }

  const Engine = { project, runway, reaches, monthsUntilAvailable, occurrences, nextDate };
  if (typeof module !== "undefined" && module.exports) module.exports = Engine;
  else root.WWEngine = Engine;
})(typeof window !== "undefined" ? window : globalThis);
