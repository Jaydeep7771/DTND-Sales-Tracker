import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, OrderBadge } from "@/components/ui";
import BillingDetailsCard from "@/components/admin/BillingDetailsCard";
import InviteStatus from "@/components/admin/InviteStatus";
import { getCurrentStaff, getCustomerDetail } from "@/lib/data";
import { inviteUrlFor } from "@/lib/invite";
import { can } from "@/lib/permissions";
import { SETTLEMENT_LABEL, type Settlement } from "@/lib/accounting";
import { money, num, shortDate, shortDateTime } from "@/lib/format";
import type { BadgeTone } from "@/components/ui";

const SETTLEMENT_TONE: Record<Settlement, BadgeTone> = {
  draft: "warning", open: "info", part_paid: "info", paid: "success", overdue: "danger", void: "danger",
};

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, staff] = await Promise.all([getCustomerDetail(id), getCurrentStaff()]);
  if (!detail) notFound();

  const { customer, orders, invoices, ledger, stats } = detail;
  const canBill = can(staff?.role, "customer:billing");
  const canSeeLedger = can(staff?.role, "ledger:read");
  const name = customer.company_name ?? customer.email;

  const tiles = [
    { label: "Invoiced", value: money(stats.invoiced), sub: `${invoices.filter((i) => i.status === "issued").length} issued`, tone: "bg-accent" },
    { label: "Outstanding", value: money(stats.outstanding), sub: stats.outstanding > 0 ? "awaiting payment" : "nothing due", tone: "bg-warning-dot" },
    { label: "Overdue", value: money(stats.overdue), sub: stats.overdue > 0 ? "past due date" : "none past due", tone: stats.overdue > 0 ? "bg-danger" : "bg-success" },
    { label: "Orders", value: String(stats.ordersPlaced), sub: `${stats.ordersOpen} open`, tone: "bg-success" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/admin/customers" className="text-[12.5px] font-medium">← Customers</Link>
        <div className="flex items-end justify-between gap-4 flex-wrap mt-2">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl font-semibold tracking-[-.01em]">{name}</h1>
              {customer.activated_at
                ? <Badge tone="success">Active</Badge>
                : <Badge tone="warning">Invite pending</Badge>}
            </div>
            <div className="text-[13px] text-slate mt-1">
              <span className="font-mono">{customer.email}</span>
              {" · onboarded "}{shortDate(customer.created_at)}
              {stats.lastOrderAt && <> · last order {shortDate(stats.lastOrderAt)}</>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        {tiles.map((t) => (
          <Card key={t.label} className="p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="label">{t.label}</span>
              <span className={`w-2 h-2 rounded-sm ${t.tone}`} />
            </div>
            <div className="font-mono text-[22px] font-semibold tracking-[-.02em] leading-none">{t.value}</div>
            <div className="text-xs text-slate">{t.sub}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 items-start grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5 min-w-0">
          {/* Invoices */}
          <Card className="overflow-hidden">
            <div className="px-4 py-3.5 border-b border-border text-sm font-semibold">Invoices</div>
            {invoices.length === 0 ? (
              <div className="px-4 py-8 text-center text-[13px] text-slate">No invoices raised for this customer yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse min-w-[560px]">
                  <thead>
                    <tr className="bg-surface-soft">
                      <th className="th px-4">Invoice</th>
                      <th className="th px-4">Issued</th>
                      <th className="th px-4">Due</th>
                      <th className="th th-r px-4">Total</th>
                      <th className="th th-r px-4">Balance</th>
                      <th className="th px-4">Status</th>
                      <th className="th th-r px-4"><span className="sr-only">PDF</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((i) => (
                      <tr key={i.id} className="border-t border-border-soft hover:bg-surface-soft">
                        <td className="px-4 py-2.5 font-mono text-[12.5px] text-navy-hover whitespace-nowrap">{i.invoice_number ?? "Draft"}</td>
                        <td className="px-4 py-2.5 text-[12.5px] text-slate-strong whitespace-nowrap">{i.issue_date ? shortDate(i.issue_date) : "—"}</td>
                        <td className="px-4 py-2.5 text-[12.5px] text-slate-strong whitespace-nowrap">{i.due_date ? shortDate(i.due_date) : "—"}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-[13px] whitespace-nowrap">{money(i.total)}</td>
                        <td className={`px-4 py-2.5 text-right font-mono text-[13px] whitespace-nowrap ${i.balance > 0 && i.status === "issued" ? "font-semibold" : "text-muted"}`}>
                          {i.status === "issued" ? money(i.balance) : "—"}
                        </td>
                        <td className="px-4 py-2.5"><Badge tone={SETTLEMENT_TONE[i.settlement]}>{SETTLEMENT_LABEL[i.settlement]}</Badge></td>
                        <td className="px-4 py-2.5 text-right">
                          <a href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm">PDF</Button></a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Orders */}
          <Card className="overflow-hidden">
            <div className="px-4 py-3.5 border-b border-border text-sm font-semibold">Orders</div>
            {orders.length === 0 ? (
              <div className="px-4 py-8 text-center text-[13px] text-slate">This customer has not placed an order yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse min-w-[520px]">
                  <thead>
                    <tr className="bg-surface-soft">
                      <th className="th px-4">Order</th>
                      <th className="th px-4">Placed</th>
                      <th className="th th-r px-4">Lines</th>
                      <th className="th th-r px-4">Value</th>
                      <th className="th px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} className="border-t border-border-soft hover:bg-surface-soft">
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <Link href={`/admin/orders?order=${o.id}`} className="font-mono text-[12.5px]">{o.order_number}</Link>
                        </td>
                        <td className="px-4 py-2.5 text-[12.5px] text-slate-strong whitespace-nowrap">{shortDate(o.created_at)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-[12.5px]">{o.items.length}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-[13px] whitespace-nowrap">{money(o.total)}</td>
                        <td className="px-4 py-2.5"><OrderBadge status={o.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Receivable subledger */}
          {canSeeLedger && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3.5 border-b border-border flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Customer ledger</div>
                  <div className="text-xs text-slate mt-0.5">Every posting against this account, oldest first.</div>
                </div>
                {ledger.length > 0 && (
                  <div className="text-right">
                    <div className="label text-[10px]">Closing balance</div>
                    <div className="font-mono text-[15px] font-semibold">{money(ledger[ledger.length - 1].balance)}</div>
                  </div>
                )}
              </div>
              {ledger.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-slate">Nothing posted yet. Issuing an invoice creates the first entry.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse min-w-[620px]">
                    <thead>
                      <tr className="bg-surface-soft">
                        <th className="th px-4">Date</th>
                        <th className="th px-4">Entry</th>
                        <th className="th px-4">Narration</th>
                        <th className="th th-r px-4">Debit</th>
                        <th className="th th-r px-4">Credit</th>
                        <th className="th th-r px-4">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.map((l) => (
                        <tr key={l.id} className="border-t border-border-soft">
                          <td className="px-4 py-2.5 text-[12.5px] text-slate-strong whitespace-nowrap">{shortDate(l.entry_date)}</td>
                          <td className="px-4 py-2.5 font-mono text-[11.5px] text-slate whitespace-nowrap">{l.entry_no}</td>
                          <td className="px-4 py-2.5 text-[12.5px]">{l.narration}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-[12.5px] whitespace-nowrap">{l.debit ? money(l.debit) : ""}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-[12.5px] whitespace-nowrap">{l.credit ? money(l.credit) : ""}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-[12.5px] font-semibold whitespace-nowrap">{money(l.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <BillingDetailsCard customer={customer} canEdit={canBill} />

          <Card>
            <div className="px-4 py-3.5 border-b border-border">
              <div className="text-sm font-semibold">Portal access</div>
              <div className="text-xs text-slate mt-0.5">
                {customer.activated_at ? `Activated ${shortDateTime(customer.activated_at)}.` : "The customer has not accepted the invite yet."}
              </div>
            </div>
            <div className="p-4">
              <InviteStatus customer={customer} inviteUrl={customer.invite_token ? inviteUrlFor(customer.invite_token) : null} />
            </div>
          </Card>

          <Card className="p-4">
            <div className="label mb-2.5">Account</div>
            <div className="flex flex-col gap-2.5 text-[13px]">
              {[
                ["Login email", customer.email],
                ["Account no.", "#" + customer.id.replace(/\D/g, "").slice(0, 4).padEnd(4, "0")],
                ["Payment terms", "Net 30"],
                ["Units ordered", num(orders.reduce((a, o) => a + o.items.reduce((b, l) => b + l.quantity, 0), 0))],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <span className="text-slate">{k}</span>
                  <span className="font-mono text-ink text-right [overflow-wrap:anywhere]">{v}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
