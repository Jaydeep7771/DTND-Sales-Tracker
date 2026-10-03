import Link from "next/link";
import { Badge, Card, PageHeading } from "@/components/ui";
import { getCompanySettings, getTrialBalance } from "@/lib/data";
import { requirePage } from "@/lib/guard";
import { buildBalanceSheet, buildProfitAndLoss, fiscalYearRange, monthRange, type StatementSection } from "@/lib/reports";
import { money, shortDate } from "@/lib/format";
import { businessDate } from "@/lib/accounting";

type RangeKey = "month" | "year" | "all";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "year", label: "This fiscal year" },
  { key: "all", label: "Everything" },
];

function SectionRows({ section, negate = false }: { section: StatementSection; negate?: boolean }) {
  if (section.lines.length === 0) {
    return (
      <tr>
        <td colSpan={2} className="px-5 py-2.5 text-[12.5px] text-muted">Nothing posted</td>
      </tr>
    );
  }
  return (
    <>
      {section.lines.map((l) => (
        <tr key={l.code + l.name} className="border-t border-border-soft">
          <td className="px-5 py-2 text-[13px]">
            {l.code && <span className="font-mono text-[11.5px] text-slate mr-2">{l.code}</span>}
            {l.name}
          </td>
          <td className="px-5 py-2 text-right font-mono text-[12.5px]">
            {money(negate ? -l.amount : l.amount)}
          </td>
        </tr>
      ))}
    </>
  );
}

function SectionHead({ title }: { title: string }) {
  return (
    <tr className="bg-surface-softer border-t border-border">
      <td colSpan={2} className="px-5 py-2 label">{title}</td>
    </tr>
  );
}

function TotalRow({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <tr className={`border-t ${strong ? "border-ink" : "border-border"}`}>
      <td className={`px-5 py-2.5 text-[13px] ${strong ? "font-semibold" : "font-medium"}`}>{label}</td>
      <td className={`px-5 py-2.5 text-right font-mono ${strong ? "text-[14px] font-semibold" : "text-[13px] font-medium"}`}>
        {money(value)}
      </td>
    </tr>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requirePage("report:read");
  const { range } = await searchParams;
  const key: RangeKey = range === "month" || range === "all" ? range : "year";

  const settings = await getCompanySettings();
  const fy = fiscalYearRange(new Date(), settings.fiscal_year_start_month);
  const period =
    key === "month" ? monthRange()
    // "Everything" still ends today: a balance sheet as at a future date
    // is meaningless, and a P&L to 2999 invites a backdating mistake.
    : key === "all" ? { from: "1900-01-01", to: businessDate() }
    : fy;

  // The P&L covers the chosen period. The balance sheet is always
  // cumulative up to its end date, because a balance is a position, not a
  // flow: "cash in October" is meaningless, "cash on 31 October" is not.
  const [periodBalances, cumulativeBalances] = await Promise.all([
    getTrialBalance({ from: period.from, to: period.to }),
    getTrialBalance({ to: period.to }),
  ]);

  const pl = buildProfitAndLoss(periodBalances, period);
  const cumulativePl = buildProfitAndLoss(cumulativeBalances, { from: "1900-01-01", to: period.to });
  const bs = buildBalanceSheet(cumulativeBalances, period.to, cumulativePl.netProfit);

  const label =
    key === "month" ? `${shortDate(period.from)} to ${shortDate(period.to)}`
    : key === "all" ? "All time"
    : `Fiscal year ${shortDate(fy.from)} to ${shortDate(fy.to)}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        eyebrow="Reports"
        title="Profit and loss, balance sheet"
        sub={`${label} · every figure is a sum of journal lines, so these cannot disagree with the trial balance.`}
        actions={
          <Badge tone={bs.balanced ? "success" : "danger"}>
            {bs.balanced ? "Balance sheet balances" : `Out by ${money(Math.abs(bs.difference))}`}
          </Badge>
        }
      />

      <div className="flex gap-2 flex-wrap">
        {RANGES.map((r) => (
          <Link
            key={r.key}
            href={`/admin/reports?range=${r.key}`}
            className={`text-[12.5px] rounded-full px-3 py-1.5 border no-underline ${
              key === r.key ? "bg-navy text-white border-navy" : "bg-surface text-slate-dark border-border hover:border-muted"
            }`}
          >
            {r.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-5 items-start grid-cols-1 xl:grid-cols-2">
        {/* ------------------------------------------------ profit and loss */}
        <Card className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Profit and loss</div>
              <div className="text-xs text-slate mt-0.5">{label}</div>
            </div>
            {pl.revenue.total > 0 && (
              <Badge tone={pl.netProfit >= 0 ? "success" : "danger"}>
                {pl.grossMarginPct}% gross margin
              </Badge>
            )}
          </div>

          <table className="w-full border-collapse">
            <tbody>
              <SectionHead title="Revenue" />
              <SectionRows section={pl.revenue} />
              <TotalRow label="Total revenue" value={pl.revenue.total} />

              <SectionHead title="Cost of sales" />
              <SectionRows section={pl.costOfSales} />
              <TotalRow label="Gross profit" value={pl.grossProfit} strong />

              <SectionHead title="Operating expenses" />
              <SectionRows section={pl.operatingExpenses} />
              <TotalRow label="Total operating expenses" value={pl.operatingExpenses.total} />

              {pl.otherIncome.lines.length > 0 && (
                <>
                  <SectionHead title="Other income" />
                  <SectionRows section={pl.otherIncome} />
                </>
              )}

              <TotalRow label={pl.netProfit >= 0 ? "Net profit" : "Net loss"} value={pl.netProfit} strong />
            </tbody>
          </table>

          <div className="px-5 py-3 border-t border-border bg-surface-soft text-[11.5px] text-slate leading-relaxed">
            Stock adjustments sit in operating expenses, not cost of sales. Shrinkage and damage are
            not the cost of goods a customer bought, and burying them in cost of sales would make the
            trading margin look worse than it is.
          </div>
        </Card>

        {/* ------------------------------------------------ balance sheet */}
        <Card className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border">
            <div className="text-sm font-semibold">Balance sheet</div>
            <div className="text-xs text-slate mt-0.5">As at {shortDate(period.to)}</div>
          </div>

          <table className="w-full border-collapse">
            <tbody>
              <SectionHead title="Assets" />
              <SectionRows section={bs.assets} />
              <TotalRow label="Total assets" value={bs.totalAssets} strong />

              <SectionHead title="Liabilities" />
              <SectionRows section={bs.liabilities} />
              <TotalRow label="Total liabilities" value={bs.liabilities.total} />

              <SectionHead title="Equity" />
              <SectionRows section={bs.equity} />
              <TotalRow label="Total equity" value={bs.equity.total} />

              <TotalRow label="Liabilities and equity" value={bs.totalLiabilitiesAndEquity} strong />
            </tbody>
          </table>

          <div className={`px-5 py-3 border-t text-[11.5px] leading-relaxed ${
            bs.balanced ? "border-border bg-surface-soft text-slate" : "border-danger-bd bg-danger-bg text-danger"
          }`}>
            {bs.balanced ? (
              <>
                Profit for the period is carried into equity as its own line. Income and expense
                accounts are not closed into retained earnings by this system, so without that line
                the sheet would not balance.
              </>
            ) : (
              <>
                Assets exceed liabilities and equity by {money(Math.abs(bs.difference))}. This should be
                impossible given the ledger enforces balanced entries; check for entries posted outside
                the date range of this report.
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
