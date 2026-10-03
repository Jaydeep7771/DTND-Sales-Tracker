"use client";

/**
 * Record a receipt from a customer and allocate it across their open
 * invoices. Defaults to oldest first, which is how a lump sum is normally
 * applied, and shows what is still unallocated as you type.
 */
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Modal, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { recordReceipt } from "@/lib/invoice-actions";
import { allocateOldestFirst, businessDate, round2, type PaymentMethod } from "@/lib/accounting";
import { money, shortDate } from "@/lib/format";
import type { InvoiceView } from "@/lib/types";

const METHODS: [PaymentMethod, string][] = [
  ["bank_transfer", "Bank transfer"],
  ["cheque", "Cheque"],
  ["cash", "Cash"],
  ["online", "Online"],
  ["adjustment", "Adjustment"],
];
const NEEDS_REFERENCE: PaymentMethod[] = ["bank_transfer", "cheque", "online"];

export default function RecordReceiptModal({
  customerId, customerName, openInvoices, focusInvoiceId, onClose,
}: {
  customerId: string;
  customerName: string;
  openInvoices: InvoiceView[];
  focusInvoiceId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Opening from one invoice pre-fills that invoice's balance.
  const focus = focusInvoiceId ? openInvoices.find((i) => i.id === focusInvoiceId) : undefined;
  const [amount, setAmount] = useState<number>(focus ? focus.balance : 0);
  const [receivedOn, setReceivedOn] = useState(businessDate());
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  // Tax the customer deducted at source. It settles the invoice without
  // arriving as cash, so it counts towards what can be allocated.
  const [withholding, setWithholding] = useState("");
  const [holdAsAdvance, setHoldAsAdvance] = useState(false);
  const [alloc, setAlloc] = useState<Record<string, number>>(
    () => (focus ? { [focus.id]: focus.balance } : allocateOldestFirst(openInvoices, 0)),
  );

  const allocated = useMemo(() => round2(Object.values(alloc).reduce((a, b) => a + (b || 0), 0)), [alloc]);
  const wht = round2(Number(withholding) || 0);
  const settleable = round2(amount + wht);
  const unallocated = round2(settleable - allocated);
  const over = unallocated < -0.005;
  const balanced = allocated > 0 && !over && (Math.abs(unallocated) < 0.005 || holdAsAdvance);

  function autoAllocate(next = round2(amount + (Number(withholding) || 0))) {
    setAlloc(allocateOldestFirst(openInvoices, next));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await recordReceipt({
        customerId, amount, received_on: receivedOn, method, reference, note,
        allocations: Object.entries(alloc).map(([invoice_id, a]) => ({ invoice_id, amount: a })),
        withholding: wht,
        allowAdvance: holdAsAdvance,
      });
      if (!res.ok) return setError(res.error);
      toast.push(`Receipt of ${money(res.data!.allocated)} recorded for ${customerName}`, "success");
      if (res.data!.advance > 0) toast.push(`${money(res.data!.advance)} held on account.`, "info");
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal
      title={`Record receipt from ${customerName}`}
      sub="Posts to the ledger and settles the invoices you allocate it against."
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="receipt" disabled={busy || !balanced}>{busy ? "Recording…" : "Record receipt"}</Button>
        </>
      }
    >
      <form id="receipt" onSubmit={submit} className="p-5 flex flex-col gap-4">
        {error && <p role="alert" className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}

        <div className="grid gap-3.5 grid-cols-2 md:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="label">Amount received</span>
            <Input
              mono type="number" min="0" step="0.01" required autoFocus
              value={amount || ""}
              onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0); setAmount(v); autoAllocate(round2(v + (Number(withholding) || 0))); }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">Received on</span>
            <Input type="date" required max={businessDate()} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">Method</span>
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">Tax withheld</span>
            <Input
              mono type="number" min="0" step="0.01"
              value={withholding}
              onChange={(e) => setWithholding(e.target.value)}
              placeholder="0"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">Reference{NEEDS_REFERENCE.includes(method) ? "" : " (optional)"}</span>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={method === "cheque" ? "Cheque no." : "Bank ref."}
              required={NEEDS_REFERENCE.includes(method)}
            />
          </label>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="label">Allocate to invoices</span>
            <button type="button" onClick={() => autoAllocate()} className="text-[11.5px] text-navy-hover bg-transparent border-0 cursor-pointer">
              Auto-allocate oldest first
            </button>
          </div>

          {openInvoices.length === 0 ? (
            <div className="border border-border rounded-lg px-3 py-6 text-center text-[13px] text-slate">
              This customer has nothing outstanding.
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-x-auto">
              <table className="w-full border-collapse min-w-[520px]">
                <thead>
                  <tr className="bg-surface-soft">
                    <th className="th">Invoice</th>
                    <th className="th">Due</th>
                    <th className="th th-r">Outstanding</th>
                    <th className="th th-r w-[150px]">Allocate</th>
                  </tr>
                </thead>
                <tbody>
                  {openInvoices.map((i) => {
                    const overdue = i.settlement === "overdue";
                    return (
                      <tr key={i.id} className="border-t border-border-soft">
                        <td className="td font-mono text-[12.5px] text-navy-hover whitespace-nowrap">{i.invoice_number}</td>
                        <td className={`td text-[12.5px] whitespace-nowrap ${overdue ? "text-danger font-semibold" : "text-slate-strong"}`}>
                          {i.due_date ? shortDate(i.due_date) : "—"}{overdue ? " · overdue" : ""}
                        </td>
                        <td className="td font-mono text-right whitespace-nowrap">{money(i.balance)}</td>
                        <td className="td text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setAlloc((s) => ({ ...s, [i.id]: i.balance }))}
                              className="text-[11px] text-navy-hover bg-transparent border-0 cursor-pointer whitespace-nowrap"
                            >
                              full
                            </button>
                            <Input
                              mono type="number" min="0" step="0.01"
                              aria-label={`Allocate to ${i.invoice_number}`}
                              value={alloc[i.id] ?? ""}
                              onChange={(e) => setAlloc((s) => ({ ...s, [i.id]: Math.max(0, Number(e.target.value) || 0) }))}
                              className="w-[110px] text-right py-1.5"
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className={`mt-2.5 rounded-lg border px-3 py-2 text-[12.5px] flex items-center justify-between gap-3 ${
            balanced ? "bg-success-bg border-success-bd text-success"
              : over ? "bg-danger-bg border-danger-bd text-danger"
              : "bg-warning-bg border-warning-bd text-warning"}`}>
            <span>
              {over ? `Over-allocated by ${money(Math.abs(unallocated))}.`
                : Math.abs(unallocated) < 0.005 ? "Fully allocated."
                : holdAsAdvance ? `${money(unallocated)} will be held on account.`
                : `${money(unallocated)} still unallocated.`}
            </span>
            <span className="font-mono">
              {money(allocated)} of {money(settleable)}
              {wht > 0 && <span className="opacity-70"> (incl. {money(wht)} withheld)</span>}
            </span>
          </div>

          {/* Offered only when there is a surplus, so it cannot be left on
              by accident and quietly swallow a mis-keyed amount. */}
          {unallocated > 0.005 && !over && (
            <label className="mt-2 flex items-start gap-2.5 text-[12.5px] text-slate-dark cursor-pointer">
              <input
                type="checkbox"
                checked={holdAsAdvance}
                onChange={(e) => setHoldAsAdvance(e.target.checked)}
                className="accent-accent w-4 h-4 mt-0.5"
              />
              <span>
                Hold {money(unallocated)} on account as an advance.
                <span className="block text-[11.5px] text-slate mt-0.5">
                  Posts to Advances from Customers, a liability, and can be applied to a future invoice.
                </span>
              </span>
            </label>
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="label">Note (optional)</span>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Cheque banked 22 Sept, clears in 3 days." />
        </label>
      </form>
    </Modal>
  );
}
