"use client";

// Customer side of a sent-back order: proposed lines (editable), the thread,
// and accept / withdraw actions.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Textarea } from "@/components/ui";
import OrderThread from "@/components/OrderThread";
import { replyToOrder, resubmitOrder, withdrawOrder } from "@/lib/actions";
import { money, num } from "@/lib/format";
import type { OrderView } from "@/lib/types";

export default function OrderConversation({ order }: { order: OrderView }) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(order.items.map((l) => [l.id, l.quantity])));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const sentBack = order.status === "changes_requested";
  const open = sentBack || order.status === "pending";

  const subtotal = order.items.reduce((a, l) => a + (qty[l.id] ?? l.quantity) * l.price_at_purchase, 0);

  function resubmit() {
    setError(null);
    start(async () => {
      const res = await resubmitOrder(order.id, qty, note);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }
  function withdraw() {
    if (!confirm("Withdraw this order? Dynamic Traders will be notified.")) return;
    setError(null);
    start(async () => {
      const res = await withdrawOrder(order.id, note);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <Card className="overflow-hidden">
      {sentBack && (
        <div className="px-[18px] py-3 bg-info-bg border-b border-info-bd text-[13px] text-info">
          <strong className="font-semibold">Dynamic Traders sent this order back.</strong> Review their comment and the proposed quantities below, then accept and resubmit, reply with a question, or withdraw the order.
        </div>
      )}

      <div className="p-[18px] grid gap-5 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 flex flex-col gap-3">
          <div className="text-sm font-semibold">{sentBack ? "Proposed order" : "Order lines"}</div>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-surface-soft">
                  <th className="th">Line</th>
                  <th className="th th-r">Unit price</th>
                  <th className="th th-r w-[120px]">Qty</th>
                  <th className="th th-r">Total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((l) => (
                  <tr key={l.id} className="border-b border-border-soft last:border-0">
                    <td className="td font-medium">{l.name}<div className="font-mono text-[11px] text-slate font-normal">{l.sku}</div></td>
                    <td className="td font-mono text-right">{money(l.price_at_purchase)}</td>
                    <td className="td text-right">
                      {sentBack ? (
                        <Input mono type="number" min="0" step="1" value={qty[l.id]} onChange={(e) => setQty((q) => ({ ...q, [l.id]: Math.max(0, Number(e.target.value) || 0) }))} className="w-[100px] text-right py-1.5 ml-auto" />
                      ) : (
                        <span className="font-mono">{num(l.quantity)}</span>
                      )}
                    </td>
                    <td className="td font-mono text-right font-semibold">{money((qty[l.id] ?? l.quantity) * l.price_at_purchase)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-6 text-[13px]">
            <span className="text-slate">Subtotal <span className="font-mono text-ink ml-2">{money(subtotal)}</span></span>
            <span className="text-slate">Total incl. 5% tax <span className="font-mono text-ink font-semibold ml-2">{money(Math.round(subtotal * 1.05))}</span></span>
          </div>

          {sentBack && (
            <div className="flex flex-col gap-2.5 pt-1">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note with your decision, e.g. “Fine, send the 1,200 now and the rest on 28 Sept.”" />
              {error && <div className="text-xs text-danger">{error}</div>}
              <div className="flex gap-2 flex-wrap justify-end">
                <Button variant="destructive" onClick={withdraw} disabled={busy}>Withdraw order</Button>
                <Button variant="success" onClick={resubmit} disabled={busy}>{busy ? "Submitting…" : "Accept & resubmit for approval"}</Button>
              </div>
            </div>
          )}
          {!sentBack && open && (
            <div className="flex justify-end">
              <Button variant="destructive" size="sm" onClick={withdraw} disabled={busy}>Withdraw order</Button>
            </div>
          )}
        </div>

        <div className="min-w-0 border-t lg:border-t-0 lg:border-l border-border pt-4 lg:pt-0 lg:pl-5">
          <OrderThread orderId={order.id} messages={order.messages} me="customer" canReply={open} onReply={replyToOrder} customerName={order.customer.company_name} />
        </div>
      </div>
    </Card>
  );
}
