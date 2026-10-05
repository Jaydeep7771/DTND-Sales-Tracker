"use server";

/**
 * Admin maintenance of the rate card: tiers, rules and who sits where.
 *
 * Pricing is an admin capability rather than a finance one. Finance
 * bills what was agreed; agreeing it is a commercial decision, and the
 * separation of duties that keeps the ledger honest applies here too.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { demo, newId } from "@/lib/demo-store";
import { isDemo, getCurrentStaff, getPriceLists } from "@/lib/data";
import { can } from "@/lib/permissions";
import type { PriceList, PriceRule } from "@/types/database";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function denyUnlessPricing(): Promise<Result | null> {
  const role = (await getCurrentStaff())?.role ?? null;
  if (can(role, "pricing:write")) return null;
  return { ok: false, error: "Your role does not permit changing prices." };
}

function revalidatePricing() {
  revalidatePath("/admin/pricing");
  revalidatePath("/admin/customers");
  revalidatePath("/portal");
}

export interface PriceListInput {
  name: string;
  description: string;
  is_default: boolean;
  is_active: boolean;
}

export async function savePriceList(id: string | null, input: PriceListInput): Promise<Result<{ id: string }>> {
  const denied = await denyUnlessPricing(); if (denied) return denied;
  const name = input.name.trim();
  if (!name) return { ok: false, error: "A price list needs a name." };

  // Deactivating the default would leave new customers with no tier at
  // all. Make another list the default first.
  if (input.is_default && !input.is_active) {
    return { ok: false, error: "The default price list must stay active." };
  }

  if (isDemo) {
    if (input.is_default) demo.priceLists.forEach((l) => { l.is_default = false; });
    if (id) {
      const row = demo.priceLists.find((l) => l.id === id);
      if (!row) return { ok: false, error: "Price list not found." };
      Object.assign(row, { name, description: input.description.trim() || null, is_default: input.is_default, is_active: input.is_active });
      revalidatePricing();
      return { ok: true, data: { id } };
    }
    const row: PriceList = {
      id: newId(), name, description: input.description.trim() || null,
      is_default: input.is_default, is_active: input.is_active, created_at: new Date().toISOString(),
    };
    demo.priceLists.push(row);
    revalidatePricing();
    return { ok: true, data: { id: row.id } };
  }

  const supabase = await createClient();
  // The partial unique index refuses a second default, so clear the old
  // one first rather than letting the insert fail.
  if (input.is_default) await supabase.from("price_lists").update({ is_default: false }).neq("id", id ?? "00000000-0000-0000-0000-000000000000");

  const patch = { name, description: input.description.trim() || null, is_default: input.is_default, is_active: input.is_active };
  const { data, error } = id
    ? await supabase.from("price_lists").update(patch).eq("id", id).select("id").single()
    : await supabase.from("price_lists").insert(patch).select("id").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not save the price list." };

  revalidatePricing();
  return { ok: true, data: { id: data.id } };
}

export interface PriceRuleInput {
  /** Exactly one of these. A list rule is a tier rate; a customer rule is a contract. */
  price_list_id?: string | null;
  customer_id?: string | null;
  product_id: string;
  min_quantity: number;
  unit_price: number;
  valid_from: string | null;
  valid_to: string | null;
  note: string;
}

export async function savePriceRule(id: string | null, input: PriceRuleInput): Promise<Result<{ id: string }>> {
  const denied = await denyUnlessPricing(); if (denied) return denied;

  const listId = input.price_list_id || null;
  const customerId = input.customer_id || null;
  if (!!listId === !!customerId) {
    return { ok: false, error: "A price rule belongs either to a price list or to one customer, not both." };
  }
  if (!input.product_id) return { ok: false, error: "Pick a product." };

  const min = Math.floor(input.min_quantity);
  if (!Number.isFinite(min) || min < 1) return { ok: false, error: "The break quantity must be 1 or more." };
  if (!Number.isFinite(input.unit_price) || input.unit_price < 0) return { ok: false, error: "Enter a unit price." };
  if (input.valid_from && input.valid_to && input.valid_to < input.valid_from) {
    return { ok: false, error: "The end date cannot be before the start date." };
  }

  const patch = {
    price_list_id: listId,
    customer_id: customerId,
    product_id: input.product_id,
    min_quantity: min,
    unit_price: Math.round(input.unit_price * 100) / 100,
    valid_from: input.valid_from || null,
    valid_to: input.valid_to || null,
    note: input.note.trim() || null,
  };

  if (isDemo) {
    const clash = demo.priceRules.find(
      (r) => r.id !== id && r.product_id === patch.product_id && r.min_quantity === min &&
        r.price_list_id === listId && r.customer_id === customerId,
    );
    if (clash) return { ok: false, error: "A rule already exists for that product at that break quantity." };

    if (id) {
      const row = demo.priceRules.find((r) => r.id === id);
      if (!row) return { ok: false, error: "Price rule not found." };
      Object.assign(row, patch);
      revalidatePricing();
      return { ok: true, data: { id } };
    }
    const row: PriceRule = { id: newId(), ...patch, created_by: null, created_at: new Date().toISOString() };
    demo.priceRules.push(row);
    revalidatePricing();
    return { ok: true, data: { id: row.id } };
  }

  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("price_rules").update(patch).eq("id", id).select("id").single()
    : await supabase.from("price_rules").insert(patch).select("id").single();

  if (error) {
    // The unique indexes are the real guard; translate rather than leak.
    if (error.code === "23505") return { ok: false, error: "A rule already exists for that product at that break quantity." };
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: "Could not save the price rule." };

  revalidatePricing();
  return { ok: true, data: { id: data.id } };
}

export async function deletePriceRule(id: string): Promise<Result> {
  const denied = await denyUnlessPricing(); if (denied) return denied;

  if (isDemo) {
    const i = demo.priceRules.findIndex((r) => r.id === id);
    if (i >= 0) demo.priceRules.splice(i, 1);
  } else {
    const { error } = await (await createClient()).from("price_rules").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePricing();
  return { ok: true };
}

/** Moves a customer onto a tier. Null puts them back on the default. */
export async function setCustomerPriceList(customerId: string, priceListId: string | null): Promise<Result> {
  const denied = await denyUnlessPricing(); if (denied) return denied;

  if (priceListId) {
    const lists = await getPriceLists();
    const list = lists.find((l) => l.id === priceListId);
    if (!list) return { ok: false, error: "That price list does not exist." };
    if (!list.is_active) return { ok: false, error: "That price list is retired. Pick an active one." };
  }

  if (isDemo) {
    const c = demo.customers.find((c) => c.id === customerId);
    if (!c) return { ok: false, error: "Customer not found." };
    c.price_list_id = priceListId;
  } else {
    const { error } = await (await createClient()).from("users").update({ price_list_id: priceListId }).eq("id", customerId);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePricing();
  revalidatePath(`/admin/customers/${customerId}`);
  return { ok: true };
}

/**
 * Whether a product may be ordered beyond free stock.
 *
 * Off by default. Turn it on only for lines you actually restock to
 * order, because every one that is on is a promise somebody has to keep.
 */
export async function setAllowBackorder(productId: string, allow: boolean): Promise<Result> {
  const denied = await denyUnlessPricing(); if (denied) return denied;

  if (isDemo) {
    const p = demo.products.find((p) => p.id === productId);
    if (!p) return { ok: false, error: "Product not found." };
    p.allow_backorder = allow;
  } else {
    const { error } = await (await createClient()).from("products").update({ allow_backorder: allow }).eq("id", productId);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/admin/products");
  revalidatePath("/portal");
  return { ok: true };
}
