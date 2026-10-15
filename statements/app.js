// The page: takes PDFs from this device, reads them here with PDF.js, and shows what was read.
// Nothing is sent anywhere and nothing is kept: the page's own security policy forbids any
// connection, and a reload or "Clear" forgets every statement.
import * as pdfjs from './vendor/pdfjs/pdf.min.mjs';
import { pagesFromPdf, readStatement, readCsvStatement, unzip, labelLines, monthly, minorDigits } from './readers.js';
import { SAMPLES } from './samples.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const $ = (id) => document.getElementById(id);
const state = { statements: [], example: true, problems: [], seen: new Set() };

// ---------------------------------------------------------------------------------------------
// Words and figures

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Minor units → "2,468.10", without ever going through a float. */
function money(minor, currency, { sign = false } = {}) {
  if (minor == null) return '—';
  const digits = minorDigits(currency);
  const negative = minor < 0;
  const s = String(Math.abs(minor)).padStart(digits + 1, '0');
  const whole = s.slice(0, s.length - digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = digits ? `${whole}.${s.slice(-digits)}` : whole;
  return `${negative ? '−' : sign && minor > 0 ? '+' : ''}${body}`;
}

const day = (iso, withYear = false) => iso
  ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' })
  : '—';
const month = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const period = (p) => (p?.from && p?.to ? `${day(p.from)} – ${day(p.to, true)}` : p?.to ? `To ${day(p.to, true)}` : 'Dates not found');

const TYPE = { current: 'Current', savings: 'Savings', deposit: 'Fixed deposit', card: 'Card' };
const LABEL = { in: 'Money in', out: 'Money out', own: 'Between your accounts', interest: 'Interest' };

// ---------------------------------------------------------------------------------------------
// Reading files

const kindOf = (name) => (/\.pdf$/i.test(name) ? 'pdf' : /\.csv$/i.test(name) ? 'csv' : /\.zip$/i.test(name) ? 'zip' : null);

/** A CSV's text → a statement, or a note on why it couldn't be read. */
function addCsv(name, bytes) {
  const statement = readCsvStatement(new TextDecoder().decode(bytes), { fileName: name });
  if (statement.unknownCsv) state.problems.push({ file: name, text: 'This CSV isn’t one this page can read yet. Wise statements in CSV are.' });
  else state.statements.push(statement);
}

async function addFiles(files) {
  const pdfs = [...files].filter((f) => kindOf(f.name));
  for (const f of [...files].filter((f) => !pdfs.includes(f))) state.problems.push({ file: f.name, text: 'This isn’t a statement this page reads: choose a PDF, or a CSV or zip from Wise.' });
  if (!pdfs.length) return render();
  if (state.example) { state.statements = []; state.example = false; }
  $('reading').hidden = false;
  for (const file of pdfs) {
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (state.seen.has(key)) { state.problems.push({ file: file.name, text: 'Already read above.' }); continue; }
    $('reading-name').textContent = file.name;
    try {
      if (kindOf(file.name) === 'csv') { addCsv(file.name, new Uint8Array(await file.arrayBuffer())); state.seen.add(key); continue; }
      if (kindOf(file.name) === 'zip') {
        const inside = (await unzip(new Uint8Array(await file.arrayBuffer()))).filter((f) => kindOf(f.name) === 'csv');
        if (!inside.length) state.problems.push({ file: file.name, text: 'There are no CSV files in this zip.' });
        for (const f of inside) addCsv(f.name, f.bytes);
        state.seen.add(key);
        continue;
      }
      const data = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
      const statement = readStatement(await pagesFromPdf(pdf), { fileName: file.name });
      await pdf.destroy();
      state.seen.add(key);
      if (statement.picture) state.problems.push({ file: file.name, text: 'This PDF is a picture of the pages, with no text in it to read. Add its balance by hand.' });
      else if (!statement.accounts.length) state.problems.push({ file: file.name, text: 'No accounts or lines were found in it. If it’s a statement from your bank, the layout is one this page can’t read yet.' });
      else state.statements.push(statement);
    } catch (error) {
      const text = error?.name === 'PasswordException'
        ? 'This PDF has a password. Open it, save a copy without the password, and add that copy.'
        : 'This file couldn’t be opened as a PDF.';
      state.problems.push({ file: file.name, text });
    }
  }
  $('reading').hidden = true;
  render();
}

function loadExamples() {
  state.statements = SAMPLES.map((s) => ({ ...readStatement(s.pages, { fileName: s.fileName }), holder: s.holder }));
  state.example = true;
  state.problems = [];
  state.seen.clear();
  render();
}

// ---------------------------------------------------------------------------------------------
// Drawing

function render() {
  const typed = $('holder').value.trim();
  // A typed name stands in for a statement that doesn't print one, and only for that.
  for (const s of state.statements) {
    if (!('holderRead' in s)) s.holderRead = s.holder;
    s.holder = s.holderRead || typed || null;
  }
  labelLines(state.statements);

  $('example-note').hidden = !state.example;
  $('clear').hidden = state.example;
  $('problems').innerHTML = state.problems.map((p) => `<li><strong>${esc(p.file)}</strong> ${esc(p.text)}</li>`).join('');
  $('problems').hidden = !state.problems.length;

  const accounts = state.statements.flatMap((s) => s.accounts);
  const adding = accounts.filter((a) => a.check.ok).length;
  // Only accounts that could be checked count against it: one with no balance in its file
  // (an empty Wise currency) hasn't failed.
  const checked = accounts.filter((a) => a.check.checked).length;
  const unchecked = accounts.length - checked;
  $('summary').hidden = !accounts.length;
  $('stat-statements').textContent = state.statements.length;
  $('stat-accounts').textContent = accounts.length;
  $('stat-lines').textContent = accounts.reduce((t, a) => t + a.lines.length, 0);
  $('stat-adds').textContent = `${adding} of ${checked}`;
  $('stat-adds').closest('div').dataset.state = adding === checked ? 'ok' : 'warn';
  $('stat-unchecked').textContent = unchecked ? ` · ${unchecked} not checked` : '';

  const months = monthly(state.statements);
  $('months').innerHTML = months.length
    ? months.map((m) => `<tr><th scope="row">${month(m.month)} <span class="cur">${esc(m.currency)}</span></th><td>${money(m.in, m.currency)}</td><td>${money(m.out, m.currency)}</td><td>${m.interest ? money(m.interest, m.currency) : '—'}</td></tr>`).join('')
    : '<tr><td colspan="4" class="none">No lines yet.</td></tr>';

  $('statements').innerHTML = state.statements.map(statementCard).join('');
}

function statementCard(s) {
  const live = s.accounts.filter((a) => !a.closed);
  const closed = s.accounts.filter((a) => a.closed);
  return `<article class="stmt card">
    <header class="stmt-head">
      <div class="who">
        <h3>${esc(s.general ? 'Plain table' : s.institution)}</h3>
        <span class="reader" title="The reader that read it">${esc(s.reader)}</span>
      </div>
      <div class="when"><span>${esc(period(s.period))}</span><span class="file">${esc(s.fileName)}</span></div>
    </header>
    ${s.general ? '<p class="note">Read as a plain table, without a reader made for this bank. Check each line against the statement.</p>' : ''}
    <div class="accts">${live.map((a) => accountRow(a, s)).join('')}</div>
    ${closed.length ? `<details class="closed"><summary>${closed.length} closed during this statement</summary><div class="accts">${closed.map((a) => accountRow(a, s)).join('')}</div></details>` : ''}
  </article>`;
}

function accountRow(a, s) {
  const name = s.general ? `${a.name} · ${s.fileName.replace(/\.pdf$/i, '')}` : a.name;
  const facts = [
    `<span class="tag${a.owed ? ' owed' : ''}">${a.owed ? 'Owed' : 'Yours'}</span>`,
    `<span>${esc(TYPE[a.type] ?? a.type)}</span>`,
    a.currency ? `<span>${esc(a.currency)}</span>` : '',
    a.ratePct ? `<span>${esc(a.ratePct)}% a year</span>` : '',
    a.closes && !a.closed ? `<span>Ends ${day(a.closes, true)}</span>` : '',
  ].filter(Boolean).join('');
  const inCredit = a.owed && a.closing < 0;
  const figure = inCredit ? `${money(-a.closing, a.currency)} <small>in credit</small>` : money(a.closing, a.currency);
  const verdict = a.check.ok
    ? '<span class="pill ok">Adds up</span>'
    : a.check.checked ? '<span class="pill warn">Doesn’t add up</span>' : '<span class="pill plain">Not checked</span>';
  const why = !a.check.ok && a.check.checked
    ? `<p class="why">From ${money(a.opening, a.currency)}, the lines come to ${money(a.check.expected, a.currency)}; the statement says ${money(a.closing, a.currency)}.${a.check.messages.filter((m) => m.kind === 'line').length ? ` ${a.check.messages.filter((m) => m.kind === 'line').length} running balance${a.check.messages.filter((m) => m.kind === 'line').length === 1 ? '' : 's'} don’t follow on, marked below.` : ''}</p>`
    : !a.check.checked && !a.lines.length && a.closing == null ? '<p class="why">No lines in this file, so it carries no balance for this account. Wise leaves a currency’s file empty when nothing happened in it.</p>'
    : !a.check.checked ? '<p class="why">The statement doesn’t print an opening and closing balance this page could find, so the lines aren’t checked.</p>' : '';
  // An overdrawn account is kept below zero only once the user confirms it (owner's ruling,
  // 16 October 2026); this page keeps nothing, so it says what adding it will ask.
  const overdrawn = a.belowZero
    ? '<p class="why">Below zero on this statement: the account was overdrawn. When you add it, WaffleWealth asks you to confirm keeping its balance below zero.</p>'
    : '';
  const flagged = new Set(a.check.messages.filter((m) => m.kind === 'line').map((m) => m.index));
  const lines = a.lines.length
    ? `<div class="lines-wrap"><table class="lines">
        <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Kind</th><th scope="col" class="num">Amount</th>${a.lines.some((l) => l.running != null) ? '<th scope="col" class="num">Balance</th>' : ''}</tr></thead>
        <tbody>${a.lines.map((l, i) => `<tr${flagged.has(i) ? ' class="flag"' : ''}>
          <td class="d">${day(l.date)}</td>
          <td class="desc">${esc(l.description)}${l.foreign ? `<span class="fx">${l.foreign.amount != null ? money(Math.abs(l.foreign.amount), l.foreign.currency) : ''} ${esc(l.foreign.currency)}</span>` : ''}</td>
          <td><span class="kind k-${l.label}">${LABEL[l.label] ?? ''}</span></td>
          <td class="num ${l.amount >= 0 ? 'in' : ''}">${money(l.amount, a.currency, { sign: true })}</td>
          ${a.lines.some((x) => x.running != null) ? `<td class="num run">${money(l.running, a.currency)}</td>` : ''}
        </tr>`).join('')}</tbody>
      </table></div>`
    : '<p class="why">No lines this month.</p>';
  return `<details class="acct">
    <summary>
      <span class="chev" aria-hidden="true"></span>
      <span class="main"><span class="name">${esc(name)}</span><span class="facts">${facts}</span></span>
      <span class="end"><span class="bal fig">${figure}</span>${verdict}</span>
    </summary>
    <div class="body">${why}${overdrawn}${a.lines.length ? `<p class="count">${a.lines.length} line${a.lines.length === 1 ? '' : 's'} · opening ${money(a.opening, a.currency)}</p>` : ''}${lines}</div>
  </details>`;
}

// ---------------------------------------------------------------------------------------------
// Wiring

const drop = $('drop');
$('file').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => addFiles(e.dataTransfer?.files ?? []));
// A file dropped beside the box would open in the tab instead; catch it here too.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { e.preventDefault(); if (!drop.contains(e.target)) addFiles(e.dataTransfer?.files ?? []); });
$('holder').addEventListener('input', render);
$('clear').addEventListener('click', () => { $('holder').value = ''; loadExamples(); });

loadExamples();
