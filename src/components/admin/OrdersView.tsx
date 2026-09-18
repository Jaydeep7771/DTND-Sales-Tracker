"use client";

// Order management: filterable queue + detail (split) or kanban, with
// approve / send back (comment + adjusted quantities) / reject (with reason).
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Field, Input, Modal, OrderBadge, orderLabel, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import OrderThread from "@/components/OrderThread";
import { adminReplyToOrder, rejectOrder, sendBackOrder, setOrderStatus } from "@/lib/actions";
import { hoursSince, money, num, relativeTime, shortDateTime, shortDate } from "@/lib/format";
import type { OrderView, OrderStatus } from "@/lib/types";

const TONE: Record<OrderStatus, string> = { pending: "#E6A23C", changes_requested: "#2F7DD1", approved: "#2F7DD1", fulfilled: "#0E7A46", rejected: "#B42318", cancelled: "#94A3B8" };
const KANBAN: { status: OrderStatus; cls: string }[] = [
  { status: "pending", cls: "text-warning" },
  { status: "changes_requested", cls: "text-info" },
  { status: "approved", cls: "text-info" },
  { status: "fulfilled", cls: "text-success" },
];
type Filter = "open" | OrderStatus | "all";
const FILTERS: [Filter, string][] = [["open", "Needs action"], ["pending", "Pending"], ["changes_requested", "Sent back"], ["approved", "Approved"], ["fulfilled", "Fulfilled"], ["all", "All"]];
const SLA_HOURS = 4;

export default function OrdersView({ orders, initialId }: { orders: OrderView[]; initialId?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [view, setView] = useState<"split" | "kanban">("split");
  const [filter, setFilter] = useState<Filter>((params.get("status") as Filter) || "open");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [selectedId, setSelectedId] = useState<string | undefined>(initialId);
  const [pending, start] = useTransition();
  const [modal, setModal] = useState<"sendBack" | "reject" | null>(null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return orders.filter((o) => {
      const byStatus = filter === "all" ? true : filter === "open" ? o.status === "pending" || o.status === "changes_requested" : o.status === filter;
      const byQ = !term || o.order_number.toLowerCase().includes(term) || o.customer.company_name.toLowerCase().includes(term) || o.items.some((l) => l.sku.toLowerCase().includes(term));
      return byStatus && byQ;
    });
  }, [orders, filter, q]);

  const active = orders.find((o) => o.id === selectedId) ?? filtered[0] ?? orders[0];

  function act(status: OrderStatus, label: string) {
    if (!active) return;
    start(async () => {
      const res = await setOrderStatus(active.id, status);
      if (!res.ok) return toast.push(res.error, "error");
      toast.push(`${active.order_number} ${label}`, "success");
      router.refresh();
    });
  }

  const summary = (o: OrderView) => `${o.items.length} line${o.items.length === 1 ? "" : "s"} · ${num(o.items.reduce((a, l) => a + l.quantity, 0))} units`;
  const count = (s: OrderStatus) => orders.filter((o) => o.status === s).length;
  const overSla = (o: OrderView) => o.status === "pending" && hoursSince(o.created_at) > SLA_HOURS;

  const lastFromCustomer = (o: OrderView) => o.messages.length > 0 && o.messages[o.messages.length - 1].author_role === "customer";
  const openCount = count("pending") + count("changes_requested");

  return (
    <div className="flex flex-col gap-5">
      {/* Page header: title on the left, view toggle on the right. Counts live in the filter, not repeated here. */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-.01em]">Orders</h1>
          <div className="text-[13px] text-slate mt-1">{openCount === 0 ? "Nothing waiting on you." : `${openCount} waiting on you`}{count("approved") ? ` · ${count("approved")} approved to fulfil` : ""}</div>
        </div>
        <div className="flex border border-border bg-surface rounded-lg overflow-hidden" role="tablist" aria-label="View">
          {(["split", "kanban"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`border-0 px-3.5 py-[7px] text-[12.5px] cursor-pointer ${view === v ? "bg-navy text-white font-semibold" : "bg-surface text-slate hover:text-ink"}`}>
              {v === "split" ? "List" : "Board"}
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
                {col.length === 0 && <div className="text-[12px] text-muted py-2 text-center">Nothing here</div>}
                {col.map((o) => (
                  <button key={o.id} type="button" onClick={() => setSelectedId(o.id)} className="text-left bg-surface border rounded-lg px-3 py-[11px] cursor-pointer flex flex-col gap-1.5 hover:border-accent" style={{ borderColor: o.id === active?.id ? "#2F7DD1" : "#E2E8F0", borderLeft: `3px solid ${TONE[o.status]}` }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-navy-hover">{o.order_number}</span>
                      <span className="font-mono text-[12.5px] font-semibold">{money(o.total)}</span>
                    </div>
                    <div className="text-[13px] font-medium">{o.customer.company_name}</div>
                    <div className="text-[11.5px] text-slate">{summary(o)} · {relativeTime(o.created_at)}</div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <div className={`grid gap-5 items-start grid-cols-1 ${view === "split" ? "lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]" : ""}`}>
        {view === "split" && (
          <Card className="overflow-hidden lg:sticky lg:top-[92px]">
            {/* One search box; status as a compact select so the queue never wraps. */}
            <div className="p-3 border-b border-border flex gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search orders" aria-label="Search orders" className="flex-1 min-w-0 border border-border bg-surface-soft rounded-lg px-3 py-2 text-[13px] outline-none focus:border-accent focus:bg-surface" />
              <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Status" className="border border-border bg-surface rounded-lg px-2.5 py-2 text-[12.5px] outline-none text-slate-dark max-w-[150px]">
                {FILTERS.map(([f, label]) => {
                  const n = f === "all" ? orders.length : f === "open" ? openCount : count(f);
                  return <option key={f} value={f}>{label} ({n})</option>;
                })}
              </select>
            </div>
            <div className="flex flex-col max-h-[calc(100vh-200px)] overflow-y-auto">
              {filtered.length === 0 && (
                <div className="px-4 py-10 text-center">
                  <div className="text-[13px] font-medium">No orders here</div>
                  <div className="text-[12px] text-slate mt-1">Try another status or clear the search.</div>
                </div>
              )}
              {filtered.map((o) => {
                const on = o.id === active?.id;
                const late = overSla(o);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setSelectedId(o.id)}
                    aria-current={on ? "true" : undefined}
                    className={`text-left border-0 border-b border-border-soft px-4 py-3 cursor-pointer flex flex-col gap-1 transition-colors ${on ? "bg-[#F5F9FD]" : "bg-surface hover:bg-surface-soft"}`}
                    style={{ boxShadow: on ? "inset 3px 0 0 #2F7DD1" : undefined }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13.5px] font-semibold truncate">{o.customer.company_name}</span>
                      <span className="font-mono text-[13px] font-medium shrink-0">{money(o.total)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-[11.5px] text-slate">
                      <span className="font-mono">{o.order_number}<span className="font-sans"> · {summary(o)}</span></span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {lastFromCustomer(o) && <span title="Customer replied" className="w-1.5 h-1.5 rounded-full bg-accent" />}
                        {late ? <span className="text-danger font-semibold">{relativeTime(o.created_at)}</span> : <span>{relativeTime(o.created_at)}</span>}
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: TONE[o.status] }} title={orderLabel[o.status]} />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        {active ? (
          <OrderDetail
            order={active}
            pending={pending}
            overSla={overSla(active)}
            onApprove={() => act("approved", "approved")}
            onFulfil={() => act("fulfilled", "marked fulfilled")}
            onSendBack={() => setModal("sendBack")}
            onReject={() => setModal("reject")}
          />
        ) : (
          <Card className="p-12 text-center">
            <div className="text-[14px] font-medium">No orders yet</div>
            <div className="text-[12.5px] text-slate mt-1">Orders submitted from the customer portal will appear here for approval.</div>
          </Card>
        )}
      </div>

      {modal === "sendBack" && active && <SendBackModal order={active} onClose={() => setModal(null)} />}
      {modal === "reject" && active && <RejectModal order={active} onClose={() => setModal(null)} />}
    </div>
  );
}

/** Right-hand panel: header with total + actions, then Details / Conversation tabs. */
function OrderDetail({ order, pending, overSla, onApprove, onFulfil, onSendBack, onReject }: {
  order: OrderView; pending: boolean; overSla: boolean;
  onApprove: () => void; onFulfil: () => void; onSendBack: () => void; onReject: () => void;
}) {
  const [tab, setTab] = useState<"details" | "conversation">("details");
  const isOpen = order.status === "pending" || order.status === "changes_requested";
  const unread = order.messages.length > 0 && order.messages[order.messages.length - 1].author_role === "customer";
  const short = order.items.filter((l) => l.stock < l.quantity);

  // Reset to details when a different order is selected.
  const [seenId, setSeenId] = useState(order.id);
  if (seenId !== order.id) { setSeenId(order.id); setTab(unread ? "conversation" : "details"); }

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 flex gap-5 flex-wrap items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-lg font-semibold tracking-[-.01em] truncate">{order.customer.company_name}</h2>
            <OrderBadge status={order.status} />
          </div>
          <div className="text-[12.5px] text-slate mt-1 flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-navy-hover">{order.order_number}</span>
            <span>·</span><span>placed {shortDateTime(order.created_at)}</span>
            <span>·</span><span>{order.customer.email}</span>
            {overSla && <><span>·</span><span className="text-danger font-semibold">waiting {Math.floor(hoursSince(order.created_at))}h, over SLA</span></>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="label">Order total</div>
          <div className="font-mono text-[26px] font-semibold tracking-[-.02em] leading-none mt-1">{money(order.total)}</div>
          <div className="text-[11px] text-muted mt-1">incl. 5% tax · {order.items.length} line{order.items.length === 1 ? "" : "s"}</div>
        </div>
      </div>

      {/* Action bar: one row, primary on the right. */}
      {(isOpen || order.status === "approved") && (
        <div className="px-6 pb-4 flex items-center gap-2 flex-wrap">
          {isOpen && short.length > 0 && (
            <span className="text-[12px] text-warning bg-warning-bg border border-warning-bd rounded-md px-2.5 py-1 mr-auto">
              {short.length === 1 ? "1 line" : `${short.length} lines`} short on stock
            </span>
          )}
          <div className="flex gap-2 ml-auto">
            {isOpen && (
              <>
                <Button variant="destructive" onClick={onReject} disabled={pending}>Reject</Button>
                <Button variant="secondary" onClick={onSendBack} disabled={pending}>Send back</Button>
                <Button variant="success" onClick={onApprove} disabled={pending}>{pending ? "Saving…" : "Approve"}</Button>
              </>
            )}
            {order.status === "approved" && <Button onClick={onFulfil} disabled={pending}>Mark fulfilled</Button>}
          </div>
        </div>
      )}
      {order.status === "changes_requested" && (
        <div className="mx-6 mb-4 rounded-lg bg-info-bg border border-info-bd px-3 py-2 text-[12.5px] text-info">Sent back. Waiting for the customer to accept the proposed changes or reply.</div>
      )}

      {/* Tabs */}
      <div className="px-6 border-b border-border flex gap-6" role="tablist">
        {([["details", "Details"], ["conversation", `Conversation${order.messages.length ? ` · ${order.messages.length}` : ""}`]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`relative bg-transparent border-0 px-0 py-3 text-[13px] cursor-pointer flex items-center gap-1.5 ${tab === id ? "text-ink font-semibold" : "text-slate hover:text-ink"}`}>
            {label}
            {id === "conversation" && unread && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
            {tab === id && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-navy" />}
          </button>
        ))}
      </div>

      {tab === "details" ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[560px]">
              <thead>
                <tr>
                  <th className="th px-6 border-b-0">Line item</th>
                  <th className="th th-r px-6 border-b-0">Qty</th>
                  <th className="th th-r px-6 border-b-0">Unit price</th>
                  <th className="th th-r px-6 border-b-0">Total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((l) => (
                  <tr key={l.id} className="border-t border-border-soft">
                    <td className="px-6 py-3">
                      <div className="text-[13.5px] font-medium">{l.name}</div>
                      <div className="font-mono text-[11px] text-slate mt-0.5">
                        {l.sku}
                        {l.stock < l.quantity ? <span className="text-danger"> · only {num(l.stock)} in stock</span> : <span className="text-muted"> · {num(l.stock)} in stock</span>}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right font-mono text-[13px]">{num(l.quantity)}</td>
                    <td className="px-6 py-3 text-right font-mono text-[13px] text-slate-strong whitespace-nowrap">{money(l.price_at_purchase)}</td>
                    <td className="px-6 py-3 text-right font-mono text-[13px] font-semibold whitespace-nowrap">{money(l.quantity * l.price_at_purchase)}</td>
                  </tr>
                ))}
                <tr className="border-t border-border">
                  <td colSpan={3} className="px-6 py-2.5 text-right text-[12.5px] text-slate">Subtotal</td>
                  <td className="px-6 py-2.5 text-right font-mono text-[13px] whitespace-nowrap">{money(order.subtotal)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="px-6 pb-4 text-right text-[12.5px] text-slate">Sales tax 5%</td>
                  <td className="px-6 pb-4 text-right font-mono text-[13px] whitespace-nowrap">{money(order.total - order.subtotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="px-6 py-4 border-t border-border bg-surface-softer grid gap-x-8 gap-y-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            {[
              ["Deliver to", order.delivery_address ?? "—"],
              ["Required by", order.required_by ? shortDate(order.required_by) : "—"],
              ["Terms", "Net 30 · PKR"],
              ["Customer note", order.note ?? "—"],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0">
                <div className="label text-[10.5px]">{k}</div>
                <div className="text-[13px] mt-1 text-slate-dark">{v}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="px-6 py-5">
          <OrderThread orderId={order.id} messages={order.messages} me="admin" canReply onReply={adminReplyToOrder} customerName={order.customer.company_name} />
        </div>
      )}
    </Card>
  );
}

function RejectModal({ order, onClose }: { order: OrderView; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  function submit(e: FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await rejectOrder(order.id, reason);
      if (!res.ok) return setError(res.error);
      toast.push(`${order.order_number} rejected`, "info");
      router.refresh();
      onClose();
    });
  }
  return (
    <Modal title={`Reject ${order.order_number}`} sub="The reason is posted on the order so the customer knows why. If only part of the order is a problem, use “Send back with comments” instead." onClose={onClose}
      footer={<><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button variant="destructive" type="submit" form="reject" disabled={busy || !reason.trim()}>{busy ? "Rejecting…" : "Reject order"}</Button></>}>
      <form id="reject" onSubmit={submit} className="p-5 flex flex-col gap-3.5">
        {error && <p className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Field label="Reason for customer"><Textarea rows={3} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Account is over its credit limit; please settle the outstanding invoice before reordering." /></Field>
      </form>
    </Modal>
  );
}

function SendBackModal({ order, onClose }: { order: OrderView; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
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
      toast.push(`${order.order_number} sent back to ${order.customer.company_name}`, "success");
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
          <div className="border border-border rounded-lg overflow-x-auto">
            <table className="w-full border-collapse min-w-[460px]">
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
                        <Input mono type="number" min="0" step="1" aria-label={`Available quantity for ${l.name}`} value={qty[l.id]} onChange={(e) => setQty((q) => ({ ...q, [l.id]: Math.max(0, Number(e.target.value) || 0) }))} className="w-[90px] text-right py-1.5" />
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
