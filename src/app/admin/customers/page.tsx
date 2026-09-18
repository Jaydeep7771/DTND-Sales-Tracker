import { Card, PageHeading } from "@/components/ui";
import OnboardCustomer from "@/components/admin/OnboardCustomer";
import InviteStatus from "@/components/admin/InviteStatus";
import { getCustomers, getOrders, isDemo } from "@/lib/data";
import { money, shortDate } from "@/lib/format";

export default async function CustomersPage() {
  const [customers, orders] = await Promise.all([getCustomers(), getOrders()]);
  const pendingInvites = customers.filter((c) => !c.activated_at).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeading
        title="Customers"
        sub={`${customers.length} portal accounts${pendingInvites ? ` · ${pendingInvites} invite${pendingInvites === 1 ? "" : "s"} pending` : ""}`}
        actions={<OnboardCustomer demo={isDemo} />}
      />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[860px]">
            <thead>
              <tr className="bg-surface-soft">
                <th className="th">Company</th>
                <th className="th">Login email</th>
                <th className="th">Onboarded</th>
                <th className="th">Portal access</th>
                <th className="th th-r">Orders</th>
                <th className="th th-r">Lifetime value</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const mine = orders.filter((o) => o.customer.id === c.id && o.status !== "rejected" && o.status !== "cancelled");
                return (
                  <tr key={c.id} className="border-b border-border-soft hover:bg-surface-soft align-top">
                    <td className="td font-medium">{c.company_name ?? "—"}</td>
                    <td className="td font-mono text-xs text-slate">{c.email}</td>
                    <td className="td text-[12.5px] text-slate-strong whitespace-nowrap">{shortDate(c.created_at)}</td>
                    <td className="td"><InviteStatus customer={c} /></td>
                    <td className="td font-mono text-right">{mine.length}</td>
                    <td className="td font-mono text-right font-medium">{money(mine.reduce((a, o) => a + o.total, 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
