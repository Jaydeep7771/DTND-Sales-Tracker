/**
 * CSV, written out properly.
 *
 * CSV rather than XLSX on purpose. Every accountant's tooling opens it,
 * Tally and QuickBooks both ingest it, and it survives being emailed to
 * an auditor who is running something from 2009. XLSX would mean a
 * dependency and a binary format for no gain here.
 *
 * Three details that are easy to get wrong and expensive to get wrong:
 *
 *   * Excel reads a CSV as the machine's ANSI codepage unless the file
 *     opens with a UTF-8 byte order mark. Without it "Rs" survives but a
 *     company name with an accent or an Urdu character does not.
 *   * A field beginning with =, +, - or @ is executed as a formula when
 *     the file is opened. That is CSV injection, and an invoice note is
 *     attacker-controlled text in exactly the place an accountant will
 *     open it. Such fields are prefixed with a tab.
 *   * Numbers are written unformatted and unseparated. A thousands
 *     separator makes the column text, and then it will not sum.
 */

export type CsvValue = string | number | boolean | null | undefined;

/** Characters that make Excel treat a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(v: CsvValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";

  let s = String(v);
  // Neutralise a formula without destroying the text: a leading tab is
  // invisible once the cell is read back and stops evaluation.
  if (FORMULA_START.test(s)) s = "\t" + s;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(values: CsvValue[]): string {
  return values.map(cell).join(",");
}

/**
 * A whole file: optional title lines, a header row and the body.
 *
 * `preamble` carries the things an auditor asks for before they will
 * look at a number — which company, which period, when it was taken.
 * They go above the header rather than in it, so the data block below is
 * still a clean table.
 */
export function csvFile(opts: {
  header: string[];
  rows: CsvValue[][];
  preamble?: string[][];
  /** Appended after a blank line, for totals. */
  footer?: CsvValue[][];
}): string {
  const lines: string[] = [];
  for (const p of opts.preamble ?? []) lines.push(csvRow(p));
  if (opts.preamble?.length) lines.push("");
  lines.push(csvRow(opts.header));
  for (const r of opts.rows) lines.push(csvRow(r));
  if (opts.footer?.length) {
    lines.push("");
    for (const f of opts.footer) lines.push(csvRow(f));
  }
  // CRLF: the line ending every spreadsheet on Windows expects.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** A filename that sorts chronologically and is safe on every platform. */
export function exportFilename(kind: string, range?: { from?: string; to?: string }, ext = "csv"): string {
  const bits = ["dtnd", kind.replace(/[^a-z0-9]+/gi, "-").toLowerCase()];
  if (range?.from) bits.push(range.from);
  if (range?.to && range.to !== range.from) bits.push(range.to);
  return `${bits.join("_")}.${ext}`;
}

/** XML text escaping, for the Tally export. */
export function xmlEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
