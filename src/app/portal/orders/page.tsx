import Link from "next/link";
import { Badge, Button, Card, orderTone } from "@/components/ui";
import { getCurrentUser, getOrders } from "@/lib/data";
import { money, shortDate, shortDateTime } from "@/lib/format";
import type { OrderStatus, OrderView } from "@/lib/types";

// Progress shown in the history table.
const PROGRESS: Record<OrderStatus, { pct: number; label: string; tone: string }> = {
  pending: { pct: 25, label: "Pending", tone: "#8A5A0B" },
  approved: { pct: 55, label: "Approved", tone: "#1C5488" },
  fulfilled: { pct: 100, label: "Delivered", tone: "#0E7A46" },
  rejected: { pct: 100, label: "Rejected", tone: "#B42318" },
};

function timeline(o: OrderView) {
  // 1 submitted · 2 approved · 3 packed · 4 delivered (packed is not tracked yet, so approved → delivered)
  const step: number = o.status === "pending" ? 1 : o.status === "approved" ? 2 : o.status === "fulfilled" ? 4 : 1;
  const rejected = o.status === "rejected";
  return [
    { label: "Submitted", when: shortDateTime(o.created_at), done: true, current: false },
    { label: rejected ? "Rejected" : "Admin review", when: step >= 2 ? "approved" : rejected ? "declined" : "in progress", done: step >= 2 || rejected, current: step === 1 && !rejected, danger: rejected },
    { label: "Packed", when: step >= 3 ? "done" : "expected soon", done: step >= 3, current: step === 2 },
    { label: "Delivered", when: step >= 4 ? "delivered" : o.required_by ? "by " + shortDate(o.required_by) : "—", done: step >= 4, current: step === 3 },
  ];
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ submitted?: string; view?: string }> }) {
  const [{ submitted, view }, user] = await Promise.all([searchParams, getCurrentUser()]);
  const orders = await getOrders(user ? { customerId: user.id } : {});
  const active = (view && orders.find((o) => o.id === view)) || orders.find((o) => o.status === "pending" || o.status === "approved") || orders[0];

  return (
    <div className="flex flex-col gap-[18px]">
      {submitted && (
        <div className="bg-success-bg border border-success-bd rounded-lg px-4 py-3 text-[13px] text-success">
          Order <span className="font-mono font-semibold">{submitted}</span> submitted. An operations admin will review it shortly.
        </div>
      )}
      <div>
        <h1 className="text-2xl font-semibold tracking-[-.01em]">Order history</h1>
        <div className="text-[13px] text-slate mt-1">Live status for open orders, full records for the last 24 months.</div>
      </div>

      {active && (
        <Card className="p-[18px] flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="label">Active order</div>
              <div className="flex items-center gap-2.5 mt-[5px]">
                <span className="font-mono text-base font-semibold">{active.order_number}</span>
                <Badge tone={orderTone[active.status]}>{active.status === "pending" ? "Pending approval" : PROGRESS[active.status].label}</Badge>
              </div>
            </div>
            <div className="text-right">
              <div className="label">Order value</div>
              <div className="font-mono text-lg font-semibold mt-1">{money(active.total)}</div>
            </div>
          </div>
          <div className="flex items-start">
            {timeline(active).map((t, i, arr) => {
              const dot = t.danger ? "#B42318" : t.current ? "#E6A23C" : t.done ? "#0E7A46" : "#fff";
              const ring = t.danger ? "#F3C6C0" : t.current ? "#F3DCAE" : t.done ? "#BFE3CE" : "#CBD5E1";
              const bar = t.done && arr[i + 1]?.done ? "#0E7A46" : "#E8EEF5";
              return (
                <div key={t.label} className="flex-1 flex flex-col gap-[9px] min-w-0">
                  <div className="flex items-center">
                    <span className="w-3.5 h-3.5 shrink-0 rounded-full border-2" style={{ background: dot, borderColor: ring }} />
                    {i < arr.length - 1 && <span className="flex-1 h-[3px]" style={{ background: bar }} />}
                  </div>
                  <div className="pr-3">
                    <div className={`text-[12.5px] font-semibold ${t.done || t.current ? "text-ink" : "text-muted"}`}>{t.label}</div>
                    <div className="font-mono text-[11px] text-muted mt-0.5">{t.when}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[760px]">
            <thead>
              <tr className="bg-surface-soft">
                <th className="th px-4">Order</th>
                <th className="th px-4">Placed</th>
                <th className="th th-r px-4">Lines</th>
                <th className="th th-r px-4">Value</th>
                <th className="th px-4">Progress</th>
                <th className="th th-r px-4" />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const p = PROGRESS[o.status];
                return (
                  <tr key={o.id} className="border-b border-border-soft hover:bg-surface-soft">
                    <td className="px-4 py-3 font-mono text-[12.5px] text-navy-hover whitespace-nowrap">{o.order_number}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-strong whitespace-nowrap">{shortDate(o.created_at)}</td>
                    <td className="px-4 py-3 text-right font-mono text-[12.5px]">{o.items.length}</td>
                    <td className="px-4 py-3 text-right font-mono text-[13px] font-medium whitespace-nowrap">{money(o.total)}</td>
                    <td className="px-4 py-3 min-w-[190px]">
                      <div className="flex items-center gap-[9px]">
                        <div className="flex-1 h-1.5 rounded-full bg-border-soft overflow-hidden"><div className="h-1.5 rounded-full" style={{ width: `${p.pct}%`, background: p.tone }} /></div>
                        <span className="text-[11px] font-semibold whitespace-nowrap" style={{ color: p.tone }}>{p.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right"><Link href={`/portal/orders?view=${o.id}`}><Button variant="ghost" size="sm">View</Button></Link></td>
                  </tr>
                );
              })}
              {orders.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-[13px] text-slate">No orders yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
