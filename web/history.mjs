/* WaffleWealth on the web: History, worked out here exactly as the app works it out.

   Ports of the app's history readings (WaffleWealthCore/History), kept to the letter: the net
   worth you recorded, month by month and day by day, each account's part rounded once and the
   month the sum of its parts; what changed between two months and which accounts did it; a
   side-by-side of up to four points; whether two dates sit at the same point of the month; the
   pace the record shows; one account's recorded track; and the forecast made then against what
   happened. Converted at today's rates, as the app converts. Nothing is stored.

   web/tests/history.test.mjs holds them to a corpus the app itself worked out. */
import { Dec, convert, minorOf, project, addMonthsToMonth, monthsSince } from './projection.mjs?v=24';

const abs = (v) => (v < 0n ? -v : v);
export const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------------------------------------
// Days

export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const lastDayOf = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(daysInMonth(y, m)).padStart(2, '0')}`; };
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
export const monthLabel = (ym) => `${SHORT_MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const dayLabel = (d) => `${Number(d.slice(8, 10))} ${SHORT_MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const isLastDay = (d) => Number(d.slice(8, 10)) === daysInMonth(Number(d.slice(0, 4)), Number(d.slice(5, 7)));

// ---------------------------------------------------------------------------------------------
// The record

/**
 * accounts: every account, in use or put away: [{ id, name, kind, currency, archivedAt }]
 * balances: every balance not taken back: [{ id, accountId, valueMinor, asOfDate, createdAt }]
 */
export function makeRecord(accounts, balances) {
  const ordered = [...balances].sort((a, b) => (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1
    : a.asOfDate < b.asOfDate ? -1 : a.asOfDate > b.asOfDate ? 1 : String(a.createdAt) < String(b.createdAt) ? -1 : String(a.createdAt) > String(b.createdAt) ? 1 : 0));
  const byAccount = new Map();
  for (const b of ordered) {
    if (!byAccount.has(b.accountId)) byAccount.set(b.accountId, []);
    byAccount.get(b.accountId).push(b);
  }
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const archivedOn = new Map(accounts.filter((a) => a.archivedAt).map((a) => [a.id, String(a.archivedAt).slice(0, 10)]));
  return { accounts, balances: ordered, byAccount, accountsById, archivedOn };
}

function resolve(record, date, ctx, cutoff = null) {
  const values = new Map();
  let newest = null;
  for (const [accountId, rows] of record.byAccount) {
    const account = record.accountsById.get(accountId);
    if (!account) continue;
    const archived = record.archivedOn.get(accountId);
    if (archived && date >= archived) continue;
    if (cutoff && account.archivedAt && String(account.archivedAt) <= cutoff) continue;
    let latest = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].asOfDate <= date && (!cutoff || String(rows[i].createdAt) <= cutoff)) { latest = rows[i]; break; }
    }
    if (!latest) continue;
    if (!newest || latest.asOfDate > newest) newest = latest.asOfDate;
    const magnitude = convert(ctx, Dec.int(latest.valueMinor), account.currency);
    values.set(accountId, minorOf(account.kind === 'ASSET' ? magnitude : magnitude.negate()));
  }
  return { values, newest };
}
const total = (values) => [...values.values()].reduce((t, v) => t + v, 0n);

/** Month by month from the first balance to this month: { months: [{ month, netWorth, values, newest }], events } or null. */
export function derive(record, ctx, today) {
  if (!record.balances.length) return null;
  const first = record.balances.reduce((m, b) => (b.asOfDate < m ? b.asOfDate : m), record.balances[0].asOfDate);
  const months = [], events = [];
  let previous = new Set();
  const end = today.slice(0, 7);
  for (let month = first.slice(0, 7); month <= end; month = addMonthsToMonth(month, 1)) {
    const r = resolve(record, lastDayOf(month), ctx);
    const contributing = new Set(r.values.keys());
    const joined = [...contributing].filter((id) => !previous.has(id));
    const left = [...previous].filter((id) => !contributing.has(id));
    if (months.length && (joined.length || left.length)) {
      const names = (ids) => ids.map((id) => record.accountsById.get(id)?.name).filter((n) => n != null).sort();
      events.push({ month, joined: names(joined), left: names(left) });
    }
    months.push({ month, netWorth: total(r.values), values: r.values, newest: r.newest });
    previous = contributing;
  }
  return { months, events };
}

/** Every day a balance was entered, and today. */
export function days(record, ctx, today) {
  if (!record.balances.length) return [];
  const dates = new Set(record.balances.map((b) => b.asOfDate).filter((d) => d <= today));
  dates.add(today);
  return [...dates].sort().map((date) => {
    const r = resolve(record, date, ctx);
    return { date, netWorth: total(r.values), values: r.values, newest: r.newest };
  });
}

/** The position at each mark, as it was known when the mark was made. */
export function atMarkers(record, markers, ctx) {
  return markers.map((m) => {
    const r = resolve(record, m.takenOn, ctx, m.createdAt || null);
    return { id: m.id, label: m.label, takenOn: m.takenOn, madeAt: m.createdAt || null, netWorth: total(r.values), values: r.values };
  });
}

// ---------------------------------------------------------------------------------------------
// Between two months: which accounts did it (HistoryAttribution)

export function attribution(from, to, reading, accountsById) {
  if (!(from < to)) return null;
  const start = reading.months.find((m) => m.month === from);
  const end = reading.months.find((m) => m.month === to);
  if (!start || !end) return null;
  const contributions = [];
  for (const id of new Set([...start.values.keys(), ...end.values.keys()])) {
    const before = start.values.has(id) ? start.values.get(id) : null;
    const after = end.values.has(id) ? end.values.get(id) : null;
    let kind, amount;
    if (before != null && after != null) { kind = 'moved'; amount = after - before; }
    else if (after != null) { kind = 'firstTracked'; amount = after; }
    else { kind = 'archived'; amount = -before; }
    const account = accountsById.get(id);
    contributions.push({ accountId: id, name: account ? account.name : 'An account no longer here',
      accountKind: account ? account.kind : 'ASSET', amount, before, after, kind });
  }
  contributions.sort((a, b) => (abs(a.amount) === abs(b.amount) ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : abs(a.amount) > abs(b.amount) ? -1 : 1));
  const sumOf = (list) => list.reduce((t, c) => t + c.amount, 0n);
  const movers = contributions.filter((c) => c.amount !== 0n);
  const totalMovement = contributions.reduce((t, c) => t + abs(c.amount), 0n);
  const share = (c) => (totalMovement === 0n ? null : Number(Dec.int(abs(c.amount)).mul(Dec.int(100)).div(Dec.int(totalMovement)).round(0).toString()));
  return {
    from, to, fromNetWorth: start.netWorth, toNetWorth: end.netWorth, contributions, movers,
    owned: contributions.filter((c) => c.accountKind === 'ASSET'), owed: contributions.filter((c) => c.accountKind === 'LIABILITY'),
    totalChange: end.netWorth - start.netWorth,
    moved: sumOf(contributions.filter((c) => c.kind === 'moved')),
    learned: sumOf(contributions.filter((c) => c.kind === 'firstTracked')),
    left: sumOf(contributions.filter((c) => c.kind === 'archived')),
    totalMovement, share,
  };
}

/** What months have been adding, from the first month to the last; null under three months. */
export function realisedPace(reading, accountsById) {
  if (!reading || !reading.months.length) return null;
  const first = reading.months[0].month, last = reading.months[reading.months.length - 1].month;
  const span = monthsSince(last, first);
  if (span < 2) return null;
  const a = attribution(first, last, reading, accountsById);
  if (!a) return null;
  return { from: first, to: last, months: span, moved: a.moved, perMonth: a.moved / BigInt(span), excludedLearning: a.learned + a.left };
}

// ---------------------------------------------------------------------------------------------
// Side by side (SnapshotComparison)

/** A point is { kind: 'month', month } or { kind: 'day', date }. */
export const pointId = (p) => (p.kind === 'month' ? `m:${p.month}` : `d:${p.date}`);
const pointOrder = (p) => (p.kind === 'month' ? `${p.month}-99` : p.date);
export const pointLastDay = (p) => (p.kind === 'day' ? p.date : lastDayOf(p.month));
export const pointTitle = (p) => (p.kind === 'month' ? monthLabel(p.month) : dayLabel(p.date));
export function pointColumnTitle(p) {
  const ym = p.kind === 'month' ? p.month : p.date.slice(0, 7);
  const year = `'${ym.slice(2, 4)}`;
  const mon = SHORT_MONTHS[Number(ym.slice(5, 7)) - 1];
  return p.kind === 'month' ? `${mon} ${year}` : `${Number(p.date.slice(8, 10))} ${mon} ${year}`;
}

export function resolvedPoints(reading, dayList) {
  const out = [
    ...(reading ? reading.months.map((m) => ({ point: { kind: 'month', month: m.month }, netWorth: m.netWorth, values: m.values, newest: m.newest })) : []),
    ...dayList.map((d) => ({ point: { kind: 'day', date: d.date }, netWorth: d.netWorth, values: d.values, newest: d.newest })),
  ];
  return out.sort((a, b) => (pointOrder(a.point) < pointOrder(b.point) ? -1 : pointOrder(a.point) > pointOrder(b.point) ? 1 : 0));
}

export function compare(points, available, accountsById) {
  const wanted = new Set(points.map(pointId));
  const picked = available.filter((r) => wanted.has(pointId(r.point)));
  if (picked.length < 2) return null;
  const columns = picked.map((r) => {
    let owned = 0n, owed = 0n;
    for (const [id, v] of r.values) { if (accountsById.get(id)?.kind === 'LIABILITY') owed += v; else owned += v; }
    return { point: r.point, effectiveDate: r.newest || pointLastDay(r.point), netWorth: r.netWorth, owned, owed, tracked: r.values.size };
  });
  const rows = [];
  for (const id of new Set(picked.flatMap((r) => [...r.values.keys()]))) {
    const values = picked.map((r) => (r.values.has(id) ? r.values.get(id) : null));
    const tracked = values.filter((v) => v != null);
    const change = tracked.length > 1 ? tracked[tracked.length - 1] - tracked[0] : null;
    const changePercent = change != null && tracked[0] !== 0n ? Dec.int(change).div(Dec.int(abs(tracked[0]))).shift(2).toString() : null;
    const account = accountsById.get(id);
    rows.push({ accountId: id, name: account ? account.name : 'An account no longer here', accountKind: account ? account.kind : 'ASSET',
      values, change, changePercent });
  }
  rows.sort((a, b) => {
    const l = a.change == null ? 0n : abs(a.change), r = b.change == null ? 0n : abs(b.change);
    return l === r ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : l > r ? -1 : 1;
  });
  return { columns, rows, netWorthChange: columns[columns.length - 1].netWorth - columns[0].netWorth };
}

// ---------------------------------------------------------------------------------------------
// Like for like: two dates at the same point of the month

export function inStep(from, to) {
  const fd = Number(from.slice(8, 10)), td = Number(to.slice(8, 10));
  if (fd === td) return true;
  if (isLastDay(to) && fd > td) return true;
  if (isLastDay(from) && td > fd) return true;
  return false;
}

function clampedDay(day, ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(Math.min(Math.max(1, day), daysInMonth(y, m))).padStart(2, '0')}`;
}
export function daysAfterPay(date, payDay) {
  const thisMonth = clampedDay(payDay, date.slice(0, 7));
  const last = thisMonth <= date ? thisMonth : clampedDay(payDay, addMonthsToMonth(date.slice(0, 7), -1));
  return daysBetween(last, date);
}
function wholeMonths(from, to) {
  const months = monthsSince(to.slice(0, 7), from.slice(0, 7));
  if (months <= 0) return 0;
  return Number(to.slice(8, 10)) >= Number(from.slice(8, 10)) || isLastDay(to) ? months : months - 1;
}
export function likeForLike(from, to, payDay = null, available = []) {
  const step = inStep(from, to);
  let suggestion = null;
  if (!step) {
    for (const d of available) {
      if (!(d < to && inStep(d, to))) continue;
      if (suggestion == null || Math.abs(daysBetween(from, d)) < Math.abs(daysBetween(from, suggestion))) suggestion = d;
    }
  }
  return { from, to, days: daysBetween(from, to), inStep: step, wholeMonths: wholeMonths(from, to),
    daysAfterPayAtStart: payDay == null ? null : daysAfterPay(from, payDay), daysAfterPayAtEnd: payDay == null ? null : daysAfterPay(to, payDay),
    suggestion, isWorthSaying: !step && from.slice(0, 7) !== to.slice(0, 7) };
}

// ---------------------------------------------------------------------------------------------
// One account's recorded balances (RecordedTrack)

export function recordedTrack(balances, kind) {
  const sign = kind === 'ASSET' ? 1n : -1n;
  const ordered = [...balances].sort((a, b) => {
    const ka = [a.asOfDate, String(a.createdAt), a.id], kb = [b.asOfDate, String(b.createdAt), b.id];
    for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] > kb[i] ? -1 : 1;
    return 0;
  });
  const byDay = new Map();
  for (const b of ordered) if (!byDay.has(b.asOfDate)) byDay.set(b.asOfDate, b);
  const points = [];
  let previous = null;
  for (const day of [...byDay.keys()].sort()) {
    const b = byDay.get(day);
    const value = BigInt(b.valueMinor) * sign;
    points.push({ date: day, value, change: previous ? value - BigInt(previous.valueMinor) * sign : 0n,
      daysSincePrevious: previous ? daysBetween(previous.asOfDate, day) : 0 });
    previous = b;
  }
  const first = points[0], latest = points[points.length - 1];
  const totalChange = first ? latest.value - first.value : 0n;
  let biggest = null;
  for (const p of points.slice(1)) if (!biggest || abs(p.change) > abs(biggest.change)) biggest = p;
  return { points, entries: balances.length, totalChange, biggestMove: biggest,
    changePercent: first && first.value !== 0n ? Dec.int(totalChange).div(Dec.int(abs(first.value))).shift(2).toString() : null,
    spanDays: first ? daysBetween(first.date, latest.date) : 0, hasSameDayEntries: balances.length > points.length };
}

// ---------------------------------------------------------------------------------------------
// The forecast made then, against what happened (ForecastReview)

const monthOfStamp = (stamp) => (stamp && /^\d{4}-\d{2}-\d{2}/.test(String(stamp)) ? String(stamp).slice(0, 7) : null);
const onOrBefore = (stamp, month) => { const m = monthOfStamp(stamp); return m != null && m <= month; };

/** The months a forecast can be read from: the first version's month up to last month. */
export function availableStarts(versions, today) {
  const first = versions.length ? monthOfStamp(versions[0].validFrom) : null;
  const current = today.slice(0, 7);
  if (!first || !(first < current)) return [];
  const out = [];
  for (let m = first; m < current; m = addMonthsToMonth(m, 1)) out.push(m);
  return out;
}

/**
 * versions: assumption versions oldest first ({ validFrom, base, incomeMinor, spendingMinor, raisePct,
 *   raiseMonth, spendingGrowthPct, returnPct }); rateVersions: oldest first ({ quote, rate, validFrom });
 * plannedAll: every planned item, put away or not, with createdAt and archivedAt; record, history as above.
 * → { ok: true, from, points: [{ month, expected, actual }], inputChanges } or { ok: false, firstKnown }
 */
export function forecastReview({ versions, rateVersions, plannedAll, record, history, ctx, today, from, inUse }) {
  let then = null;
  for (const v of versions) if (onOrBefore(v.validFrom, from)) then = v;
  if (!then) return { ok: false, firstKnown: (versions.length && monthOfStamp(versions[0].validFrom)) || today.slice(0, 7) };
  const ratesThen = {};
  for (const v of rateVersions) if (onOrBefore(v.validFrom, from)) ratesThen[v.quote] = v.rate;
  const snapshots = [];
  for (const account of record.accounts) {
    const archived = monthOfStamp(account.archivedAt);
    if (archived && archived <= from) continue;
    const rows = record.byAccount.get(account.id) || [];
    let latest = null;
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].asOfDate.slice(0, 7) <= from) { latest = rows[i]; break; }
    if (!latest) continue;
    snapshots.push({ ...account, latestMinor: latest.valueMinor, latestDate: latest.asOfDate });
  }
  const planned = plannedAll.filter((p) => {
    const created = monthOfStamp(p.createdAt);
    if (!created || created > from) return false;
    const archived = monthOfStamp(p.archivedAt);
    return !(archived && archived <= from);
  });
  const scales = { ...ctx.scales };
  const past = {
    base: then.base, scales, rates: ratesThen, accounts: snapshots, planned,
    assumptions: { ...ctx.assumptions, incomeMinor: then.incomeMinor, spendingMinor: then.spendingMinor, raisePct: then.raisePct,
      raiseMonth: then.raiseMonth, spendingGrowthPct: then.spendingGrowthPct, returnPct: then.returnPct },
  };
  const span = monthsSince(today.slice(0, 7), from);
  const expected = project(past, lastDayOf(from), span);
  if (!history) return { ok: false, firstKnown: today.slice(0, 7) };
  const actual = new Map(history.months.map((m) => [m.month, m]));
  const points = expected.months.filter((m) => actual.has(m.month)).map((m) => ({ month: m.month, expected: m.netWorth, actual: actual.get(m.month).netWorth }));

  const latest = versions[versions.length - 1];
  const fields = ['base', 'incomeMinor', 'spendingMinor', 'raisePct', 'raiseMonth', 'spendingGrowthPct', 'returnPct'];
  const assumptionsEdited = latest ? fields.some((k) => (k.endsWith('Pct')
    ? Dec.of(String(latest[k])).cmp(Dec.of(String(then[k]))) !== 0 : String(latest[k]) !== String(then[k]))) : false;
  const thenSet = new Set(snapshots.map((s) => s.id));
  const nowSet = new Set(inUse.map((a) => a.id));
  const names = new Map(record.accounts.map((a) => [a.id, a.name]));
  const codes = new Set([...snapshots.map((s) => s.currency), ...inUse.map((a) => a.currency)]);
  const ratesChanged = [...new Set(rateVersions.filter((v) => !onOrBefore(v.validFrom, from)).map((v) => v.quote))].filter((c) => codes.has(c)).sort();
  const plannedAdded = plannedAll.filter((p) => { const m = monthOfStamp(p.createdAt); return m != null && m > from; }).map((p) => p.name).sort();
  return {
    ok: true, from, points,
    inputChanges: {
      assumptionsEdited,
      accountsJoined: [...nowSet].filter((id) => !thenSet.has(id)).map((id) => names.get(id)).filter((n) => n != null).sort(),
      accountsLeft: [...thenSet].filter((id) => !nowSet.has(id)).map((id) => names.get(id)).filter((n) => n != null).sort(),
      ratesChanged, plannedAdded,
    },
  };
}
