/**
 * What a customer can actually order.
 *
 * stock_quantity is what is on the shelf, and some of it is already
 * promised. An approved order has been committed to a buyer but has not
 * been dispatched, so its stock has not been relieved and is not free
 * either. Selling it twice is the thing this file exists to stop.
 *
 * Pending orders are not committed. They have not been approved, and
 * treating an unapproved order as a reservation would let anybody block
 * stock by filling a cart.
 *
 * The check is advisory in the browser and binding at submit. The
 * browser copy keeps buyers from building a cart that cannot ship; the
 * submit copy is the one that counts, because the browser's numbers are
 * always a few seconds old and someone else may have taken the stock.
 */

export interface Availability {
  product_id: string;
  on_hand: number;
  committed: number;
  available: number;
}

export interface StockCheckLine {
  product_id: string;
  name: string;
  quantity: number;
  allow_backorder: boolean;
}

export interface StockProblem {
  product_id: string;
  name: string;
  requested: number;
  available: number;
  /** Backorder lines are reported but do not block. */
  kind: "over" | "backorder";
}

export const NO_AVAILABILITY: Availability = { product_id: "", on_hand: 0, committed: 0, available: 0 };

export function availabilityOf(map: Map<string, Availability>, productId: string): Availability {
  return map.get(productId) ?? { ...NO_AVAILABILITY, product_id: productId };
}

/**
 * Checks a whole cart in one pass.
 *
 * `blocking` is what must be fixed before the order can be submitted;
 * `backorders` is what will ship late and the buyer should be told
 * about. Separating them matters: a distributor genuinely does take
 * orders it cannot fill today, but only on lines where that was a
 * decision rather than an accident.
 */
export function checkStock(
  lines: StockCheckLine[],
  map: Map<string, Availability>,
): { blocking: StockProblem[]; backorders: StockProblem[] } {
  const blocking: StockProblem[] = [];
  const backorders: StockProblem[] = [];

  for (const l of lines) {
    const available = availabilityOf(map, l.product_id).available;
    if (l.quantity <= available) continue;
    const problem: StockProblem = {
      product_id: l.product_id,
      name: l.name,
      requested: l.quantity,
      available: Math.max(0, available),
      kind: l.allow_backorder ? "backorder" : "over",
    };
    (l.allow_backorder ? backorders : blocking).push(problem);
  }

  return { blocking, backorders };
}

/** The most of this product that may go in a cart right now. */
export function maxOrderable(available: number, allowBackorder: boolean): number | null {
  if (allowBackorder) return null; // no ceiling
  return Math.max(0, available);
}

export function stockMessage(p: StockProblem): string {
  if (p.kind === "backorder") {
    return p.available > 0
      ? `${p.name}: ${p.available} available now, the remaining ${p.requested - p.available} will ship on restock.`
      : `${p.name}: out of stock, the full ${p.requested} will ship on restock.`;
  }
  return p.available > 0
    ? `${p.name}: only ${p.available} available, you asked for ${p.requested}.`
    : `${p.name}: out of stock and not available to backorder.`;
}
