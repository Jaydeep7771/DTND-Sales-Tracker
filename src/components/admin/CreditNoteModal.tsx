"use client";

/**
 * Raise a credit note against an issued invoice.
 *
 * Quantities are per line rather than one lump figure, because a credit
 * is nearly always "two cartons came back damaged" and the note has to
 * say which two. A lump sum would also make it impossible to tell what
 * has already been credited.
 */
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Modal, Textarea, Toggle } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { createCreditNote } from "@/lib/credit-notes";
import { computeInvoiceTotals } from "@/lib/accounting";
import { money } from "@/lib/format";
import { taxConfig, taxLabel } from "@/lib/money";
import type { InvoiceView } from "@/lib/types";

export default function CreditNoteModal({
  invoice, creditable, onClose,
}: {
  invoice: InvoiceView;
  /** invoice_item id -> quantity still creditable */
  creditable: Record<string, number>;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [qty, setQty] = useState<Record<string, number>>({});

  const totals = useMemo(
    () =>
      computeInvoiceTotals(
        invoice.items.filter((i) => (qty[i.id] ?? 0) > 0).map((i) => ({ quantity: qty[i.id], unit_price: i.unit_price })),
        0, 0, invoice.tax_rate,
      ),
    [qty, invoice],
  );

  const anything = totals.total > 0;
  const nothingLeft = invoice.items.every((i) => (creditable[i.id] ?? 0) <= 0);

  function creditAll() {
    const next: Record<string, number> = {};
    for (const i of invoice.items) if ((creditable[i.id] ?? 0) > 0) next[i.id] = creditable[i.id];
    setQty(next);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createCreditNote({ invoiceId: invoice.id, quantities: qty, reason, restock });
      if (!res.ok) return setError(res.error);
      toast.push(`${res.data!.number} raised for ${money(res.data!.total)}`, "success");
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal
      title={`Credit note against ${invoice.invoice_number}`}
      sub="The invoice stays as issued and unchanged. The credit is a separate document, applied to the customer's balance immediately."
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="credit-note" disabled={busy || !anything || !reason.trim()}>
            {busy ? "Raising…" : anything ? `Raise credit note for ${money(totals.total)}` : "Raise credit note"}
          </Button>
        </>
      }
    >
      <form id="credit-note" onSubmit={submit} className="p-5 flex flex-col gap-4">
        {error && <p role="alert" className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}

        {nothingLeft ? (
          <p className="rounded-lg bg-info-bg border border-info-bd px-3 py-2.5 text-[13px] text-info">
            Every line on this invoice has already been credited in full.
          </p>
        ) : (
          <>
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="label">What is being credited</span>
                <button type="button" onClick={creditAll} className="text-[11.5px] text-navy-hover bg-transparent border-0 cursor-pointer">
                  Credit everything
                </button>
              </div>

              <div className="border border-border rounded-lg overflow-x-auto">
                <table className="w-full border-collapse min-w-[520px]">
                  <thead>
                    <tr className="bg-surface-soft">
                      <th className="th">Line</th>
                      <th className="th th-r">Invoiced</th>
                      <th className="th th-r">Creditable</th>
                      <th className="th th-r w-[130px]">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.items.map((item) => {
                      const left = creditable[item.id] ?? 0;
                      return (
                        <tr key={item.id} className={`border-t border-border-soft ${left <= 0 ? "opacity-50" : ""}`}>
                          <td className="td">
                            <div className="text-[13px] font-medium">{item.name}</div>
                            <div className="font-mono text-[11px] text-slate mt-0.5">{item.sku} · {money(item.unit_price)} each</div>
                          </td>
                          <td className="td font-mono text-right text-[12.5px]">{item.quantity}</td>
                          <td className="td font-mono text-right text-[12.5px]">{left}</td>
                          <td className="td text-right">
                            <Input
                              mono type="number" min="0" max={left} step="1"
                              aria-label={`Credit quantity for ${item.name}`}
                              disabled={left <= 0}
                              value={qty[item.id] ?? ""}
                              onChange={(e) =>
                                setQty((s) => ({ ...s, [item.id]: Math.max(0, Math.min(left, Number(e.target.value) || 0)) }))
                              }
                              className="w-[100px] text-right py-1.5"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {anything && (
              <div className="rounded-lg border border-border bg-surface-soft px-3.5 py-3 flex flex-col gap-1.5">
                {[
                  ["Goods", money(totals.subtotal)],
                  [taxLabel({ ...taxConfig(), rate: invoice.tax_rate }), money(totals.tax_amount)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-[12.5px] text-slate-dark">
                    <span>{k}</span><span className="font-mono">{v}</span>
                  </div>
                ))}
                <div className="flex justify-between text-[13.5px] font-semibold pt-1.5 border-t border-border">
                  <span>Credit total</span><span className="font-mono">{money(totals.total)}</span>
                </div>
                <div className="text-[11.5px] text-slate mt-1">
                  Tax is credited at the invoice&apos;s {(invoice.tax_rate * 100).toFixed(invoice.tax_rate * 100 % 1 === 0 ? 0 : 2)}% rate,
                  not today&apos;s, so you never hand back tax that was not collected.
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3.5 py-3">
              <div className="min-w-0">
                <div className="text-[13px] font-medium">Goods came back to the warehouse</div>
                <div className="text-[11.5px] text-slate mt-0.5">
                  Puts the stock back and takes its cost out of cost of sales. Leave off for a pricing correction.
                </div>
              </div>
              <Toggle on={restock} label="Returned to stock" onChange={setRestock} />
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="label">Reason</span>
              <Textarea
                rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Two cartons arrived damaged, collected by our driver on 3 Oct."
              />
              <span className="text-[11.5px] text-slate">Prints on the credit note and explains the ledger entry.</span>
            </label>
          </>
        )}
      </form>
    </Modal>
  );
}
