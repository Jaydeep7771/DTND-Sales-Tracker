import Link from "next/link";
import { Button, Card, PageHeading } from "@/components/ui";
import { getDashboardMetrics, getLowStock, getOrders } from "@/lib/data";
import { longDate, money, num } from "@/lib/format";

export default async function AdminOverviewPage() {
  const [m, low, orders] = await Promise.all([getDashboardMetrics(), getLowStock(5), getOrders()]);
  const pending = orders.filter((o) => o.status === "pending").slice(0, 5);

  const metrics = [
    { label: "Total orders today", value: String(m.ordersToday), delta: `${m.pendingApprovals} awaiting approval`, deltaColor: "text-success", tone: "bg-accent" },
    { label: "Pending approvals", value: String(m.pendingApprovals), delta: m.pendingOverSla ? `${m.pendingOverSla} over 4h SLA` : "All within 4h SLA", deltaColor: m.pendingOverSla ? "text-warning" : "text-slate", tone: "bg-warning-dot" },
    { label: "Low stock alerts", value: String(m.lowStockCount), delta: `${m.zeroStockCount} at zero on hand`, deltaColor: "text-danger", tone: "bg-danger" },
    { label: "Fulfilled this week", value: String(m.fulfilledThisWeek), delta: `${money(m.fulfilledValueThisWeek)} dispatched`, deltaColor: "text-slate", tone: "bg-success" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        eyebrow={longDate()}
        title="Operations overview"
        actions={
          <>
            <Button variant="secondary">Export day sheet</Button>
            <Link href="/admin/orders"><Button>Review pending orders</Button></Link>
          </>
        }
      />

      <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        {metrics.map((x) => (
          <Card key={x.label} className="p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="label">{x.label}</span>
              <span className={`w-2 h-2 rounded-sm ${x.tone}`} />
            </div>
            <div className="font-mono text-[30px] font-semibold tracking-[-.02em] leading-none">{x.value}</div>
            <div className={`text-xs ${x.deltaColor}`}>{x.delta}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 items-start" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <Card>
          <div className="px-4 py-3.5 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold">Orders awaiting approval</span>
            <Link href="/admin/orders" className="text-xs font-medium">Open queue →</Link>
          </div>
          {pending.length === 0 && <div className="px-4 py-6 text-[13px] text-slate">Queue is clear.</div>}
          {pending.map((o) => (
            <Link key={o.id} href={`/admin/orders?order=${o.id}`} className="flex items-center gap-3 px-4 py-3 border-b border-border-soft text-ink hover:bg-surface-soft">
              <span className="font-mono text-xs text-navy-hover shrink-0">{o.order_number}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium truncate">{o.customer.company_name}</div>
                <div className="text-[11.5px] text-slate">{o.items.length} lines · {num(o.items.reduce((a, l) => a + l.quantity, 0))} units</div>
              </div>
              <span className="font-mono text-[13px] font-medium">{money(o.subtotal)}</span>
            </Link>
          ))}
        </Card>

        <Card>
          <div className="px-4 py-3.5 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold">Low stock alerts</span>
            <Link href="/admin/inventory" className="text-xs font-medium">Manage inventory →</Link>
          </div>
          {low.length === 0 && <div className="px-4 py-6 text-[13px] text-slate">Nothing below reorder point.</div>}
          {low.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3 border-b border-border-soft">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium truncate">{p.name}</div>
                <div className="font-mono text-[11px] text-slate">{p.sku} · {p.category}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[13px] text-danger font-semibold">{num(p.stock_quantity)}</div>
                <div className="text-[10.5px] text-muted">reorder at {p.reorder_point}</div>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
