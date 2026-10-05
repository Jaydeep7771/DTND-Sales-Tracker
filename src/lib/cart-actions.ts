"use server";

/**
 * Cart mutations.
 *
 * The cart lives on the server so it follows the buyer between the
 * phone in the warehouse and the laptop at the desk. Every one of these
 * writes only a product id and a quantity: price is never sent by the
 * browser and never stored, it is resolved on read. That removes a whole
 * class of problem where a cart quietly carries a stale or tampered
 * price into an order.
 *
 * Quantities are capped here against free stock as well as in the UI.
 * The UI cap is a courtesy; this one is the rule.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { demo, newId } from "@/lib/demo-store";
import { isDemo, getAvailabilityMap, getCart, getCurrentUser } from "@/lib/data";
import { availabilityOf } from "@/lib/availability";
import type { CartView } from "@/lib/types";
import type { Product } from "@/types/database";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function revalidateCart() {
  revalidatePath("/portal");
  revalidatePath("/portal/checkout");
}

async function me(): Promise<string | null> {
  return (await getCurrentUser())?.id ?? null;
}

async function productById(id: string): Promise<Product | null> {
  if (isDemo) return demo.products.find((p) => p.id === id) ?? null;
  const { data } = await (await createClient()).from("products").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

/**
 * The most of this product that may sit in a cart.
 *
 * Returns the requested quantity when the product is backorderable,
 * otherwise clamps to free stock. Clamping rather than rejecting is
 * deliberate: a buyer who asks for 500 and can have 320 almost always
 * wants the 320, and telling them so beats an error that loses the line.
 */
async function cap(product: Product, want: number): Promise<{ qty: number; clamped: boolean; available: number }> {
  const available = availabilityOf(await getAvailabilityMap(), product.id).available;
  if (product.allow_backorder) return { qty: want, clamped: false, available };
  const qty = Math.max(0, Math.min(want, available));
  return { qty, clamped: qty < want, available };
}

export async function readCart(): Promise<CartView> {
  return getCart();
}

/** Every mutation hands back the whole recomputed cart, so the client
 *  never has to guess what the server decided. */
export interface CartResult {
  cart: CartView;
  /** True when the quantity was reduced to the free stock. */
  clamped: boolean;
  available: number;
}

export async function addToCart(productId: string, quantity: number): Promise<Result<CartResult>> {
  const id = await me();
  if (!id) return { ok: false, error: "Sign in to use a cart." };

  const want = Math.floor(quantity);
  if (!Number.isFinite(want) || want < 1) return { ok: false, error: "Quantity must be at least 1." };

  const product = await productById(productId);
  if (!product || product.is_archived) return { ok: false, error: "That product is no longer available." };

  const existing = isDemo
    ? demo.cart.find((c) => c.customer_id === id && c.product_id === productId)
    : (await (await createClient()).from("cart_items").select("*").eq("customer_id", id).eq("product_id", productId).maybeSingle()).data;

  const { qty, clamped, available } = await cap(product, (existing?.quantity ?? 0) + want);
  if (qty === 0) return { ok: false, error: `${product.name} is out of stock and cannot be backordered.` };

  if (isDemo) {
    if (existing) existing.quantity = qty;
    else demo.cart.push({ id: newId(), customer_id: id, product_id: productId, quantity: qty, added_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  } else {
    const { error } = await (await createClient())
      .from("cart_items")
      .upsert({ customer_id: id, product_id: productId, quantity: qty, updated_at: new Date().toISOString() }, { onConflict: "customer_id,product_id" });
    if (error) return { ok: false, error: error.message };
  }

  revalidateCart();
  return { ok: true, data: { cart: await getCart(id), clamped, available } };
}

export async function setCartQuantity(productId: string, quantity: number): Promise<Result<CartResult>> {
  const id = await me();
  if (!id) return { ok: false, error: "Sign in to use a cart." };

  const want = Math.floor(quantity);
  if (want <= 0) {
    const removed = await removeFromCart(productId);
    return removed.ok ? { ok: true, data: { cart: await getCart(id), clamped: false, available: 0 } } : removed;
  }

  const product = await productById(productId);
  if (!product) return { ok: false, error: "That product is no longer available." };

  const { qty, clamped, available } = await cap(product, want);
  if (qty === 0) return { ok: false, error: `${product.name} is out of stock and cannot be backordered.` };

  if (isDemo) {
    const row = demo.cart.find((c) => c.customer_id === id && c.product_id === productId);
    if (row) row.quantity = qty;
  } else {
    const { error } = await (await createClient())
      .from("cart_items").update({ quantity: qty, updated_at: new Date().toISOString() })
      .eq("customer_id", id).eq("product_id", productId);
    if (error) return { ok: false, error: error.message };
  }

  revalidateCart();
  return { ok: true, data: { cart: await getCart(id), clamped, available } };
}

export async function removeFromCart(productId: string): Promise<Result<{ cart: CartView }>> {
  const id = await me();
  if (!id) return { ok: false, error: "Sign in to use a cart." };

  if (isDemo) {
    const i = demo.cart.findIndex((c) => c.customer_id === id && c.product_id === productId);
    if (i >= 0) demo.cart.splice(i, 1);
  } else {
    const { error } = await (await createClient()).from("cart_items").delete().eq("customer_id", id).eq("product_id", productId);
    if (error) return { ok: false, error: error.message };
  }

  revalidateCart();
  return { ok: true, data: { cart: await getCart(id) } };
}

export async function clearCart(customerId?: string): Promise<Result> {
  const id = customerId ?? (await me());
  if (!id) return { ok: false, error: "Sign in to use a cart." };

  if (isDemo) {
    for (let i = demo.cart.length - 1; i >= 0; i--) if (demo.cart[i].customer_id === id) demo.cart.splice(i, 1);
  } else {
    const { error } = await (await createClient()).from("cart_items").delete().eq("customer_id", id);
    if (error) return { ok: false, error: error.message };
  }

  revalidateCart();
  return { ok: true };
}

/**
 * Takes over a cart that was built in localStorage before this change,
 * or on a browser that was signed out at the time.
 *
 * Quantities are added to whatever is already on the server rather than
 * replacing it, because the buyer put both sets of lines there on
 * purpose. Runs once: the client clears its copy on a successful merge.
 */
export async function mergeLocalCart(lines: { product_id: string; quantity: number }[]): Promise<Result<CartView>> {
  const id = await me();
  if (!id) return { ok: false, error: "Sign in to use a cart." };
  if (!lines.length) return { ok: true, data: await getCart(id) };

  // Capped at a sane number of lines so a corrupted localStorage blob
  // cannot turn into thousands of writes.
  for (const l of lines.slice(0, 200)) {
    if (!l?.product_id || !Number.isFinite(l.quantity) || l.quantity < 1) continue;
    await addToCart(l.product_id, Math.floor(l.quantity));
  }

  revalidateCart();
  return { ok: true, data: await getCart(id) };
}
