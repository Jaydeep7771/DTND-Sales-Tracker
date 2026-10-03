/**
 * Stock movements and their cost consequences.
 *
 * The rule this module exists to enforce: **stock never changes without a
 * movement row, and a movement that leaves the business posts its cost to
 * the ledger.** Before this, the demo path edited a counter and the live
 * path did nothing at all, so inventory on the balance sheet was whatever
 * had been typed in once and cost of goods sold was never recorded.
 *
 * Valuation is moving average. It is the usual basis for a distributor
 * buying the same line repeatedly at drifting prices, and unlike FIFO it
 * needs no layer tracking, so a stocktake can be reconciled by hand.
 */
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { demo, newId } from "@/lib/demo-store";
import { isDemo, getCurrentStaff } from "@/lib/data";
import { postEntry } from "@/lib/ledger";
import { businessDate, round2 } from "@/lib/accounting";
import type { StockMovement, StockReason } from "@/types/database";

export type MoveResult = { ok: true; value: number } | { ok: false; error: string };

export interface MovementInput {
  product_id: string;
  /** Signed: positive brings stock in, negative sends it out. */
  quantity: number;
  reason: StockReason;
  unit_cost?: number;        // defaults to the product's moving average
  order_id?: string | null;
  invoice_id?: string | null;
  note?: string | null;
  moved_on?: string;
}

async function productOf(id: string) {
  if (isDemo) return demo.products.find((p) => p.id === id) ?? null;
  const { data } = await (await createClient()).from("products").select("*").eq("id", id).single();
  return data;
}

async function insertMovement(row: Omit<StockMovement, "id" | "created_at">): Promise<string | null> {
  if (isDemo) {
    const id = newId();
    demo.stock.push({ ...row, id, created_at: new Date().toISOString() });
    const p = demo.products.find((x) => x.id === row.product_id);
    if (p) p.stock_quantity = Math.max(0, p.stock_quantity + row.quantity);
    return id;
  }
  // Live: the trigger keeps products.stock_quantity in step.
  const { data, error } = await (await createClient()).from("stock_movements").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

/**
 * Records one movement and returns its value. Does not post to the ledger;
 * callers that need a journal entry pass its id in, because several
 * movements usually share one entry (a dispatch of six lines is one entry,
 * not six).
 */
export async function recordMovement(
  input: MovementInput,
  journalEntryId: string | null = null,
): Promise<MoveResult> {
  if (!Number.isInteger(input.quantity) || input.quantity === 0) {
    return { ok: false, error: "A stock movement needs a whole, non-zero quantity." };
  }
  const product = await productOf(input.product_id);
  if (!product) return { ok: false, error: "Product not found." };

  if (input.quantity < 0 && product.stock_quantity + input.quantity < 0) {
    return { ok: false, error: `${product.name} has only ${product.stock_quantity} in stock.` };
  }

  const unit_cost = round2(input.unit_cost ?? Number(product.cost_price ?? 0));
  const value = round2(input.quantity * unit_cost);
  const staff = await getCurrentStaff();

  await insertMovement({
    product_id: input.product_id,
    quantity: input.quantity,
    unit_cost,
    value,
    reason: input.reason,
    order_id: input.order_id ?? null,
    invoice_id: input.invoice_id ?? null,
    journal_entry_id: journalEntryId,
    note: input.note ?? null,
    moved_on: input.moved_on ?? businessDate(),
    created_by: staff?.id ?? null,
  });

  return { ok: true, value };
}

/**
 * Dispatches an order: relieves stock and posts the cost of the goods.
 *
 * Called when the order is marked fulfilled, not when it is approved.
 * Approval is a commercial promise; until the goods leave the warehouse
 * they are still the business's asset and belong on its balance sheet.
 *
 * One journal entry covers the whole dispatch:
 *   Dr Cost of Goods Sold   total cost
 *   Cr Inventory            total cost
 *
 * Lines with no cost recorded contribute nothing and are reported back, so
 * a missing cost shows up as a warning rather than a silently zero margin.
 */
export async function dispatchOrder(
  orderId: string,
  lines: { product_id: string; name: string; quantity: number }[],
): Promise<{ ok: true; cost: number; uncosted: string[] } | { ok: false; error: string }> {
  if (lines.length === 0) return { ok: false, error: "This order has no lines to dispatch." };

  // Price the dispatch before touching anything, so a shortfall on the
  // last line does not leave the first five already relieved.
  const priced: { product_id: string; quantity: number; unit_cost: number; name: string }[] = [];
  const uncosted: string[] = [];
  for (const l of lines) {
    const p = await productOf(l.product_id);
    if (!p) return { ok: false, error: `${l.name} no longer exists in the catalogue.` };
    if (p.stock_quantity < l.quantity) {
      return { ok: false, error: `${p.name} has ${p.stock_quantity} in stock but the order needs ${l.quantity}.` };
    }
    const unit_cost = round2(Number(p.cost_price ?? 0));
    if (unit_cost === 0) uncosted.push(p.name);
    priced.push({ product_id: l.product_id, quantity: l.quantity, unit_cost, name: p.name });
  }

  const cost = round2(priced.reduce((a, l) => a + l.quantity * l.unit_cost, 0));

  // Post the cost first. If posting fails the goods stay on the shelf,
  // which is recoverable; relieving stock without the entry is not.
  let entryId: string | null = null;
  if (cost > 0) {
    const posted = await postEntry({
      entry_date: businessDate(),
      narration: `Cost of goods dispatched on order ${orderId.slice(0, 8)}`,
      source_type: "dispatch",
      source_id: orderId,
      lines: [
        { system_key: "cogs", debit: cost },
        { system_key: "inventory", credit: cost },
      ],
    });
    if (!posted.ok) return { ok: false, error: `Could not post the cost of sale: ${posted.error}` };
    entryId = posted.entryId;
  }

  for (const l of priced) {
    const res = await recordMovement(
      { product_id: l.product_id, quantity: -l.quantity, reason: "dispatch", unit_cost: l.unit_cost, order_id: orderId },
      entryId,
    );
    if (!res.ok) return { ok: false, error: res.error };
  }

  return { ok: true, cost, uncosted };
}

/**
 * Opening stock when a product is created. Posts Dr Inventory / Cr Opening
 * Balance Equity, which is how stock brought in from outside the system
 * enters the books without inventing revenue or a purchase.
 */
export async function recordOpeningStock(
  productId: string,
  quantity: number,
  unitCost: number,
): Promise<MoveResult> {
  if (quantity <= 0) return { ok: true, value: 0 };
  const value = round2(quantity * round2(unitCost));

  let entryId: string | null = null;
  if (value > 0) {
    const posted = await postEntry({
      entry_date: businessDate(),
      narration: "Opening stock brought forward",
      source_type: "stock",
      source_id: productId,
      lines: [
        { system_key: "inventory", debit: value },
        { system_key: "opening_balance", credit: value },
      ],
    });
    if (!posted.ok) return { ok: false, error: `Could not post opening stock: ${posted.error}` };
    entryId = posted.entryId;
  }

  return recordMovement(
    { product_id: productId, quantity, reason: "opening", unit_cost: unitCost, note: "Opening stock" },
    entryId,
  );
}

/**
 * A stocktake correction. Posts the difference to Stock Adjustments rather
 * than to cost of sales, because shrinkage and damage are not the cost of
 * goods a customer bought and should not sit inside gross margin.
 */
export async function adjustStock(
  productId: string,
  newQuantity: number,
  note: string,
): Promise<MoveResult> {
  const product = await productOf(productId);
  if (!product) return { ok: false, error: "Product not found." };
  if (!Number.isInteger(newQuantity) || newQuantity < 0) {
    return { ok: false, error: "Enter the counted quantity as a whole number." };
  }

  const delta = newQuantity - product.stock_quantity;
  if (delta === 0) return { ok: true, value: 0 };

  const unit_cost = round2(Number(product.cost_price ?? 0));
  const value = round2(Math.abs(delta) * unit_cost);

  let entryId: string | null = null;
  if (value > 0) {
    // A shortfall is an expense; a surplus reduces that expense.
    const posted = await postEntry({
      entry_date: businessDate(),
      narration: `Stock adjustment: ${product.name}${note ? ` · ${note}` : ""}`,
      source_type: "stock",
      source_id: productId,
      lines:
        delta < 0
          ? [{ system_key: "stock_adjustment", debit: value }, { system_key: "inventory", credit: value }]
          : [{ system_key: "inventory", debit: value }, { system_key: "stock_adjustment", credit: value }],
    });
    if (!posted.ok) return { ok: false, error: `Could not post the adjustment: ${posted.error}` };
    entryId = posted.entryId;
  }

  return recordMovement(
    { product_id: productId, quantity: delta, reason: "adjustment", unit_cost, note: note || "Stocktake" },
    entryId,
  );
}

/**
 * Moving average on receipt: new average = total value / total units.
 * Returning the figure rather than writing it lets the caller save it in
 * the same update as the rest of the bill.
 */
export function movingAverage(
  onHand: number, currentCost: number, received: number, receiptCost: number,
): number {
  const units = onHand + received;
  if (units <= 0) return round2(receiptCost);
  return round2((onHand * currentCost + received * receiptCost) / units);
}
