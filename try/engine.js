/* WaffleWealth: the browser sketch of the app's engine.
   Same shape as the app, written independently for the page: income and spending are step
   functions (a raise lands in one calendar month each year, spending rises once per
   projection year), the invested balances grow at the annual return divided by twelve,
   interest or dividends are paid on a cadence as cash unless kept in the account, a
   liability's charge goes out of cash while its balance stays, and money available only
   from an age counts in net worth but not in what you could reach. Runs in a browser or in
   Node; nothing here talks to a network. */
(function (root) {
  "use strict";

  const FREQ = { monthly: 1, quarterly: 3, yearly: 12 };

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
      for (const h of held) {
        if (h.a.kind === "liability") { owed += h.bal; continue; }
        assets += h.bal;
        if (h.unlock > i) locked += h.bal;
      }
      const netWorth = cash + assets - owed;
      return { i, date: at(i), netWorth, available: netWorth - locked, locked, cash, parts };
    };

    const points = [totals(0, { income: 0, spending: 0, growth: 0, paidOut: 0, kept: 0, charges: 0 })];
    let raises = 0;
    for (let i = 1; i <= months; i++) {
      const parts = { income: 0, spending: 0, growth: 0, paidOut: 0, kept: 0, charges: 0 };
      const mon = at(i).getMonth() + 1;
      if (mon === Number(state.raiseMonth)) raises += 1;
      const income = incomeBase * Math.pow(1 + (state.raisePct || 0) / 100, raises);
      const spending = state.spending * Math.pow(1 + (state.spendingGrowthPct || 0) / 100, Math.floor((i - 1) / 12));

      for (const h of held) {
        const a = h.a;
        if (a.kind === "asset" && a.invested && r) {
          const g = h.bal * r; h.bal += g; parts.growth += g;
        }
        if (a.pays) {
          const n = FREQ[a.pays.frequency] || 1;
          if (i % n === 0) {
            const amount = a.pays.basis === "amount"
              ? Number(a.pays.amount) || 0
              : h.bal * ((Number(a.pays.ratePct) || 0) / 100) * (n / 12);
            if (a.kind === "asset") {
              if (a.pays.reinvested) { h.bal += amount; parts.kept += amount; }
              else { cash += amount; parts.paidOut += amount; }
            } else {
              if (a.pays.reinvested) { h.bal += amount; parts.charges += amount; }
              else { cash -= amount; parts.charges += amount; }
            }
          }
        }
      }

      cash += income - spending;
      parts.income = income; parts.spending = spending;
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

  const Engine = { project, runway, reaches, monthsUntilAvailable };
  if (typeof module !== "undefined" && module.exports) module.exports = Engine;
  else root.WWEngine = Engine;
})(typeof window !== "undefined" ? window : globalThis);
