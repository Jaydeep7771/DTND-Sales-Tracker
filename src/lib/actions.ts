"use server";

// Server Actions: every mutation in the app. Each one works against Supabase
// when configured and against the demo store otherwise.
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { demo, newId, DEMO_ADMIN_ID, DEMO_ADMIN, DEMO_ROLE_COOKIE } from "@/lib/demo-store";
import { can, isStaff, type Capability } from "@/lib/permissions";
import type { UserRole } from "@/types/database";
import { inviteEmail, sendEmail } from "@/lib/email";
import { inviteExpiry, inviteUrlFor, isInviteExpired } from "@/lib/invite";
import { isDemo, getOrder, getCustomerExposure, getCart, getCurrentUser, DEMO_CUSTOMER_COOKIE } from "@/lib/data";
import { clearCart } from "@/lib/cart-actions";
import { stockMessage } from "@/lib/availability";
import { adjustStock, dispatchOrder, recordOpeningStock } from "@/lib/inventory";
import { creditCheck } from "@/lib/receivables";
import { transitionError } from "@/lib/order-status";
import { money } from "@/lib/format";
import type { OrderStatus } from "@/types/database";
import type { SubmitOrderInput } from "@/lib/types";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

// ---------------------------------------------------------------- authorization
// Defence in depth. Row level security is the real boundary in live mode,
// but demo mode has none, and an explicit check gives a better message.
async function currentRole(): Promise<UserRole | null> {
  const { getCurrentStaff } = await import("@/lib/data");
  return (await getCurrentStaff())?.role ?? null;
}

async function denyUnless(capability: Capability): Promise<Result | null> {
  if (can(await currentRole(), capability)) return null;
  return { ok: false, error: "Your role does not permit this action." };
}

/** Demo only: switch which staff persona the console acts as. */
export async function setDemoRole(role: UserRole): Promise<Result> {
  if (!isDemo) return { ok: false, error: "Only available in demo mode." };
  if (!isStaff(role)) return { ok: false, error: "Not a staff role." };
  (await cookies()).set(DEMO_ROLE_COOKIE, role, { path: "/", httpOnly: true, sameSite: "lax" });
  revalidateAll();
  return { ok: true };
}

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
  cost_price: number;
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
  { const denied = await denyUnless("product:write"); if (denied) return denied; }
  if (!input.name.trim()) return { ok: false, error: "Product name is required." };
  if (!(input.price >= 0)) return { ok: false, error: "Price must be zero or more." };
  if (!Number.isInteger(input.stock_quantity) || input.stock_quantity < 0) return { ok: false, error: "Opening stock must be a whole number." };
  if (!(input.cost_price >= 0)) return { ok: false, error: "Cost must be zero or more." };
  if (input.cost_price > input.price && input.price > 0) {
    return { ok: false, error: "Cost is above the selling price. Check the figures before saving." };
  }

  // Stock is created at zero and brought in by an opening movement, so the
  // count and the stock ledger agree from the product's first day.
  let productId: string;
  let sku: string;

  if (isDemo) {
    sku = nextSku(input.category, demo.products.map((p) => p.sku));
    const now = new Date().toISOString();
    productId = newId();
    demo.products.unshift({
      id: productId, sku, ...input, stock_quantity: 0,
      name: input.name.trim(), description: input.description.trim() || null,
      // Backorder is opt-in; a new line starts capped at real stock.
      allow_backorder: false, is_archived: false, created_at: now, updated_at: now,
    });
  } else {
    const supabase = await createClient();
    const { data: skus } = await supabase.from("products").select("sku");
    sku = nextSku(input.category, (skus ?? []).map((s) => s.sku));
    const { data, error } = await supabase.from("products")
      .insert({ ...input, sku, stock_quantity: 0, name: input.name.trim(), description: input.description.trim() || null })
      .select("id").single();
    if (error || !data) return { ok: false, error: error?.message ?? "Could not create the product." };
    productId = data.id;
  }

  if (input.stock_quantity > 0) {
    const opened = await recordOpeningStock(productId, input.stock_quantity, input.cost_price);
    if (!opened.ok) return { ok: false, error: opened.error };
  }

  revalidateAll();
  return { ok: true, data: { sku } };
}

export interface UpdateProductInput {
  price: number; cost_price: number; stock_quantity: number; reorder_point: number;
  is_archived: boolean; name: string; description: string; stock_note: string;
}

/**
 * Stock is not edited here even though the form shows a box for it. A
 * difference between the counted figure and the recorded one is a
 * stocktake adjustment: it moves stock, posts to Stock Adjustments and
 * leaves a row saying who counted it and why. Typing over the number
 * would destroy exactly the evidence an auditor asks for.
 */
export async function updateProduct(id: string, input: UpdateProductInput): Promise<Result> {
  { const denied = await denyUnless("product:write"); if (denied) return denied; }
  if (!input.name.trim()) return { ok: false, error: "Product name is required." };
  if (!(input.price >= 0)) return { ok: false, error: "Price must be zero or more." };
  if (!(input.cost_price >= 0)) return { ok: false, error: "Cost must be zero or more." };
  if (!Number.isInteger(input.stock_quantity) || input.stock_quantity < 0) return { ok: false, error: "Stock must be a whole number." };

  const fields = {
    price: input.price, cost_price: input.cost_price, reorder_point: input.reorder_point,
    is_archived: input.is_archived, name: input.name.trim(),
    description: input.description.trim() || null,
  };

  if (isDemo) {
    const p = demo.products.find((p) => p.id === id);
    if (!p) return { ok: false, error: "Product not found." };
    Object.assign(p, fields, { updated_at: new Date().toISOString() });
  } else {
    const { error } = await (await createClient()).from("products").update(fields).eq("id", id);
    if (error) return { ok: false, error: error.message };
  }

  const adjusted = await adjustStock(id, input.stock_quantity, input.stock_note.trim());
  if (!adjusted.ok) return { ok: false, error: adjusted.error };

  revalidateAll();
  return { ok: true };
}

// ---------------------------------------------------------------- orders
export async function setOrderStatus(
  orderId: string,
  status: OrderStatus,
  opts: { asCustomer?: boolean } = {},
): Promise<Result<{ warning?: string }>> {
  // A customer withdrawing their own order is the one case where the
  // order:write capability does not apply; everything else is staff.
  if (!opts.asCustomer) {
    const denied = await denyUnless("order:write"); if (denied) return denied;
  }
  let warning: string | undefined;
  const order = await getOrder(orderId);
  if (!order) return { ok: false, error: "Order not found." };
  const was = order.status;

  // Every move through this function is checked against one transition
  // table. The screens already hid the buttons that do not apply; this is
  // the half that was missing, so a crafted request cannot do what the UI
  // refuses to offer.
  const refusal = transitionError(was, status);
  if (refusal) return { ok: false, error: refusal };
  if (was === status) return { ok: true };

  // An order with money already on it cannot simply be dropped: the
  // invoice would be left outstanding against goods nobody is sending.
  if (status === "cancelled") {
    const live = order.invoices.filter((i) => i.status === "issued" && i.type !== "credit_note");
    if (live.length > 0) {
      return {
        ok: false,
        error: `${live[0].invoice_number} has been issued against this order. Void it, or raise a credit note, before withdrawing the order.`,
      };
    }
  }

  // Marking an order fulfilled is the moment goods leave the building, so
  // that is where stock is relieved and the cost of sale is posted. Doing
  // it at approval would have taken the goods off the balance sheet while
  // they were still on the shelf.
  if (status === "fulfilled" && was !== "fulfilled") {
    const dispatched = await dispatchOrder(
      orderId,
      order.items.map((i) => ({ product_id: i.product_id, name: i.name, quantity: i.quantity })),
    );
    if (!dispatched.ok) return { ok: false, error: dispatched.error };
    if (dispatched.uncosted.length) {
      warning = `Dispatched, but ${dispatched.uncosted.length} line${dispatched.uncosted.length === 1 ? " has" : "s have"} no cost recorded, so gross profit on this order is overstated: ${dispatched.uncosted.join(", ")}.`;
    }
  }

  // Approval checks stock without moving it, so an order is never approved
  // for goods that are not there.
  if (status === "approved" && (was === "pending" || was === "changes_requested")) {
    const short = await shortOf(order.items);
    if (short) return { ok: false, error: short };

    // Credit control. A limit that can be clicked through is not a limit,
    // so exceeding it refuses the approval rather than warning about it.
    const exposure = await getCustomerExposure(order.customer.id);
    const verdict = creditCheck({ ...exposure, orderValue: order.total }, money);
    if (!verdict.ok) return { ok: false, error: verdict.reason };
    if (verdict.warning) warning = verdict.warning;
  }

  if (isDemo) {
    const o = demo.orders.find((o) => o.id === orderId);
    if (!o) return { ok: false, error: "Order not found." };
    o.status = status;
  } else {
    const { error } = await (await createClient()).from("orders").update({ status }).eq("id", orderId);
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true, data: warning ? { warning } : undefined };
}

/** Names the first line that cannot be met from stock, for the approval guard. */
async function shortOf(items: { product_id: string; name: string; quantity: number }[]): Promise<string | null> {
  const products = isDemo
    ? demo.products
    : ((await (await createClient()).from("products").select("id, name, stock_quantity")).data ?? []);
  for (const it of items) {
    const p = products.find((x) => x.id === it.product_id);
    if (p && p.stock_quantity < it.quantity) {
      return `${p.name} has ${p.stock_quantity} in stock but this order needs ${it.quantity}. Send the order back with revised quantities, or restock first.`;
    }
  }
  return null;
}

/**
 * Turns the server cart into a pending order.
 *
 * Three things are decided here and nowhere else, because this is the
 * last point at which they can be decided honestly:
 *
 *   * the price, resolved from the rate card rather than taken from the
 *     browser, so price_at_purchase is a number we computed;
 *   * whether the stock exists, re-checked now rather than relying on
 *     the figure the catalogue showed a few minutes ago;
 *   * that the cart is emptied only once the order actually exists.
 */
export async function submitOrder(input: SubmitOrderInput): Promise<Result<{ order_number: string; id: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const cart = await getCart(user.id);
  if (!cart.lines.length) return { ok: false, error: "Your cart is empty." };

  // Availability is read fresh. Between filling a cart and checking out,
  // somebody else's order may have taken the stock.
  if (cart.blocking.length) {
    return {
      ok: false,
      error:
        cart.blocking.length === 1
          ? stockMessage(cart.blocking[0])
          : `Some lines are no longer available:\n${cart.blocking.map((p) => "• " + stockMessage(p)).join("\n")}`,
    };
  }

  if (isDemo) {
    const n = demo.nextOrderNumber++;
    const id = newId();
    demo.orders.unshift({
      id,
      order_number: "DT-" + n,
      customer_id: user.id,
      status: "pending",
      delivery_address: input.delivery_address,
      required_by: input.required_by,
      note: input.note || null,
      created_at: new Date().toISOString(),
      items: cart.lines.map((l) => ({ id: newId(), product_id: l.product_id, quantity: l.quantity, price_at_purchase: l.unit_price })),
    });
    await clearCart(user.id);
    revalidateAll();
    return { ok: true, data: { order_number: "DT-" + n, id } };
  }

  const supabase = await createClient();

  const { data: order, error } = await supabase
    .from("orders")
    .insert({ customer_id: user.id, delivery_address: input.delivery_address, required_by: input.required_by, note: input.note || null })
    .select("id, order_number")
    .single();
  if (error || !order) return { ok: false, error: error?.message ?? "Could not create order." };

  const { error: itemsError } = await supabase.from("order_items").insert(
    // The price comes from the resolved cart line, which came from the
    // rate card. Nothing the browser sent reaches this column.
    cart.lines.map((l) => ({ order_id: order.id, product_id: l.product_id, quantity: l.quantity, price_at_purchase: l.unit_price })),
  );
  if (itemsError) {
    // Leave the cart alone so the buyer can retry without rebuilding it.
    await supabase.from("orders").delete().eq("id", order.id);
    return { ok: false, error: itemsError.message };
  }

  await clearCart(user.id);
  revalidateAll();
  return { ok: true, data: { order_number: order.order_number, id: order.id } };
}

// ---------------------------------------------------------------- CMS
export async function toggleAnnouncement(id: string, is_active: boolean): Promise<Result> {
  { const denied = await denyUnless("cms:write"); if (denied) return denied; }
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

// ---------------------------------------------------------------- customers (invite-link onboarding)
export interface InviteResult {
  inviteUrl: string;
  email: { to: string; subject: string; text: string; sent: boolean; reason?: string };
}

async function adminDisplayName(): Promise<string> {
  if (isDemo) return DEMO_ADMIN.name;
  const me = await (await import("@/lib/data")).getCurrentUser();
  return me?.company_name ?? "Operations team";
}

/** Composes and sends the invite email; returns the message so the admin can preview it. */
async function deliverInvite(to: string, company: string, token: string): Promise<InviteResult> {
  const url = inviteUrlFor(token);
  const msg = inviteEmail({ to, company, inviteUrl: url, adminName: await adminDisplayName() });
  const result = await sendEmail(msg);
  return { inviteUrl: url, email: { to, subject: msg.subject, text: msg.text, sent: result.sent, reason: result.reason } };
}

/**
 * Creates the customer account, generates a single-use invite link and emails
 * it. Live mode: the auth user is created with a random password the customer
 * replaces on acceptance. Demo mode: the link switches the portal to that customer.
 * Email goes out in either mode when RESEND_API_KEY is configured.
 */
export async function onboardCustomer(input: { company_name: string; email: string }): Promise<Result<InviteResult>> {
  { const denied = await denyUnless("customer:write"); if (denied) return denied; }
  const email = input.email.trim().toLowerCase();
  const company = input.company_name.trim();
  if (!email.includes("@")) return { ok: false, error: "Enter a valid email." };
  if (!company) return { ok: false, error: "Company name is required." };
  const token = crypto.randomUUID().replace(/-/g, "");
  const now = new Date().toISOString();
  const expires = inviteExpiry();

  if (isDemo) {
    if (demo.customers.some((c) => c.email === email)) return { ok: false, error: "A customer with that email already exists." };
    demo.customers.push({ id: newId(), email, role: "customer", company_name: company, billing_address: null, ntn: null, strn: null, is_active: true, suspended_at: null, suspended_by: null, suspend_reason: null, invite_expires_at: expires, invited_by: null, credit_limit: 0, credit_hold: false, payment_terms_days: null, invite_token: token, invited_at: now, activated_at: null, price_list_id: null, consolidated_billing: false, created_at: now });
  } else {
    const admin = createAdminClient();
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: crypto.randomUUID(), // replaced by the customer on invite acceptance
      email_confirm: true,
      user_metadata: { role: "customer", company_name: company },
    });
    if (error || !created.user) return { ok: false, error: error?.message ?? "Could not create user." };
    const { error: tokenError } = await admin.from("users").update({ invite_token: token, invited_at: now, invite_expires_at: expires }).eq("id", created.user.id);
    if (tokenError) return { ok: false, error: tokenError.message };
  }

  const result = await deliverInvite(email, company, token);
  revalidateAll();
  return { ok: true, data: result };
}

/** Re-sends the invite email using the customer's current link (does not invalidate it). */
export async function resendInvite(customerId: string): Promise<Result<InviteResult>> {
  let c: { email: string; company_name: string | null; invite_token: string | null } | undefined;
  if (isDemo) c = demo.customers.find((c) => c.id === customerId);
  else c = (await createAdminClient().from("users").select("email, company_name, invite_token").eq("id", customerId).maybeSingle()).data ?? undefined;
  if (!c) return { ok: false, error: "Customer not found." };
  if (!c.invite_token) return { ok: false, error: "This customer has already activated their account." };
  const result = await deliverInvite(c.email, c.company_name ?? c.email, c.invite_token);
  return { ok: true, data: result };
}

/** Issues a fresh link (invalidating the old one) and emails it. */
export async function regenerateInvite(customerId: string): Promise<Result<InviteResult>> {
  const token = crypto.randomUUID().replace(/-/g, "");
  const expires = inviteExpiry();
  let c: { email: string; company_name: string | null } | undefined;
  if (isDemo) {
    const d = demo.customers.find((c) => c.id === customerId);
    if (!d) return { ok: false, error: "Customer not found." };
    d.invite_token = token; d.invited_at = new Date().toISOString(); d.invite_expires_at = expires;
    c = d;
  } else {
    const admin = createAdminClient();
    const { data, error } = await admin.from("users").update({ invite_token: token, invited_at: new Date().toISOString(), invite_expires_at: expires }).eq("id", customerId).select("email, company_name").single();
    if (error || !data) return { ok: false, error: error?.message ?? "Customer not found." };
    c = data;
  }
  const result = await deliverInvite(c.email, c.company_name ?? c.email, token);
  revalidateAll();
  return { ok: true, data: result };
}

/** Looks up an invite token. Used by the /invite/[token] page. */
export interface InviteView {
  email: string;
  company_name: string | null;
  activated: boolean;
  expired: boolean;
  expires_at: string | null;
}

export async function getInvite(token: string): Promise<InviteView | null> {
  const row = isDemo
    ? [...demo.customers, ...demo.staff].find((c) => c.invite_token === token)
    : (await createAdminClient()
        .from("users")
        .select("email, company_name, activated_at, invite_expires_at, is_active")
        .eq("invite_token", token)
        .maybeSingle()).data;
  if (!row) return null;

  return {
    email: row.email,
    company_name: row.company_name,
    activated: !!row.activated_at,
    expired: isInviteExpired(row.invite_expires_at),
    expires_at: row.invite_expires_at,
  };
}



/** Customer accepts the invite: sets a password (live) and is signed in to the portal. */
export async function acceptInvite(token: string, password: string): Promise<Result> {
  if (isDemo) {
    const c = [...demo.customers, ...demo.staff].find((c) => c.invite_token === token);
    if (!c) return { ok: false, error: "This invite link is invalid or has already been used." };
    if (isInviteExpired(c.invite_expires_at)) {
      return { ok: false, error: "This invite link has expired. Ask Dynamic Traders to send a new one." };
    }
    if (!c.is_active) return { ok: false, error: "This account has been suspended." };
    c.activated_at = new Date().toISOString();
    c.invite_token = null;
    c.invite_expires_at = null;
    (await cookies()).set(DEMO_CUSTOMER_COOKIE, c.id, { path: "/", httpOnly: true, sameSite: "lax" });
    revalidateAll();
    return { ok: true };
  }
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("users").select("id, email, invite_expires_at, is_active")
    .eq("invite_token", token).maybeSingle();
  if (!profile) return { ok: false, error: "This invite link is invalid or has already been used." };
  if (isInviteExpired(profile.invite_expires_at)) {
    return { ok: false, error: "This invite link has expired. Ask Dynamic Traders to send a new one." };
  }
  if (!profile.is_active) return { ok: false, error: "This account has been suspended." };

  const { error } = await admin.auth.admin.updateUserById(profile.id, { password });
  if (error) return { ok: false, error: error.message };
  await admin.from("users").update({
    invite_token: null, invite_expires_at: null, activated_at: new Date().toISOString(),
  }).eq("id", profile.id);
  const { error: signInError } = await (await createClient()).auth.signInWithPassword({ email: profile.email, password });
  if (signInError) return { ok: false, error: signInError.message };
  revalidateAll();
  return { ok: true };
}

// ---------------------------------------------------------------- order conversation (send back / reply / resubmit)
async function author(): Promise<{ id: string; role: UserRole } | null> {
  const { getCurrentUser } = await import("@/lib/data");
  const u = await getCurrentUser();
  return u ? { id: u.id, role: u.role } : null;
}

async function addMessage(orderId: string, by: { id: string; role: UserRole }, body: string): Promise<Result> {
  if (isDemo) {
    demo.messages.push({ id: newId(), order_id: orderId, author_id: by.id, author_role: by.role, body, created_at: new Date().toISOString() });
    return { ok: true };
  }
  const { error } = await (await createClient()).from("order_messages").insert({ order_id: orderId, author_id: by.id, author_role: by.role, body });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Admin sends an order back to the customer with a comment and (optionally)
 * adjusted line quantities, e.g. "only half of the Hex Bolts are available".
 * Lines set to 0 are removed. The order moves to `changes_requested`.
 */
export async function sendBackOrder(orderId: string, comment: string, quantities: Record<string, number>): Promise<Result> {
  if (!comment.trim()) return { ok: false, error: "Add a comment so the customer knows what to change." };
  const denied = await denyUnless("order:write"); if (denied) return denied;

  const current = await getOrder(orderId);
  if (!current) return { ok: false, error: "Order not found." };
  const blocked = transitionError(current.status, "changes_requested");
  if (blocked) return { ok: false, error: blocked };
  const by = isDemo ? { id: DEMO_ADMIN_ID, role: "admin" as const } : await author();
  if (!by) return { ok: false, error: "Sign in first." };

  const changes: string[] = [];
  if (isDemo) {
    const o = demo.orders.find((o) => o.id === orderId);
    if (!o) return { ok: false, error: "Order not found." };
    o.items = o.items.flatMap((it) => {
      const q = quantities[it.id];
      if (q === undefined || q === it.quantity) return [it];
      const name = demo.products.find((p) => p.id === it.product_id)?.name ?? it.product_id;
      if (q <= 0) { changes.push(`Removed ${name}`); return []; }
      changes.push(`${name}: ${it.quantity.toLocaleString()} → ${q.toLocaleString()}`);
      return [{ ...it, quantity: q }];
    });
    if (o.items.length === 0) return { ok: false, error: "An order needs at least one line. Reject it instead." };
    o.status = "changes_requested";
  } else {
    const supabase = await createClient();
    const { data: items } = await supabase.from("order_items").select("id, quantity, product:products(name)").eq("order_id", orderId);
    for (const it of items ?? []) {
      const q = quantities[it.id];
      if (q === undefined || q === it.quantity) continue;
      const name = (it.product as unknown as { name: string } | null)?.name ?? "line";
      if (q <= 0) { await supabase.from("order_items").delete().eq("id", it.id); changes.push(`Removed ${name}`); }
      else { await supabase.from("order_items").update({ quantity: q }).eq("id", it.id); changes.push(`${name}: ${it.quantity.toLocaleString()} → ${q.toLocaleString()}`); }
    }
    const { error } = await supabase.from("orders").update({ status: "changes_requested" }).eq("id", orderId);
    if (error) return { ok: false, error: error.message };
  }
  const body = changes.length ? `${comment.trim()}\n\nProposed changes:\n• ${changes.join("\n• ")}` : comment.trim();
  const res = await addMessage(orderId, by, body);
  revalidateAll();
  return res;
}

/** Admin rejects with a reason that is posted to the thread so the customer knows why. */
export async function rejectOrder(orderId: string, reason: string): Promise<Result> {
  if (!reason.trim()) return { ok: false, error: "Give the customer a reason." };
  const by = isDemo ? { id: DEMO_ADMIN_ID, role: "admin" as const } : await author();
  if (!by || !isStaff(by.role)) return { ok: false, error: "Staff only." };
  const res = await setOrderStatus(orderId, "rejected");
  if (!res.ok) return res;
  await addMessage(orderId, by, "Order rejected: " + reason.trim());
  revalidateAll();
  return { ok: true };
}

/** Either side posts a reply on the order thread. */
export async function replyToOrder(orderId: string, body: string): Promise<Result> {
  if (!body.trim()) return { ok: false, error: "Message is empty." };
  const by = isDemo && (await author())?.role !== "customer" ? { id: DEMO_ADMIN_ID, role: "admin" as const } : await author();
  if (!by) return { ok: false, error: "Sign in to reply." };
  const res = await addMessage(orderId, by, body.trim());
  revalidateAll();
  return res;
}

/** Admin reply helper: always posts as admin (demo mode has no admin session). */
export async function adminReplyToOrder(orderId: string, body: string): Promise<Result> {
  if (!body.trim()) return { ok: false, error: "Message is empty." };
  const by = isDemo ? { id: DEMO_ADMIN_ID, role: "admin" as const } : await author();
  if (!by || !isStaff(by.role)) return { ok: false, error: "Staff only." };
  const res = await addMessage(orderId, by, body.trim());
  revalidateAll();
  return res;
}

/** Customer accepts the proposed changes (or edits quantities) and resubmits for approval. */
export async function resubmitOrder(orderId: string, quantities: Record<string, number>, note: string): Promise<Result> {
  const by = await author();
  if (!by) return { ok: false, error: "Sign in first." };

  const existing = await getOrder(orderId);
  if (!existing || existing.customer.id !== by.id) return { ok: false, error: "Order not found." };
  // Only an order the admin sent back is the customer's to change.
  if (existing.status !== "changes_requested") {
    return {
      ok: false,
      error: existing.status === "pending"
        ? "This order is already with us for approval."
        : transitionError(existing.status, "pending") ?? "This order can no longer be changed.",
    };
  }

  if (isDemo) {
    const o = demo.orders.find((o) => o.id === orderId && o.customer_id === by.id);
    if (!o) return { ok: false, error: "Order not found." };
    o.items = o.items.flatMap((it) => { const q = quantities[it.id] ?? it.quantity; return q <= 0 ? [] : [{ ...it, quantity: q }]; });
    if (o.items.length === 0) return { ok: false, error: "Keep at least one line, or withdraw the order." };
    o.status = "pending";
  } else {
    const supabase = await createClient();
    for (const [id, q] of Object.entries(quantities)) {
      if (q <= 0) await supabase.from("order_items").delete().eq("id", id);
      else await supabase.from("order_items").update({ quantity: q }).eq("id", id);
    }
    const { error } = await supabase.from("orders").update({ status: "pending" }).eq("id", orderId);
    if (error) return { ok: false, error: error.message };
  }
  await addMessage(orderId, by, note.trim() || "Accepted the changes and resubmitted for approval.");
  revalidateAll();
  return { ok: true };
}

/** Customer withdraws an open order. */
export async function withdrawOrder(orderId: string, reason: string): Promise<Result> {
  const by = await author();
  if (!by) return { ok: false, error: "Sign in first." };

  // Ownership is checked here as well as by row level security, so the
  // demo path cannot be used to withdraw somebody else's order.
  const order = await getOrder(orderId);
  if (!order || order.customer.id !== by.id) return { ok: false, error: "Order not found." };

  // Routed through setOrderStatus rather than writing the status directly,
  // so the transition table and the issued-invoice check both apply. This
  // is what previously allowed a dispatched, invoiced order to be
  // withdrawn from the portal.
  const res = await setOrderStatus(orderId, "cancelled", { asCustomer: true });
  if (!res.ok) return res;

  await addMessage(orderId, by, reason.trim() || "Order withdrawn by customer.");
  revalidateAll();
  return { ok: true };
}

// ---------------------------------------------------------------- auth
export async function signIn(email: string, password: string): Promise<Result<{ role: string }>> {
  if (isDemo) return { ok: true, data: { role: "admin" } };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("users").select("role, is_active, suspend_reason").eq("id", user!.id).single();

  // Checked after the password, not before: answering differently for a
  // suspended account than a wrong password would confirm the address
  // exists to anyone guessing.
  if (profile && !profile.is_active) {
    await supabase.auth.signOut();
    return {
      ok: false,
      error: "This account has been suspended. Contact Dynamic Traders if you think that is a mistake.",
    };
  }
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

// ---------------------------------------------------------------- customer billing
export interface CustomerBilling {
  company_name: string;
  billing_address: string;
  ntn: string;
  strn: string;
}

/**
 * Billing and tax identity. Finance owns this because invoices print it,
 * and an invoice already issued keeps its own frozen copy regardless.
 */
export async function updateCustomerBilling(customerId: string, input: CustomerBilling): Promise<Result> {
  const denied = await denyUnless("customer:billing"); if (denied) return denied;
  if (!input.company_name.trim()) return { ok: false, error: "Company name is required." };

  const patch = {
    company_name: input.company_name.trim(),
    billing_address: input.billing_address.trim() || null,
    ntn: input.ntn.trim() || null,
    strn: input.strn.trim() || null,
  };

  if (isDemo) {
    const c = demo.customers.find((c) => c.id === customerId);
    if (!c) return { ok: false, error: "Customer not found." };
    Object.assign(c, patch);
  } else {
    const { error } = await (await createClient()).from("users").update(patch).eq("id", customerId);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${customerId}`);
  return { ok: true };
}

export interface CustomerCredit {
  credit_limit: number;
  credit_hold: boolean;
  payment_terms_days: number | null;
}

/**
 * Credit terms. Separate from billing details because this is a
 * commercial decision that blocks approvals, not data entry, and the
 * capability that guards it should be able to differ later.
 */
export async function updateCustomerCredit(customerId: string, input: CustomerCredit): Promise<Result> {
  const denied = await denyUnless("customer:billing"); if (denied) return denied;
  if (!(input.credit_limit >= 0)) return { ok: false, error: "A credit limit cannot be negative." };
  if (input.payment_terms_days !== null && (!Number.isInteger(input.payment_terms_days) || input.payment_terms_days < 0)) {
    return { ok: false, error: "Payment terms must be a whole number of days." };
  }

  const patch = {
    credit_limit: input.credit_limit,
    credit_hold: input.credit_hold,
    payment_terms_days: input.payment_terms_days,
  };

  if (isDemo) {
    const c = demo.customers.find((c) => c.id === customerId);
    if (!c) return { ok: false, error: "Customer not found." };
    Object.assign(c, patch);
  } else {
    const { error } = await (await createClient()).from("users").update(patch).eq("id", customerId);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/admin/customers");
  revalidatePath("/admin/receivables");
  revalidatePath(`/admin/customers/${customerId}`);
  return { ok: true };
}
