// Server-side read layer. Uses Supabase when keys are configured, otherwise
// the in-memory demo store so the app runs with zero setup.
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { demo, DEMO_CUSTOMER_EMAIL } from "@/lib/demo-store";
import { configureCurrency, configureTax, currencyFromSettings, taxConfig } from "@/lib/money";
import { isStaff } from "@/lib/permissions";
import { DEMO_ROLE_COOKIE } from "@/lib/demo-store";
import type { AccountBalance } from "@/lib/accounting";
import type { AccountRow, CompanySettings, JournalEntryRow, PeriodRow } from "@/types/database";
import type { Product, Announcement, UserProfile, OrderView, OrderLine, OrderMessage, ProductQuery, ProductPage, CategoryCount, DashboardMetrics, OrderStatus } from "@/lib/types";

/** Cookie that picks which demo customer the portal acts as (set by the invite flow). */
import { settlementOf } from "@/lib/accounting";
import { buildAging, daysPastDue, type AgingRow, type AgingTotals } from "@/lib/receivables";
import type { InvoiceView, InvoiceLineView } from "@/lib/types";
import type { Invoice, InvoiceItem, InvoicePayment } from "@/types/database";

/** Cookie that picks which demo customer the portal acts as (set by the invite flow). */
export const DEMO_CUSTOMER_COOKIE = "dtnd-demo-customer";

export const isDemo =
  !process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes("placeholder");

// ---------------------------------------------------------------- helpers
function buildOrder(
  o: { id: string; order_number: string; status: OrderStatus; created_at: string; required_by: string | null; delivery_address: string | null; note: string | null },
  customer: { id: string; company_name: string | null; email: string },
  items: OrderLine[],
  messages: OrderMessage[],
): OrderView {
  const subtotal = items.reduce((a, l) => a + l.quantity * l.price_at_purchase, 0);
  return {
    id: o.id,
    order_number: o.order_number,
    status: o.status,
    created_at: o.created_at,
    required_by: o.required_by,
    delivery_address: o.delivery_address,
    note: o.note,
    customer: { id: customer.id, company_name: customer.company_name ?? customer.email, email: customer.email },
    items,
    messages,
    invoices: [],
    subtotal,
    total: Math.round(subtotal * (1 + taxConfig().rate)),
  };
}

function paginate(all: Product[], q: ProductQuery, catalogTotal: number): ProductPage {
  const perPage = q.perPage ?? 9;
  const pages = Math.max(1, Math.ceil(all.length / perPage));
  const page = Math.min(Math.max(1, q.page ?? 1), pages);
  return { rows: all.slice((page - 1) * perPage, page * perPage), total: all.length, catalogTotal, page, pages };
}

// ---------------------------------------------------------------- products
export async function getProducts(q: ProductQuery = {}): Promise<ProductPage> {
  await applyFormatting();
  const term = (q.q ?? "").trim().toLowerCase();
  const cat = q.category && q.category !== "All" ? q.category : null;

  if (isDemo) {
    const active = demo.products.filter((p) => q.includeArchived || !p.is_archived);
    const rows = active.filter(
      (p) => (!cat || p.category === cat) && (!term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term)),
    );
    return paginate(rows, q, active.length);
  }

  const supabase = await createClient();
  let query = supabase.from("products").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (!q.includeArchived) query = query.eq("is_archived", false);
  if (cat) query = query.eq("category", cat);
  if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%`);
  const perPage = q.perPage ?? 9;
  const page = Math.max(1, q.page ?? 1);
  const { data, count, error } = await query.range((page - 1) * perPage, page * perPage - 1);
  if (error) throw error;
  const { count: catalogTotal } = await supabase.from("products").select("id", { count: "exact", head: true }).eq("is_archived", false);
  const total = count ?? 0;
  return { rows: data ?? [], total, catalogTotal: catalogTotal ?? 0, page, pages: Math.max(1, Math.ceil(total / perPage)) };
}

export async function getCategories(): Promise<CategoryCount[]> {
  await applyFormatting();
  const products = isDemo ? demo.products.filter((p) => !p.is_archived) : (await (await createClient()).from("products").select("category").eq("is_archived", false)).data ?? [];
  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

export async function getLowStock(limit = 5): Promise<Product[]> {
  await applyFormatting();
  if (isDemo) return demo.products.filter((p) => !p.is_archived && p.stock_quantity < p.reorder_point).sort((a, b) => a.stock_quantity - b.stock_quantity).slice(0, limit);
  const supabase = await createClient();
  // PostgREST can't compare two columns directly; fetch and filter (catalog is small for a POC).
  const { data } = await supabase.from("products").select("*").eq("is_archived", false).order("stock_quantity");
  return (data ?? []).filter((p) => p.stock_quantity < p.reorder_point).slice(0, limit);
}

// ---------------------------------------------------------------- orders
export async function getOrders(opts: { customerId?: string } = {}): Promise<OrderView[]> {
  await applyFormatting();
  if (isDemo) {
    const cid = opts.customerId;
    const built = demo.orders
      .filter((o) => !cid || o.customer_id === cid)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((o) => {
        const customer = demo.customers.find((c) => c.id === o.customer_id)!;
        const items: OrderLine[] = o.items.map((it) => {
          const p = demo.products.find((p) => p.id === it.product_id)!;
          return { id: it.id, product_id: p.id, name: p.name, sku: p.sku, quantity: it.quantity, price_at_purchase: it.price_at_purchase, stock: p.stock_quantity };
        });
        return buildOrder(o, customer, items, demo.messages.filter((m) => m.order_id === o.id));
      });
    return withInvoices(built);
  }

  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select("*, customer:users!orders_customer_id_fkey(id, company_name, email), items:order_items(id, product_id, quantity, price_at_purchase, product:products(name, sku, stock_quantity)), messages:order_messages(*)")
    .order("created_at", { ascending: false });
  if (opts.customerId) query = query.eq("customer_id", opts.customerId);
  const { data, error } = await query;
  if (error) throw error;
  type Row = NonNullable<typeof data>[number] & {
    customer: { id: string; company_name: string | null; email: string };
    items: { id: string; product_id: string; quantity: number; price_at_purchase: number; product: { name: string; sku: string; stock_quantity: number } }[];
    messages: OrderMessage[];
  };
  return withInvoices(((data ?? []) as unknown as Row[]).map((o) =>
    buildOrder(
      o,
      o.customer,
      o.items.map((it) => ({ id: it.id, product_id: it.product_id, name: it.product.name, sku: it.product.sku, quantity: it.quantity, price_at_purchase: it.price_at_purchase, stock: it.product.stock_quantity })),
      [...o.messages].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    ),
  ));
}

/** Attaches invoices to orders in one pass rather than per row. */
async function withInvoices(orders: OrderView[]): Promise<OrderView[]> {
  if (orders.length === 0) return orders;
  const invoices = await getInvoices();
  for (const o of orders) o.invoices = invoices.filter((i) => i.order_id === o.id);
  return orders;
}

export async function getOrder(id: string): Promise<OrderView | null> {
  return (await getOrders()).find((o) => o.id === id) ?? null;
}

// ---------------------------------------------------------------- customers / users
export async function getCustomers(): Promise<UserProfile[]> {
  await applyFormatting();
  if (isDemo) return demo.customers;
  const { data } = await (await createClient()).from("users").select("*").eq("role", "customer").order("company_name");
  return data ?? [];
}

/** The signed-in user's profile. In demo mode the portal acts as the customer
 *  chosen via the invite flow (cookie), defaulting to Meezan Hardware. */
export async function getCurrentUser(): Promise<UserProfile | null> {
  if (isDemo) {
    const id = (await cookies()).get(DEMO_CUSTOMER_COOKIE)?.value;
    return demo.customers.find((c) => c.id === id) ?? demo.customers.find((c) => c.email === DEMO_CUSTOMER_EMAIL) ?? null;
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("users").select("*").eq("id", user.id).single();
  return data;
}

// ---------------------------------------------------------------- announcements
export async function getAnnouncements(opts: { type?: "announcement" | "faq"; activeOnly?: boolean } = {}): Promise<Announcement[]> {
  await applyFormatting();
  const filter = (a: Announcement) => (!opts.type || a.type === opts.type) && (!opts.activeOnly || (a.is_active && (!a.expires_at || a.expires_at > new Date().toISOString())));
  if (isDemo) return demo.announcements.filter(filter).sort((a, b) => a.priority - b.priority);
  let query = (await createClient()).from("announcements").select("*").order("priority");
  if (opts.type) query = query.eq("type", opts.type);
  if (opts.activeOnly) query = query.eq("is_active", true);
  const { data } = await query;
  return (data ?? []).filter(filter);
}

// ---------------------------------------------------------------- dashboard
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  await applyFormatting();
  const [orders, products, cats] = await Promise.all([getOrders(), getProducts({ perPage: 10000 }), getCategories()]);
  const now = Date.now();
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = now - 7 * 86400e3;
  const pending = orders.filter((o) => o.status === "pending" || o.status === "changes_requested");
  const fulfilled = orders.filter((o) => o.status === "fulfilled" && new Date(o.created_at).getTime() > weekAgo);
  return {
    ordersToday: orders.filter((o) => new Date(o.created_at) >= startOfToday).length,
    pendingApprovals: pending.length,
    pendingOverSla: pending.filter((o) => now - new Date(o.created_at).getTime() > 4 * 3600e3).length,
    lowStockCount: products.rows.filter((p) => p.stock_quantity < p.reorder_point).length,
    zeroStockCount: products.rows.filter((p) => p.stock_quantity === 0).length,
    fulfilledThisWeek: fulfilled.length,
    fulfilledValueThisWeek: fulfilled.reduce((a, o) => a + o.total, 0),
    totalSkus: products.catalogTotal,
    categories: cats.length,
  };
}

// ---------------------------------------------------------------- staff / accounting

/**
 * The signed-in staff member. In demo mode the console acts as whichever
 * persona the role cookie names, defaulting to the operations admin.
 */
export async function getCurrentStaff(): Promise<UserProfile | null> {
  if (isDemo) {
    const role = (await cookies()).get(DEMO_ROLE_COOKIE)?.value;
    return demo.staff.find((s) => s.role === role) ?? demo.staff[0] ?? null;
  }
  const user = await getCurrentUser();
  return user && isStaff(user.role) ? user : null;
}

export async function getCompanySettings(): Promise<CompanySettings> {
  if (isDemo) return demo.acc.settings;
  const { data } = await (await createClient()).from("company_settings").select("*").eq("id", true).single();
  return data as CompanySettings;
}

/**
 * Applies the company's currency and tax settings to the formatters.
 *
 * This lives in the read layer rather than in a layout component because
 * Next renders a layout and its page segments in parallel: a component
 * cannot guarantee it runs before the page that formats money. Every read
 * below awaits this first, so by the time a screen has data to render the
 * formatters are already configured. Cached per request, so it costs one
 * query however many reads a page makes.
 */
const applyFormatting = cache(async () => {
  const s = await getCompanySettings();
  configureCurrency(currencyFromSettings(s));
  configureTax({ rate: s.default_tax_rate, label: s.tax_label });
});

/** Accounting periods, newest first. */
export async function getPeriods(): Promise<PeriodRow[]> {
  const rows = isDemo
    ? demo.acc.periods ?? []
    : ((await (await createClient()).from("accounting_periods").select("*")).data ?? []);
  return [...rows].sort((a, b) => b.starts_on.localeCompare(a.starts_on));
}

/** True when nothing may be posted on this date. */
export async function isPeriodClosed(date: string): Promise<boolean> {
  return (await getPeriods()).some((p) => p.closed_at && date >= p.starts_on && date <= p.ends_on);
}

export async function getAccounts(): Promise<AccountRow[]> {
  await applyFormatting();
  const rows = isDemo ? demo.acc.accounts : ((await (await createClient()).from("accounts").select("*")).data ?? []);
  return [...rows].sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Trial balance. Computed from journal lines only, never from stored
 * totals, so it cannot drift away from the ledger.
 */
export async function getTrialBalance(range?: { from?: string; to?: string }): Promise<AccountBalance[]> {
  await applyFormatting();
  const accounts = await getAccounts();
  const totals = new Map<string, { debit: number; credit: number }>();

  // A statement is always "for a period" or "as at a date", so the same
  // aggregation takes an optional range. Entries are filtered by their
  // entry date, not the date they were keyed in.
  if (isDemo) {
    const inRange = new Set(
      demo.acc.entries
        .filter((e) => (!range?.from || e.entry_date >= range.from) && (!range?.to || e.entry_date <= range.to))
        .map((e) => e.id),
    );
    for (const l of demo.acc.lines) {
      if (!inRange.has(l.entry_id)) continue;
      const t = totals.get(l.account_id) ?? { debit: 0, credit: 0 };
      t.debit += Number(l.debit);
      t.credit += Number(l.credit);
      totals.set(l.account_id, t);
    }
  } else {
    let q = (await createClient())
      .from("journal_lines")
      .select("account_id, debit, credit, journal_entries!inner(entry_date)");
    if (range?.from) q = q.gte("journal_entries.entry_date", range.from);
    if (range?.to) q = q.lte("journal_entries.entry_date", range.to);
    const { data } = await q;
    for (const l of data ?? []) {
      const t = totals.get(l.account_id) ?? { debit: 0, credit: 0 };
      t.debit += Number(l.debit);
      t.credit += Number(l.credit);
      totals.set(l.account_id, t);
    }
  }

  return accounts.map((a) => {
    const t = totals.get(a.id) ?? { debit: 0, credit: 0 };
    const debitNormal = a.type === "asset" || a.type === "expense";
    return {
      ...a,
      system_key: a.system_key as AccountBalance["system_key"],
      total_debit: t.debit,
      total_credit: t.credit,
      balance: debitNormal ? t.debit - t.credit : t.credit - t.debit,
    };
  });
}

export async function getJournal(limit = 100): Promise<JournalEntryRow[]> {
  await applyFormatting();
  if (isDemo) return demo.acc.entries.slice(0, limit);
  const { data } = await (await createClient())
    .from("journal_entries").select("*").order("entry_date", { ascending: false }).limit(limit);
  return data ?? [];
}

// ---------------------------------------------------------------- invoices

function buildInvoice(
  inv: Invoice,
  items: InvoiceItem[],
  payments: InvoicePayment[],
  customer: { id: string; company_name: string | null; email: string },
  orderNumber: string | null,
): InvoiceView {
  const live = payments.filter((p) => !p.reversed_at);
  const paid = live.reduce((a, p) => a + Number(p.amount), 0);
  const lines: InvoiceLineView[] = items
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((i) => ({
      id: i.id,
      order_item_id: i.order_item_id,
      sku: i.sku,
      name: i.name,
      unit_of_measure: i.unit_of_measure,
      quantity: i.quantity,
      unit_price: Number(i.unit_price),
      line_total: Number(i.line_total),
    }));
  return {
    id: inv.id,
    invoice_number: inv.invoice_number,
    order_id: inv.order_id,
    order_number: orderNumber,
    type: inv.type,
    status: inv.status,
    customer: { id: customer.id, company_name: customer.company_name ?? customer.email, email: customer.email },
    seller: inv.seller ?? {},
    buyer: inv.buyer ?? {},
    currency: inv.currency,
    tax_rate: Number(inv.tax_rate),
    subtotal: Number(inv.subtotal),
    discount: Number(inv.discount),
    freight: Number(inv.freight),
    tax_amount: Number(inv.tax_amount),
    total: Number(inv.total),
    issue_date: inv.issue_date,
    due_date: inv.due_date,
    terms_days: inv.terms_days,
    notes: inv.notes,
    items: lines,
    payments,
    paid,
    balance: Number(inv.total) - paid,
    settlement: settlementOf(inv.status, Number(inv.total), paid, inv.due_date),
    pdf_path: inv.pdf_path,
    issued_at: inv.issued_at,
    created_at: inv.created_at,
  };
}

export async function getInvoices(opts: { customerId?: string; orderId?: string } = {}): Promise<InvoiceView[]> {
  await applyFormatting();
  if (isDemo) {
    return demo.acc.invoices
      .filter((i) => (!opts.customerId || i.customer_id === opts.customerId) && (!opts.orderId || i.order_id === opts.orderId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((i) => {
        const customer = demo.customers.find((c) => c.id === i.customer_id)!;
        const order = demo.orders.find((o) => o.id === i.order_id);
        return buildInvoice(
          i,
          demo.acc.invoiceItems.filter((x) => x.invoice_id === i.id),
          demo.acc.payments.filter((p) => p.invoice_id === i.id),
          customer,
          order?.order_number ?? null,
        );
      });
  }

  const supabase = await createClient();
  let query = supabase
    .from("invoices")
    .select("*, customer:users!invoices_customer_id_fkey(id, company_name, email), items:invoice_items(*), payments:invoice_payments(*), order:orders(order_number)")
    .order("created_at", { ascending: false });
  if (opts.customerId) query = query.eq("customer_id", opts.customerId);
  if (opts.orderId) query = query.eq("order_id", opts.orderId);
  const { data, error } = await query;
  if (error) throw error;
  type Row = Invoice & {
    customer: { id: string; company_name: string | null; email: string };
    items: InvoiceItem[];
    payments: InvoicePayment[];
    order: { order_number: string } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((i) =>
    buildInvoice(i, i.items ?? [], i.payments ?? [], i.customer, i.order?.order_number ?? null),
  );
}

export async function getInvoice(id: string): Promise<InvoiceView | null> {
  await applyFormatting();
  return (await getInvoices()).find((i) => i.id === id) ?? null;
}

/** How much of each order line is still uninvoiced, for partial dispatch. */
export async function getRemainingToInvoice(orderId: string): Promise<Map<string, number>> {
  const invoices = (await getInvoices({ orderId })).filter((i) => i.status !== "void");
  const used = new Map<string, number>();
  for (const inv of invoices) {
    for (const l of inv.items) {
      if (!l.order_item_id) continue;
      used.set(l.order_item_id, (used.get(l.order_item_id) ?? 0) + l.quantity);
    }
  }
  return used;
}

// ---------------------------------------------------------------- customer detail
export interface LedgerRow {
  id: string;
  entry_no: string;
  entry_date: string;
  narration: string;
  account: string;
  debit: number;
  credit: number;
  balance: number;   // running receivable balance
}

export interface CustomerDetail {
  customer: UserProfile;
  orders: OrderView[];
  invoices: InvoiceView[];
  ledger: LedgerRow[];
  stats: {
    ordersPlaced: number;
    ordersOpen: number;
    invoiced: number;      // total issued, excluding void
    outstanding: number;   // unpaid portion
    overdue: number;       // unpaid and past due
    lastOrderAt: string | null;
  };
}

/** Aged receivables across every customer, for the collections screen. */
export async function getAging(): Promise<{ rows: AgingRow[]; totals: AgingTotals }> {
  await applyFormatting();
  const [invoices, customers] = await Promise.all([getInvoices(), getCustomers()]);
  return buildAging(invoices, customers);
}

/** What one customer owes and how late it is, for the approval decision. */
export async function getCustomerExposure(customerId: string): Promise<{
  outstanding: number; worstDaysPastDue: number; creditLimit: number; creditHold: boolean;
}> {
  const [invoices, customer] = await Promise.all([
    getInvoices({ customerId }),
    getCustomerById(customerId),
  ]);
  let outstanding = 0;
  let worst = 0;
  for (const i of invoices) {
    if (i.status !== "issued" || i.type === "credit_note" || i.balance <= 0.005) continue;
    outstanding += i.balance;
    worst = Math.max(worst, daysPastDue(i.due_date));
  }
  return {
    outstanding: Math.round(outstanding * 100) / 100,
    worstDaysPastDue: worst,
    creditLimit: Number(customer?.credit_limit ?? 0),
    creditHold: Boolean(customer?.credit_hold),
  };
}

export async function getCustomerById(id: string): Promise<UserProfile | null> {
  await applyFormatting();
  if (isDemo) return demo.customers.find((c) => c.id === id) ?? null;
  const { data } = await (await createClient()).from("users").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

/** The customer's receivable subledger, oldest first with a running balance. */
export async function getCustomerLedger(customerId: string): Promise<LedgerRow[]> {
  await applyFormatting();
  const accounts = await getAccounts();
  const nameOf = new Map(accounts.map((a) => [a.id, `${a.code} ${a.name}`]));

  let rows: { id: string; entry_id: string; account_id: string; debit: number; credit: number }[];
  let entries: Map<string, { entry_no: string; entry_date: string; narration: string }>;

  if (isDemo) {
    rows = demo.acc.lines.filter((l) => l.party_id === customerId);
    entries = new Map(demo.acc.entries.map((e) => [e.id, e]));
  } else {
    const { data } = await (await createClient())
      .from("journal_lines")
      .select("id, entry_id, account_id, debit, credit, entry:journal_entries(entry_no, entry_date, narration)")
      .eq("party_id", customerId);
    type R = { id: string; entry_id: string; account_id: string; debit: number; credit: number; entry: { entry_no: string; entry_date: string; narration: string } | null };
    const list = (data ?? []) as unknown as R[];
    rows = list;
    entries = new Map(list.filter((r) => r.entry).map((r) => [r.entry_id, r.entry!]));
  }

  let balance = 0;
  return rows
    .map((l) => ({ l, e: entries.get(l.entry_id) }))
    .filter((x) => x.e)
    .sort((a, b) => a.e!.entry_date.localeCompare(b.e!.entry_date) || a.e!.entry_no.localeCompare(b.e!.entry_no))
    .map(({ l, e }) => {
      balance += Number(l.debit) - Number(l.credit);
      return {
        id: l.id,
        entry_no: e!.entry_no,
        entry_date: e!.entry_date,
        narration: e!.narration,
        account: nameOf.get(l.account_id) ?? "—",
        debit: Number(l.debit),
        credit: Number(l.credit),
        balance,
      };
    });
}

export async function getCustomerDetail(id: string): Promise<CustomerDetail | null> {
  await applyFormatting();
  const customer = await getCustomerById(id);
  if (!customer) return null;

  const [orders, invoices, ledger] = await Promise.all([
    getOrders({ customerId: id }),
    getInvoices({ customerId: id }),
    getCustomerLedger(id),
  ]);

  // Credit notes are corrections, not receivables, so they are excluded
  // from the tiles; their effect is already in each invoice's balance.
  const live = invoices.filter((i) => i.status === "issued" && i.type !== "credit_note");
  return {
    customer,
    orders,
    invoices,
    ledger,
    stats: {
      ordersPlaced: orders.length,
      ordersOpen: orders.filter((o) => o.status === "pending" || o.status === "changes_requested" || o.status === "approved").length,
      invoiced: live.reduce((a, i) => a + i.total, 0),
      outstanding: live.reduce((a, i) => a + i.balance, 0),
      overdue: live.filter((i) => i.settlement === "overdue").reduce((a, i) => a + i.balance, 0),
      lastOrderAt: orders[0]?.created_at ?? null,
    },
  };
}

// ---------------------------------------------------------------- receipts
export interface ReceiptView {
  entry_id: string;
  received_on: string;
  method: string;
  reference: string | null;
  note: string | null;
  amount: number;
  reversed: boolean;
  reversal_reason: string | null;
  allocations: { invoice_id: string; invoice_number: string | null; amount: number }[];
}

/**
 * Allocations grouped back into the receipts they came from. They share a
 * journal entry, so that is the grouping key.
 */
export async function getReceipts(customerId: string): Promise<ReceiptView[]> {
  await applyFormatting();
  const invoices = await getInvoices({ customerId });
  const numberOf = new Map(invoices.map((i) => [i.id, i.invoice_number]));
  const ids = new Set(invoices.map((i) => i.id));

  const rows = isDemo
    ? demo.acc.payments.filter((p) => ids.has(p.invoice_id))
    : ((await (await createClient()).from("invoice_payments").select("*").in("invoice_id", [...ids])).data ?? []);

  const groups = new Map<string, ReceiptView>();
  for (const p of rows) {
    const key = p.journal_entry_id ?? p.id;
    const existing = groups.get(key);
    const allocation = { invoice_id: p.invoice_id, invoice_number: numberOf.get(p.invoice_id) ?? null, amount: Number(p.amount) };
    if (existing) {
      existing.amount += allocation.amount;
      existing.allocations.push(allocation);
    } else {
      groups.set(key, {
        entry_id: key,
        received_on: p.paid_on,
        method: p.method,
        reference: p.reference,
        note: p.note,
        amount: allocation.amount,
        reversed: !!p.reversed_at,
        reversal_reason: p.reversal_reason,
        allocations: [allocation],
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.received_on.localeCompare(a.received_on));
}
