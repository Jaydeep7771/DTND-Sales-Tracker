"use client";

// Invoice workspace on the order detail. Finance raises a draft, adjusts
// it for a part shipment, then issues and emails it in one step.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input, Modal, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import {
  createDraftInvoice, discardDraftInvoice, issueAndSendInvoice,
  sendInvoice, updateDraftInvoice, voidInvoice,
} from "@/lib/invoice-actions";
import { computeInvoiceTotals, SETTLEMENT_LABEL, type Settlement } from "@/lib/accounting";
import { money, num, shortDate, shortDateTime } from "@/lib/format";
import type { BadgeTone } from "@/components/ui";
import type { InvoiceView, OrderView } from "@/lib/types";

const TONE: Record<Settlement, BadgeTone> = {
  draft: "warning", open: "info", part_paid: "info", paid: "success", overdue: "danger", void: "danger",
};

export default function InvoicePanel({ order, canInvoice }: { order: OrderView; canInvoice: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const draft = order.invoices.find((i) => i.status === "draft");
  const issued = order.invoices.filter((i) => i.status !== "draft");
  const billable = order.status === "approved" || order.status === "fulfilled";

  function raise() {
    start(async () => {
      const res = await createDraftInvoice(order.id);
      if (!res.ok) return toast.push(res.error, "error");
      toast.push("Draft invoice created", "success");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {draft ? (
        <DraftEditor invoice={draft} canInvoice={canInvoice} />
      ) : (
        <div className="border border-dashed border-border-strong rounded-[10px] p-8 text-center">
          <div className="text-[13.5px] font-medium">
            {issued.length ? "No draft in progress" : "No invoice raised yet"}
          </div>
          <div className="text-[12.5px] text-slate mt-1 max-w-[380px] mx-auto leading-[1.5]">
            {billable
              ? "Raise a draft prefilled with whatever is still uninvoiced on this order. You can reduce quantities before issuing to bill a part shipment."
              : "The order has to be approved before it can be invoiced."}
          </div>
          {canInvoice && billable && (
            <div className="mt-4"><Button onClick={raise} disabled={busy}>{busy ? "Creating…" : "Raise invoice"}</Button></div>
          )}
        </div>
      )}

      {issued.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="label">Issued documents</div>
          {issued.map((inv) => <IssuedInvoice key={inv.id} invoice={inv} canInvoice={canInvoice} />)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- draft
function DraftEditor({ invoice, canInvoice }: { invoice: InvoiceView; canInvoice: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(invoice.items.map((l) => [l.id, l.quantity])));
  const [discount, setDiscount] = useState(invoice.discount);
  const [freight, setFreight] = useState(invoice.freight);
  const [terms, setTerms] = useState(invoice.terms_days);
  const [notes, setNotes] = useState(invoice.notes ?? "");

  // Live totals so the figure never lags the inputs.
  const lines = invoice.items.map((l) => ({ ...l, quantity: qty[l.id] ?? l.quantity })).filter((l) => l.quantity > 0);
  const totals = computeInvoiceTotals(lines, discount, freight, invoice.tax_rate);
  const patch = { quantities: qty, discount, freight, terms_days: terms, notes };

  function save(then?: () => void) {
    start(async () => {
      const res = await updateDraftInvoice(invoice.id, patch);
      if (!res.ok) return toast.push(res.error, "error");
      router.refresh();
      then?.();
    });
  }

  function issueAndSend() {
    start(async () => {
      const saved = await updateDraftInvoice(invoice.id, patch);
      if (!saved.ok) return toast.push(saved.error, "error");
      const res = await issueAndSendInvoice(invoice.id);
      if (!res.ok) return toast.push(res.error, "error");
      const d = res.data!;
      toast.push(
        d.sent ? `${d.invoice_number} issued and emailed to ${d.to}` : `${d.invoice_number} issued. Email not sent: ${d.reason}`,
        d.sent ? "success" : "info",
      );
      router.refresh();
    });
  }

  function discard() {
    start(async () => {
      const res = await discardDraftInvoice(invoice.id);
      if (!res.ok) return toast.push(res.error, "error");
      toast.push("Draft discarded", "info");
      router.refresh();
    });
  }

  return (
    <div className="border border-border rounded-[10px] overflow-hidden">
      <div className="px-4 py-3 bg-warning-bg border-b border-warning-bd flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[12.5px] text-warning">
          <strong className="font-semibold">Draft.</strong> Nothing is numbered or posted to the ledger until you issue it.
        </div>
        <Badge tone="warning">Draft</Badge>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[520px]">
          <thead>
            <tr className="bg-surface-soft">
              <th className="th px-4">Line</th>
              <th className="th th-r px-4">Unit price</th>
              <th className="th th-r px-4 w-[120px]">Qty</th>
              <th className="th th-r px-4">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((l) => {
              const q = qty[l.id] ?? l.quantity;
              return (
                <tr key={l.id} className={`border-t border-border-soft ${q === 0 ? "opacity-45" : ""}`}>
                  <td className="px-4 py-2.5">
                    <div className="text-[13px] font-medium">{l.name}</div>
                    <div className="font-mono text-[11px] text-slate">{l.sku}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-[13px] whitespace-nowrap">{money(l.unit_price)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Input
                      mono type="number" min="0" step="1" disabled={!canInvoice}
                      aria-label={`Quantity for ${l.name}`}
                      value={q}
                      onChange={(e) => setQty((s) => ({ ...s, [l.id]: Math.max(0, Number(e.target.value) || 0) }))}
                      className="w-[100px] text-right py-1.5 ml-auto"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-[13px] font-semibold whitespace-nowrap">{money(q * l.unit_price)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 p-4 border-t border-border grid-cols-1 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="label">Discount</span>
              <Input mono type="number" min="0" step="1" disabled={!canInvoice} value={discount} onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label">Freight</span>
              <Input mono type="number" min="0" step="1" disabled={!canInvoice} value={freight} onChange={(e) => setFreight(Math.max(0, Number(e.target.value) || 0))} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label">Terms (days)</span>
              <Input mono type="number" min="0" step="1" disabled={!canInvoice} value={terms} onChange={(e) => setTerms(Math.max(0, Number(e.target.value) || 0))} />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="label">Note on the invoice</span>
            <Textarea rows={2} disabled={!canInvoice} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Part shipment. Balance of 25 units to follow on 28 Sept." />
          </label>
        </div>

        <div className="flex flex-col gap-1.5 text-[13px]">
          {[
            ["Subtotal", money(totals.subtotal)],
            ...(discount ? [["Discount", `-${money(discount)}`]] : []),
            ...(freight ? [["Freight", money(freight)]] : []),
            [`Sales tax ${(invoice.tax_rate * 100).toFixed(0)}%`, money(totals.tax_amount)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between text-slate"><span>{k}</span><span className="font-mono text-ink">{v}</span></div>
          ))}
          <div className="flex justify-between items-baseline border-t border-border pt-2 mt-1">
            <span className="font-semibold">Total</span>
            <span className="font-mono text-[20px] font-semibold">{money(totals.total)}</span>
          </div>
          <div className="text-[11px] text-muted">{lines.length} of {invoice.items.length} lines billed</div>
        </div>
      </div>

      {canInvoice && (
        <div className="px-4 py-3 border-t border-border bg-surface-softer flex gap-2 flex-wrap justify-end">
          <Button variant="destructive" onClick={discard} disabled={busy}>Discard</Button>
          <Button variant="secondary" onClick={() => save(() => toast.push("Draft saved", "success"))} disabled={busy}>Save draft</Button>
          <Button variant="secondary" onClick={() => save(() => window.open(`/api/invoices/${invoice.id}/pdf`, "_blank"))} disabled={busy}>Preview PDF</Button>
          <Button onClick={issueAndSend} disabled={busy || lines.length === 0}>{busy ? "Working…" : "Issue & email"}</Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- issued
function IssuedInvoice({ invoice, canInvoice }: { invoice: InvoiceView; canInvoice: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");

  function resend() {
    start(async () => {
      const res = await sendInvoice(invoice.id);
      if (!res.ok) return toast.push(res.error, "error");
      toast.push(res.data!.sent ? `Emailed to ${res.data!.to}` : `Not sent: ${res.data!.reason}`, res.data!.sent ? "success" : "info");
    });
  }

  return (
    <div className="border border-border rounded-[10px] overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[14px] font-semibold">{invoice.invoice_number}</span>
            <Badge tone={TONE[invoice.settlement]}>{SETTLEMENT_LABEL[invoice.settlement]}</Badge>
          </div>
          <div className="text-[11.5px] text-slate mt-1">
            Issued {invoice.issued_at ? shortDateTime(invoice.issued_at) : "—"}
            {invoice.due_date && invoice.settlement !== "void" && <> · due {shortDate(invoice.due_date)}</>}
            {" · "}{num(invoice.items.length)} line{invoice.items.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[18px] font-semibold">{money(invoice.total)}</div>
          {invoice.paid > 0 && <div className="text-[11.5px] text-slate">paid {money(invoice.paid)} · balance {money(invoice.balance)}</div>}
        </div>
      </div>
      <div className="px-4 py-2.5 border-t border-border bg-surface-softer flex gap-2 flex-wrap justify-end">
        <a href={`/api/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer">
          <Button variant="secondary" size="sm">Download PDF</Button>
        </a>
        {canInvoice && invoice.status === "issued" && (
          <>
            <Button variant="secondary" size="sm" onClick={resend} disabled={busy}>{busy ? "Sending…" : "Email again"}</Button>
            {invoice.paid === 0 && <Button variant="destructive" size="sm" onClick={() => setVoiding(true)} disabled={busy}>Void</Button>}
          </>
        )}
      </div>

      {voiding && (
        <Modal
          title={`Void ${invoice.invoice_number}`}
          sub="The ledger entry is reversed rather than deleted, so the audit trail stays intact. The number is never reused."
          onClose={() => setVoiding(false)}
          footer={
            <>
              <Button variant="secondary" type="button" onClick={() => setVoiding(false)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={busy || !reason.trim()}
                onClick={() => start(async () => {
                  const res = await voidInvoice(invoice.id, reason);
                  if (!res.ok) return toast.push(res.error, "error");
                  toast.push(`${invoice.invoice_number} voided and reversed`, "info");
                  setVoiding(false);
                  router.refresh();
                })}
              >
                Void invoice
              </Button>
            </>
          }
        >
          <div className="p-5">
            <label className="flex flex-col gap-1.5">
              <span className="label">Reason</span>
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Raised against the wrong order." />
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}
