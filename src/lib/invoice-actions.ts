"use server";

/**
 * Invoice lifecycle. Draft is freely editable; issuing freezes the
 * snapshot, allocates a gapless number, posts to the ledger and renders
 * the PDF. After that only voiding is possible, by reversing entry.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { demo, newId } from "@/lib/demo-store";
import { isDemo, getCompanySettings, getCurrentStaff, getCustomerAdvance, getCustomerById, getInvoice, getInvoices, getOrders, getRemainingToInvoice } from "@/lib/data";
import { can } from "@/lib/permissions";
import { addDays, businessDate, computeInvoiceTotals, round2, type PaymentMethod } from "@/lib/accounting";
import { fiscalYearLabel, nextDocumentNumber, postEntry, reverseEntry } from "@/lib/ledger";
import { invoiceEmail, sendEmail } from "@/lib/email";
import { money } from "@/lib/format";
import type { CompanySettings, InvoiceItem } from "@/types/database";
import type { InvoiceView } from "@/lib/types";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * The seller side of the frozen snapshot. Presentation is included on
 * purpose: an invoice should keep the letterhead, currency notation and
 * tax wording it was issued with, however settings change afterwards.
 */
function sellerSnapshot(settings: CompanySettings) {
  return {
    name: settings.legal_name, address: settings.address, city: settings.city, country: settings.country,
    ntn: settings.ntn, strn: settings.strn, phone: settings.phone, email: settings.email, bank: settings.bank_details,
    tagline: settings.tagline, initials: settings.logo_initials,
    template: settings.invoice_template, accent: settings.accent_color,
    footer_note: settings.invoice_footer_note, tax_label: settings.tax_label,
    show_bank: settings.invoice_show_bank, show_signature: settings.invoice_show_signature,
    show_tax_ids: settings.invoice_show_tax_ids,
    currency_symbol: settings.currency_symbol, currency_display: settings.currency_display,
    decimals: settings.decimal_places, locale: settings.number_locale,
  };
}

function revalidateAll() {
  for (const p of ["/admin", "/admin/orders", "/admin/invoices", "/admin/accounts", "/portal/orders", "/portal/invoices"]) revalidatePath(p);
}

async function deny(capability: Parameters<typeof can>[1]): Promise<Result | null> {
  const staff = await getCurrentStaff();
  if (can(staff?.role, capability)) return null;
  return { ok: false, error: "Your role does not permit this action." };
}

// ---------------------------------------------------------------- create
/**
 * Raises a draft against an approved order, prefilled with whatever is
 * still uninvoiced so a part shipment can be billed now and the rest later.
 */
export async function createDraftInvoice(orderId: string): Promise<Result<{ id: string }>> {
  const denied = await deny("invoice:write"); if (denied) return denied;

  const order = (await getOrders()).find((o) => o.id === orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status === "pending" || order.status === "changes_requested") {
    return { ok: false, error: "Approve the order before invoicing it." };
  }
  if (order.invoices.some((i) => i.status === "draft")) {
    return { ok: false, error: "This order already has a draft invoice." };
  }

  const used = await getRemainingToInvoice(orderId);
  const lines = order.items
    .map((l) => ({ line: l, remaining: l.quantity - (used.get(l.id) ?? 0) }))
    .filter((x) => x.remaining > 0);
  if (lines.length === 0) return { ok: false, error: "Every line on this order has already been invoiced." };

  const settings = await getCompanySettings();
  const taxRate = Number(settings.default_tax_rate);
  const totals = computeInvoiceTotals(
    lines.map((x) => ({ quantity: x.remaining, unit_price: x.line.price_at_purchase })), 0, 0, taxRate,
  );
  const now = new Date().toISOString();

  if (isDemo) {
    const id = newId();
    demo.acc.invoices.unshift({
      id, invoice_number: null, type: "tax_invoice", status: "draft",
      order_id: orderId, customer_id: order.customer.id,
      seller: {}, buyer: {}, currency: settings.currency_code, tax_rate: taxRate,
      subtotal: totals.subtotal, discount: 0, freight: 0, tax_amount: totals.tax_amount, total: totals.total,
      issue_date: null, due_date: null, terms_days: settings.default_terms_days, notes: settings.invoice_default_notes,
      pdf_path: null, pdf_sha256: null, journal_entry_id: null, credit_note_for: null,
      issued_by: null, issued_at: null, voided_at: null, void_reason: null,
      created_by: null, created_at: now, updated_at: now,
    });
    lines.forEach((x, i) =>
      demo.acc.invoiceItems.push({
        id: newId(), invoice_id: id, order_item_id: x.line.id,
        sku: x.line.sku, name: x.line.name, unit_of_measure: "Each",
        quantity: x.remaining, unit_price: x.line.price_at_purchase,
        line_total: round2(x.remaining * x.line.price_at_purchase), sort_order: i,
      }),
    );
    revalidateAll();
    return { ok: true, data: { id } };
  }

  const supabase = await createClient();
  const { data: inv, error } = await supabase.from("invoices").insert({
    order_id: orderId, customer_id: order.customer.id, tax_rate: taxRate,
    currency: settings.currency_code, terms_days: settings.default_terms_days,
    notes: settings.invoice_default_notes,
    subtotal: totals.subtotal, tax_amount: totals.tax_amount, total: totals.total,
  }).select("id").single();
  if (error || !inv) return { ok: false, error: error?.message ?? "Could not create the draft." };

  const { error: itemsError } = await supabase.from("invoice_items").insert(
    lines.map((x, i) => ({
      invoice_id: inv.id, order_item_id: x.line.id, sku: x.line.sku, name: x.line.name,
      quantity: x.remaining, unit_price: x.line.price_at_purchase,
      line_total: round2(x.remaining * x.line.price_at_purchase), sort_order: i,
    })),
  );
  if (itemsError) return { ok: false, error: itemsError.message };
  revalidateAll();
  return { ok: true, data: { id: inv.id } };
}

// ---------------------------------------------------------------- edit
export interface DraftPatch {
  quantities: Record<string, number>;   // invoice_item id -> qty, 0 removes
  discount: number;
  freight: number;
  terms_days: number;
  notes: string;
}

export async function updateDraftInvoice(invoiceId: string, patch: DraftPatch): Promise<Result> {
  const denied = await deny("invoice:write"); if (denied) return denied;
  const invoice = await getInvoice(invoiceId);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (invoice.status !== "draft") return { ok: false, error: "Only drafts can be edited." };

  const kept = invoice.items
    .map((l) => ({ ...l, quantity: patch.quantities[l.id] ?? l.quantity }))
    .filter((l) => l.quantity > 0);
  if (kept.length === 0) return { ok: false, error: "An invoice needs at least one line." };

  const totals = computeInvoiceTotals(kept, patch.discount, patch.freight, invoice.tax_rate);

  if (isDemo) {
    demo.acc.invoiceItems = demo.acc.invoiceItems.filter((i) => i.invoice_id !== invoiceId || kept.some((k) => k.id === i.id));
    for (const i of demo.acc.invoiceItems.filter((i) => i.invoice_id === invoiceId)) {
      const k = kept.find((k) => k.id === i.id)!;
      i.quantity = k.quantity;
      i.line_total = round2(k.quantity * k.unit_price);
    }
    const inv = demo.acc.invoices.find((i) => i.id === invoiceId)!;
    Object.assign(inv, {
      discount: patch.discount, freight: patch.freight, terms_days: patch.terms_days,
      notes: patch.notes.trim() || null, subtotal: totals.subtotal,
      tax_amount: totals.tax_amount, total: totals.total, updated_at: new Date().toISOString(),
    });
    revalidateAll();
    return { ok: true };
  }

  const supabase = await createClient();
  const removed = invoice.items.filter((l) => !kept.some((k) => k.id === l.id)).map((l) => l.id);
  if (removed.length) await supabase.from("invoice_items").delete().in("id", removed);
  for (const k of kept) {
    await supabase.from("invoice_items").update({ quantity: k.quantity, line_total: round2(k.quantity * k.unit_price) }).eq("id", k.id);
  }
  const { error } = await supabase.from("invoices").update({
    discount: patch.discount, freight: patch.freight, terms_days: patch.terms_days,
    notes: patch.notes.trim() || null, subtotal: totals.subtotal,
    tax_amount: totals.tax_amount, total: totals.total,
  }).eq("id", invoiceId);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function discardDraftInvoice(invoiceId: string): Promise<Result> {
  const denied = await deny("invoice:write"); if (denied) return denied;
  const invoice = await getInvoice(invoiceId);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (invoice.status !== "draft") return { ok: false, error: "Only drafts can be discarded." };
  if (isDemo) {
    demo.acc.invoices = demo.acc.invoices.filter((i) => i.id !== invoiceId);
    demo.acc.invoiceItems = demo.acc.invoiceItems.filter((i) => i.invoice_id !== invoiceId);
  } else {
    const { error } = await (await createClient()).from("invoices").delete().eq("id", invoiceId);
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

// ---------------------------------------------------------------- issue
export async function issueInvoice(invoiceId: string): Promise<Result<{ invoice_number: string }>> {
  const denied = await deny("invoice:write"); if (denied) return denied;
  const invoice = await getInvoice(invoiceId);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (invoice.status !== "draft") return { ok: false, error: "This invoice has already been issued." };
  if (invoice.items.length === 0) return { ok: false, error: "An invoice needs at least one line." };

  const settings = await getCompanySettings();
  const issueDate = new Date();
  const iso = businessDate(issueDate);
  const due = addDays(iso, invoice.terms_days);

  // Gapless number, scoped to the fiscal year.
  const fy = fiscalYearLabel(issueDate, settings.fiscal_year_start_month);
  const short = fy.slice(2, 4) + fy.slice(-2);
  const scope = `${settings.invoice_prefix}-${fy}`;
  const seq = await nextDocumentNumber(scope);
  const number = `${settings.invoice_prefix}-${short}-${String(seq).padStart(5, "0")}`;

  // Freeze both parties. A later change to settings or the customer record
  // must never rewrite an issued document.
  const customer = invoice.customer;
  const buyerRow = isDemo
    ? demo.customers.find((c) => c.id === customer.id)
    : (await (await createClient()).from("users").select("*").eq("id", customer.id).single()).data;
  const seller = sellerSnapshot(settings);
  const buyer = {
    name: customer.company_name, email: customer.email,
    address: buyerRow?.billing_address ?? null, ntn: buyerRow?.ntn ?? null, strn: buyerRow?.strn ?? null,
  };

  // Post to the ledger before marking issued, so a posting failure leaves
  // the invoice as an editable draft rather than an unposted document.
  const revenue = round2(invoice.subtotal - invoice.discount);
  const posted = await postEntry({
    entry_date: iso,
    narration: `Invoice ${number} to ${customer.company_name}`,
    source_type: "invoice",
    source_id: invoice.id,
    lines: [
      { system_key: "accounts_receivable", debit: invoice.total, party_id: customer.id, memo: number },
      { system_key: "sales_revenue", credit: revenue },
      ...(invoice.freight > 0 ? [{ system_key: "other_income" as const, credit: invoice.freight, memo: "Freight recovered" }] : []),
      ...(invoice.tax_amount > 0 ? [{ system_key: "output_tax" as const, credit: invoice.tax_amount }] : []),
    ],
  });
  if (!posted.ok) return { ok: false, error: `Ledger posting failed: ${posted.error}` };

  const staff = await getCurrentStaff();
  const patch = {
    invoice_number: number, status: "issued" as const, issue_date: iso, due_date: due,
    seller, buyer, issued_at: new Date().toISOString(), issued_by: staff?.id ?? null,
    journal_entry_id: posted.entryId,
  };

  if (isDemo) {
    Object.assign(demo.acc.invoices.find((i) => i.id === invoiceId)!, patch);
  } else {
    const { error } = await (await createClient()).from("invoices").update(patch).eq("id", invoiceId);
    if (error) return { ok: false, error: error.message };
    await archivePdf(invoiceId);
  }
  revalidateAll();
  return { ok: true, data: { invoice_number: number } };
}

/** Stores an immutable copy of the PDF with its hash. Live mode only. */
async function archivePdf(invoiceId: string): Promise<void> {
  try {
    const invoice = await getInvoice(invoiceId);
    if (!invoice?.invoice_number) return;
    const { renderInvoicePdf } = await import("@/lib/invoice-pdf");
    const { createHash } = await import("node:crypto");
    const pdf = await renderInvoicePdf(invoice);
    const path = `${invoice.customer.id}/${invoice.invoice_number}.pdf`;
    const supabase = await createClient();
    await supabase.storage.from("invoices").upload(path, pdf, { contentType: "application/pdf", upsert: true });
    await supabase.from("invoices")
      .update({ pdf_path: path, pdf_sha256: createHash("sha256").update(pdf).digest("hex") })
      .eq("id", invoiceId);
  } catch {
    // Archiving is best effort. The PDF is always re-renderable from the
    // frozen snapshot, so a storage outage must not block issuing.
  }
}

// ---------------------------------------------------------------- send
export async function sendInvoice(invoiceId: string): Promise<Result<{ sent: boolean; reason?: string; to: string }>> {
  const denied = await deny("invoice:write"); if (denied) return denied;
  const invoice = await getInvoice(invoiceId);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (invoice.status !== "issued") return { ok: false, error: "Issue the invoice before sending it." };

  const { renderInvoicePdf } = await import("@/lib/invoice-pdf");
  const pdf = await renderInvoicePdf(invoice);
  const staff = await getCurrentStaff();
  const message = invoiceEmail({
    to: invoice.customer.email,
    company: invoice.customer.company_name,
    invoiceNumber: invoice.invoice_number!,
    total: invoice.total,
    currency: invoice.currency,
    dueDate: invoice.due_date,
    orderNumber: invoice.order_number,
    senderName: staff?.company_name ?? "Accounts",
    bankDetails: (invoice.seller as { bank?: string | null }).bank ?? null,
  });
  const result = await sendEmail({
    ...message,
    attachments: [{ filename: `${invoice.invoice_number}.pdf`, content: pdf.toString("base64") }],
  });
  revalidateAll();
  return { ok: true, data: { sent: result.sent, reason: result.reason, to: invoice.customer.email } };
}

export async function issueAndSendInvoice(invoiceId: string): Promise<Result<{ invoice_number: string; sent: boolean; reason?: string; to: string }>> {
  const issued = await issueInvoice(invoiceId);
  if (!issued.ok) return issued;
  const sent = await sendInvoice(invoiceId);
  if (!sent.ok) return sent;
  return { ok: true, data: { invoice_number: issued.data!.invoice_number, ...sent.data! } };
}

// ---------------------------------------------------------------- void
export async function voidInvoice(invoiceId: string, reason: string): Promise<Result> {
  const denied = await deny("invoice:write"); if (denied) return denied;
  if (!reason.trim()) return { ok: false, error: "Give a reason so the ledger explains itself." };
  const invoice = await getInvoice(invoiceId);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (invoice.status !== "issued") return { ok: false, error: "Only issued invoices can be voided." };
  if (invoice.paid > 0) return { ok: false, error: "This invoice has payments against it. Raise a credit note instead." };

  const row = isDemo
    ? demo.acc.invoices.find((i) => i.id === invoiceId)
    : (await (await createClient()).from("invoices").select("journal_entry_id").eq("id", invoiceId).single()).data;
  if (row?.journal_entry_id) {
    const reversed = await reverseEntry(row.journal_entry_id, `Void of ${invoice.invoice_number}: ${reason.trim()}`);
    if (!reversed.ok) return { ok: false, error: `Could not reverse the ledger entry: ${reversed.error}` };
  }

  const patch = { status: "void" as const, voided_at: new Date().toISOString(), void_reason: reason.trim() };
  if (isDemo) Object.assign(demo.acc.invoices.find((i) => i.id === invoiceId)!, patch);
  else {
    const { error } = await (await createClient()).from("invoices").update(patch).eq("id", invoiceId);
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

// ---------------------------------------------------------------- receipts
/**
 * Cash arrives as a receipt from a customer, not as a payment on one
 * invoice. A Net 30 buyer settles several invoices with one transfer, so
 * the receipt is the unit of work and allocation across invoices is part
 * of it. All allocations of a receipt share one journal entry, which is
 * what groups them and what a reversal acts on.
 */
export interface ReceiptInput {
  customerId: string;
  /** Cash actually received into the bank or till. */
  amount: number;
  received_on: string;
  method: PaymentMethod;
  reference: string;
  note: string;
  allocations: { invoice_id: string; amount: number }[];
  /**
   * Income tax the customer deducted at source. The business has already
   * paid this to the government through the customer, so it settles the
   * invoice even though the cash never arrived.
   */
  withholding?: number;
  /**
   * Treat anything unallocated as money held on account rather than
   * refusing the receipt. Off by default: a mismatch is usually an error,
   * and silently parking it would hide that.
   */
  allowAdvance?: boolean;
}

const REFERENCE_REQUIRED: PaymentMethod[] = ["bank_transfer", "cheque", "online"];

export async function recordReceipt(input: ReceiptInput): Promise<Result<{ entryNo: string; allocated: number; advance: number }>> {
  const denied = await deny("payment:write"); if (denied) return denied;

  const amount = round2(input.amount);
  if (!(amount > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  if (input.received_on > businessDate()) return { ok: false, error: "A receipt cannot be dated in the future." };
  if (REFERENCE_REQUIRED.includes(input.method) && !input.reference.trim()) {
    return { ok: false, error: "A reference is required so the receipt can be reconciled against the bank." };
  }

  // Only this customer's live invoices may be settled.
  const open = (await getInvoices({ customerId: input.customerId }))
    .filter((i) => i.status === "issued" && i.balance > 0.005);
  const byId = new Map(open.map((i) => [i.id, i]));

  const allocations = input.allocations
    .map((a) => ({ ...a, amount: round2(a.amount) }))
    .filter((a) => a.amount > 0);
  if (allocations.length === 0) return { ok: false, error: "Allocate the receipt to at least one invoice." };

  for (const a of allocations) {
    const inv = byId.get(a.invoice_id);
    if (!inv) return { ok: false, error: "One of the invoices is not open for this customer." };
    if (a.amount > inv.balance + 0.005) {
      return { ok: false, error: `${inv.invoice_number} only has ${money(inv.balance)} outstanding.` };
    }
  }

  const withholding = round2(Math.max(0, input.withholding ?? 0));
  const allocated = round2(allocations.reduce((s, a) => s + a.amount, 0));

  // Tax withheld at source settles the invoice without arriving as cash,
  // so what has to balance is cash plus withholding against allocations.
  const settled = round2(amount + withholding);
  const unallocated = round2(settled - allocated);

  if (unallocated < -0.005) {
    return { ok: false, error: `Allocated ${money(allocated)} but the receipt plus withholding is only ${money(settled)}.` };
  }
  if (unallocated > 0.005 && !input.allowAdvance) {
    return {
      ok: false,
      error: `${money(unallocated)} is still unallocated. Allocate it, reduce the amount, or hold it as an advance on the customer's account.`,
    };
  }
  if (withholding > 0 && allocated <= 0.005) {
    return { ok: false, error: "Withholding has to be allocated against the invoice it was deducted from." };
  }

  // One entry for the whole receipt. Cash and withholding are both debits
  // because both are things the business received; the credit side clears
  // the receivable and parks any surplus as an advance.
  const customer = open[0]?.customer ?? (await getCustomerById(input.customerId));
  const posted = await postEntry({
    entry_date: input.received_on,
    narration: `Receipt from ${customer?.company_name ?? "customer"}${input.reference.trim() ? ` · ${input.reference.trim()}` : ""}`,
    source_type: "payment",
    source_id: input.customerId,
    lines: [
      ...(amount > 0
        ? [{ system_key: input.method === "cash" ? ("cash" as const) : ("bank" as const), debit: amount, memo: input.reference.trim() || undefined }]
        : []),
      ...(withholding > 0
        ? [{ system_key: "withholding_receivable" as const, debit: withholding, party_id: input.customerId, memo: "Tax deducted at source" }]
        : []),
      ...(allocated > 0
        ? [{ system_key: "accounts_receivable" as const, credit: allocated, party_id: input.customerId, memo: allocations.map((a) => byId.get(a.invoice_id)?.invoice_number).filter(Boolean).join(", ") }]
        : []),
      ...(unallocated > 0.005
        ? [{ system_key: "customer_advances" as const, credit: unallocated, party_id: input.customerId, memo: "Held on account" }]
        : []),
    ],
  });
  if (!posted.ok) return { ok: false, error: `Ledger posting failed: ${posted.error}` };

  const staff = await getCurrentStaff();
  const rows = allocations.map((a) => ({
    invoice_id: a.invoice_id,
    amount: a.amount,
    paid_on: input.received_on,
    method: input.method,
    reference: input.reference.trim() || null,
    note: input.note.trim() || null,
    journal_entry_id: posted.entryId,
    recorded_by: staff?.id ?? null,
  }));

  if (isDemo) {
    for (const r of rows) {
      demo.acc.payments.push({
        id: newId(), ...r,
        reversed_at: null, reversal_reason: null, reversed_by: null,
        created_at: new Date().toISOString(),
      });
    }
  } else {
    const { error } = await (await createClient()).from("invoice_payments").insert(rows);
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true, data: { entryNo: posted.entryNo, allocated, advance: unallocated > 0.005 ? unallocated : 0 } };
}

/**
 * Applies money already held on account against open invoices.
 *
 * Dr Customer Advances / Cr Accounts Receivable: no cash moves, because
 * the cash arrived when the advance was taken.
 */
export async function applyAdvance(
  customerId: string,
  allocations: { invoice_id: string; amount: number }[],
): Promise<Result<{ entryNo: string; applied: number }>> {
  const denied = await deny("payment:write"); if (denied) return denied;

  const held = await getCustomerAdvance(customerId);
  const rows = allocations.map((a) => ({ ...a, amount: round2(a.amount) })).filter((a) => a.amount > 0);
  if (rows.length === 0) return { ok: false, error: "Choose at least one invoice to apply the advance to." };

  const applied = round2(rows.reduce((s, a) => s + a.amount, 0));
  if (applied > held + 0.005) {
    return { ok: false, error: `Only ${money(held)} is held on account for this customer.` };
  }

  const open = (await getInvoices({ customerId }))
    .filter((i) => i.status === "issued" && i.type !== "credit_note" && i.balance > 0.005);
  const byId = new Map(open.map((i) => [i.id, i]));
  for (const a of rows) {
    const inv = byId.get(a.invoice_id);
    if (!inv) return { ok: false, error: "One of the invoices is not open for this customer." };
    if (a.amount > inv.balance + 0.005) {
      return { ok: false, error: `${inv.invoice_number} only has ${money(inv.balance)} outstanding.` };
    }
  }

  const customer = open[0]?.customer ?? (await getCustomerById(customerId));
  const iso = businessDate();
  const posted = await postEntry({
    entry_date: iso,
    narration: `Advance applied for ${customer?.company_name ?? "customer"}`,
    source_type: "payment",
    source_id: customerId,
    lines: [
      { system_key: "customer_advances", debit: applied, party_id: customerId, memo: "Applied to invoices" },
      { system_key: "accounts_receivable", credit: applied, party_id: customerId, memo: rows.map((a) => byId.get(a.invoice_id)?.invoice_number).filter(Boolean).join(", ") },
    ],
  });
  if (!posted.ok) return { ok: false, error: `Ledger posting failed: ${posted.error}` };

  const staff = await getCurrentStaff();
  const payments = rows.map((a) => ({
    invoice_id: a.invoice_id, amount: a.amount, paid_on: iso,
    method: "adjustment" as const, reference: "Advance applied", note: null,
    journal_entry_id: posted.entryId, recorded_by: staff?.id ?? null,
  }));

  if (isDemo) {
    for (const r of payments) {
      demo.acc.payments.push({
        id: newId(), ...r, reversed_at: null, reversal_reason: null, reversed_by: null,
        created_at: new Date().toISOString(),
      });
    }
  } else {
    const { error } = await (await createClient()).from("invoice_payments").insert(payments);
    if (error) return { ok: false, error: error.message };
  }

  revalidateAll();
  return { ok: true, data: { entryNo: posted.entryNo, applied } };
}

/**
 * Reverses a whole receipt, which is what a bounced cheque needs. The
 * allocations stay on record marked reversed, and the ledger gains a
 * mirror entry rather than losing the original.
 */
export async function reverseReceipt(journalEntryId: string, reason: string): Promise<Result> {
  const denied = await deny("payment:write"); if (denied) return denied;
  if (!reason.trim()) return { ok: false, error: "Give a reason, for example a returned cheque." };

  const reversed = await reverseEntry(journalEntryId, reason.trim());
  if (!reversed.ok) return { ok: false, error: `Could not reverse the ledger entry: ${reversed.error}` };

  const patch = { reversed_at: new Date().toISOString(), reversal_reason: reason.trim() };
  if (isDemo) {
    for (const p of demo.acc.payments.filter((p) => p.journal_entry_id === journalEntryId && !p.reversed_at)) {
      Object.assign(p, patch);
    }
  } else {
    const staff = await getCurrentStaff();
    const { error } = await (await createClient())
      .from("invoice_payments")
      .update({ ...patch, reversed_by: staff?.id ?? null })
      .eq("journal_entry_id", journalEntryId)
      .is("reversed_at", null);
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}


/** Re-renders the PDF from the frozen snapshot. Used by the download route. */
export async function invoicePdfBytes(invoiceId: string): Promise<Buffer | null> {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) return null;
  // A draft has no snapshot yet, so preview it against current settings:
  // that is what it will look like once issued.
  if (invoice.status === "draft") {
    invoice.seller = sellerSnapshot(await getCompanySettings());
  }
  const { renderInvoicePdf } = await import("@/lib/invoice-pdf");
  return renderInvoicePdf(invoice as InvoiceView);
}

export type { InvoiceItem };
