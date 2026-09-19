"use server";

/**
 * Invoice lifecycle. Draft is freely editable; issuing freezes the
 * snapshot, allocates a gapless number, posts to the ledger and renders
 * the PDF. After that only voiding is possible, by reversing entry.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { demo, newId } from "@/lib/demo-store";
import { isDemo, getCompanySettings, getCurrentStaff, getInvoice, getOrders, getRemainingToInvoice } from "@/lib/data";
import { can } from "@/lib/permissions";
import { addDays, businessDate, computeInvoiceTotals, round2 } from "@/lib/accounting";
import { fiscalYearLabel, nextDocumentNumber, postEntry, reverseEntry } from "@/lib/ledger";
import { invoiceEmail, sendEmail } from "@/lib/email";
import type { Invoice, InvoiceItem } from "@/types/database";
import type { InvoiceView } from "@/lib/types";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

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
      seller: {}, buyer: {}, currency: "PKR", tax_rate: taxRate,
      subtotal: totals.subtotal, discount: 0, freight: 0, tax_amount: totals.tax_amount, total: totals.total,
      issue_date: null, due_date: null, terms_days: settings.default_terms_days, notes: null,
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
    terms_days: settings.default_terms_days,
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
  const seller = {
    name: settings.legal_name, address: settings.address, city: settings.city, country: settings.country,
    ntn: settings.ntn, strn: settings.strn, phone: settings.phone, email: settings.email, bank: settings.bank_details,
  };
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

// ---------------------------------------------------------------- payments
export async function recordPayment(
  invoiceId: string,
  input: { amount: number; paid_on: string; method: Invoice["currency"] extends never ? never : string; reference: string },
): Promise<Result> {
  const denied = await deny("payment:write"); if (denied) return denied;
  const invoice = await getInvoice(invoiceId);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (invoice.status !== "issued") return { ok: false, error: "Only issued invoices can take payment." };
  if (!(input.amount > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  if (input.amount > invoice.balance + 0.005) {
    return { ok: false, error: `That is more than the outstanding balance of ${invoice.balance}.` };
  }

  const bankKey = input.method === "cash" ? "cash" : "bank";
  const posted = await postEntry({
    entry_date: input.paid_on,
    narration: `Payment received for ${invoice.invoice_number} from ${invoice.customer.company_name}`,
    source_type: "payment",
    source_id: invoiceId,
    lines: [
      { system_key: bankKey, debit: input.amount, memo: input.reference || undefined },
      { system_key: "accounts_receivable", credit: input.amount, party_id: invoice.customer.id, memo: invoice.invoice_number ?? undefined },
    ],
  });
  if (!posted.ok) return { ok: false, error: `Ledger posting failed: ${posted.error}` };

  const staff = await getCurrentStaff();
  if (isDemo) {
    demo.acc.payments.push({
      id: newId(), invoice_id: invoiceId, amount: input.amount, paid_on: input.paid_on,
      method: input.method as never, reference: input.reference || null, note: null,
      journal_entry_id: posted.entryId, recorded_by: staff?.id ?? null, created_at: new Date().toISOString(),
    });
  } else {
    const { error } = await (await createClient()).from("invoice_payments").insert({
      invoice_id: invoiceId, amount: input.amount, paid_on: input.paid_on,
      method: input.method as never, reference: input.reference || null,
      journal_entry_id: posted.entryId, recorded_by: staff?.id ?? null,
    });
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

/** Re-renders the PDF from the frozen snapshot. Used by the download route. */
export async function invoicePdfBytes(invoiceId: string): Promise<Buffer | null> {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) return null;
  const { renderInvoicePdf } = await import("@/lib/invoice-pdf");
  return renderInvoicePdf(invoice as InvoiceView);
}

export type { InvoiceItem };
