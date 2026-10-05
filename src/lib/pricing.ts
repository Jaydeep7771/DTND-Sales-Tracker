/**
 * Price resolution.
 *
 * A wholesaler does not have one price. It has a rate card per trade
 * tier, negotiated prices for particular accounts, and a cheaper unit
 * rate once you buy a pallet instead of a box. All three are the same
 * shape — a price that applies to a product, for somebody, above some
 * quantity — so they are one rule table and one resolver.
 *
 * Most specific wins:
 *
 *   1. a rule written for this customer
 *   2. a rule on the price list this customer sits on
 *   3. products.price, the list price
 *
 * Within whichever of those applies, the break used is the highest
 * min_quantity the line actually reaches. Falling back a tier is not
 * allowed: if a customer has a contract on a product, that contract is
 * their price, even on a quantity where the tier happens to be cheaper.
 * A negotiated price is a commitment, not a floor, and quietly beating
 * it is how you end up explaining an invoice to someone.
 *
 * Pure on purpose. The resolver takes rules and returns a price, so it
 * is the same code in the catalogue, in the cart and at order submit,
 * and the submit path never has to trust what the browser sent.
 */
import type { PriceRule } from "@/types/database";

export interface PricedUnit {
  /** Price per unit for this quantity. */
  unit_price: number;
  /** The product's own list price, for showing what was saved. */
  list_price: number;
  /** Where the price came from, for the UI and for support calls. */
  source: "contract" | "tier" | "list";
  /** Tier name, when source is "tier". */
  source_name?: string;
  /** The break that applied, when the rule had one above 1. */
  break_quantity?: number;
  /** The next break up, so the catalogue can say "500+ at 142.00". */
  next_break?: { min_quantity: number; unit_price: number };
}

export interface PriceContext {
  /** Rules scoped to this customer, any product. */
  customerRules: PriceRule[];
  /** Rules on the customer's price list, any product. */
  listRules: PriceRule[];
  /** Name of that price list, for display. */
  listName?: string;
  /** Business date the rules are evaluated on, YYYY-MM-DD. */
  on: string;
}

function inTerm(rule: PriceRule, on: string): boolean {
  if (rule.valid_from && on < rule.valid_from) return false;
  if (rule.valid_to && on > rule.valid_to) return false;
  return true;
}

/** Breaks for one product in one scope, cheapest-qualifying order. */
function breaksFor(rules: PriceRule[], productId: string, on: string): PriceRule[] {
  return rules
    .filter((r) => r.product_id === productId && inTerm(r, on))
    .sort((a, b) => a.min_quantity - b.min_quantity);
}

function pick(breaks: PriceRule[], qty: number): { applied: PriceRule | null; next: PriceRule | null } {
  let applied: PriceRule | null = null;
  let next: PriceRule | null = null;
  for (const r of breaks) {
    if (r.min_quantity <= qty) applied = r;
    else if (!next) next = r;
  }
  return { applied, next };
}

/**
 * The price one customer pays for one product at one quantity.
 *
 * `quantity` matters: ask for the price of 1 and you get the entry
 * price, which is what a catalogue card should show, with `next_break`
 * telling the buyer what ordering more would do.
 */
export function resolvePrice(
  product: { id: string; price: number },
  quantity: number,
  ctx: PriceContext,
): PricedUnit {
  const list_price = product.price;
  const qty = Math.max(1, Math.floor(quantity));

  for (const [scope, rules, source] of [
    ["contract", ctx.customerRules, "contract"],
    ["tier", ctx.listRules, "tier"],
  ] as const) {
    const breaks = breaksFor(rules, product.id, ctx.on);
    if (!breaks.length) continue;
    const { applied, next } = pick(breaks, qty);
    // Breaks that all start above this quantity leave nothing applied;
    // the scope still owns the product, so fall through to list price
    // but keep advertising the break the buyer could reach.
    if (!applied) {
      return {
        unit_price: list_price,
        list_price,
        source: "list",
        next_break: next ? { min_quantity: next.min_quantity, unit_price: next.unit_price } : undefined,
      };
    }
    return {
      unit_price: applied.unit_price,
      list_price,
      source,
      source_name: scope === "tier" ? ctx.listName : undefined,
      break_quantity: applied.min_quantity > 1 ? applied.min_quantity : undefined,
      next_break: next ? { min_quantity: next.min_quantity, unit_price: next.unit_price } : undefined,
    };
  }

  return { unit_price: list_price, list_price, source: "list" };
}

/** Whole-line money, rounded once at the line rather than per unit. */
export function lineTotal(unit: PricedUnit, quantity: number): number {
  return Math.round(unit.unit_price * quantity * 100) / 100;
}

/** What the customer saved against list on this line. Never negative. */
export function savingOn(unit: PricedUnit, quantity: number): number {
  return Math.max(0, Math.round((unit.list_price - unit.unit_price) * quantity * 100) / 100);
}

/** One line of a ladder for the product page: "100+ 142.00, 500+ 136.00". */
export function ladderFor(product: { id: string; price: number }, ctx: PriceContext): { min_quantity: number; unit_price: number }[] {
  const scoped = breaksFor(ctx.customerRules, product.id, ctx.on);
  const rules = scoped.length ? scoped : breaksFor(ctx.listRules, product.id, ctx.on);
  if (!rules.length) return [];
  const ladder = rules.map((r) => ({ min_quantity: r.min_quantity, unit_price: r.unit_price }));
  // Show list price as the opening rung when the first break starts higher.
  if (ladder[0].min_quantity > 1) ladder.unshift({ min_quantity: 1, unit_price: product.price });
  return ladder;
}
