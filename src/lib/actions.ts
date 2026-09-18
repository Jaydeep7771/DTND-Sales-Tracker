"use server";

// Server Actions: every mutation in the app. Each one works against Supabase
// when configured and against the demo store otherwise.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { demo, newId, DEMO_CUSTOMER_EMAIL } from "@/lib/demo-store";
import { isDemo } from "@/lib/data";
import type { OrderStatus } from "@/types/database";
import type { SubmitOrderInput } from "@/lib/types";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function revalidateAll() {
  for (const p of ["/admin", "/admin/inventory", "/admin/orders", "/admin/cms", "/admin/customers", "/portal", "/portal/orders", "/portal/checkout"]) revalidatePath(p);
}

// ---------------------------------------------------------------- products
export interface NewProductInput {
  name: string;
  description: string;
  category: string;
  unit_of_measure: string;
  price: number;
  stock_quantity: number;
  reorder_point: number;
  image_url: string | null;
}

function nextSku(category: string, existing: string[]): string {
  const code = category.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase() || "GEN";
  const nums = existing.filter((s) => s.startsWith(code + "-")).map((s) => parseInt(s.slice(4), 10)).filter(Number.isFinite);
  return `${code}-${String((nums.length ? Math.max(...nums) : 100) + 1).padStart(4, "0")}`;
}

export async function createProduct(input: NewProductInput): Promise<Result<{ sku: string }>> {
  if (!input.name.trim()) return { ok: false, error: "Product name is required." };
  if (!(input.price >= 0)) return { ok: false, error: "Price must be zero or more." };
  if (!Number.isInteger(input.stock_quantity) || input.stock_quantity < 0) return { ok: false, error: "Opening stock must be a whole number." };

  if (isDemo) {
    const sku = nextSku(input.category, demo.products.map((p) => p.sku));
    const now = new Date().toISOString();
    demo.products.unshift({ id: newId(), sku, ...input, name: input.name.trim(), description: input.description.trim() || null, is_archived: false, created_at: now, updated_at: now });
    revalidateAll();
    return { ok: true, data: { sku } };
  }

  const supabase = await createClient();
  const { data: skus } = await supabase.from("products").select("sku");
  const sku = nextSku(input.category, (skus ?? []).map((s) => s.sku));
  const { error } = await supabase.from("products").insert({ ...input, sku, name: input.name.trim(), description: input.description.trim() || null });
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true, data: { sku } };
}

// ---------------------------------------------------------------- orders
export async function setOrderStatus(orderId: string, status: OrderStatus): Promise<Result> {
  if (isDemo) {
    const o = demo.orders.find((o) => o.id === orderId);
    if (!o) return { ok: false, error: "Order not found." };
    // Approving deducts stock, mirroring the DB trigger you'd add later.
    if (status === "approved" && o.status === "pending") {
      for (const it of o.items) {
        const p = demo.products.find((p) => p.id === it.product_id);
        if (p) p.stock_quantity = Math.max(0, p.stock_quantity - it.quantity);
      }
    }
    o.status = status;
    revalidateAll();
    return { ok: true };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("orders").update({ status }).eq("id", orderId);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function submitOrder(input: SubmitOrderInput): Promise<Result<{ order_number: string; id: string }>> {
  if (!input.lines.length) return { ok: false, error: "Your cart is empty." };

  if (isDemo) {
    const customer = demo.customers.find((c) => c.email === DEMO_CUSTOMER_EMAIL)!;
    const n = demo.nextOrderNumber++;
    const id = newId();
    demo.orders.unshift({
      id,
      order_number: "DT-" + n,
      customer_id: customer.id,
      status: "pending",
      delivery_address: input.delivery_address,
      required_by: input.required_by,
      note: input.note || null,
      created_at: new Date().toISOString(),
      items: input.lines.map((l) => {
        const p = demo.products.find((p) => p.id === l.product_id)!;
        return { id: newId(), product_id: p.id, quantity: l.quantity, price_at_purchase: p.price };
      }),
    });
    revalidateAll();
    return { ok: true, data: { order_number: "DT-" + n, id } };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  // Lock prices at submit time from the live catalog.
  const ids = input.lines.map((l) => l.product_id);
  const { data: products } = await supabase.from("products").select("id, price").in("id", ids);
  const priceOf = new Map((products ?? []).map((p) => [p.id, p.price]));

  const { data: order, error } = await supabase
    .from("orders")
    .insert({ customer_id: user.id, delivery_address: input.delivery_address, required_by: input.required_by, note: input.note || null })
    .select("id, order_number")
    .single();
  if (error || !order) return { ok: false, error: error?.message ?? "Could not create order." };

  const { error: itemsError } = await supabase.from("order_items").insert(
    input.lines.map((l) => ({ order_id: order.id, product_id: l.product_id, quantity: l.quantity, price_at_purchase: priceOf.get(l.product_id) ?? 0 })),
  );
  if (itemsError) return { ok: false, error: itemsError.message };
  revalidateAll();
  return { ok: true, data: { order_number: order.order_number, id: order.id } };
}

// ---------------------------------------------------------------- CMS
export async function toggleAnnouncement(id: string, is_active: boolean): Promise<Result> {
  if (isDemo) {
    const a = demo.announcements.find((a) => a.id === id);
    if (a) a.is_active = is_active;
    revalidateAll();
    return { ok: true };
  }
  const { error } = await (await createClient()).from("announcements").update({ is_active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function createAnnouncement(input: { title: string; content: string; type: "announcement" | "faq" }): Promise<Result> {
  if (!input.title.trim()) return { ok: false, error: "Title is required." };
  if (isDemo) {
    const siblings = demo.announcements.filter((a) => a.type === input.type);
    demo.announcements.push({ id: newId(), title: input.title.trim(), content: input.content.trim(), type: input.type, priority: siblings.length + 1, expires_at: null, is_active: true, created_at: new Date().toISOString() });
    revalidateAll();
    return { ok: true };
  }
  const { error } = await (await createClient()).from("announcements").insert({ title: input.title.trim(), content: input.content.trim(), type: input.type });
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// ---------------------------------------------------------------- customers
export async function onboardCustomer(input: { company_name: string; email: string }): Promise<Result<{ tempPassword: string }>> {
  if (!input.email.includes("@")) return { ok: false, error: "Enter a valid email." };
  const tempPassword = "DT-" + Math.random().toString(36).slice(2, 10);

  if (isDemo) {
    demo.customers.push({ id: newId(), email: input.email.trim(), role: "customer", company_name: input.company_name.trim(), created_at: new Date().toISOString() });
    revalidateAll();
    return { ok: true, data: { tempPassword } };
  }

  // Creates the auth user; the on_auth_user_created trigger inserts the profile row.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email: input.email.trim(),
    password: tempPassword,
    email_confirm: true,
    user_metadata: { role: "customer", company_name: input.company_name.trim() },
  });
  if (error) return { ok: false, error: error.message };

  // Welcome email (Resend). Skipped silently if no key is configured.
  if (process.env.RESEND_API_KEY) {
    const { Resend } = await import("resend");
    await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: process.env.EMAIL_FROM ?? "Portal <onboarding@resend.dev>",
      to: input.email.trim(),
      subject: "Your Dynamic Traders portal login",
      text: `Welcome ${input.company_name}.\n\nSign in at ${process.env.NEXT_PUBLIC_APP_URL ?? ""}/login\nEmail: ${input.email}\nTemporary password: ${tempPassword}\n\nPlease change it after your first login.`,
    });
  }
  revalidateAll();
  return { ok: true, data: { tempPassword } };
}

// ---------------------------------------------------------------- auth
export async function signIn(email: string, password: string): Promise<Result<{ role: string }>> {
  if (isDemo) return { ok: true, data: { role: "admin" } };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("users").select("role").eq("id", user!.id).single();
  return { ok: true, data: { role: profile?.role ?? "customer" } };
}

export async function signOut(): Promise<void> {
  if (isDemo) return;
  await (await createClient()).auth.signOut();
}

// ---------------------------------------------------------------- catalog paging (portal "Load more")
export async function loadCatalogPage(q: { q?: string; category?: string; page: number }) {
  const { getProducts } = await import("@/lib/data");
  return getProducts({ ...q, perPage: 9 });
}
