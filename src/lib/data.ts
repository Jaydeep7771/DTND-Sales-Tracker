// Server-side read layer. Uses Supabase when keys are configured, otherwise
// the in-memory demo store so the app runs with zero setup.
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { demo, DEMO_CUSTOMER_EMAIL } from "@/lib/demo-store";
import { TAX_RATE } from "@/lib/types";
import type { Product, Announcement, UserProfile, OrderView, OrderLine, ProductQuery, ProductPage, CategoryCount, DashboardMetrics, OrderStatus } from "@/lib/types";

export const isDemo =
  !process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes("placeholder");

// ---------------------------------------------------------------- helpers
function buildOrder(
  o: { id: string; order_number: string; status: OrderStatus; created_at: string; required_by: string | null; delivery_address: string | null; note: string | null },
  customer: { id: string; company_name: string | null; email: string },
  items: OrderLine[],
): OrderView {
  const subtotal = items.reduce((a, l) => a + l.quantity * l.price_at_purchase, 0);
  return {
    id: o.id,
    order_number: o.order_number,
    status: o.status,
    created_at: o.created_at,
    required_by: o.required_by,
    delivery_address: o.delivery_address,
    note: o.note,
    customer: { id: customer.id, company_name: customer.company_name ?? customer.email, email: customer.email },
    items,
    subtotal,
    total: Math.round(subtotal * (1 + TAX_RATE)),
  };
}

function paginate(all: Product[], q: ProductQuery, catalogTotal: number): ProductPage {
  const perPage = q.perPage ?? 9;
  const pages = Math.max(1, Math.ceil(all.length / perPage));
  const page = Math.min(Math.max(1, q.page ?? 1), pages);
  return { rows: all.slice((page - 1) * perPage, page * perPage), total: all.length, catalogTotal, page, pages };
}

// ---------------------------------------------------------------- products
export async function getProducts(q: ProductQuery = {}): Promise<ProductPage> {
  const term = (q.q ?? "").trim().toLowerCase();
  const cat = q.category && q.category !== "All" ? q.category : null;

  if (isDemo) {
    const active = demo.products.filter((p) => q.includeArchived || !p.is_archived);
    const rows = active.filter(
      (p) => (!cat || p.category === cat) && (!term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term)),
    );
    return paginate(rows, q, active.length);
  }

  const supabase = await createClient();
  let query = supabase.from("products").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (!q.includeArchived) query = query.eq("is_archived", false);
  if (cat) query = query.eq("category", cat);
  if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%`);
  const perPage = q.perPage ?? 9;
  const page = Math.max(1, q.page ?? 1);
  const { data, count, error } = await query.range((page - 1) * perPage, page * perPage - 1);
  if (error) throw error;
  const { count: catalogTotal } = await supabase.from("products").select("id", { count: "exact", head: true }).eq("is_archived", false);
  const total = count ?? 0;
  return { rows: data ?? [], total, catalogTotal: catalogTotal ?? 0, page, pages: Math.max(1, Math.ceil(total / perPage)) };
}

export async function getCategories(): Promise<CategoryCount[]> {
  const products = isDemo ? demo.products.filter((p) => !p.is_archived) : (await (await createClient()).from("products").select("category").eq("is_archived", false)).data ?? [];
  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

export async function getLowStock(limit = 5): Promise<Product[]> {
  if (isDemo) return demo.products.filter((p) => !p.is_archived && p.stock_quantity < p.reorder_point).sort((a, b) => a.stock_quantity - b.stock_quantity).slice(0, limit);
  const supabase = await createClient();
  // PostgREST can't compare two columns directly; fetch and filter (catalog is small for a POC).
  const { data } = await supabase.from("products").select("*").eq("is_archived", false).order("stock_quantity");
  return (data ?? []).filter((p) => p.stock_quantity < p.reorder_point).slice(0, limit);
}

// ---------------------------------------------------------------- orders
export async function getOrders(opts: { customerId?: string } = {}): Promise<OrderView[]> {
  if (isDemo) {
    const cid = opts.customerId;
    return demo.orders
      .filter((o) => !cid || o.customer_id === cid)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((o) => {
        const customer = demo.customers.find((c) => c.id === o.customer_id)!;
        const items: OrderLine[] = o.items.map((it) => {
          const p = demo.products.find((p) => p.id === it.product_id)!;
          return { id: it.id, product_id: p.id, name: p.name, sku: p.sku, quantity: it.quantity, price_at_purchase: it.price_at_purchase, stock: p.stock_quantity };
        });
        return buildOrder(o, customer, items);
      });
  }

  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select("*, customer:users!orders_customer_id_fkey(id, company_name, email), items:order_items(id, product_id, quantity, price_at_purchase, product:products(name, sku, stock_quantity))")
    .order("created_at", { ascending: false });
  if (opts.customerId) query = query.eq("customer_id", opts.customerId);
  const { data, error } = await query;
  if (error) throw error;
  type Row = NonNullable<typeof data>[number] & {
    customer: { id: string; company_name: string | null; email: string };
    items: { id: string; product_id: string; quantity: number; price_at_purchase: number; product: { name: string; sku: string; stock_quantity: number } }[];
  };
  return ((data ?? []) as unknown as Row[]).map((o) =>
    buildOrder(
      o,
      o.customer,
      o.items.map((it) => ({ id: it.id, product_id: it.product_id, name: it.product.name, sku: it.product.sku, quantity: it.quantity, price_at_purchase: it.price_at_purchase, stock: it.product.stock_quantity })),
    ),
  );
}

export async function getOrder(id: string): Promise<OrderView | null> {
  return (await getOrders()).find((o) => o.id === id) ?? null;
}

// ---------------------------------------------------------------- customers / users
export async function getCustomers(): Promise<UserProfile[]> {
  if (isDemo) return demo.customers;
  const { data } = await (await createClient()).from("users").select("*").eq("role", "customer").order("company_name");
  return data ?? [];
}

/** The signed-in user's profile. In demo mode the portal acts as a fixed customer. */
export async function getCurrentUser(): Promise<UserProfile | null> {
  if (isDemo) return demo.customers.find((c) => c.email === DEMO_CUSTOMER_EMAIL) ?? null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("users").select("*").eq("id", user.id).single();
  return data;
}

// ---------------------------------------------------------------- announcements
export async function getAnnouncements(opts: { type?: "announcement" | "faq"; activeOnly?: boolean } = {}): Promise<Announcement[]> {
  const filter = (a: Announcement) => (!opts.type || a.type === opts.type) && (!opts.activeOnly || (a.is_active && (!a.expires_at || a.expires_at > new Date().toISOString())));
  if (isDemo) return demo.announcements.filter(filter).sort((a, b) => a.priority - b.priority);
  let query = (await createClient()).from("announcements").select("*").order("priority");
  if (opts.type) query = query.eq("type", opts.type);
  if (opts.activeOnly) query = query.eq("is_active", true);
  const { data } = await query;
  return (data ?? []).filter(filter);
}

// ---------------------------------------------------------------- dashboard
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const [orders, products, cats] = await Promise.all([getOrders(), getProducts({ perPage: 10000 }), getCategories()]);
  const now = Date.now();
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = now - 7 * 86400e3;
  const pending = orders.filter((o) => o.status === "pending");
  const fulfilled = orders.filter((o) => o.status === "fulfilled" && new Date(o.created_at).getTime() > weekAgo);
  return {
    ordersToday: orders.filter((o) => new Date(o.created_at) >= startOfToday).length,
    pendingApprovals: pending.length,
    pendingOverSla: pending.filter((o) => now - new Date(o.created_at).getTime() > 4 * 3600e3).length,
    lowStockCount: products.rows.filter((p) => p.stock_quantity < p.reorder_point).length,
    zeroStockCount: products.rows.filter((p) => p.stock_quantity === 0).length,
    fulfilledThisWeek: fulfilled.length,
    fulfilledValueThisWeek: fulfilled.reduce((a, o) => a + o.total, 0),
    totalSkus: products.catalogTotal,
    categories: cats.length,
  };
}
