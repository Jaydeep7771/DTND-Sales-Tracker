// View models the UI renders. Both the Supabase adapter and the demo store
// produce these shapes so pages never care where data came from.
import type { OrderStatus, Product, UserProfile, Announcement, OrderMessage, InvoicePayment as InvoicePaymentT } from "@/types/database";
import type { InvoiceType as InvoiceTypeT, InvoiceStatus as InvoiceStatusT, Settlement as SettlementT } from "@/lib/accounting";
import type { PricedUnit } from "@/lib/pricing";
import type { Availability, StockProblem } from "@/lib/availability";

export type { OrderStatus, Product, UserProfile, Announcement, OrderMessage };

export interface OrderLine {
  id: string;
  product_id: string;
  name: string;
  sku: string;
  quantity: number;
  price_at_purchase: number;
  stock: number; // current on-hand, for the admin approval screen
}

export interface OrderView {
  id: string;
  order_number: string;
  status: OrderStatus;
  created_at: string;
  required_by: string | null;
  delivery_address: string | null;
  note: string | null;
  customer: { id: string; company_name: string; email: string };
  items: OrderLine[];
  messages: OrderMessage[];
  invoices: InvoiceView[];
  subtotal: number;
  total: number; // subtotal + tax at the configured rate
}

export interface ProductQuery {
  q?: string;
  category?: string; // "All" or a category name
  page?: number;
  perPage?: number;
  includeArchived?: boolean;
}

export interface ProductPage {
  rows: PricedProduct[];
  total: number; // rows matching the filter
  catalogTotal: number; // all active products
  page: number;
  pages: number;
}

export interface CategoryCount {
  name: string;
  count: number;
}

export interface DashboardMetrics {
  ordersToday: number;
  pendingApprovals: number;
  pendingOverSla: number;
  lowStockCount: number;
  zeroStockCount: number;
  fulfilledThisWeek: number;
  fulfilledValueThisWeek: number;
  totalSkus: number;
  categories: number;
}

/**
 * A cart line as the server computes it.
 *
 * The browser sends product and quantity; everything else here — the
 * price, what it saved against list, what is in stock — is resolved
 * server-side on every read. A cart left open for a week therefore
 * cannot check out at last week's price, and nothing the client sends
 * can influence what is charged.
 */
export interface CartLine {
  product_id: string;
  name: string;
  sku: string;
  unit_of_measure: string;
  quantity: number;

  unit_price: number;
  list_price: number;
  price_source: PricedUnit["source"];
  price_source_name?: string;
  break_quantity?: number;
  next_break?: { min_quantity: number; unit_price: number };
  line_total: number;
  saving: number;

  available: number;
  allow_backorder: boolean;
}

export interface CartView {
  lines: CartLine[];
  subtotal: number;
  tax: number;
  total: number;
  /** Total saved against list price, so the tier is worth something visible. */
  saving: number;
  /** Lines that must change before the order can be submitted. */
  blocking: StockProblem[];
  /** Lines that will ship late. Allowed, but the buyer is told. */
  backorders: StockProblem[];
  /** Name of the tier these prices came from, when not the default. */
  tier?: string;
}

/** A catalogue product with this customer's price and free stock attached. */
export interface PricedProduct extends Product {
  pricing: PricedUnit;
  availability: Availability;
  /** Volume breaks to advertise on the card. Empty when there are none. */
  ladder: { min_quantity: number; unit_price: number }[];
}

/**
 * Submitting takes no lines. The server cart is the order: sending lines
 * from the browser would mean trusting quantities and, through them,
 * prices that the server has already resolved.
 */
export interface SubmitOrderInput {
  delivery_address: string;
  required_by: string | null;
  note: string;
}

// The tax rate is a company setting, not a constant. See src/lib/money.ts.

// ---------------------------------------------------------------- invoices
export interface InvoiceLineView {
  id: string;
  order_item_id: string | null;
  sku: string;
  name: string;
  unit_of_measure: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface InvoiceView {
  id: string;
  invoice_number: string | null;
  order_id: string | null;
  order_number: string | null;
  type: InvoiceTypeT;
  status: InvoiceStatusT;
  customer: { id: string; company_name: string; email: string };
  seller: Record<string, unknown>;
  buyer: Record<string, unknown>;
  currency: string;
  tax_rate: number;
  subtotal: number;
  discount: number;
  freight: number;
  tax_amount: number;
  total: number;
  issue_date: string | null;
  due_date: string | null;
  terms_days: number;
  notes: string | null;
  items: InvoiceLineView[];
  payments: InvoicePaymentT[];
  paid: number;
  balance: number;
  settlement: SettlementT;
  pdf_path: string | null;
  issued_at: string | null;
  created_at: string;
}
