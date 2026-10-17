/* WaffleWealth on the web: reading a document as a statement, here in the browser.

   The readers are the statements page's (../statements/readers.js), which read the same banks
   the app reads; PDFs are opened with the copy of PDF.js that page keeps on this site. Nothing
   is sent anywhere to be read. Loaded only when someone asks to read a document. */
import * as pdfjs from '../statements/vendor/pdfjs/pdf.min.mjs';
import { pagesFromPdf, readStatement, readCsvStatement, readOfxStatement, ofxText, isOfxName, looksLikeOfx, unzip, labelLines } from '../statements/readers.js';
import { fingerprint } from './statement-save.mjs?v=25';

// Putting a reading right, as the app does: the same functions the statements page uses.
export { correctLine, leaveOutLine, linesOff, correctedCount } from '../statements/readers.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../statements/vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const kindOf = (name) => (/\.pdf$/i.test(name) ? 'pdf' : /\.csv$/i.test(name) ? 'csv' : isOfxName(name) ? 'ofx' : /\.zip$/i.test(name) ? 'zip' : null);

/**
 * One document's file → `{ statements, problems }`. A zip is the CSVs in it, each a statement
 * of its own, as the app reads it. Each statement carries `sha256`, made as the app makes it,
 * and its lines are labelled (between your accounts, interest, in, out) across them all.
 */
export async function readDocument(name, bytes) {
  const statements = [];
  const problems = [];
  const kind = kindOf(name);
  if (!kind) return { statements, problems: ['This isn’t a statement WaffleWealth reads: a PDF, a bank’s OFX or QFX download, or a CSV or zip from Wise.'] };
  // A bank's download (OFX, QFX, QBO) is read exactly as the bank sent it, and hashed on its bytes
  // alone, like a PDF. Some banks name it .csv, so a CSV's contents are looked at first.
  const addOfx = async (fileName, data) => {
    const statement = readOfxStatement(ofxText(data), { fileName });
    if (statement.unknownOfx) problems.push(`${fileName}: no bank or card statement was found in this download.`);
    else statements.push({ ...statement, sha256: await fingerprint('download.ofx', data) });
  };
  const addCsv = async (fileName, data) => {
    const statement = readCsvStatement(new TextDecoder().decode(data), { fileName });
    if (statement.unknownCsv) problems.push(`${fileName}: this CSV isn’t one WaffleWealth reads yet. Wise statements in CSV are.`);
    else statements.push({ ...statement, sha256: await fingerprint(fileName, data) });
  };
  try {
    if (kind === 'ofx') await addOfx(name, bytes);
    else if (kind === 'csv' && looksLikeOfx(new TextDecoder().decode(bytes.subarray(0, 4096)))) await addOfx(name, bytes);
    else if (kind === 'csv') await addCsv(name, bytes);
    else if (kind === 'zip') {
      const inside = (await unzip(bytes)).filter((f) => kindOf(f.name) === 'csv');
      if (!inside.length) problems.push('There are no CSV files in this zip.');
      for (const f of inside) await addCsv(f.name, f.bytes);
    } else {
      // PDF.js takes the buffer over, so it gets a copy; the fingerprint is of the bytes as given.
      const sha256 = await fingerprint(name, bytes);
      const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
      const statement = readStatement(await pagesFromPdf(pdf), { fileName: name });
      await pdf.destroy();
      if (statement.picture) problems.push('This PDF is pictures of its pages, with no text in it. Open WaffleWealth on your iPhone and read it there: the iPhone can read pictures.');
      else if (!statement.accounts.length) problems.push('No accounts or lines were found in it. If it’s from your bank, its layout is one WaffleWealth can’t read yet: read it on your iPhone, or add the balance by hand.');
      else statements.push({ ...statement, sha256 });
    }
  } catch (error) {
    problems.push(error?.name === 'PasswordException'
      ? 'This PDF has a password. Open it, save a copy without the password, and upload that copy.'
      : 'This file couldn’t be opened as a statement.');
  }
  labelLines(statements);
  return { statements, problems };
}
