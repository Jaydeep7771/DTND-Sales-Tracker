"use client";

// Order management: split view (queue + detail) or kanban, with approve/reject.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, OrderBadge, orderLabel } from "@/components/ui";
import { setOrderStatus } from "@/lib/actions";
import { money, num, shortDateTime, shortDate } from "@/lib/format";
import type { OrderView, OrderStatus } from "@/lib/types";

const TONE: Record<OrderStatus, string> = { pending: "#E6A23C", approved: "#2F7DD1", fulfilled: "#0E7A46", rejected: "#B42318" };
const COL_TONE: Record<string, string> = { pending: "text-warning", approved: "text-info", fulfilled: "text-success" };

export default function OrdersView({ orders, initialId }: { orders: OrderView[]; initialId?: string }) {
  const router = useRouter();
  const [view, setView] = useState<"split" | "kanban">("split");
  const [selectedId, setSelectedId] = useState(initialId ?? orders[0]?.id);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const active = orders.find((o) => o.id === selectedId) ?? orders[0];

  function act(status: OrderStatus) {
    if (!active) return;
    setError(null);
    start(async () => {
      const res = await setOrderStatus(active.id, status);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  const summary = (o: OrderView) => `${o.items.length} lines · ${num(o.items.reduce((a, l) => a + l.quantity, 0))} units`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-.01em]">Order management</h1>
          <div className="text-[13px] text-slate mt-1">
            {orders.filter((o) => o.status === "pending").length} pending · {orders.filter((o) => o.status === "approved").length} approved · {orders.filter((o) => o.status === "fulfilled").length} fulfilled
          </div>
        </div>
        <div className="flex border border-border-strong bg-surface rounded-lg overflow-hidden">
          {(["split", "kanban"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`border-0 px-[15px] py-2 text-[12.5px] cursor-pointer ${view === v ? "bg-navy text-white font-semibold" : "bg-surface text-slate-dark font-medium"}`}>
              {v === "split" ? "Split view" : "Kanban"}
            </button>
          ))}
        </div>
      </div>

      {view === "kanban" && (
        <div className="grid gap-3.5 items-start" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {(["pending", "approved", "fulfilled"] as const).map((st) => {
            const col = orders.filter((o) => o.status === st);
            return (
              <div key={st} className="bg-[#eff3f8] border border-border rounded-[10px] p-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-semibold tracking-[.06em] uppercase ${COL_TONE[st]}`}>{orderLabel[st]}</span>
                  <span className="font-mono text-[11px] text-slate bg-surface border border-border rounded-full px-2 py-px">{col.length}</span>
                </div>
                {col.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setSelectedId(o.id)}
                    className="text-left bg-surface border rounded-lg px-3 py-[11px] cursor-pointer flex flex-col gap-1.5 hover:border-accent"
                    style={{ borderColor: o.id === active?.id ? "#2F7DD1" : "#E2E8F0", borderLeft: `3px solid ${TONE[o.status]}` }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-navy-hover">{o.order_number}</span>
                      <span className="font-mono text-[12.5px] font-semibold">{money(o.subtotal)}</span>
                    </div>
                    <div className="text-[13px] font-medium">{o.customer.company_name}</div>
                    <div className="text-[11.5px] text-slate">{summary(o)} · {shortDateTime(o.created_at)}</div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <div className={`grid gap-4 items-start grid-cols-1 ${view === "split" ? "lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]" : ""}`}>
        {view === "split" && (
          <Card className="overflow-hidden">
            <div className="px-3.5 py-3 border-b border-border text-[13px] font-semibold">Order queue</div>
            <div className="flex flex-col max-h-[560px] overflow-y-auto">
              {orders.map((o) => {
                const on = o.id === active?.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setSelectedId(o.id)}
                    className="text-left border-0 border-b border-border-soft px-3.5 py-3 cursor-pointer flex flex-col gap-[5px]"
                    style={{ borderLeft: `3px solid ${on ? "#2F7DD1" : "transparent"}`, background: on ? "#F5F9FD" : "#fff" }}
                  >
                    <div className="flex items-center justify-between gap-2.5">
                      <span className="font-mono text-xs text-navy-hover">{o.order_number}</span>
                      <OrderBadge status={o.status} />
                    </div>
                    <div className="text-[13px] font-medium">{o.customer.company_name}</div>
                    <div className="flex justify-between gap-2 text-[11.5px] text-slate">
                      <span>{summary(o)}</span>
                      <span className="font-mono">{money(o.subtotal)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        {active ? (
          <Card className="overflow-hidden">
            <div className="p-4 border-b border-border flex gap-3.5 flex-wrap items-start justify-between">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-[15px] font-semibold">{active.order_number}</span>
                  <OrderBadge status={active.status} />
                </div>
                <div className="text-base font-semibold mt-1.5">{active.customer.company_name}</div>
                <div className="text-[12.5px] text-slate mt-0.5">{active.customer.email} · placed {shortDateTime(active.created_at)} · Net 30</div>
              </div>
              <div className="flex gap-2 flex-wrap">
                {active.status === "pending" && (
                  <>
                    <Button variant="destructive" onClick={() => act("rejected")} disabled={pending}>Reject</Button>
                    <Button variant="success" onClick={() => act("approved")} disabled={pending}>{pending ? "Saving…" : "Approve order"}</Button>
                  </>
                )}
                {active.status === "approved" && <Button onClick={() => act("fulfilled")} disabled={pending}>Mark fulfilled</Button>}
              </div>
            </div>
            {error && <div className="mx-4 mt-3 rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</div>}

            <div className="p-4 grid gap-3 border-b border-border bg-surface-softer" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
              {[
                ["Payment terms", "Net 30 · PKR"],
                ["Deliver to", active.delivery_address ?? "—"],
                ["Required by", active.required_by ? shortDate(active.required_by) : "—"],
                ["Customer note", active.note ?? "—"],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="label text-[10.5px]">{k}</div>
                  <div className="text-[13.5px] font-medium mt-[3px]">{v}</div>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[520px]">
                <thead>
                  <tr className="bg-surface-soft">
                    <th className="th px-4">Line item</th>
                    <th className="th th-r px-4">Qty</th>
                    <th className="th th-r px-4">Locked price</th>
                    <th className="th th-r px-4">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {active.items.map((l) => (
                    <tr key={l.id} className="border-b border-border-soft">
                      <td className="px-4 py-[11px]">
                        <div className="text-[13px] font-medium">{l.name}</div>
                        <div className="font-mono text-[11px] text-slate">{l.sku} · stock {num(l.stock)}</div>
                      </td>
                      <td className="px-4 py-[11px] text-right font-mono text-[13px]">{num(l.quantity)}</td>
                      <td className="px-4 py-[11px] text-right font-mono text-[13px]">{money(l.price_at_purchase)}</td>
                      <td className="px-4 py-[11px] text-right font-mono text-[13px] font-semibold">{money(l.quantity * l.price_at_purchase)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3.5 flex justify-end gap-7 bg-surface-soft">
              <div className="text-right">
                <div className="label">Subtotal</div>
                <div className="font-mono text-sm mt-[3px]">{money(active.subtotal)}</div>
              </div>
              <div className="text-right">
                <div className="label">Order total</div>
                <div className="font-mono text-xl font-semibold mt-0.5">{money(active.total)}</div>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="p-8 text-center text-[13px] text-slate">No orders yet.</Card>
        )}
      </div>
    </div>
  );
}
