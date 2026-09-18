/** Formatting helpers shared by admin and portal. */

export function money(n: number): string {
  return "PKR " + Math.round(n).toLocaleString("en-US");
}

export function num(n: number): string {
  return n.toLocaleString("en-US");
}

/** "18 Sep, 09:12" */
export function shortDateTime(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) +
    ", " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  );
}

/** "18 Sep 2026" */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** "Thursday, 18 September" */
export function longDate(d = new Date()): string {
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export type StockState = "In stock" | "Low stock" | "Backorder";

export function stockState(stock: number, reorder: number): StockState {
  if (stock === 0) return "Backorder";
  if (stock < reorder) return "Low stock";
  return "In stock";
}
