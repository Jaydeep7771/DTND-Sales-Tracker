import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card } from "@/components/ui";
import { getCurrentUser, getStatement } from "@/lib/data";
import { exportHref } from "@/lib/export-links";
import { money, num, shortDate } from "@/lib/format";
import { businessDate } from "@/lib/accounting";
import { amountDue } from "@/lib/statements";
import { BUCKET_LABEL, BUCKET_ORDER } from "@/lib/receivables";

export const dynamic = "force-dynamic";

/**
 * The customer's own statement, on screen.
 *
 * Same figures as the PDF we email, from the same builder, so the two
 * can never disagree — which matters, because the whole point of a
 * statement is that both sides are looking at the same thing.
 */
export default async function PortalStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const to = sp.to || businessDate();
  const d = new Date(`${to}T00:00:00Z`);
  const from = sp.from || new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 1)).toISOString().slice(0, 10);

  const s = await getStatement(user.id, from, to);
  if (!s) redirect("/portal");

  const due = amountDue(s);
  const overdue = BUCKET_ORDER.filter((b) => b !== "current").reduce((a, b) => a + s.aging[b], 0);

  // Three ranges, because a buyer reconciling wants either "since I last
  // paid" or "the quarter", never an arbitrary slider.
  const ranges: [string, string][] = [
    ["Last 3 months", `?from=${new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 1)).toISOString().slice(0, 10)}&to=${to}`],
    ["Last 6 months", `?from=${new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 5, 1)).toISOString().slice(0, 10)}&to=${to}`],
    ["Last 12 months", `?from=${new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 11, 1)).toISOString().slice(0, 10)}&to=${to}`],
  ];

  return (
    <div className="flex flex-col gap-5 max-w-[960px]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-.01em]">Account statement</h1>
          <div className="text-[13px] text-slate mt-1">
            {shortDate(s.from)} to {shortDate(s.to)} · every invoice, payment and credit on your account.
          </div>
        </div>
        <div className="flex gap-2">
          <a href={exportHref("statement", { from, to })}>
            <Button variant="secondary">CSV</Button>
          </a>
          <a href={`/api/statements/${user.id}/pdf?from=${from}&to=${to}`} target="_blank" rel="noreferrer">
            <Button>Download PDF</Button>
          </a>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {ranges.map(([label, href]) => (
          <Link key={label} href={`/portal/statement${href}`} className="text-[12.5px] rounded-full px-3 py-1.5 border border-border bg-surface text-slate-dark no-underline hover:border-accent">
            {label}
          </Link>
        ))}
      </div>

      <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <Figure label="Opening balance" value={money(s.opening)} />
        <Figure label="Invoiced in period" value={money(s.totals.debits)} />
        <Figure label="Paid and credited" value={money(s.totals.credits)} />
        <Figure label="Amount due" value={money(due)} tone={due > 0.5 ? "strong" : undefined} />
      </div>

      {overdue > 0.5 && (
        <Card className="p-4 bg-danger-bg border-danger-bd">
          <div className="text-[13px] text-danger">
            <strong className="font-semibold">{money(overdue)} is past its due date.</strong>{" "}
            The breakdown by age is below. If any of it is in dispute, tell us and we will hold it.
          </div>
        </Card>
      )}

      {s.advance > 0.5 && (
        <Card className="p-4 bg-success-bg border-success-bd">
          <div className="text-[13px] text-success">
            <strong className="font-semibold">{money(s.advance)} held on account.</strong>{" "}
            This is already deducted from the amount due and will be applied to your next invoice.
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] border-collapse min-w-[620px]">
            <thead>
              <tr className="bg-surface-soft text-left text-[11px] uppercase tracking-wide text-slate">
                <th className="px-4 py-2 font-semibold">Date</th>
                <th className="px-4 py-2 font-semibold">Reference</th>
                <th className="px-4 py-2 font-semibold">Description</th>
                <th className="px-4 py-2 font-semibold text-right">Charges</th>
                <th className="px-4 py-2 font-semibold text-right">Payments</th>
                <th className="px-4 py-2 font-semibold text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border-soft">
                <td className="px-4 py-2.5" colSpan={3}><span className="font-medium">Balance brought forward</span></td>
                <td /><td />
                <td className="px-4 py-2.5 text-right font-mono font-semibold">{money(s.opening)}</td>
              </tr>
              {s.lines.map((l) => (
                <tr key={l.id} className="border-t border-border-soft">
                  <td className="px-4 py-2.5 font-mono text-[12px] whitespace-nowrap">{shortDate(l.date)}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px]">{l.entry_no}</td>
                  <td className="px-4 py-2.5">{l.description}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{l.debit ? money(l.debit) : ""}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-success">{l.credit ? money(l.credit) : ""}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{money(l.balance)}</td>
                </tr>
              ))}
              {s.lines.length === 0 && (
                <tr className="border-t border-border-soft">
                  <td colSpan={6} className="px-4 py-8 text-center text-slate">No movement in this period.</td>
                </tr>
              )}
              <tr className="border-t border-ink">
                <td className="px-4 py-2.5 font-semibold" colSpan={3}>Closing balance</td>
                <td className="px-4 py-2.5 text-right font-mono">{money(s.totals.debits)}</td>
                <td className="px-4 py-2.5 text-right font-mono">{money(s.totals.credits)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-[15px] font-semibold">{money(s.closing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-sm font-semibold">Age of what is outstanding</div>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${BUCKET_ORDER.length}, minmax(0, 1fr))` }}>
          {BUCKET_ORDER.map((b) => (
            <div key={b} className="px-4 py-3 border-r border-border-soft last:border-0">
              <div className="label">{BUCKET_LABEL[b]}</div>
              <div className={`font-mono text-[15px] font-semibold mt-1 ${b !== "current" && s.aging[b] > 0 ? "text-danger" : ""}`}>
                {money(s.aging[b])}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {s.openItems.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold">Invoices still open</span>
            <Badge tone="info">{num(s.openItems.length)}</Badge>
          </div>
          {s.openItems.map((i) => (
            <div key={i.number} className="px-4 py-2.5 border-b border-border-soft last:border-0 flex justify-between items-center gap-3 text-[13px]">
              <div>
                <span className="font-mono font-semibold">{i.number}</span>
                <span className="text-slate ml-2 text-[12px]">
                  {shortDate(i.date)}{i.due && <> · due {shortDate(i.due)}</>}
                </span>
              </div>
              <span className="font-mono font-semibold">{money(i.balance)}</span>
            </div>
          ))}
        </Card>
      )}

      <div className="text-[12px] text-slate">
        This is your account as at {shortDate(s.to)}. If anything does not agree with your own
        records, tell us within seven days and we will reconcile it with you.{" "}
        <Link href="/portal/invoices">Every invoice is here</Link>.
      </div>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "strong" }) {
  return (
    <Card className="p-4">
      <div className="label">{label}</div>
      <div className={`font-mono text-[20px] font-semibold mt-1 ${tone === "strong" ? "text-ink" : "text-slate-dark"}`}>{value}</div>
    </Card>
  );
}
