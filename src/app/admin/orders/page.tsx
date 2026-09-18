import OrdersView from "@/components/admin/OrdersView";
import { getOrders } from "@/lib/data";

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const [{ order }, orders] = await Promise.all([searchParams, getOrders()]);
  return <OrdersView orders={orders} initialId={order} />;
}
