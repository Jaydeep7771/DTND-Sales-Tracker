// View models the UI renders. Both the Supabase adapter and the demo store
// produce these shapes so pages never care where data came from.
import type { OrderStatus, Product, UserProfile, Announcement, OrderMessage, InvoicePayment as InvoicePaymentT } from "@/types/database";
import type { InvoiceType as InvoiceTypeT, InvoiceStatus as InvoiceStatusT, Settlement as SettlementT } from "@/lib/accounting";

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
  total: number; // subtotal + 5% sales tax
}

export interface ProductQuery {
  q?: string;
  category?: string; // "All" or a category name
  page?: number;
  perPage?: number;
  includeArchived?: boolean;
}

export interface ProductPage {
  rows: Product[];
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

export interface CartLine {
  product_id: string;
  name: string;
  sku: string;
  unit_price: number;
  quantity: number;
}

export interface SubmitOrderInput {
  lines: { product_id: string; quantity: number }[];
  delivery_address: string;
  required_by: string | null;
  note: string;
}

export const TAX_RATE = 0.05;

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
