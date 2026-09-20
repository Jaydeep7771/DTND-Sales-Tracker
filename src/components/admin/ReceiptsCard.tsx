"use client";

// Receipts received from a customer, with allocation detail and the
// reversal a bounced cheque needs.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Modal, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import RecordReceiptModal from "./RecordReceiptModal";
import { reverseReceipt } from "@/lib/invoice-actions";
import { money, shortDate } from "@/lib/format";
import type { ReceiptView } from "@/lib/data";
import type { InvoiceView } from "@/lib/types";

const METHOD_LABEL: Record<string, string> = {
  bank_transfer: "Bank transfer", cheque: "Cheque", cash: "Cash", online: "Online", adjustment: "Adjustment",
};

export default function ReceiptsCard({
  customerId, customerName, receipts, openInvoices, canRecord,
}: {
  customerId: string;
  customerName: string;
  receipts: ReceiptView[];
  openInvoices: InvoiceView[];
  canRecord: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [recording, setRecording] = useState(false);
  const [reversing, setReversing] = useState<ReceiptView | null>(null);
  const [reason, setReason] = useState("");
  const [busy, start] = useTransition();

  const received = receipts.filter((r) => !r.reversed).reduce((a, r) => a + r.amount, 0);

  return (
    <>
      <Card className="overflow-hidden">
        <div className="px-4 py-3.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Receipts</div>
            <div className="text-xs text-slate mt-0.5">
              {receipts.length === 0 ? "Nothing received yet." : `${money(received)} received across ${receipts.filter((r) => !r.reversed).length} receipt${receipts.filter((r) => !r.reversed).length === 1 ? "" : "s"}.`}
            </div>
          </div>
          {canRecord && (
            <Button size="sm" onClick={() => setRecording(true)} disabled={openInvoices.length === 0}>
              Record receipt
            </Button>
          )}
        </div>

        {receipts.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-slate">
            {openInvoices.length === 0
              ? "Nothing outstanding to receive against."
              : "When money arrives, record it here and allocate it across the open invoices."}
          </div>
        ) : (
          <div className="flex flex-col">
            {receipts.map((r) => (
              <div key={r.entry_id} className={`px-4 py-3 border-t border-border-soft ${r.reversed ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13.5px] font-semibold">{money(r.amount)}</span>
                      <span className="text-[12px] text-slate">{METHOD_LABEL[r.method] ?? r.method}</span>
                      {r.reference && <span className="font-mono text-[11.5px] text-slate">{r.reference}</span>}
                      {r.reversed && <Badge tone="danger">Reversed</Badge>}
                    </div>
                    <div className="text-[11.5px] text-slate mt-1">
                      {shortDate(r.received_on)} · applied to{" "}
                      {r.allocations.map((a) => a.invoice_number ?? "invoice").join(", ")}
                    </div>
                    {r.reversed && r.reversal_reason && (
                      <div className="text-[11.5px] text-danger mt-1">{r.reversal_reason}</div>
                    )}
                    {r.note && !r.reversed && <div className="text-[11.5px] text-slate mt-1">{r.note}</div>}
                  </div>
                  {canRecord && !r.reversed && (
                    <Button variant="destructive" size="sm" onClick={() => { setReversing(r); setReason(""); }} disabled={busy}>
                      Reverse
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {recording && (
        <RecordReceiptModal
          customerId={customerId}
          customerName={customerName}
          openInvoices={openInvoices}
          onClose={() => setRecording(false)}
        />
      )}

      {reversing && (
        <Modal
          title={`Reverse receipt of ${money(reversing.amount)}`}
          sub="Use this for a returned cheque or a receipt entered in error. The ledger gains a mirror entry and the invoices go back to outstanding."
          onClose={() => setReversing(null)}
          footer={
            <>
              <Button variant="secondary" type="button" onClick={() => setReversing(null)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={busy || !reason.trim()}
                onClick={() => start(async () => {
                  const res = await reverseReceipt(reversing.entry_id, reason);
                  if (!res.ok) return toast.push(res.error, "error");
                  toast.push("Receipt reversed", "info");
                  setReversing(null);
                  router.refresh();
                })}
              >
                {busy ? "Reversing…" : "Reverse receipt"}
              </Button>
            </>
          }
        >
          <div className="p-5">
            <label className="flex flex-col gap-1.5">
              <span className="label">Reason</span>
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cheque returned unpaid by the bank." />
            </label>
          </div>
        </Modal>
      )}
    </>
  );
}
