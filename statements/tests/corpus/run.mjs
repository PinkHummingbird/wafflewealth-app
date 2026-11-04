// node statements/tests/corpus/run.mjs [--json] [--only <path-substring>]
//
// The scoreboard: every bank layout in this folder, read the way the website reads an upload
// (web/statement-read.mjs, readDocument), and compared with what the file holds. Each layout is
// a folder with the bank's file, made up but laid out as the bank lays it out (columns, order,
// separator, quoting, dates, number format, sign, rows above and below the table, text encoding),
// and an expect.json saying what a correct reading gives. See README.md.
//
// PASS: every expected account read, every line's date, amount and words right, and the balances.
// PARTIAL: the file was read, but something in it is wrong or missing.
// FAIL: nothing was read from it.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// CORPUS_READER=/path/to/another/checkout/web/statement-read.mjs scores another checkout's readers
// against these layouts (the default is this checkout's).
const { readDocument } = await import(process.env.CORPUS_READER
  ? pathToFileURL(process.env.CORPUS_READER).href
  : '../../../web/statement-read.mjs');

const here = dirname(fileURLToPath(import.meta.url));

/** Every folder under here holding an expect.json. */
export function layouts(root = here) {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === 'expect.json') found.push(dir);
    }
  };
  walk(root);
  return found;
}

const words = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ');

/** One account read against one expected: the list of what differs (empty when right). */
function compareAccount(got, want) {
  const wrong = [];
  if (want.currency !== undefined && want.currency !== null && got.currency !== want.currency) {
    wrong.push(`currency ${got.currency} (expected ${want.currency})`);
  }
  if (want.owed !== undefined && Boolean(got.owed) !== Boolean(want.owed)) wrong.push(`owed ${Boolean(got.owed)} (expected ${want.owed})`);
  const lines = got.lines ?? [];
  const expected = want.lines ?? [];
  if (lines.length !== expected.length) wrong.push(`${lines.length} lines (expected ${expected.length})`);
  // Lines are compared as a set, by date and amount, since banks list them either way round.
  const left = [...lines];
  for (const w of expected) {
    const i = left.findIndex((l) => l.date === w.date && l.amount === w.amount);
    if (i < 0) {
      const near = lines.find((l) => l.date === w.date) ?? lines.find((l) => l.amount === w.amount);
      wrong.push(`line ${w.date} ${w.amount} "${w.text ?? ''}" not found${near ? ` (nearest: ${near.date} ${near.amount} "${near.description}")` : ''}`);
      continue;
    }
    const l = left.splice(i, 1)[0];
    if (w.text && !words(l.description).includes(words(w.text))) wrong.push(`line ${w.date} ${w.amount}: words "${l.description}" lack "${w.text}"`);
  }
  for (const key of ['opening', 'closing']) {
    if (want[key] !== undefined && want[key] !== null && got[key] !== want[key]) wrong.push(`${key} ${got[key]} (expected ${want[key]})`);
  }
  return wrong;
}

/** One layout folder → { path, bank, country, format, status, problems, wrong }. */
export async function score(dir) {
  const spec = JSON.parse(readFileSync(join(dir, 'expect.json'), 'utf8'));
  const file = join(dir, spec.file);
  const base = { path: relative(here, dir), bank: spec.bank, country: spec.country, format: spec.format, mustPass: Boolean(spec.must_pass) };
  if (!existsSync(file)) return { ...base, status: 'FAIL', problems: [`missing file ${spec.file}`], wrong: [] };
  let result;
  try {
    result = await readDocument(spec.file, new Uint8Array(readFileSync(file)));
  } catch (error) {
    return { ...base, status: 'FAIL', problems: [`threw: ${error?.message ?? error}`], wrong: [] };
  }
  const accounts = result.statements.flatMap((s) => s.accounts);
  const read = accounts.some((a) => (a.lines ?? []).length > 0 || a.closing != null);
  if (!read) return { ...base, status: 'FAIL', problems: result.problems, wrong: [] };
  const wrong = [];
  const wanted = spec.expect?.accounts ?? [];
  if (accounts.length !== wanted.length) wrong.push(`${accounts.length} accounts (expected ${wanted.length})`);
  // Each expected account is matched with the read account that differs from it least.
  const pool = [...accounts];
  for (const want of wanted) {
    let best = -1;
    let bestWrong = null;
    pool.forEach((got, i) => {
      const w = compareAccount(got, want);
      if (bestWrong === null || w.length < bestWrong.length) { best = i; bestWrong = w; }
    });
    if (best < 0) { wrong.push('an expected account was not read'); continue; }
    pool.splice(best, 1);
    wrong.push(...bestWrong);
  }
  return { ...base, status: wrong.length ? 'PARTIAL' : 'PASS', problems: result.problems, wrong };
}

export async function scoreAll(filter) {
  const out = [];
  for (const dir of layouts()) {
    if (filter && !relative(here, dir).includes(filter)) continue;
    out.push(await score(dir));
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf('--only');
  const results = await scoreAll(at > 0 ? process.argv[at + 1] : null);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 1));
  } else {
    for (const r of results) {
      console.log(`${r.status.padEnd(7)} ${r.path.padEnd(42)} ${String(r.format).padEnd(6)} ${r.bank}`);
      for (const w of r.wrong.slice(0, 6)) console.log(`          - ${w}`);
      if (r.status === 'FAIL') for (const p of (r.problems ?? []).slice(0, 2)) console.log(`          ! ${p}`);
    }
    const count = (s) => results.filter((r) => r.status === s).length;
    console.log(`\n${results.length} layouts: ${count('PASS')} pass, ${count('PARTIAL')} partly, ${count('FAIL')} fail`);
    const byCountry = {};
    for (const r of results) {
      const c = (byCountry[r.country] ??= { PASS: 0, PARTIAL: 0, FAIL: 0 });
      c[r.status] += 1;
    }
    for (const [c, n] of Object.entries(byCountry).sort()) console.log(`  ${c.padEnd(4)} pass ${n.PASS}, partly ${n.PARTIAL}, fail ${n.FAIL}`);
  }
}
