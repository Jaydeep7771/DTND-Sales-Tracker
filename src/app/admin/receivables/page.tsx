import Link from "next/link";
import { Badge, Card, PageHeading } from "@/components/ui";
import { getAging } from "@/lib/data";
import { requirePage } from "@/lib/guard";
import { BUCKET_LABEL, BUCKET_ORDER, type AgeBucket } from "@/lib/receivables";
import { money } from "@/lib/format";

/** Older buckets read hotter, so the eye lands on the money at risk. */
const TONE: Record<AgeBucket, string> = {
  current: "text-slate-strong",
  d1_30: "text-ink",
  d31_60: "text-warning",
  d61_90: "text-warning font-semibold",
  d90_plus: "text-danger font-semibold",
};

export default async function ReceivablesPage() {
  await requirePage("report:read");
  const { rows, totals } = await getAging();

  const overduePct = totals.outstanding > 0 ? Math.round((totals.overdue / totals.outstanding) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        eyebrow="Receivables"
        title="Aged debtors"
        sub="Measured from the due date, so an invoice on Net 60 is not late on day 31."
        actions={
          totals.outstanding > 0 ? (
            <Badge tone={overduePct > 40 ? "danger" : overduePct > 15 ? "warning" : "success"}>
              {overduePct}% overdue
            </Badge>
          ) : undefined
        }
      />

      {/* Totals first: the question is always "how much, and how bad". */}
      <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <Card className="px-4 py-3.5">
          <div className="label">Outstanding</div>
          <div className="text-[22px] font-semibold font-mono mt-1">{money(totals.outstanding)}</div>
          <div className="text-[11.5px] text-slate mt-0.5">{rows.length} customer{rows.length === 1 ? "" : "s"}</div>
        </Card>
        {BUCKET_ORDER.map((b) => (
          <Card key={b} className="px-4 py-3.5">
            <div className="label">{BUCKET_LABEL[b]}</div>
            <div className={`text-[22px] font-semibold font-mono mt-1 ${TONE[b]}`}>{money(totals.buckets[b])}</div>
            <div className="text-[11.5px] text-slate mt-0.5">
              {totals.outstanding > 0 ? Math.round((totals.buckets[b] / totals.outstanding) * 100) : 0}% of the book
            </div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">By customer</div>
            <div className="text-xs text-slate mt-0.5">Worst debt first. Click a row for the account.</div>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-slate">
            Nothing outstanding. Every issued invoice has been settled.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[860px]">
              <thead>
                <tr className="bg-surface-soft">
                  <th className="th px-5">Customer</th>
                  <th className="th th-r px-3">Not yet due</th>
                  <th className="th th-r px-3">1–30</th>
                  <th className="th th-r px-3">31–60</th>
                  <th className="th th-r px-3">61–90</th>
                  <th className="th th-r px-3">90+</th>
                  <th className="th th-r px-5">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const overLimit = r.credit_limit > 0 && r.outstanding > r.credit_limit;
                  return (
                    <tr key={r.customer_id} className="border-t border-border-soft hover:bg-surface-soft">
                      <td className="px-5 py-3">
                        <Link href={`/admin/customers/${r.customer_id}`} className="text-[13.5px] font-medium text-ink hover:text-navy-hover no-underline">
                          {r.company_name}
                        </Link>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-[11.5px] text-slate">
                            {r.open_invoices} invoice{r.open_invoices === 1 ? "" : "s"}
                            {r.worst_days > 0 ? ` · worst ${r.worst_days} days late` : " · within terms"}
                          </span>
                          {r.credit_hold && <Badge tone="danger">On hold</Badge>}
                          {overLimit && <Badge tone="warning">Over limit</Badge>}
                        </div>
                      </td>
                      {BUCKET_ORDER.map((b) => (
                        <td key={b} className={`px-3 py-3 text-right font-mono text-[12.5px] ${r.buckets[b] > 0 ? TONE[b] : "text-muted"}`}>
                          {r.buckets[b] > 0 ? money(r.buckets[b]) : "—"}
                        </td>
                      ))}
                      <td className="px-5 py-3 text-right font-mono text-[13px] font-semibold">{money(r.outstanding)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-surface-soft">
                  <td className="px-5 py-3 text-[12.5px] font-semibold">Total</td>
                  {BUCKET_ORDER.map((b) => (
                    <td key={b} className="px-3 py-3 text-right font-mono text-[12.5px] font-semibold">{money(totals.buckets[b])}</td>
                  ))}
                  <td className="px-5 py-3 text-right font-mono text-[13px] font-semibold">{money(totals.outstanding)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
