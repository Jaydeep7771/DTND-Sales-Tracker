import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import { getCurrentUser, getInvoices } from "@/lib/data";
import { money, num, shortDate } from "@/lib/format";
import { SETTLEMENT_LABEL, type Settlement } from "@/lib/accounting";
import type { BadgeTone } from "@/components/ui";
import type { InvoiceView } from "@/lib/types";

export const dynamic = "force-dynamic";

const TONE: Record<Settlement, BadgeTone> = {
  draft: "warning", open: "info", part_paid: "info", paid: "success", overdue: "danger", void: "danger",
};

/**
 * The customer's own copy of everything we have billed them.
 *
 * Until now the emailed PDF was the only copy that existed on their
 * side, so a lost attachment meant asking us to reissue. Drafts are not
 * shown — and cannot be, because row level security hides anything that
 * is not issued — which is right: an unissued document is our working
 * paper, not a bill.
 */
export default async function PortalInvoicesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const invoices = (await getInvoices({ customerId: user.id })).filter((i) => i.status !== "draft");

  const outstanding = invoices
    .filter((i) => i.status === "issued" && i.type === "tax_invoice")
    .reduce((a, i) => a + i.balance, 0);
  const overdue = invoices
    .filter((i) => i.settlement === "overdue")
    .reduce((a, i) => a + i.balance, 0);
  const quotes = invoices.filter((i) => i.type === "proforma" && i.status === "issued" && !i.converted_to);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-.01em]">Invoices</h1>
        <div className="text-[13px] text-slate mt-1">
          Every document we have issued to your account. Each one can be downloaded as a PDF at any time.
        </div>
      </div>

      <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        <Summary label="Outstanding balance" value={money(outstanding)} />
        <Summary label="Of which overdue" value={money(overdue)} tone={overdue > 0.005 ? "danger" : undefined} />
        <Summary label="Documents" value={num(invoices.length)} />
      </div>

      {quotes.length > 0 && (
        <Card className="p-4 bg-info-bg border-info-bd">
          <div className="text-[13px] text-info">
            <strong className="font-semibold">{num(quotes.length)} open quote{quotes.length === 1 ? "" : "s"}.</strong>{" "}
            A proforma is a firm price, not a bill — nothing is owed until we invoice it. Tell us to proceed and we will.
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {invoices.length === 0 && (
          <div className="p-10 text-center">
            <div className="text-[13.5px] font-medium">No invoices yet</div>
            <div className="text-[12.5px] text-slate mt-1">
              Invoices appear here once an order has been approved and billed.{" "}
              <Link href="/portal/orders">Track your orders</Link>.
            </div>
          </div>
        )}
        {invoices.map((i) => <InvoiceRow key={i.id} invoice={i} />)}
      </Card>
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <Card className="p-4">
      <div className="label">{label}</div>
      <div className={`font-mono text-[22px] font-semibold mt-1 ${tone === "danger" ? "text-danger" : ""}`}>{value}</div>
    </Card>
  );
}

function InvoiceRow({ invoice: i }: { invoice: InvoiceView }) {
  const isCredit = i.type === "credit_note";
  const isProforma = i.type === "proforma";
  const consolidated = !!i.period_start;
  const expired = isProforma && !!i.valid_until && !i.converted_to && i.valid_until < new Date().toISOString().slice(0, 10);

  return (
    <div className="px-4 py-3.5 border-b border-border-soft last:border-0 flex items-center gap-3.5 flex-wrap">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/portal/invoices/${i.id}`} className="font-mono text-[14px] font-semibold">{i.invoice_number}</Link>
          {isCredit && <Badge tone="success" className="text-[10.5px]">Credit note</Badge>}
          {isProforma && <Badge tone="info" className="text-[10.5px]">Quote</Badge>}
          {isProforma && i.converted_to && <Badge tone="success" className="text-[10.5px]">Invoiced</Badge>}
          {expired && <Badge tone="danger" className="text-[10.5px]">Expired</Badge>}
          {consolidated && <Badge tone="info" className="text-[10.5px]">Monthly</Badge>}
          {!isCredit && !isProforma && <Badge tone={TONE[i.settlement]} className="text-[10.5px]">{SETTLEMENT_LABEL[i.settlement]}</Badge>}
        </div>
        <div className="text-[11.5px] text-slate mt-1">
          {i.issue_date ? shortDate(i.issue_date) : "—"}
          {consolidated && <> · {shortDate(i.period_start!)} – {shortDate(i.period_end!)}</>}
          {i.order_numbers.length > 0 && <> · {i.order_numbers.join(", ")}</>}
          {!isCredit && !isProforma && i.due_date && i.status === "issued" && <> · due {shortDate(i.due_date)}</>}
          {isProforma && i.valid_until && <> · {expired ? "expired" : "valid until"} {shortDate(i.valid_until)}</>}
        </div>
      </div>

      <div className="text-right">
        <div className={`font-mono text-[16px] font-semibold ${isCredit ? "text-success" : ""}`}>
          {isCredit ? "−" : ""}{money(i.total)}
        </div>
        {i.type === "tax_invoice" && i.status === "issued" && i.balance > 0.005 && (
          <div className="text-[11.5px] text-slate">{money(i.balance)} outstanding</div>
        )}
        {isProforma && <div className="text-[11.5px] text-slate">not a bill</div>}
      </div>

      <a href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer" className="text-[12.5px] font-medium shrink-0">
        PDF
      </a>
    </div>
  );
}
