import { Badge, Card, PageHeading } from "@/components/ui";
import ExportPickers from "@/components/admin/ExportPickers";
import { getAnnexC, getCompanySettings } from "@/lib/data";
import { requirePage } from "@/lib/guard";
import { exportHref } from "@/lib/export-links";
import { money, num, shortDate } from "@/lib/format";
import { businessDate } from "@/lib/accounting";
import { fiscalYearRange } from "@/lib/reports";
import { BUYER_TYPE_LABEL } from "@/lib/fbr";

export const dynamic = "force-dynamic";

interface Group {
  title: string;
  blurb: string;
  items: { kind: string; label: string; note: string; ext?: string }[];
}

const GROUPS: Group[] = [
  {
    title: "Statements",
    blurb: "What an accountant or auditor asks for first. Each is generated from the ledger when you click it, so two downloads of the same period are identical.",
    items: [
      { kind: "profit-and-loss", label: "Profit and loss", note: "With the prior period alongside" },
      { kind: "balance-sheet", label: "Balance sheet", note: "Position at the end date" },
      { kind: "cash-flow", label: "Cash flow", note: "Direct method, proves back to the bank" },
      { kind: "trial-balance", label: "Trial balance", note: "Every account, debits and credits" },
    ],
  },
  {
    title: "Ledgers and registers",
    blurb: "The detail behind the statements. This is what an auditor samples from.",
    items: [
      { kind: "day-book", label: "Day book", note: "Every journal line in the period" },
      { kind: "invoices", label: "Invoice register", note: "Issued, draft and void, with balances" },
      { kind: "purchases", label: "Purchase register", note: "Supplier bills and input tax" },
      { kind: "aged-debtors", label: "Aged debtors", note: "Outstanding by age bucket" },
      { kind: "stock", label: "Stock valuation", note: "On hand, committed and value at cost" },
    ],
  },
  {
    title: "Other accounting software",
    blurb: "The same journal, in the shape each package imports. Nothing is invented, so the two sets of books can be reconciled rather than hoped about.",
    items: [
      { kind: "tally", label: "Tally vouchers", note: "XML import file, journal vouchers", ext: "XML" },
      { kind: "quickbooks", label: "QuickBooks journal", note: "General journal import" },
      { kind: "quickbooks-accounts", label: "QuickBooks chart of accounts", note: "Import this first" },
    ],
  },
];

export default async function ExportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; month?: string }>;
}) {
  await requirePage("report:read");
  const sp = await searchParams;

  const settings = await getCompanySettings();
  const fy = fiscalYearRange(new Date(), settings.fiscal_year_start_month);
  const from = sp.from || fy.from;
  const to = sp.to || businessDate();
  const month = sp.month || businessDate().slice(0, 7);

  const annex = await getAnnexC(month);

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        eyebrow="Data"
        title="Exports and filing"
        sub="Everything in this system can leave it. Reports for your accountant, the journal for Tally or QuickBooks, and the sales tax return data for the FBR portal."
      />

      <ExportPickers from={from} to={to} month={month} />

      {GROUPS.map((g) => (
        <Card key={g.title} className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border">
            <div className="text-sm font-semibold">{g.title}</div>
            <div className="text-xs text-slate mt-1 max-w-[620px] leading-[1.5]">{g.blurb}</div>
          </div>
          <div className="divide-y divide-border-soft">
            {g.items.map((i) => (
              <div key={i.kind} className="px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-[13.5px] font-medium">{i.label}</div>
                  <div className="text-[12px] text-slate mt-0.5">{i.note}</div>
                </div>
                <a
                  href={exportHref(i.kind, { from, to })}
                  className="text-[12.5px] font-medium rounded-[7px] px-3 py-1.5 border border-border bg-surface no-underline hover:border-accent hover:text-navy-hover shrink-0"
                >
                  Download {i.ext ?? "CSV"}
                </a>
              </div>
            ))}
          </div>
        </Card>
      ))}

      {/* ------------------------------------------------------ FBR */}
      <Card className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Sales tax return · Annex-C</div>
            <div className="text-xs text-slate mt-1 max-w-[620px] leading-[1.5]">
              The line-by-line listing of domestic supplies the return actually asks for: buyer
              registration, HS code, rate, value excluding tax and the tax itself. The monthly
              summary tells you what to pay; this is what you upload.
            </div>
          </div>
          <Badge tone={annex.invalid === 0 ? "success" : "danger"}>
            {annex.rows.length === 0
              ? "Nothing in this month"
              : annex.invalid === 0
                ? "Ready to upload"
                : `${num(annex.invalid)} of ${num(annex.rows.length)} rows incomplete`}
          </Badge>
        </div>

        <div className="px-5 py-3.5 grid gap-4 border-b border-border" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <Figure label="Tax period" value={month} />
          <Figure label="Rows" value={num(annex.rows.length)} />
          <Figure label="Value excluding tax" value={money(annex.totals.value)} />
          <Figure label="Output tax" value={money(annex.totals.tax)} />
          {settings.further_tax_enabled && <Figure label="Further tax" value={money(annex.totals.further)} />}
        </div>

        {annex.issues.length > 0 && (
          <div className="px-5 py-3.5 bg-danger-bg border-b border-danger-bd">
            <div className="text-[12.5px] text-danger font-semibold mb-1.5">
              The portal will reject these rows. Fix them here and re-download.
            </div>
            <ul className="text-[12.5px] text-danger flex flex-col gap-1">
              {annex.issues.map((i) => (
                <li key={i.reason}>
                  <span className="font-mono mr-2">{num(i.count)}×</span>{i.reason}
                </li>
              ))}
            </ul>
            <div className="text-[11.5px] text-danger mt-2 opacity-90">
              HS codes are set per product under Inventory. Buyer registration numbers are on each
              customer&apos;s billing details.
            </div>
          </div>
        )}

        {annex.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] border-collapse min-w-[860px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate border-b border-border">
                  <th className="px-5 py-2 font-semibold">Document</th>
                  <th className="px-5 py-2 font-semibold">Buyer</th>
                  <th className="px-5 py-2 font-semibold">Registration</th>
                  <th className="px-5 py-2 font-semibold">HS code</th>
                  <th className="px-5 py-2 font-semibold text-right">Rate</th>
                  <th className="px-5 py-2 font-semibold text-right">Value excl. tax</th>
                  <th className="px-5 py-2 font-semibold text-right">Sales tax</th>
                </tr>
              </thead>
              <tbody>
                {annex.rows.slice(0, 50).map((r, i) => (
                  <tr key={`${r.document_number}-${r.hs_code}-${i}`} className={`border-b border-border-soft ${r.problems.length ? "bg-danger-bg" : ""}`}>
                    <td className="px-5 py-2">
                      <div className="font-mono font-medium">{r.document_number || "—"}</div>
                      <div className="text-[11px] text-slate">{shortDate(r.document_date)} · {r.document_type}</div>
                    </td>
                    <td className="px-5 py-2">
                      <div>{r.buyer_name}</div>
                      <div className="text-[11px] text-slate">{BUYER_TYPE_LABEL[r.buyer_type]}</div>
                    </td>
                    <td className="px-5 py-2 font-mono text-[11.5px]">{r.buyer_registration || <span className="text-danger">missing</span>}</td>
                    <td className="px-5 py-2 font-mono text-[11.5px]">{r.hs_code || <span className="text-danger">missing</span>}</td>
                    <td className="px-5 py-2 text-right font-mono">{r.rate}%</td>
                    <td className="px-5 py-2 text-right font-mono">{money(r.value_excluding_tax)}</td>
                    <td className="px-5 py-2 text-right font-mono">{money(r.sales_tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {annex.rows.length > 50 && (
              <div className="px-5 py-2.5 text-[12px] text-slate border-b border-border-soft">
                Showing the first 50 of {num(annex.rows.length)}. The download has all of them.
              </div>
            )}
          </div>
        )}

        <div className="px-5 py-3 border-t border-border bg-surface-softer flex gap-2 flex-wrap justify-between items-center">
          <span className="text-[11.5px] text-slate">
            A proforma is excluded: nothing has been supplied, so it is not a return item.
            A credit note appears as a negative supply, which is how the return nets it off.
          </span>
          <div className="flex gap-2">
            <a href={exportHref("sales-tax", {})} className="text-[12.5px] font-medium rounded-[7px] px-3 py-1.5 border border-border bg-surface no-underline hover:border-accent">
              Monthly summary
            </a>
            <a href={exportHref("buyer-register", {})} className="text-[12.5px] font-medium rounded-[7px] px-3 py-1.5 border border-border bg-surface no-underline hover:border-accent">
              Buyer register
            </a>
            <a href={exportHref("annex-c", { month })} className="text-[12.5px] font-medium rounded-[7px] px-3 py-1.5 border border-navy bg-navy text-white no-underline hover:bg-navy-hover">
              Download Annex-C
            </a>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="font-mono text-[16px] font-semibold mt-0.5">{value}</div>
    </div>
  );
}
