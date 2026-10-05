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
import type { AccountRow, Bill, BillItem, BillPayment, CompanySettings, JournalEntryRow, PeriodRow, Supplier } from "@/types/database";
import type { Product, Announcement, UserProfile, OrderView, OrderLine, OrderMessage, ProductQuery, ProductPage, CategoryCount, DashboardMetrics, OrderStatus, CartLine, CartView, PricedProduct } from "@/lib/types";
import type { PriceList, PriceRule } from "@/types/database";
import { ladderFor, lineTotal, resolvePrice, savingOn, type PriceContext } from "@/lib/pricing";
import { availabilityOf, checkStock, type Availability } from "@/lib/availability";
import { buildStatement, type Statement, type StatementSource } from "@/lib/statements";
import { buildCashFlow, type CashEntry, type CashFlow } from "@/lib/cashflow";
import { buildAnnexC, type AnnexCReport } from "@/lib/fbr";
import type { ExportEntry } from "@/lib/accounting-export";

/** Cookie that picks which demo customer the portal acts as (set by the invite flow). */
import { addDays, businessDate, round2, settlementOf } from "@/lib/accounting";
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

function paginate(all: PricedProduct[], q: ProductQuery, catalogTotal: number): ProductPage {
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

  // Price and availability are attached here rather than in the page, so
  // every caller of getProducts sees this customer's numbers and no route
  // can accidentally render list price to somebody on a contract.
  const [ctx, avail] = await Promise.all([getPriceContext(), getAvailabilityMap()]);

  if (isDemo) {
    const active = demo.products.filter((p) => q.includeArchived || !p.is_archived);
    const rows = active.filter(
      (p) => (!cat || p.category === cat) && (!term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term)),
    );
    return paginate(priceProducts(rows, ctx, avail), q, active.length);
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
  return { rows: priceProducts(data ?? [], ctx, avail), total, catalogTotal: catalogTotal ?? 0, page, pages: Math.max(1, Math.ceil(total / perPage)) };
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

/**
 * Attaches invoices to orders in one pass rather than per row.
 *
 * Matching on order_id alone would miss a consolidated invoice, which
 * has none — it is linked to its orders only through its lines. So the
 * line linkage is checked as well, and that is what an order screen
 * needs: "what has been billed against this", however it was billed.
 */
async function withInvoices(orders: OrderView[]): Promise<OrderView[]> {
  if (orders.length === 0) return orders;
  const invoices = await getInvoices();
  for (const o of orders) {
    const mine = new Set(o.items.map((l) => l.id));
    o.invoices = invoices.filter(
      (i) => i.order_id === o.id || i.items.some((l) => l.order_item_id && mine.has(l.order_item_id)),
    );
  }
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

/**
 * Company settings, or sensible defaults.
 *
 * A signed-out caller is refused this row by row level security and gets
 * null back. That used to crash the formatter, which turned every
 * unauthenticated hit on a guarded route — a PDF link opened in the
 * wrong browser, a crawler, an expired session — into a 500 instead of
 * the 404 the guard was about to return. Falling back keeps the failure
 * where it belongs: in the authorization check, not in number
 * formatting.
 */
export async function getCompanySettings(): Promise<CompanySettings> {
  if (isDemo) return demo.acc.settings;
  const { data } = await (await createClient()).from("company_settings").select("*").eq("id", true).maybeSingle();
  return (data ?? DEFAULT_SETTINGS) as CompanySettings;
}

/**
 * Only ever used when the real row cannot be read. Deliberately minimal:
 * anything that renders from these is about to be refused anyway.
 */
const DEFAULT_SETTINGS = {
  id: true, legal_name: "", address: "", city: "", country: "Pakistan",
  phone: null, email: null, ntn: null, strn: null, bank_details: null,
  default_tax_rate: 0, default_terms_days: 30,
  invoice_prefix: "INV", credit_note_prefix: "CN",
  proforma_prefix: "PI", proforma_valid_days: 14,
  fiscal_year_start_month: 7, tax_label: "Sales Tax",
} as unknown as CompanySettings;

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

export interface JournalLineView {
  account_id: string;
  code: string;
  name: string;
  debit: number;
  credit: number;
  party_id: string | null;
  party_name: string | null;
  memo: string | null;
}

export interface JournalEntryView extends JournalEntryRow {
  lines: JournalLineView[];
  total: number;
  /** True when some later entry reverses this one, so the UI can say so. */
  reversed_by: string | null;
}

export interface DayBookQuery {
  from?: string;
  to?: string;
  accountId?: string;
  source?: string;
  limit?: number;
}

/**
 * The day book: entries with their lines, which is the only view that
 * explains a balance. The trial balance says Rent is 450,000; this says
 * which three payments made it so.
 */
export async function getDayBook(q: DayBookQuery = {}): Promise<JournalEntryView[]> {
  await applyFormatting();
  const [accounts, customers, staff] = await Promise.all([getAccounts(), getCustomers(), getStaff()]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const partyById = new Map([...customers, ...staff].map((u) => [u.id, u.company_name ?? u.email]));

  let entries: JournalEntryRow[];
  let lines: { entry_id: string; account_id: string; debit: number; credit: number; party_id: string | null; memo: string | null; sort_order: number }[];

  if (isDemo) {
    entries = demo.acc.entries.filter(
      (e) => (!q.from || e.entry_date >= q.from) && (!q.to || e.entry_date <= q.to) && (!q.source || e.source_type === q.source),
    );
    lines = demo.acc.lines;
  } else {
    const supabase = await createClient();
    let eq = supabase.from("journal_entries").select("*").order("entry_date", { ascending: false });
    if (q.from) eq = eq.gte("entry_date", q.from);
    if (q.to) eq = eq.lte("entry_date", q.to);
    if (q.source) eq = eq.eq("source_type", q.source);
    const { data: e } = await eq.limit(q.limit ?? 200);
    entries = e ?? [];
    const { data: l } = await supabase.from("journal_lines").select("*").in("entry_id", entries.map((x) => x.id));
    lines = l ?? [];
  }

  // Which entries have already been reversed, so the screen can say so
  // rather than letting someone reverse the same mistake twice.
  const reversals = new Map<string, string>();
  const allEntries = isDemo ? demo.acc.entries : entries;
  for (const e of allEntries) if (e.reversal_of) reversals.set(e.reversal_of, e.entry_no);

  const views = entries
    .map((e) => {
      const own = lines
        .filter((l) => l.entry_id === e.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((l) => {
          const account = accountById.get(l.account_id);
          return {
            account_id: l.account_id,
            code: account?.code ?? "—",
            name: account?.name ?? "Unknown account",
            debit: Number(l.debit),
            credit: Number(l.credit),
            party_id: l.party_id,
            party_name: l.party_id ? partyById.get(l.party_id) ?? null : null,
            memo: l.memo,
          };
        });
      return {
        ...e,
        lines: own,
        total: round2(own.reduce((a, l) => a + l.debit, 0)),
        reversed_by: reversals.get(e.id) ?? null,
      };
    })
    // Filtering by account after building the lines, so the entry is still
    // shown whole: half an entry is not a journal entry.
    .filter((e) => !q.accountId || e.lines.some((l) => l.account_id === q.accountId))
    .sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.posted_at.localeCompare(a.posted_at));

  return views.slice(0, q.limit ?? 200);
}

/** Staff list, used to name the party on a journal line. */
export async function getStaff(): Promise<UserProfile[]> {
  if (isDemo) return demo.staff;
  const { data } = await (await createClient()).from("users").select("*").neq("role", "customer");
  return data ?? [];
}

// ---------------------------------------------------------------- invoices

function buildInvoice(
  inv: Invoice,
  items: InvoiceItem[],
  payments: InvoicePayment[],
  customer: { id: string; company_name: string | null; email: string },
  orderNumber: string | null,
  extra: { convertedTo?: string | null; orderNumbers?: string[] } = {},
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
    valid_until: inv.valid_until,
    converted_from: inv.converted_from,
    converted_to: extra.convertedTo ?? null,
    period_start: inv.period_start,
    period_end: inv.period_end,
    // A consolidated invoice belongs to no single order, so the orders it
    // bills are read back from the lines rather than from a column.
    order_numbers: extra.orderNumbers ?? (orderNumber ? [orderNumber] : []),
    sent_at: inv.sent_at,
    sent_to: inv.sent_to,
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

/**
 * Order numbers keyed by order_item id.
 *
 * A consolidated invoice has no order_id, and a proforma that was
 * converted still needs to say which orders it covered, so "which orders
 * does this document bill" is answered from the line linkage rather than
 * from a column that only holds one value.
 */
const orderNumberByItem = cache(async (): Promise<Map<string, string>> => {
  const map = new Map<string, string>();
  if (isDemo) {
    for (const o of demo.orders) for (const it of o.items) map.set(it.id, o.order_number);
    return map;
  }
  const { data } = await (await createClient()).from("order_items").select("id, order:orders(order_number)");
  for (const row of (data ?? []) as unknown as { id: string; order: { order_number: string } | null }[]) {
    if (row.order) map.set(row.id, row.order.order_number);
  }
  return map;
});

function ordersBilledBy(items: InvoiceItem[], byItem: Map<string, string>, fallback: string | null): string[] {
  const seen = new Set<string>();
  for (const l of items) {
    const n = l.order_item_id ? byItem.get(l.order_item_id) : null;
    if (n) seen.add(n);
  }
  if (!seen.size && fallback) seen.add(fallback);
  return [...seen].sort();
}

export async function getInvoices(opts: { customerId?: string; orderId?: string } = {}): Promise<InvoiceView[]> {
  await applyFormatting();
  const byItem = await orderNumberByItem();

  if (isDemo) {
    // Reverse of converted_from, built once rather than searched per row.
    const convertedTo = new Map<string, string>();
    for (const i of demo.acc.invoices) if (i.converted_from) convertedTo.set(i.converted_from, i.id);

    return demo.acc.invoices
      .filter((i) => (!opts.customerId || i.customer_id === opts.customerId) && (!opts.orderId || i.order_id === opts.orderId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((i) => {
        const customer = demo.customers.find((c) => c.id === i.customer_id)!;
        const order = demo.orders.find((o) => o.id === i.order_id);
        const items = demo.acc.invoiceItems.filter((x) => x.invoice_id === i.id);
        return buildInvoice(
          i,
          items,
          demo.acc.payments.filter((p) => p.invoice_id === i.id),
          customer,
          order?.order_number ?? null,
          { convertedTo: convertedTo.get(i.id) ?? null, orderNumbers: ordersBilledBy(items, byItem, order?.order_number ?? null) },
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
  const rows = (data ?? []) as unknown as Row[];
  // Built across the fetched set. A filtered read can miss the partner
  // row, which is why the forward link is a lookup and not a promise.
  const convertedTo = new Map<string, string>();
  for (const i of rows) if (i.converted_from) convertedTo.set(i.converted_from, i.id);

  return rows.map((i) =>
    buildInvoice(i, i.items ?? [], i.payments ?? [], i.customer, i.order?.order_number ?? null, {
      convertedTo: convertedTo.get(i.id) ?? null,
      orderNumbers: ordersBilledBy(i.items ?? [], byItem, i.order?.order_number ?? null),
    }),
  );
}

export async function getInvoice(id: string): Promise<InvoiceView | null> {
  await applyFormatting();
  return (await getInvoices()).find((i) => i.id === id) ?? null;
}

/** How much of each order line is still uninvoiced, for partial dispatch. */
/**
 * How much of each order line is currently invoiced.
 *
 * A credit note carries the original line's order_item_id so it can be
 * matched back, which means it has to be SUBTRACTED here, not added.
 * Adding it meant that invoicing 120 and crediting 20 recorded 140 as
 * invoiced, and the 20 that came back could never be sold again: the
 * order reported "every line has already been invoiced", which was the
 * opposite of the truth.
 *
 * The figure is allowed to go negative only in the sense that it is
 * clamped at zero: crediting more than was invoiced on a line is already
 * refused when the credit note is raised.
 */
export async function getRemainingToInvoice(orderId: string): Promise<Map<string, number>> {
  // Scoped to the customer, not to the order. A consolidated invoice
  // bills several orders and carries no order_id, so filtering by order
  // would miss it entirely and the same goods could be billed twice.
  const order = (await getOrders()).find((o) => o.id === orderId);
  if (!order) return new Map();
  const mine = new Set(order.items.map((l) => l.id));

  const documents = (await getInvoices({ customerId: order.customer.id })).filter(
    // A proforma is an offer. It reserves nothing, so it must not make
    // the goods look billed and block the real invoice.
    (i) => i.status !== "void" && i.type !== "proforma",
  );
  const used = new Map<string, number>();

  for (const doc of documents) {
    // A credit note gives quantity back to the order; an invoice takes it.
    const direction = doc.type === "credit_note" ? -1 : 1;
    for (const l of doc.items) {
      if (!l.order_item_id || !mine.has(l.order_item_id)) continue;
      used.set(l.order_item_id, (used.get(l.order_item_id) ?? 0) + direction * l.quantity);
    }
  }

  for (const [id, qty] of used) used.set(id, Math.max(0, qty));
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
    if (i.status !== "issued" || i.type !== "tax_invoice" || i.balance <= 0.005) continue;
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

/**
 * Money held on account for a customer, read straight from the ledger so
 * it cannot drift away from the balance sheet.
 */
export async function getCustomerAdvance(customerId: string): Promise<number> {
  return ledgerPosition(customerId, "customer_advances", "credit");
}

/** Tax a customer has deducted at source, recoverable at year end. */
export async function getWithheldFrom(customerId: string): Promise<number> {
  return ledgerPosition(customerId, "withholding_receivable", "debit");
}

async function ledgerPosition(
  partyId: string, systemKey: string, normal: "debit" | "credit",
): Promise<number> {
  const accounts = await getAccounts();
  const account = accounts.find((a) => a.system_key === systemKey);
  if (!account) return 0;

  let debit = 0;
  let credit = 0;
  if (isDemo) {
    for (const l of demo.acc.lines) {
      if (l.account_id !== account.id || l.party_id !== partyId) continue;
      debit += Number(l.debit);
      credit += Number(l.credit);
    }
  } else {
    const { data } = await (await createClient())
      .from("journal_lines").select("debit, credit")
      .eq("account_id", account.id).eq("party_id", partyId);
    for (const l of data ?? []) { debit += Number(l.debit); credit += Number(l.credit); }
  }
  return round2(normal === "credit" ? credit - debit : debit - credit);
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
  const live = invoices.filter((i) => i.status === "issued" && i.type === "tax_invoice");
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

// ---------------------------------------------------------------- purchases
export interface BillView extends Bill {
  supplier_name: string;
  items: BillItem[];
  paid: number;
  balance: number;
  settlement: "open" | "part_paid" | "paid" | "overdue" | "void";
}

export async function getSuppliers(): Promise<Supplier[]> {
  await applyFormatting();
  const rows = isDemo
    ? demo.acc.suppliers ?? []
    : ((await (await createClient()).from("suppliers").select("*")).data ?? []);
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSupplier(id: string): Promise<Supplier | null> {
  return (await getSuppliers()).find((s) => s.id === id) ?? null;
}

function buildBill(bill: Bill, items: BillItem[], payments: BillPayment[], supplierName: string): BillView {
  const live = payments.filter((p) => !p.reversed_at);
  const paid = round2(live.reduce((a, p) => a + Number(p.amount), 0));
  const balance = round2(Number(bill.total) - paid);
  const overdue = bill.due_date ? bill.due_date < businessDate() : false;
  return {
    ...bill,
    supplier_name: supplierName,
    items: [...items].sort((a, b) => a.sort_order - b.sort_order),
    paid,
    balance,
    settlement:
      bill.status === "void" ? "void"
      : balance <= 0.005 ? "paid"
      : paid > 0 ? "part_paid"
      : overdue ? "overdue"
      : "open",
  };
}

export async function getBills(opts: { supplierId?: string } = {}): Promise<BillView[]> {
  await applyFormatting();
  const suppliers = await getSuppliers();
  const name = (id: string) => suppliers.find((s) => s.id === id)?.name ?? "Unknown supplier";

  if (isDemo) {
    return (demo.acc.bills ?? [])
      .filter((b) => !opts.supplierId || b.supplier_id === opts.supplierId)
      .map((b) =>
        buildBill(
          b,
          (demo.acc.billItems ?? []).filter((i) => i.bill_id === b.id),
          (demo.acc.billPayments ?? []).filter((p) => p.bill_id === b.id),
          name(b.supplier_id),
        ),
      )
      .sort((a, b) => b.bill_date.localeCompare(a.bill_date));
  }

  // Fetched separately rather than as an embedded select: the generated
  // types do not carry these relationships, and three small queries are
  // clearer than fighting the type generator.
  const supabase = await createClient();
  let q = supabase.from("bills").select("*").order("bill_date", { ascending: false });
  if (opts.supplierId) q = q.eq("supplier_id", opts.supplierId);
  const { data: bills } = await q;
  if (!bills?.length) return [];

  const ids = bills.map((b) => b.id);
  const [{ data: items }, { data: payments }] = await Promise.all([
    supabase.from("bill_items").select("*").in("bill_id", ids),
    supabase.from("bill_payments").select("*").in("bill_id", ids),
  ]);

  return bills.map((b) =>
    buildBill(
      b,
      (items ?? []).filter((i) => i.bill_id === b.id),
      (payments ?? []).filter((p) => p.bill_id === b.id),
      name(b.supplier_id),
    ),
  );
}

export async function getBill(id: string): Promise<BillView | null> {
  return (await getBills()).find((b) => b.id === id) ?? null;
}

/** Aged creditors, the mirror of the debtors schedule. */
export async function getPayablesAging(): Promise<{ rows: AgingRow[]; totals: AgingTotals }> {
  const bills = await getBills();
  const asInvoices = bills
    .filter((b) => b.status === "posted")
    .map((b) => ({
      customer: { id: b.supplier_id, company_name: b.supplier_name, email: "" },
      due_date: b.due_date,
      balance: b.balance,
      status: "issued",
      type: "tax_invoice",
    }));
  return buildAging(asInvoices, []);
}

/** Output tax less input tax, by month, which is what gets filed. */
export interface TaxMonth { month: string; output: number; input: number; net: number }

export async function getSalesTaxSummary(): Promise<TaxMonth[]> {
  await applyFormatting();
  const [invoices, bills] = await Promise.all([getInvoices(), getBills()]);
  const months = new Map<string, TaxMonth>();

  const bucket = (date: string) => {
    const key = date.slice(0, 7);
    const row = months.get(key) ?? { month: key, output: 0, input: 0, net: 0 };
    months.set(key, row);
    return row;
  };

  for (const i of invoices) {
    if (i.status !== "issued" || !i.issue_date) continue;
    // A proforma creates no output tax liability: nothing has been
    // supplied and nothing posted, so it is not a return item.
    if (i.type === "proforma") continue;
    // A credit note gives tax back, so it reduces output tax rather than
    // adding to it.
    bucket(i.issue_date).output += i.type === "credit_note" ? -i.tax_amount : i.tax_amount;
  }
  for (const b of bills) {
    if (b.status !== "posted") continue;
    bucket(b.bill_date).input += Number(b.tax_amount);
  }

  return [...months.values()]
    .map((m) => ({ ...m, output: round2(m.output), input: round2(m.input), net: round2(m.output - m.input) }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

// ================================================================ pricing
/**
 * Price resolution needs three things: the rules written for this
 * customer, the rules on their tier, and today's date. Gathering them is
 * one round trip per request thanks to cache(), so the catalogue can
 * price every card without going back to the database per product.
 */
export const getPriceContext = cache(async (customerId?: string | null): Promise<PriceContext> => {
  const on = businessDate();
  const id = customerId ?? (await getCurrentUser())?.id ?? null;

  const lists = await getPriceLists();
  const defaultList = lists.find((l) => l.is_default && l.is_active) ?? null;

  let listId = defaultList?.id ?? null;
  if (id) {
    const me = isDemo
      ? [...demo.customers, ...demo.staff].find((c) => c.id === id) ?? null
      : (await (await createClient()).from("users").select("price_list_id").eq("id", id).maybeSingle()).data;
    // An inactive tier falls back to the default rather than to nothing,
    // so retiring a price list cannot silently put somebody on list price
    // without anyone noticing.
    const chosen = me?.price_list_id ? lists.find((l) => l.id === me.price_list_id && l.is_active) : null;
    listId = chosen?.id ?? defaultList?.id ?? null;
  }

  const [customerRules, listRules] = await Promise.all([
    id ? getPriceRules({ customerId: id }) : Promise.resolve([]),
    listId ? getPriceRules({ priceListId: listId }) : Promise.resolve([]),
  ]);

  return { customerRules, listRules, listName: lists.find((l) => l.id === listId)?.name, on };
});

export async function getPriceLists(): Promise<PriceList[]> {
  if (isDemo) return [...(demo.priceLists ?? [])];
  const { data } = await (await createClient())
    .from("price_lists").select("*").order("is_default", { ascending: false }).order("name");
  return data ?? [];
}

export async function getPriceRules(opts: { customerId?: string; priceListId?: string; productId?: string } = {}): Promise<PriceRule[]> {
  if (isDemo) {
    return (demo.priceRules ?? []).filter(
      (r) =>
        (!opts.customerId || r.customer_id === opts.customerId) &&
        (!opts.priceListId || r.price_list_id === opts.priceListId) &&
        (!opts.productId || r.product_id === opts.productId),
    );
  }
  let q = (await createClient()).from("price_rules").select("*");
  if (opts.customerId) q = q.eq("customer_id", opts.customerId);
  if (opts.priceListId) q = q.eq("price_list_id", opts.priceListId);
  if (opts.productId) q = q.eq("product_id", opts.productId);
  const { data } = await q.order("min_quantity");
  return data ?? [];
}

// =========================================================== availability
/**
 * Free stock per product: on hand, less what approved orders have
 * already promised. Fetched for the whole catalogue in one query — it is
 * one small aggregate and the alternative is a query per card.
 */
export const getAvailabilityMap = cache(async (): Promise<Map<string, Availability>> => {
  const map = new Map<string, Availability>();

  if (isDemo) {
    const committed = new Map<string, number>();
    for (const o of demo.orders) {
      if (o.status !== "approved") continue;
      for (const it of o.items) committed.set(it.product_id, (committed.get(it.product_id) ?? 0) + it.quantity);
    }
    for (const p of demo.products) {
      const c = committed.get(p.id) ?? 0;
      map.set(p.id, { product_id: p.id, on_hand: p.stock_quantity, committed: c, available: p.stock_quantity - c });
    }
    return map;
  }

  const { data } = await (await createClient()).from("product_availability").select("*");
  for (const row of (data ?? []) as Availability[]) map.set(row.product_id, row);
  return map;
});

/** Attaches this customer's price and free stock to catalogue rows. */
export function priceProducts(
  rows: Product[],
  ctx: PriceContext,
  availability: Map<string, Availability>,
): PricedProduct[] {
  return rows.map((p) => ({
    ...p,
    // Quantity 1: the card shows the entry price and advertises the next
    // break, which is what makes a volume discount do any work.
    pricing: resolvePrice(p, 1, ctx),
    availability: availabilityOf(availability, p.id),
    ladder: ladderFor(p, ctx),
  }));
}

// ================================================================== cart
/**
 * The cart as the server sees it.
 *
 * Stored rows are only product and quantity. Name, price, line total and
 * free stock are all recomputed here on every read, which means a cart
 * built last week cannot check out at last week's price and cannot hide
 * that something has since sold out.
 */
export async function getCart(customerId?: string): Promise<CartView> {
  await applyFormatting();
  const id = customerId ?? (await getCurrentUser())?.id ?? null;
  const empty: CartView = { lines: [], subtotal: 0, tax: 0, total: 0, saving: 0, blocking: [], backorders: [] };
  if (!id) return empty;

  const rows = isDemo
    ? (demo.cart ?? []).filter((c) => c.customer_id === id)
    : ((await (await createClient()).from("cart_items").select("*").eq("customer_id", id).order("added_at")).data ?? []);
  if (!rows.length) return empty;

  const productIds = rows.map((r) => r.product_id);
  const products: Product[] = isDemo
    ? demo.products.filter((p) => productIds.includes(p.id))
    : ((await (await createClient()).from("products").select("*").in("id", productIds)).data ?? []);
  const byId = new Map(products.map((p) => [p.id, p]));

  const [ctx, avail] = await Promise.all([getPriceContext(id), getAvailabilityMap()]);

  const lines: CartLine[] = [];
  for (const row of rows) {
    const p = byId.get(row.product_id);
    // A product archived or deleted out from under a cart is dropped
    // rather than rendered as a blank line.
    if (!p || p.is_archived) continue;
    const priced = resolvePrice(p, row.quantity, ctx);
    lines.push({
      product_id: p.id,
      name: p.name,
      sku: p.sku,
      unit_of_measure: p.unit_of_measure,
      quantity: row.quantity,
      unit_price: priced.unit_price,
      list_price: priced.list_price,
      price_source: priced.source,
      price_source_name: priced.source_name,
      break_quantity: priced.break_quantity,
      next_break: priced.next_break,
      line_total: lineTotal(priced, row.quantity),
      saving: savingOn(priced, row.quantity),
      available: availabilityOf(avail, p.id).available,
      allow_backorder: p.allow_backorder,
    });
  }

  const { blocking, backorders } = checkStock(
    lines.map((l) => ({ product_id: l.product_id, name: l.name, quantity: l.quantity, allow_backorder: l.allow_backorder })),
    avail,
  );

  const subtotal = round2(lines.reduce((a, l) => a + l.line_total, 0));
  const tax = Math.round(subtotal * taxConfig().rate);
  return {
    lines,
    subtotal,
    tax,
    total: subtotal + tax,
    saving: round2(lines.reduce((a, l) => a + l.saving, 0)),
    blocking,
    backorders,
    tier: ctx.listName,
  };
}

// ============================================================ statements
/**
 * One customer's account over a period.
 *
 * Built from the receivable control account only. Advances sit on a
 * liability and withholding on its own receivable, and both carry the
 * same party id, so including every tagged line would count each entry
 * twice. They are reported separately, which is where a buyer expects
 * to see them.
 */
export async function getStatement(customerId: string, from: string, to: string): Promise<Statement | null> {
  await applyFormatting();
  const customer = await getCustomerById(customerId);
  if (!customer) return null;

  const accounts = await getAccounts();
  const ar = accounts.find((a) => a.system_key === "accounts_receivable");
  if (!ar) return null;

  let rows: StatementSource[] = [];
  if (isDemo) {
    const entries = new Map(demo.acc.entries.map((e) => [e.id, e]));
    rows = demo.acc.lines
      .filter((l) => l.account_id === ar.id && l.party_id === customerId)
      .map((l) => {
        const e = entries.get(l.entry_id);
        return e && {
          id: l.id, entry_no: e.entry_no, entry_date: e.entry_date,
          narration: l.memo ? `${e.narration} · ${l.memo}` : e.narration,
          debit: Number(l.debit), credit: Number(l.credit),
        };
      })
      .filter((x): x is StatementSource => !!x);
  } else {
    const { data } = await (await createClient())
      .from("journal_lines")
      .select("id, debit, credit, memo, entry:journal_entries(entry_no, entry_date, narration)")
      .eq("account_id", ar.id).eq("party_id", customerId);
    type R = { id: string; debit: number; credit: number; memo: string | null; entry: { entry_no: string; entry_date: string; narration: string } | null };
    rows = ((data ?? []) as unknown as R[])
      .filter((r) => r.entry)
      .map((r) => ({
        id: r.id, entry_no: r.entry!.entry_no, entry_date: r.entry!.entry_date,
        narration: r.memo ? `${r.entry!.narration} · ${r.memo}` : r.entry!.narration,
        debit: Number(r.debit), credit: Number(r.credit),
      }));
  }

  const [invoices, advance, withheld] = await Promise.all([
    getInvoices({ customerId }),
    getCustomerAdvance(customerId),
    getWithheldFrom(customerId),
  ]);

  return buildStatement({
    rows,
    from,
    to,
    advance,
    withheld,
    openItems: invoices
      .filter((i) => i.status === "issued" && i.type === "tax_invoice")
      .map((i) => ({
        number: i.invoice_number ?? "",
        issue_date: i.issue_date,
        due_date: i.due_date,
        total: i.total,
        balance: i.balance,
      })),
  });
}

// ============================================================= cash flow
/** Journal entries with their lines resolved, for the cash flow and exports. */
const ledgerEntries = cache(async (from?: string, to?: string): Promise<CashEntry[]> => {
  const accounts = await getAccounts();
  const byId = new Map(accounts.map((a) => [a.id, a]));

  let entries: { id: string; entry_date: string }[];
  let lines: { entry_id: string; account_id: string; debit: number; credit: number }[];

  if (isDemo) {
    entries = demo.acc.entries;
    lines = demo.acc.lines;
  } else {
    const supabase = await createClient();
    let q = supabase.from("journal_entries").select("id, entry_date");
    if (from) q = q.gte("entry_date", from);
    if (to) q = q.lte("entry_date", to);
    const { data: e } = await q;
    entries = e ?? [];
    const { data: l } = await supabase
      .from("journal_lines").select("entry_id, account_id, debit, credit")
      .in("entry_id", entries.map((x) => x.id));
    lines = l ?? [];
  }

  const byEntry = new Map<string, CashEntry["lines"]>();
  for (const l of lines) {
    const a = byId.get(l.account_id);
    if (!a) continue;
    const list = byEntry.get(l.entry_id) ?? [];
    list.push({
      account_id: l.account_id, code: a.code, name: a.name, type: a.type,
      system_key: a.system_key, debit: Number(l.debit), credit: Number(l.credit),
    });
    byEntry.set(l.entry_id, list);
  }

  return entries
    .filter((e) => (!from || e.entry_date >= from) && (!to || e.entry_date <= to))
    .map((e) => ({ entry_date: e.entry_date, lines: byEntry.get(e.id) ?? [] }));
});

export async function getCashFlow(from: string, to: string): Promise<CashFlow> {
  await applyFormatting();

  // Opening cash is everything up to the day before the window. Taken
  // from the ledger rather than from a stored balance, so it cannot
  // drift away from the entries that produced it.
  const before = await getTrialBalance({ to: addDays(from, -1) });
  const opening = before
    .filter((b) => b.system_key === "cash" || b.system_key === "bank")
    .reduce((a, b) => a + b.balance, 0);

  const entries = await ledgerEntries(from, to);
  return buildCashFlow({ entries, from, to, opening });
}

// ========================================================= tax return
/** Annex-C rows for one month, with whatever would make FBR reject them. */
export async function getAnnexC(month: string): Promise<AnnexCReport> {
  await applyFormatting();
  const [invoices, products, settings] = await Promise.all([
    getInvoices(),
    getProducts({ perPage: 10000, includeArchived: true }),
    getCompanySettings(),
  ]);

  // HS code lives on the product, and an invoice line keeps only the sku
  // it was issued with, so the two are matched here rather than frozen
  // onto the document. Coding the catalogue later should fix past
  // months' returns, not just future ones.
  const hsBySku = new Map(products.rows.map((p) => [p.sku, p.hs_code]));
  const customers = await getCustomers();
  const byId = new Map(customers.map((c) => [c.id, c]));

  return buildAnnexC({
    month,
    furtherTax: settings.further_tax_enabled,
    invoices: invoices.map((i) => {
      // The buyer snapshot frozen at issue is authoritative; the live
      // customer record only fills in what was not captured then.
      const frozen = (i.buyer ?? {}) as { name?: string; ntn?: string | null; strn?: string | null };
      const live = byId.get(i.customer.id);
      return {
        invoice_number: i.invoice_number,
        issue_date: i.issue_date,
        type: i.type,
        status: i.status,
        tax_rate: i.tax_rate,
        discount: i.discount,
        freight: i.freight,
        buyer: {
          name: frozen.name || i.customer.company_name,
          strn: frozen.strn ?? live?.strn ?? null,
          ntn: frozen.ntn ?? live?.ntn ?? null,
          cnic: live?.cnic ?? null,
        },
        items: i.items.map((l) => ({
          sku: l.sku, name: l.name,
          hs_code: hsBySku.get(l.sku) ?? null,
          line_total: l.line_total,
        })),
      };
    }),
  });
}

// ============================================================== exports
/** The journal in the shape the Tally and QuickBooks writers want. */
export async function getExportEntries(from: string, to: string): Promise<ExportEntry[]> {
  const book = await getDayBook({ from, to, limit: 10000 });
  return book
    // Oldest first: an import that posts in date order leaves a readable
    // ledger on the other side.
    .slice()
    .reverse()
    .map((e) => ({
      entry_no: e.entry_no,
      entry_date: e.entry_date,
      narration: e.narration,
      lines: e.lines.map((l) => ({
        code: l.code,
        name: l.name,
        debit: Number(l.debit),
        credit: Number(l.credit),
        party_name: l.party_name,
        memo: l.memo,
      })),
    }));
}

// ====================================================== reconciliation
export interface ControlBreak {
  customer_id: string;
  company_name: string;
  control: number;      // receivable control account for this party
  subledger: number;    // sum of their open invoices
  difference: number;
}

/**
 * Does the receivable control account agree with the invoices behind it?
 *
 * It always should. Every invoice posts to the control account and every
 * receipt credits it, so the two are the same facts recorded twice — and
 * that is exactly why the check is worth running: when they disagree,
 * something has been done to one and not the other.
 *
 * It earned its place. A statement built from the control account came
 * out two million short of the invoices it was meant to explain, because
 * receipts posted against invoices that were later voided had never been
 * reversed. Nothing on any screen would have shown that: the aged
 * debtors list reads the invoices, the trial balance reads the ledger,
 * and neither compares them.
 */
export async function getReceivableBreaks(): Promise<ControlBreak[]> {
  await applyFormatting();
  const accounts = await getAccounts();
  const ar = accounts.find((a) => a.system_key === "accounts_receivable");
  if (!ar) return [];

  const [customers, invoices] = await Promise.all([getCustomers(), getInvoices()]);

  const control = new Map<string, number>();
  if (isDemo) {
    for (const l of demo.acc.lines) {
      if (l.account_id !== ar.id || !l.party_id) continue;
      control.set(l.party_id, (control.get(l.party_id) ?? 0) + Number(l.debit) - Number(l.credit));
    }
  } else {
    const { data } = await (await createClient())
      .from("journal_lines").select("party_id, debit, credit").eq("account_id", ar.id).not("party_id", "is", null);
    for (const l of data ?? []) {
      if (!l.party_id) continue;
      control.set(l.party_id, (control.get(l.party_id) ?? 0) + Number(l.debit) - Number(l.credit));
    }
  }

  const sub = new Map<string, number>();
  for (const i of invoices) {
    if (i.status !== "issued" || i.type !== "tax_invoice") continue;
    sub.set(i.customer.id, (sub.get(i.customer.id) ?? 0) + i.balance);
  }

  const breaks: ControlBreak[] = [];
  for (const c of customers) {
    const a = round2(control.get(c.id) ?? 0);
    const b = round2(sub.get(c.id) ?? 0);
    // Half a unit of currency, not zero: rounding on a split allocation
    // can leave paisa, and reporting that as a break would train people
    // to ignore the warning.
    if (Math.abs(a - b) < 0.5) continue;
    breaks.push({
      customer_id: c.id,
      company_name: c.company_name ?? c.email,
      control: a,
      subledger: b,
      difference: round2(a - b),
    });
  }

  return breaks.sort((x, y) => Math.abs(y.difference) - Math.abs(x.difference));
}
