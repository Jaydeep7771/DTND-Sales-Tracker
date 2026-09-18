"use client";

// Order management: split view (queue + detail) or kanban, with
// approve / send back (with comment + adjusted quantities) / reject.
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Modal, OrderBadge, orderLabel, Textarea } from "@/components/ui";
import OrderThread from "@/components/OrderThread";
import { adminReplyToOrder, sendBackOrder, setOrderStatus } from "@/lib/actions";
import { money, num, shortDateTime, shortDate } from "@/lib/format";
import type { OrderView, OrderStatus } from "@/lib/types";

const TONE: Record<OrderStatus, string> = { pending: "#E6A23C", changes_requested: "#2F7DD1", approved: "#2F7DD1", fulfilled: "#0E7A46", rejected: "#B42318", cancelled: "#94A3B8" };
const KANBAN: { status: OrderStatus; cls: string }[] = [
  { status: "pending", cls: "text-warning" },
  { status: "changes_requested", cls: "text-info" },
  { status: "approved", cls: "text-info" },
  { status: "fulfilled", cls: "text-success" },
];

export default function OrdersView({ orders, initialId }: { orders: OrderView[]; initialId?: string }) {
  const router = useRouter();
  const [view, setView] = useState<"split" | "kanban">("split");
  const [selectedId, setSelectedId] = useState(initialId ?? orders[0]?.id);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sendBack, setSendBack] = useState(false);
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
  const count = (s: OrderStatus) => orders.filter((o) => o.status === s).length;
  const isOpen = active && (active.status === "pending" || active.status === "changes_requested");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-.01em]">Order management</h1>
          <div className="text-[13px] text-slate mt-1">
            {count("pending")} pending · {count("changes_requested")} sent back · {count("approved")} approved · {count("fulfilled")} fulfilled
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
        <div className="grid gap-3.5 items-start" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          {KANBAN.map(({ status, cls }) => {
            const col = orders.filter((o) => o.status === status);
            return (
              <div key={status} className="bg-[#eff3f8] border border-border rounded-[10px] p-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-semibold tracking-[.06em] uppercase ${cls}`}>{orderLabel[status]}</span>
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
            <div className="flex flex-col max-h-[640px] overflow-y-auto">
              {orders.map((o) => {
                const on = o.id === active?.id;
                const unread = o.messages.length > 0 && o.messages[o.messages.length - 1].author_role === "customer";
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
                      <span className="flex items-center gap-1.5">
                        {unread && <span title="Customer replied" className="w-2 h-2 rounded-full bg-accent" />}
                        <OrderBadge status={o.status} />
                      </span>
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
                {isOpen && (
                  <>
                    <Button variant="destructive" onClick={() => act("rejected")} disabled={pending}>Reject</Button>
                    <Button variant="secondary" onClick={() => setSendBack(true)} disabled={pending}>Send back with comments</Button>
                    <Button variant="success" onClick={() => act("approved")} disabled={pending}>{pending ? "Saving…" : "Approve order"}</Button>
                  </>
                )}
                {active.status === "approved" && <Button onClick={() => act("fulfilled")} disabled={pending}>Mark fulfilled</Button>}
              </div>
            </div>
            {active.status === "changes_requested" && (
              <div className="mx-4 mt-3 rounded-lg bg-info-bg border border-info-bd px-3 py-2 text-[13px] text-info">Waiting for the customer to accept the proposed changes or reply.</div>
            )}
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
                        <div className="font-mono text-[11px] text-slate">
                          {l.sku} · stock <span className={l.stock < l.quantity ? "text-danger font-semibold" : ""}>{num(l.stock)}</span>
                          {l.stock < l.quantity && <span className="text-danger"> · short by {num(l.quantity - l.stock)}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-[11px] text-right font-mono text-[13px]">{num(l.quantity)}</td>
                      <td className="px-4 py-[11px] text-right font-mono text-[13px]">{money(l.price_at_purchase)}</td>
                      <td className="px-4 py-[11px] text-right font-mono text-[13px] font-semibold">{money(l.quantity * l.price_at_purchase)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3.5 flex justify-end gap-7 bg-surface-soft border-b border-border">
              <div className="text-right">
                <div className="label">Subtotal</div>
                <div className="font-mono text-sm mt-[3px]">{money(active.subtotal)}</div>
              </div>
              <div className="text-right">
                <div className="label">Order total</div>
                <div className="font-mono text-xl font-semibold mt-0.5">{money(active.total)}</div>
              </div>
            </div>

            <div className="p-4">
              <OrderThread orderId={active.id} messages={active.messages} me="admin" canReply onReply={adminReplyToOrder} customerName={active.customer.company_name} />
            </div>
          </Card>
        ) : (
          <Card className="p-8 text-center text-[13px] text-slate">No orders yet.</Card>
        )}
      </div>

      {sendBack && active && <SendBackModal order={active} onClose={() => setSendBack(false)} />}
    </div>
  );
}

function SendBackModal({ order, onClose }: { order: OrderView; onClose: () => void }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(order.items.map((l) => [l.id, l.quantity])));
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const changed = order.items.filter((l) => qty[l.id] !== l.quantity);
  const suggestions = [
    "Some of these items are not available right now.",
    "Only part of the order can be fulfilled at the moment. Can we proceed with the adjusted quantities?",
    "Please confirm the delivery date; we cannot meet the requested date.",
  ];

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await sendBackOrder(order.id, comment, qty);
      if (!res.ok) return setError(res.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal
      title={`Send ${order.order_number} back to ${order.customer.company_name}`}
      sub="The customer sees your comment and any adjusted quantities, and can accept, reply or withdraw."
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="send-back" disabled={busy || !comment.trim()}>{busy ? "Sending…" : "Send back to customer"}</Button>
        </>
      }
    >
      <form id="send-back" onSubmit={submit} className="p-5 flex flex-col gap-4">
        {error && <p className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Field label="Comment to customer">
          <Textarea rows={3} required value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Only half of the Hex Bolts are available this week. Can we proceed with 1,200 now and the rest on 28 Sept?" />
        </Field>
        <div className="flex gap-1.5 flex-wrap">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => setComment((c) => (c ? c + " " : "") + s)} className="border border-border-strong bg-surface text-slate-dark rounded-full px-3 py-1 text-[11.5px] cursor-pointer hover:border-muted">{s.length > 48 ? s.slice(0, 46) + "…" : s}</button>
          ))}
        </div>

        <div>
          <div className="label mb-2">Adjust quantities (optional · set 0 to remove a line)</div>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-surface-soft">
                  <th className="th">Line</th>
                  <th className="th th-r">In stock</th>
                  <th className="th th-r">Requested</th>
                  <th className="th th-r w-[130px]">Available</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((l) => (
                  <tr key={l.id} className="border-b border-border-soft last:border-0">
                    <td className="td font-medium">{l.name}<div className="font-mono text-[11px] text-slate font-normal">{l.sku}</div></td>
                    <td className={`td font-mono text-right ${l.stock < l.quantity ? "text-danger font-semibold" : ""}`}>{num(l.stock)}</td>
                    <td className="td font-mono text-right">{num(l.quantity)}</td>
                    <td className="td text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {l.stock < l.quantity && <button type="button" onClick={() => setQty((q) => ({ ...q, [l.id]: l.stock }))} className="text-[11px] text-navy-hover bg-transparent border-0 cursor-pointer whitespace-nowrap">use stock</button>}
                        <Input mono type="number" min="0" step="1" value={qty[l.id]} onChange={(e) => setQty((q) => ({ ...q, [l.id]: Math.max(0, Number(e.target.value) || 0) }))} className="w-[90px] text-right py-1.5" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {changed.length > 0 && (
            <div className="text-[12px] text-info mt-2">
              {changed.length} line{changed.length === 1 ? "" : "s"} adjusted. The change summary is added to your comment automatically.
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
