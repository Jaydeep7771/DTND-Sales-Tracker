"use server";

/**
 * Invoice lifecycle. Draft is freely editable; issuing freezes the
 * snapshot, allocates a gapless number, posts to the ledger and renders
 * the PDF. After that only voiding is possible, by reversing entry.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { demo, newId } from "@/lib/demo-store";
import { isDemo, getCompanySettings, getCurrentStaff, getCustomerAdvance, getCustomerById, getCustomers, getInvoice, getInvoices, getOrders, getRemainingToInvoice } from "@/lib/data";
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
export async function createDraftInvoice(
  orderId: string,
  type: "tax_invoice" | "proforma" = "tax_invoice",
): Promise<Result<{ id: string }>> {
  const denied = await deny("invoice:write"); if (denied) return denied;

  const order = (await getOrders()).find((o) => o.id === orderId);
  if (!order) return { ok: false, error: "Order not found." };

  // Only a live order may be billed. Listing what IS allowed rather than
  // what is not means a new status cannot quietly become invoiceable:
  // previously only pending and sent-back were blocked, so a rejected or
  // withdrawn order could still be invoiced to the customer.
  if (order.status !== "approved" && order.status !== "fulfilled") {
    const why: Record<string, string> = {
      pending: "Approve the order before invoicing it.",
      changes_requested: "This order is back with the customer for changes. Invoice it once they resubmit and it is approved.",
      rejected: "This order was rejected, so there is nothing to bill.",
      cancelled: "This order was withdrawn, so there is nothing to bill.",
    };
    return { ok: false, error: why[order.status] ?? "This order cannot be invoiced." };
  }
  if (order.invoices.some((i) => i.status === "draft" && i.type === type)) {
    return { ok: false, error: `This order already has a draft ${type === "proforma" ? "proforma" : "invoice"}.` };
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
      id, invoice_number: null, type, status: "draft",
      order_id: orderId, customer_id: order.customer.id,
      seller: {}, buyer: {}, currency: settings.currency_code, tax_rate: taxRate,
      subtotal: totals.subtotal, discount: 0, freight: 0, tax_amount: totals.tax_amount, total: totals.total,
      issue_date: null, due_date: null, terms_days: settings.default_terms_days, notes: settings.invoice_default_notes,
      pdf_path: null, pdf_sha256: null, journal_entry_id: null, credit_note_for: null,
      converted_from: null, valid_until: null, period_start: null, period_end: null,
      sent_at: null, sent_to: null,
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
    order_id: orderId, customer_id: order.customer.id, type, tax_rate: taxRate,
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

  // Re-checked at issue, not just at draft: a draft can sit for days while
  // the order is withdrawn underneath it.
  if (invoice.order_id) {
    const order = (await getOrders()).find((o) => o.id === invoice.order_id);
    if (order && order.status !== "approved" && order.status !== "fulfilled") {
      return {
        ok: false,
        error: `Order ${order.order_number} is ${order.status === "cancelled" ? "withdrawn" : order.status}, so this draft cannot be issued. Discard it.`,
      };
    }
  }
  if (invoice.items.length === 0) return { ok: false, error: "An invoice needs at least one line." };

  const settings = await getCompanySettings();
  const issueDate = new Date();
  const iso = businessDate(issueDate);
  const proforma = invoice.type === "proforma";

  // A proforma is an offer, not a supply. It gets its own gapless series
  // because the tax invoice series has to stay unbroken for the tax
  // authority, and burning a number on a quote that may never be
  // accepted would put a hole in it.
  const prefix = proforma ? settings.proforma_prefix : settings.invoice_prefix;
  const fy = fiscalYearLabel(issueDate, settings.fiscal_year_start_month);
  const short = fy.slice(2, 4) + fy.slice(-2);
  const seq = await nextDocumentNumber(`${prefix}-${fy}`);
  const number = `${prefix}-${short}-${String(seq).padStart(5, "0")}`;

  // A tax invoice falls due; a proforma expires. They are not the same
  // date and must not be stored in the same column, or a quote would
  // show up in the aged debtors as money somebody owes us.
  const due = proforma ? null : addDays(iso, invoice.terms_days);
  const validUntil = proforma ? addDays(iso, settings.proforma_valid_days) : null;

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
  //
  // A proforma posts nothing at all. No goods have been supplied, so
  // there is no revenue to recognise, no receivable to raise and no
  // output tax to declare. Booking any of it would be inventing a sale.
  const revenue = round2(invoice.subtotal - invoice.discount);
  const posted = proforma ? { ok: true as const, entryId: null } : await postEntry({
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
    valid_until: validUntil,
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

  // Recorded only on a real send, so "sent" on the screen means it left
  // rather than that somebody pressed the button.
  if (result.sent) {
    const stamp = { sent_at: new Date().toISOString(), sent_to: invoice.customer.email };
    if (isDemo) Object.assign(demo.acc.invoices.find((i) => i.id === invoiceId)!, stamp);
    else await (await createClient()).from("invoices").update(stamp).eq("id", invoiceId);
  }

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

// ------------------------------------------------------------- proforma
/**
 * Turns an accepted proforma into a tax invoice.
 *
 * The quote itself is left alone: it keeps its number, stays issued and
 * records nothing in the ledger, which is exactly what it should do. The
 * tax invoice is raised as a fresh draft so it can still be checked
 * before it posts, and it points back at the proforma through
 * converted_from, which is unique — a quote bills once.
 *
 * Quantities are re-derived against what is still uninvoiced, because
 * between quoting and accepting the goods may have been billed another
 * way, and a quote is not a reservation.
 */
export async function convertProforma(proformaId: string): Promise<Result<{ id: string }>> {
  const denied = await deny("invoice:write"); if (denied) return denied;

  const proforma = await getInvoice(proformaId);
  if (!proforma) return { ok: false, error: "Proforma not found." };
  if (proforma.type !== "proforma") return { ok: false, error: "Only a proforma can be converted." };
  if (proforma.status !== "issued") return { ok: false, error: "Issue the proforma before converting it." };
  if (proforma.converted_to) return { ok: false, error: "This proforma has already been converted." };

  // An expiry that is not enforced is decoration. Requoting is a few
  // clicks; honouring a stale price silently is a margin leak.
  const today = businessDate();
  if (proforma.valid_until && proforma.valid_until < today) {
    return { ok: false, error: `This proforma expired on ${proforma.valid_until}. Raise a fresh one at current prices.` };
  }

  if (proforma.order_id) {
    const order = (await getOrders()).find((o) => o.id === proforma.order_id);
    if (order && order.status !== "approved" && order.status !== "fulfilled") {
      return { ok: false, error: `Order ${order.order_number} is ${order.status === "cancelled" ? "withdrawn" : order.status}, so this quote cannot be billed.` };
    }
  }

  // Clamp to what is genuinely still outstanding on each order line.
  const remainingByItem = new Map<string, number>();
  if (proforma.order_id) {
    const used = await getRemainingToInvoice(proforma.order_id);
    const order = (await getOrders()).find((o) => o.id === proforma.order_id);
    for (const l of order?.items ?? []) remainingByItem.set(l.id, l.quantity - (used.get(l.id) ?? 0));
  }

  const lines = proforma.items
    .map((l) => {
      const cap = l.order_item_id ? remainingByItem.get(l.order_item_id) : undefined;
      return { line: l, quantity: cap === undefined ? l.quantity : Math.min(l.quantity, Math.max(0, cap)) };
    })
    .filter((x) => x.quantity > 0);

  if (!lines.length) {
    return { ok: false, error: "Everything on this quote has since been invoiced another way. Nothing left to bill." };
  }

  const settings = await getCompanySettings();
  const totals = computeInvoiceTotals(
    lines.map((x) => ({ quantity: x.quantity, unit_price: x.line.unit_price })),
    proforma.discount, proforma.freight, proforma.tax_rate,
  );
  const now = new Date().toISOString();

  if (isDemo) {
    const id = newId();
    demo.acc.invoices.unshift({
      id, invoice_number: null, type: "tax_invoice", status: "draft",
      order_id: proforma.order_id, customer_id: proforma.customer.id,
      seller: {}, buyer: {}, currency: proforma.currency, tax_rate: proforma.tax_rate,
      subtotal: totals.subtotal, discount: proforma.discount, freight: proforma.freight,
      tax_amount: totals.tax_amount, total: totals.total,
      issue_date: null, due_date: null, terms_days: settings.default_terms_days, notes: proforma.notes,
      pdf_path: null, pdf_sha256: null, journal_entry_id: null, credit_note_for: null,
      converted_from: proforma.id, valid_until: null, period_start: null, period_end: null,
      sent_at: null, sent_to: null,
      issued_by: null, issued_at: null, voided_at: null, void_reason: null,
      created_by: null, created_at: now, updated_at: now,
    });
    lines.forEach((x, i) =>
      demo.acc.invoiceItems.push({
        id: newId(), invoice_id: id, order_item_id: x.line.order_item_id,
        sku: x.line.sku, name: x.line.name, unit_of_measure: x.line.unit_of_measure,
        quantity: x.quantity, unit_price: x.line.unit_price,
        line_total: round2(x.quantity * x.line.unit_price), sort_order: i,
      }),
    );
    revalidateAll();
    return { ok: true, data: { id } };
  }

  const supabase = await createClient();
  const { data: inv, error } = await supabase.from("invoices").insert({
    order_id: proforma.order_id, customer_id: proforma.customer.id, type: "tax_invoice",
    converted_from: proforma.id,
    currency: proforma.currency, tax_rate: proforma.tax_rate, terms_days: settings.default_terms_days,
    notes: proforma.notes, discount: proforma.discount, freight: proforma.freight,
    subtotal: totals.subtotal, tax_amount: totals.tax_amount, total: totals.total,
  }).select("id").single();
  if (error || !inv) {
    // The unique index is the real guard against billing a quote twice.
    if (error?.code === "23505") return { ok: false, error: "This proforma has already been converted." };
    return { ok: false, error: error?.message ?? "Could not raise the invoice." };
  }

  const { error: itemsError } = await supabase.from("invoice_items").insert(
    lines.map((x, i) => ({
      invoice_id: inv.id, order_item_id: x.line.order_item_id,
      sku: x.line.sku, name: x.line.name, unit_of_measure: x.line.unit_of_measure,
      quantity: x.quantity, unit_price: x.line.unit_price,
      line_total: round2(x.quantity * x.line.unit_price), sort_order: i,
    })),
  );
  if (itemsError) {
    await supabase.from("invoices").delete().eq("id", inv.id);
    return { ok: false, error: itemsError.message };
  }

  revalidateAll();
  return { ok: true, data: { id: inv.id } };
}

// --------------------------------------------------------- consolidated
export interface ConsolidatedInput {
  customerId: string;
  /** Inclusive business dates, YYYY-MM-DD. */
  from: string;
  to: string;
}

/**
 * One invoice covering every order a customer placed in a period.
 *
 * A customer ordering twice a week got eight invoices a month and eight
 * payments to reconcile. This bills the lot once. The invoice carries no
 * order_id — there is no single order — and is tied to the orders it
 * bills purely through invoice_items.order_item_id, which is the same
 * linkage a part-shipment already used and the only thing that stays
 * true when one document spans several orders.
 *
 * It is raised as a draft, because a month's billing is exactly the sort
 * of document somebody should read before it posts.
 */
export async function createConsolidatedInvoice(input: ConsolidatedInput): Promise<Result<{ id: string; orders: number; lines: number }>> {
  const denied = await deny("invoice:write"); if (denied) return denied;
  if (!input.from || !input.to) return { ok: false, error: "Give a period to bill." };
  if (input.to < input.from) return { ok: false, error: "The period ends before it starts." };

  const customer = await getCustomerById(input.customerId);
  if (!customer) return { ok: false, error: "Customer not found." };

  const orders = (await getOrders({ customerId: input.customerId })).filter((o) => {
    if (o.status !== "approved" && o.status !== "fulfilled") return false;
    const on = businessDate(new Date(o.created_at));
    return on >= input.from && on <= input.to;
  });
  if (!orders.length) return { ok: false, error: "No billable orders for that customer in that period." };
  if (orders.some((o) => o.invoices.some((i) => i.status === "draft" && i.type === "tax_invoice"))) {
    return { ok: false, error: "One of these orders already has a draft invoice. Issue or discard it first." };
  }

  // Each order contributes only what is still uninvoiced, so running the
  // month twice, or running it after somebody billed one order by hand,
  // cannot bill the same goods again.
  const picked: { order: typeof orders[number]; item: typeof orders[number]["items"][number]; quantity: number }[] = [];
  for (const order of orders) {
    const used = await getRemainingToInvoice(order.id);
    for (const item of order.items) {
      const remaining = item.quantity - (used.get(item.id) ?? 0);
      if (remaining > 0) picked.push({ order, item, quantity: remaining });
    }
  }
  if (!picked.length) return { ok: false, error: "Everything in that period has already been invoiced." };

  // Grouped by order so the document reads as a statement of the month
  // rather than a jumble of lines.
  picked.sort((a, b) =>
    a.order.created_at.localeCompare(b.order.created_at) || a.item.name.localeCompare(b.item.name));

  const settings = await getCompanySettings();
  const taxRate = Number(settings.default_tax_rate);
  const totals = computeInvoiceTotals(
    picked.map((x) => ({ quantity: x.quantity, unit_price: x.item.price_at_purchase })), 0, 0, taxRate,
  );
  const now = new Date().toISOString();
  const orderCount = new Set(picked.map((x) => x.order.id)).size;

  // Each line says which order it came from, because a consolidated
  // invoice is unreadable without that and the buyer will ask.
  const label = (x: typeof picked[number]) => `${x.item.name} · ${x.order.order_number}`;

  if (isDemo) {
    const id = newId();
    demo.acc.invoices.unshift({
      id, invoice_number: null, type: "tax_invoice", status: "draft",
      order_id: null, customer_id: input.customerId,
      seller: {}, buyer: {}, currency: settings.currency_code, tax_rate: taxRate,
      subtotal: totals.subtotal, discount: 0, freight: 0, tax_amount: totals.tax_amount, total: totals.total,
      issue_date: null, due_date: null, terms_days: settings.default_terms_days,
      notes: settings.invoice_default_notes,
      pdf_path: null, pdf_sha256: null, journal_entry_id: null, credit_note_for: null,
      converted_from: null, valid_until: null, period_start: input.from, period_end: input.to,
      sent_at: null, sent_to: null,
      issued_by: null, issued_at: null, voided_at: null, void_reason: null,
      created_by: null, created_at: now, updated_at: now,
    });
    picked.forEach((x, i) =>
      demo.acc.invoiceItems.push({
        id: newId(), invoice_id: id, order_item_id: x.item.id,
        sku: x.item.sku, name: label(x), unit_of_measure: "Each",
        quantity: x.quantity, unit_price: x.item.price_at_purchase,
        line_total: round2(x.quantity * x.item.price_at_purchase), sort_order: i,
      }),
    );
    revalidateAll();
    return { ok: true, data: { id, orders: orderCount, lines: picked.length } };
  }

  const supabase = await createClient();
  const { data: inv, error } = await supabase.from("invoices").insert({
    order_id: null, customer_id: input.customerId, tax_rate: taxRate,
    currency: settings.currency_code, terms_days: settings.default_terms_days,
    notes: settings.invoice_default_notes,
    period_start: input.from, period_end: input.to,
    subtotal: totals.subtotal, tax_amount: totals.tax_amount, total: totals.total,
  }).select("id").single();
  if (error || !inv) return { ok: false, error: error?.message ?? "Could not create the consolidated draft." };

  const { error: itemsError } = await supabase.from("invoice_items").insert(
    picked.map((x, i) => ({
      invoice_id: inv.id, order_item_id: x.item.id, sku: x.item.sku, name: label(x),
      quantity: x.quantity, unit_price: x.item.price_at_purchase,
      line_total: round2(x.quantity * x.item.price_at_purchase), sort_order: i,
    })),
  );
  if (itemsError) {
    await supabase.from("invoices").delete().eq("id", inv.id);
    return { ok: false, error: itemsError.message };
  }

  revalidateAll();
  return { ok: true, data: { id: inv.id, orders: orderCount, lines: picked.length } };
}

export interface BillingRunRow {
  customerId: string;
  company: string;
  ok: boolean;
  invoiceId?: string;
  orders?: number;
  reason?: string;
}

/**
 * The monthly run: one consolidated draft per account that is set to be
 * billed that way.
 *
 * Every customer is attempted and the failures are reported rather than
 * thrown, because "nothing to bill" is a perfectly normal outcome for
 * half the list and must not stop the other half.
 */
export async function runConsolidatedBilling(from: string, to: string): Promise<Result<{ rows: BillingRunRow[] }>> {
  const denied = await deny("invoice:write"); if (denied) return denied;

  const customers = (await getCustomers()).filter((c) => c.consolidated_billing);
  if (!customers.length) {
    return { ok: false, error: "No accounts are set to consolidated billing. Turn it on for a customer first." };
  }

  const rows: BillingRunRow[] = [];
  for (const c of customers) {
    const res = await createConsolidatedInvoice({ customerId: c.id, from, to });
    rows.push(
      res.ok
        ? { customerId: c.id, company: c.company_name ?? c.email, ok: true, invoiceId: res.data!.id, orders: res.data!.orders }
        : { customerId: c.id, company: c.company_name ?? c.email, ok: false, reason: res.error },
    );
  }

  revalidateAll();
  return { ok: true, data: { rows } };
}

/** Whether this account is billed per order or once per period. */
export async function setConsolidatedBilling(customerId: string, on: boolean): Promise<Result> {
  const denied = await deny("invoice:write"); if (denied) return denied;
  if (isDemo) {
    const c = demo.customers.find((c) => c.id === customerId);
    if (!c) return { ok: false, error: "Customer not found." };
    c.consolidated_billing = on;
  } else {
    const { error } = await (await createClient()).from("users").update({ consolidated_billing: on }).eq("id", customerId);
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  revalidatePath(`/admin/customers/${customerId}`);
  return { ok: true };
}
