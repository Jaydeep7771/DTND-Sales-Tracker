/**
 * Handing the books to someone else's software.
 *
 * Two targets, two formats, because they genuinely want different
 * things:
 *
 *   * Tally imports XML. Its unit of work is a voucher with a ledger
 *     entry per line, where a positive AMOUNT is a credit and a negative
 *     one is a debit — the opposite of the convention everywhere else in
 *     this codebase, which is exactly the sort of detail that makes a
 *     hand-built import silently post backwards.
 *   * QuickBooks imports a journal as CSV, one row per line, with the
 *     journal number repeated down the rows that belong together. Both
 *     Online and Desktop read this shape.
 *
 * Neither export invents anything. Both are the same journal the ledger
 * already holds, which means a reconciliation between this system and
 * theirs is possible rather than aspirational.
 */
import { csvFile, xmlEscape, type CsvValue } from "@/lib/csv";

export interface ExportEntry {
  entry_no: string;
  entry_date: string;      // YYYY-MM-DD
  narration: string;
  lines: {
    code: string;
    name: string;
    debit: number;
    credit: number;
    party_name: string | null;
    memo: string | null;
  }[];
}

// ------------------------------------------------------------------ Tally
/** Tally wants DDMMYYYY with no separators. */
function tallyDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}${m}${y}`;
}

/**
 * A Tally import file.
 *
 * Everything goes in as a Journal voucher rather than as Sales or
 * Purchase vouchers. That is deliberate: a Sales voucher in Tally also
 * wants inventory, godowns and a stock item master to post against, and
 * guessing at those would create a stock ledger over there that disagrees
 * with the one over here. A journal carries the money correctly and
 * leaves stock where it is actually maintained.
 *
 * Ledger names are "code name" so they are unique and sort the same way
 * they do here. Tally will create any it does not recognise.
 */
export function toTallyXml(entries: ExportEntry[], companyName: string): string {
  const vouchers = entries.map((e) => {
    const lines = e.lines
      .map((l) => {
        // Tally's sign convention: credit positive, debit negative.
        const amount = l.credit - l.debit;
        return `
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${xmlEscape(`${l.code} ${l.name}`)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${amount < 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
          <AMOUNT>${amount.toFixed(2)}</AMOUNT>
          ${l.party_name ? `<PARTYLEDGERNAME>${xmlEscape(l.party_name)}</PARTYLEDGERNAME>` : ""}
          ${l.memo ? `<NARRATION>${xmlEscape(l.memo)}</NARRATION>` : ""}
        </ALLLEDGERENTRIES.LIST>`;
      })
      .join("");

    return `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View">
        <DATE>${tallyDate(e.entry_date)}</DATE>
        <EFFECTIVEDATE>${tallyDate(e.entry_date)}</EFFECTIVEDATE>
        <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
        <VOUCHERNUMBER>${xmlEscape(e.entry_no)}</VOUCHERNUMBER>
        <NARRATION>${xmlEscape(e.narration)}</NARRATION>
        <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>${lines}
      </VOUCHER>
    </TALLYMESSAGE>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${xmlEscape(companyName)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>${vouchers.join("")}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
`;
}

// ------------------------------------------------------------ QuickBooks
/** QuickBooks reads DD/MM/YYYY or MM/DD/YYYY by locale; it is told which on import. */
function qbDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * A QuickBooks journal-entry import.
 *
 * One row per ledger line. The journal number repeats down every row of
 * the same entry, which is how QuickBooks groups them; a blank in that
 * column would start a new journal, so it is written on every row even
 * though it looks redundant.
 *
 * Debit and credit go in separate columns and only one is filled. Putting
 * a zero in the other makes QuickBooks reject the row.
 */
export function toQuickBooksCsv(entries: ExportEntry[], meta: { company: string; from: string; to: string }): string {
  const rows: CsvValue[][] = [];
  for (const e of entries) {
    for (const l of e.lines) {
      rows.push([
        qbDate(e.entry_date),
        e.entry_no,
        `${l.code} ${l.name}`,
        l.debit > 0 ? l.debit : "",
        l.credit > 0 ? l.credit : "",
        l.memo || e.narration,
        l.party_name ?? "",
      ]);
    }
  }

  return csvFile({
    preamble: [
      [meta.company],
      ["General journal export"],
      [`Period`, meta.from, "to", meta.to],
      ["Dates are DD/MM/YYYY"],
    ],
    header: ["*JournalDate", "*JournalNo", "*AccountName", "Debits", "Credits", "Description", "Name"],
    rows,
  });
}

/**
 * The chart of accounts on its own.
 *
 * Imported before the journal, so QuickBooks has somewhere to put each
 * line instead of creating thirty accounts of its own guessing.
 */
export function toQuickBooksAccountsCsv(
  accounts: { code: string; name: string; type: string; is_group: boolean }[],
  company: string,
): string {
  // QuickBooks' own account-type vocabulary. Mapping to it beats sending
  // ours and letting the importer guess.
  const TYPE: Record<string, string> = {
    asset: "Other Current Assets",
    liability: "Other Current Liabilities",
    equity: "Equity",
    income: "Income",
    expense: "Expenses",
  };

  return csvFile({
    preamble: [[company], ["Chart of accounts"]],
    header: ["Account Number", "Account Name", "Type", "Detail Type"],
    rows: accounts
      .filter((a) => !a.is_group)
      .map((a) => [a.code, `${a.code} ${a.name}`, TYPE[a.type] ?? "Other Current Assets", ""]),
  });
}
