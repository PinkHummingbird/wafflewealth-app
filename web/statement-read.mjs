/* WaffleWealth on the web: reading a document as a statement, here in the browser.

   The readers are the statements page's (../statements/readers.js, and xlsx.js for Excel), which
   read the same banks the app reads; PDFs are opened with the copy of PDF.js that page keeps on
   this site. Nothing is sent anywhere to be read. Loaded only when someone asks to read a document. */
import * as pdfjs from '../statements/vendor/pdfjs/pdf.min.mjs';
import {
  pagesFromPdf, readStatement, readCsvStatement, readOfxStatement, readMt940Statement, readCamtStatement, readQifStatement,
  ofxText, isOfxName, looksLikeOfx, looksLikeMt940, looksLikeCamt, looksLikeQif, unzip, labelLines,
} from '../statements/readers.js?v=27';
import { readXlsxStatement, looksLikeXlsx, unreadableExcel } from '../statements/xlsx.js?v=27';
import { fingerprint } from './statement-save.mjs?v=27';

// Putting a reading right, as the app does: the same functions the statements page uses.
export { correctLine, leaveOutLine, linesOff, correctedCount } from '../statements/readers.js?v=27';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../statements/vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

/** The other downloads a bank may give, as the app names them: MT940, CAMT (XML), QIF, and text files of either. */
const BANK_FILE = /\.(sta|mt940|940|swi|qif|xml|txt)$/i;

const kindOf = (name) => (/\.pdf$/i.test(name) ? 'pdf' : /\.csv$/i.test(name) ? 'csv' : isOfxName(name) ? 'ofx'
  : /\.xlsx?$/i.test(name) ? 'excel' : /\.zip$/i.test(name) ? 'zip' : BANK_FILE.test(name) ? 'bank' : null);

const isPdf = (bytes) => bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;

/**
 * One document's file → `{ statements, problems }`. A zip is the statement files in it, each a
 * statement of its own, as the app reads it. Each statement carries `sha256`, made as the app
 * makes it, and its lines are labelled (between your accounts, interest, in, out) across them all.
 *
 * A bank's download is known by what is in it before its name, as in the app: banks name the
 * same file many ways. OFX first, then an Excel workbook (an .xlsx, even one named .zip), then
 * (for anything that isn't a PDF) CAMT, MT940 and QIF, then a CSV read from its header for a
 * file named .csv or as a bank file; a PDF last.
 */
export async function readDocument(name, bytes) {
  const statements = [];
  const problems = [];
  // Said of the file itself, or, for one of several in a zip, with its name in front.
  const tell = (fileName, text) => problems.push(fileName === name ? text : `${fileName}: ${text[0].toLowerCase()}${text.slice(1)}`);
  // A bank's download (OFX, QFX, QBO) is read exactly as the bank sent it, and hashed on its bytes
  // alone, like a PDF. Some banks name it .csv, so a CSV's contents are looked at first.
  const addOfx = async (fileName, data) => {
    const statement = readOfxStatement(ofxText(data), { fileName });
    if (statement.unknownOfx) problems.push(`${fileName}: no bank or card statement was found in this download.`);
    else statements.push({ ...statement, sha256: await fingerprint('download.ofx', data) });
  };
  // An Excel workbook: its first sheet with a table of lines, read as that table's CSV would be,
  // and hashed as the app hashes any file that isn't named .csv, on its bytes alone.
  const addXlsx = async (fileName, data) => {
    const statement = await readXlsxStatement(data, { fileName });
    if (statement.accounts.length) statements.push({ ...statement, sha256: await fingerprint(fileName, data) });
    else tell(fileName, 'No table of lines was found in this spreadsheet.');
  };
  // The other bank files (CAMT, MT940, QIF, any bank's CSV): hashed as the app hashes them, a CSV
  // by its name and bytes (Wise's empty currency files differ only in name), the rest by bytes.
  // True when the file was taken as one of them, read or not.
  const addBankFile = async (fileName, data) => {
    const kind = kindOf(fileName);
    const text = ofxText(data);
    const reader = looksLikeCamt(text) ? readCamtStatement : looksLikeMt940(text) ? readMt940Statement
      : looksLikeQif(text) ? readQifStatement : ['csv', 'bank', 'excel'].includes(kind) ? readCsvStatement : null;
    if (!reader) return false;
    const statement = reader(text, { fileName });
    if (statement.accounts.length) statements.push({ ...statement, sha256: await fingerprint(fileName, data) });
    else problems.push(`${fileName}: ${kind === 'csv'
      ? 'its columns weren’t recognised: it needs a date and an amount, or money in and money out.'
      : 'no statement was found in this file.'}`);
    return true;
  };
  const headOf = (data) => new TextDecoder().decode(data.subarray(0, 4096));
  const addOne = async (fileName, data) => {
    if (kindOf(fileName) === 'ofx' || looksLikeOfx(headOf(data))) return addOfx(fileName, data);
    if (looksLikeXlsx(data)) return addXlsx(fileName, data);
    // A file named for Excel that isn't a workbook: one saved with a password, or the older .xls.
    // Anything else named so (a bank's text file) is read for what is in it, below.
    const unreadable = kindOf(fileName) === 'excel' ? unreadableExcel(data) : null;
    if (unreadable) {
      tell(fileName, unreadable === 'password'
        ? 'This spreadsheet has a password. Open it, save a copy without the password, and upload that copy.'
        : 'This is an older Excel file (.xls), which WaffleWealth can’t read. Open it in a spreadsheet app, save it as .xlsx or CSV, and upload that copy.');
      return;
    }
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
    if (isPdf(data) || looksLikeXlsx(data) || looksLikeOfx(headOf(data))) return true;
    const text = ofxText(data);
    return looksLikeCamt(text) || looksLikeMt940(text) || looksLikeQif(text);
  };
  const kind = kindOf(name);
  if (!kind && !known(bytes)) {
    return { statements, problems: ['This isn’t a statement WaffleWealth reads: a PDF, a bank’s download (OFX, QFX, MT940, CAMT or QIF), a bank’s CSV or Excel file (.xlsx), or a zip of them.'] };
  }
  try {
    // An Excel workbook is a zip itself: one renamed .zip is read as the workbook it is.
    if (kind === 'zip' && !looksLikeXlsx(bytes)) {
      const inside = (await unzip(bytes)).filter((f) => ['csv', 'ofx', 'bank', 'excel'].includes(kindOf(f.name)));
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
