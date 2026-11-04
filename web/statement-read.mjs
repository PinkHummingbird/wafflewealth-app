/* WaffleWealth on the web: reading a document as a statement, here in the browser.

   The readers are the statements page's (../statements/readers.js), which read the same banks
   the app reads; PDFs are opened with the copy of PDF.js that page keeps on this site. Nothing
   is sent anywhere to be read. Loaded only when someone asks to read a document. */
import * as pdfjs from '../statements/vendor/pdfjs/pdf.min.mjs';
import {
  pagesFromPdf, readStatement, readCsvStatement, readOfxStatement, readMt940Statement, readCamtStatement, readQifStatement,
  ofxText, isOfxName, looksLikeOfx, looksLikeMt940, looksLikeCamt, looksLikeQif, unzip, labelLines,
} from '../statements/readers.js?v=28';
import { fingerprint } from './statement-save.mjs?v=29';

// Putting a reading right, as the app does: the same functions the statements page uses.
export { correctLine, leaveOutLine, linesOff, correctedCount } from '../statements/readers.js?v=28';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../statements/vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

/** The other downloads a bank may give, as the app names them: MT940, CAMT (XML), QIF, and text files of either. */
const BANK_FILE = /\.(sta|mt940|940|swi|qif|xml|txt)$/i;

const kindOf = (name) => (/\.pdf$/i.test(name) ? 'pdf' : /\.csv$/i.test(name) ? 'csv' : isOfxName(name) ? 'ofx'
  : /\.zip$/i.test(name) ? 'zip' : BANK_FILE.test(name) ? 'bank' : null);

const isPdf = (bytes) => bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;

/**
 * One document's file → `{ statements, problems }`. A zip is the statement files in it, each a
 * statement of its own, as the app reads it. Each statement carries `sha256`, made as the app
 * makes it, and its lines are labelled (between your accounts, interest, in, out) across them all.
 *
 * A bank's download is known by what is in it before its name, as in the app: banks name the
 * same file many ways. OFX first, then (for anything that isn't a PDF) CAMT, MT940 and QIF, then
 * a CSV read from its header for a file named .csv or as a bank file; a PDF last.
 *
 * `dayFirstWhenUnsure` settles a CSV's or QIF's dates that could be read either way when nothing
 * in the file does: the page passes false when the main currency is the US dollar, as the app does.
 */
export async function readDocument(name, bytes, { dayFirstWhenUnsure = true } = {}) {
  const statements = [];
  const problems = [];
  // A bank's download (OFX, QFX, QBO) is read exactly as the bank sent it. Some banks name it .csv,
  // so a CSV's contents are looked at first. It is hashed as the app hashes every file, by its
  // name: on its bytes alone, and a file named .csv on its name and bytes, so the phone and the
  // website know it for the same file.
  const addOfx = async (fileName, data) => {
    const statement = readOfxStatement(ofxText(data), { fileName });
    if (statement.unknownOfx) problems.push(`${fileName}: no bank or card statement was found in this download.`);
    else statements.push({ ...statement, sha256: await fingerprint(fileName, data) });
  };
  // The other bank files (CAMT, MT940, QIF, any bank's CSV): hashed as the app hashes them, a CSV
  // by its name and bytes (Wise's empty currency files differ only in name), the rest by bytes.
  // True when the file was taken as one of them, read or not.
  const addBankFile = async (fileName, data) => {
    const kind = kindOf(fileName);
    const text = ofxText(data);
    const reader = looksLikeCamt(text) ? readCamtStatement : looksLikeMt940(text) ? readMt940Statement
      : looksLikeQif(text) ? readQifStatement : kind === 'csv' || kind === 'bank' ? readCsvStatement : null;
    if (!reader) return false;
    const statement = reader(text, { fileName, dayFirstWhenUnsure });
    if (statement.accounts.length) statements.push({ ...statement, sha256: await fingerprint(fileName, data) });
    else problems.push(`${fileName}: ${kind === 'csv'
      ? 'its columns weren’t recognised: it needs a date and an amount, or money in and money out.'
      : 'no statement was found in this file.'}`);
    return true;
  };
  const headOf = (data) => new TextDecoder().decode(data.subarray(0, 4096));
  const addOne = async (fileName, data) => {
    if (kindOf(fileName) === 'ofx' || looksLikeOfx(headOf(data))) return addOfx(fileName, data);
    if (!isPdf(data) && await addBankFile(fileName, data)) return;
    // PDF.js takes the buffer over, so it gets a copy; the fingerprint is of the bytes as given.
    const sha256 = await fingerprint(fileName, data);
    const pdf = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
    const statement = readStatement(await pagesFromPdf(pdf), { fileName });
    await pdf.destroy();
    if (statement.picture) problems.push('This PDF is pictures of its pages, with no text in it. Open WaffleWealth on your iPhone and read it there: the iPhone can read pictures.');
    else if (!statement.accounts.length) problems.push('No accounts or lines were found in it. If it’s from your bank, its layout is one WaffleWealth can’t read yet: read it on your iPhone, or add the balance by hand.');
    else statements.push({ ...statement, sha256 });
  };
  // A file of any other name is read only when what is in it says what it is.
  const known = (data) => {
    if (isPdf(data) || looksLikeOfx(headOf(data))) return true;
    const text = ofxText(data);
    return looksLikeCamt(text) || looksLikeMt940(text) || looksLikeQif(text);
  };
  const kind = kindOf(name);
  if (!kind && !known(bytes)) {
    return { statements, problems: ['This isn’t a statement WaffleWealth reads: a PDF, a bank’s download (OFX, QFX, MT940, CAMT or QIF), a bank’s CSV, or a zip of them.'] };
  }
  try {
    if (kind === 'zip') {
      const inside = (await unzip(bytes)).filter((f) => ['csv', 'ofx', 'bank'].includes(kindOf(f.name)));
      if (!inside.length) problems.push('There are no statement files in this zip.');
      for (const f of inside) await addOne(f.name, f.bytes);
    } else {
      await addOne(name, bytes);
    }
  } catch (error) {
    problems.push(error?.name === 'PasswordException'
      ? 'This PDF has a password. Open it, save a copy without the password, and upload that copy.'
      : 'This file couldn’t be opened as a statement.');
  }
  labelLines(statements);
  return { statements, problems };
}
