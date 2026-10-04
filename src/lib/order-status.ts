/**
 * Which order status may follow which.
 *
 * This existed only in the UI: screens hid the buttons that did not apply,
 * and the server accepted anything. So a fulfilled, dispatched, invoiced
 * order could be withdrawn by a crafted request, leaving goods gone, an
 * invoice outstanding and an order marked cancelled.
 *
 * One table, consulted by every action that moves an order, is the fix.
 */
import type { OrderStatus } from "@/types/database";

/**
 * Dispatch and the two refusals are terminal.
 *
 * Once goods have left the warehouse the order is history: a return is a
 * credit note plus a stock movement, not a status change, because only
 * those record what actually happened to the goods and the money. Letting
 * a fulfilled order go back to cancelled would silently strand the stock
 * and the receivable.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["approved", "changes_requested", "rejected", "cancelled"],
  changes_requested: ["pending", "approved", "rejected", "cancelled"],
  approved: ["fulfilled", "cancelled"],
  fulfilled: [],
  rejected: [],
  cancelled: [],
};

export const TERMINAL: OrderStatus[] = ["fulfilled", "rejected", "cancelled"];

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL.includes(status);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;              // a no-op is not an error
  return ORDER_TRANSITIONS[from].includes(to);
}

const LABEL: Record<OrderStatus, string> = {
  pending: "pending", changes_requested: "sent back", approved: "approved",
  rejected: "rejected", fulfilled: "fulfilled", cancelled: "withdrawn",
};

/**
 * Says why a move is refused, in the terms the person on the screen
 * thinks in, and points at what they should do instead.
 */
export function transitionError(from: OrderStatus, to: OrderStatus): string | null {
  if (canTransition(from, to)) return null;

  if (from === "fulfilled") {
    return `This order has already been dispatched. Goods have left the warehouse, so it cannot be ${LABEL[to]}. Raise a credit note against the invoice and book the goods back in if they are being returned.`;
  }
  if (from === "rejected" || from === "cancelled") {
    return `This order is ${LABEL[from]} and closed. Ask the customer to place a new order.`;
  }
  if (from === "approved" && to === "rejected") {
    return "This order has already been approved. Withdraw it instead, which records that it was stopped rather than refused.";
  }
  if (from === "approved" && to === "changes_requested") {
    return "This order has already been approved. Withdraw it and ask the customer to place a corrected order.";
  }
  return `An order that is ${LABEL[from]} cannot become ${LABEL[to]}.`;
}
