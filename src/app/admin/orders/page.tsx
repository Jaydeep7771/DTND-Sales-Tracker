import OrdersView from "@/components/admin/OrdersView";
import { getCurrentStaff, getOrders } from "@/lib/data";
import { can } from "@/lib/permissions";

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const [{ order }, orders, staff] = await Promise.all([searchParams, getOrders(), getCurrentStaff()]);
  return <OrdersView orders={orders} initialId={order} canWrite={can(staff?.role, "order:write")} />;
}
