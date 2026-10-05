import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card } from "@/components/ui";
import { getCurrentUser, getInvoice } from "@/lib/data";
import { money, num, shortDate, shortDateTime } from "@/lib/format";
import { SETTLEMENT_LABEL, type Settlement } from "@/lib/accounting";
import { taxConfig, taxLabel } from "@/lib/money";
import type { BadgeTone } from "@/components/ui";

export const dynamic = "force-dynamic";

const TONE: Record<Settlement, BadgeTone> = {
  draft: "warning", open: "info", part_paid: "info", paid: "success", overdue: "danger", void: "danger",
};

/**
 * One document, on screen rather than as an attachment.
 *
 * Everything shown comes from the frozen snapshot taken at issue, so
 * this page and the PDF say the same thing however the company settings
 * or the customer record have changed since.
 */
export default async function PortalInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const invoice = await getInvoice(id);

  // Ownership is re-checked here as well as by row level security: a
  // guessed id must 404, not render somebody else's billing.
  if (!invoice || invoice.customer.id !== user.id || invoice.status === "draft") notFound();

  const isCredit = invoice.type === "credit_note";
  const isProforma = invoice.type === "proforma";
  const consolidated = !!invoice.period_start;
  const expired = isProforma && !!invoice.valid_until && !invoice.converted_to
    && invoice.valid_until < new Date().toISOString().slice(0, 10);
  const seller = invoice.seller as Record<string, string | null>;
  const payments = invoice.payments.filter((p) => !p.reversed_at);

  return (
    <div className="flex flex-col gap-5 max-w-[900px]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/portal/invoices" className="text-[13px]">← All invoices</Link>
          <h1 className="text-2xl font-semibold tracking-[-.01em] mt-1.5 font-mono">{invoice.invoice_number}</h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {isCredit && <Badge tone="success">Credit note</Badge>}
            {isProforma && <Badge tone="info">Proforma quote</Badge>}
            {isProforma && invoice.converted_to && <Badge tone="success">Invoiced</Badge>}
            {expired && <Badge tone="danger">Expired</Badge>}
            {consolidated && <Badge tone="info">Monthly statement</Badge>}
            {!isCredit && !isProforma && <Badge tone={TONE[invoice.settlement]}>{SETTLEMENT_LABEL[invoice.settlement]}</Badge>}
          </div>
        </div>
        <a href={`/api/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer">
          <Button>Download PDF</Button>
        </a>
      </div>

      {isProforma && (
        <Card className="p-4 bg-info-bg border-info-bd">
          <div className="text-[13px] text-info">
            <strong className="font-semibold">This is a quote, not a bill.</strong>{" "}
            Nothing is owed and nothing has been charged to your account.
            {invoice.valid_until && !expired && <> The price holds until {shortDate(invoice.valid_until)}.</>}
            {expired && <> It expired on {shortDate(invoice.valid_until!)}; ask us for a fresh quote.</>}
          </div>
        </Card>
      )}

      {invoice.status === "void" && (
        <Card className="p-4 bg-danger-bg border-danger-bd">
          <div className="text-[13px] text-danger">
            <strong className="font-semibold">Cancelled.</strong> This document was withdrawn and nothing is owed against it.
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="px-4 py-3.5 grid gap-4 border-b border-border" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
          <Fact label="From" value={seller.name ?? "—"} sub={[seller.address, seller.city].filter(Boolean).join(", ")} />
          <Fact label={isProforma ? "Quoted" : "Issued"} value={invoice.issue_date ? shortDate(invoice.issue_date) : "—"} />
          {consolidated
            ? <Fact label="Period" value={`${shortDate(invoice.period_start!)} – ${shortDate(invoice.period_end!)}`} sub={`${num(invoice.order_numbers.length)} orders`} />
            : <Fact label="Orders" value={invoice.order_numbers.join(", ") || "—"} />}
          {isProforma
            ? <Fact label="Valid until" value={invoice.valid_until ? shortDate(invoice.valid_until) : "—"} />
            : !isCredit && <Fact label="Due" value={invoice.due_date ? shortDate(invoice.due_date) : "—"} sub={`${num(invoice.terms_days)} day terms`} />}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px] border-collapse min-w-[520px]">
            <thead>
              <tr className="bg-surface-soft text-left text-[11px] uppercase tracking-wide text-slate">
                <th className="px-4 py-2 font-semibold">Item</th>
                <th className="px-4 py-2 font-semibold text-right">Qty</th>
                <th className="px-4 py-2 font-semibold text-right">Unit price</th>
                <th className="px-4 py-2 font-semibold text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((l) => (
                <tr key={l.id} className="border-t border-border-soft">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{l.name}</div>
                    <div className="font-mono text-[11px] text-slate">{l.sku} · {l.unit_of_measure}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{num(l.quantity)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{money(l.unit_price)}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold">{money(l.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3.5 border-t border-border flex justify-end">
          <div className="w-full max-w-[280px] flex flex-col gap-1.5 text-[13px]">
            {[
              ["Subtotal", money(invoice.subtotal)],
              ...(invoice.discount ? [["Discount", `-${money(invoice.discount)}`]] : []),
              ...(invoice.freight ? [["Freight", money(invoice.freight)]] : []),
              [taxLabel({ ...taxConfig(), rate: invoice.tax_rate }), money(invoice.tax_amount)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-slate"><span>{k}</span><span className="font-mono text-ink">{v}</span></div>
            ))}
            <div className="flex justify-between items-baseline border-t border-border pt-2 mt-1">
              <span className="font-semibold">Total</span>
              <span className="font-mono text-[20px] font-semibold">{money(invoice.total)}</span>
            </div>
            {invoice.type === "tax_invoice" && invoice.status === "issued" && (
              <>
                {invoice.paid > 0 && (
                  <div className="flex justify-between text-success"><span>Paid</span><span className="font-mono">−{money(invoice.paid)}</span></div>
                )}
                <div className="flex justify-between font-semibold">
                  <span>Balance</span>
                  <span className={`font-mono ${invoice.balance > 0.005 ? "text-danger" : "text-success"}`}>{money(invoice.balance)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {invoice.notes && (
          <div className="px-4 py-3 border-t border-border bg-surface-softer text-[12.5px] text-slate-strong whitespace-pre-line">{invoice.notes}</div>
        )}
      </Card>

      {payments.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-sm font-semibold">Payments received</div>
          {payments.map((p) => (
            <div key={p.id} className="px-4 py-2.5 border-b border-border-soft last:border-0 flex justify-between items-center text-[13px]">
              <span className="text-slate">
                {shortDate(p.paid_on)}
                {p.reference && <span className="font-mono text-[11.5px] ml-2">{p.reference}</span>}
              </span>
              <span className="font-mono font-semibold text-success">{money(Number(p.amount))}</span>
            </div>
          ))}
        </Card>
      )}

      {seller.bank && invoice.type === "tax_invoice" && invoice.balance > 0.005 && (
        <Card className="p-4">
          <div className="label mb-1.5">How to pay</div>
          <div className="text-[13px] whitespace-pre-line">{seller.bank}</div>
          <div className="text-[11.5px] text-slate mt-2">Quote {invoice.invoice_number} as the reference so we can match it.</div>
        </Card>
      )}

      {invoice.sent_at && (
        <div className="text-[11.5px] text-muted">
          Emailed to {invoice.sent_to} on {shortDateTime(invoice.sent_at)}.
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-[13px] font-medium mt-0.5">{value}</div>
      {sub && <div className="text-[11.5px] text-slate mt-0.5">{sub}</div>}
    </div>
  );
}
