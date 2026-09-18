import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import OrderNotifications from "@/components/admin/OrderNotifications";
import ScreenSwitcher from "@/components/ScreenSwitcher";
import { getCurrentUser, getDashboardMetrics, isDemo } from "@/lib/data";
import { DEMO_ADMIN } from "@/lib/demo-store";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Role guard (live mode only; demo mode is open for review).
  let admin = DEMO_ADMIN;
  if (!isDemo) {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    if (user.role !== "admin") redirect("/portal");
    const name = user.company_name ?? user.email;
    admin = { name, title: "Operations admin", initials: name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() };
  }

  const m = await getDashboardMetrics();
  const topOffset = isDemo ? 37 : 0;

  return (
    <>
      {isDemo && <ScreenSwitcher />}
      {!isDemo && <OrderNotifications />}
      <AdminShell pendingCount={m.pendingApprovals} totalSkus={m.totalSkus} lowStockCount={m.lowStockCount} admin={admin} topOffset={topOffset}>
        {children}
      </AdminShell>
    </>
  );
}
