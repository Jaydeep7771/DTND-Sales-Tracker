import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import OrderNotifications from "@/components/admin/OrderNotifications";
import ScreenSwitcher from "@/components/ScreenSwitcher";
import { getCurrentStaff, getDashboardMetrics, isDemo } from "@/lib/data";
import { ROLE_LABEL } from "@/lib/permissions";

export const dynamic = "force-dynamic";

function initialsOf(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Staff guard. Customers never reach the console; in demo mode the
  // persona comes from the role cookie so both roles can be reviewed.
  const staff = await getCurrentStaff();
  if (!isDemo) {
    if (!staff) redirect("/login");
    if (staff.role === "customer") redirect("/portal");
  }

  const role = staff?.role ?? "admin";
  const name = staff?.company_name ?? staff?.email ?? "Operations";
  const m = await getDashboardMetrics();
  const topOffset = isDemo ? 37 : 0;

  return (
    <>
      {isDemo && <ScreenSwitcher />}
      {!isDemo && <OrderNotifications />}
      <AdminShell
        role={role}
        pendingCount={m.pendingApprovals}
        totalSkus={m.totalSkus}
        lowStockCount={m.lowStockCount}
        admin={{ name, title: ROLE_LABEL[role], initials: initialsOf(name) }}
        topOffset={topOffset}
        demo={isDemo}
      >
        {children}
      </AdminShell>
    </>
  );
}
