import { Badge, Card, PageHeading } from "@/components/ui";
import OnboardCustomer from "@/components/admin/OnboardCustomer";
import CustomerRow from "@/components/admin/CustomerRow";
import { getCurrentStaff, getCustomers, getInvoices, getOrders } from "@/lib/data";
import { can } from "@/lib/permissions";
import { money, shortDate } from "@/lib/format";

export default async function CustomersPage() {
  const [staff, customers, orders, invoices] = await Promise.all([
    getCurrentStaff(), getCustomers(), getOrders(), getInvoices(),
  ]);
  const canWrite = can(staff?.role, "customer:write");
  const pendingInvites = customers.filter((c) => !c.activated_at).length;
  const issued = invoices.filter((i) => i.status === "issued");

  return (
    <div className="flex flex-col gap-4">
      <PageHeading
        title="Customers"
        sub={`${customers.length} portal accounts${pendingInvites ? ` · ${pendingInvites} invite${pendingInvites === 1 ? "" : "s"} pending` : ""}`}
        actions={canWrite ? <OnboardCustomer /> : undefined}
      />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[820px]">
            <thead>
              <tr className="bg-surface-soft">
                <th className="th px-4">Company</th>
                <th className="th px-4">Login email</th>
                <th className="th px-4">Onboarded</th>
                <th className="th px-4">Access</th>
                <th className="th th-r px-4">Orders</th>
                <th className="th th-r px-4">Outstanding</th>
                <th className="th th-r px-4">Invoiced</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const mine = issued.filter((i) => i.customer.id === c.id);
                const outstanding = mine.reduce((a, i) => a + i.balance, 0);
                const overdue = mine.some((i) => i.settlement === "overdue");
                const orderCount = orders.filter((o) => o.customer.id === c.id).length;
                return (
                  <CustomerRow key={c.id} id={c.id} name={c.company_name ?? c.email}>
                    <td className="px-4 py-3 font-mono text-xs text-slate">{c.email}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-strong whitespace-nowrap">{shortDate(c.created_at)}</td>
                    <td className="px-4 py-3">
                      {c.activated_at ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Invite pending</Badge>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[13px]">{orderCount}</td>
                    <td className={`px-4 py-3 text-right font-mono text-[13px] whitespace-nowrap ${overdue ? "text-danger font-semibold" : outstanding > 0 ? "font-medium" : "text-muted"}`}>
                      {outstanding > 0 ? money(outstanding) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[13px] font-medium whitespace-nowrap">
                      {money(mine.reduce((a, i) => a + i.total, 0))}
                    </td>
                  </CustomerRow>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
