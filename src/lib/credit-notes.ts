"use server";

/**
 * Credit notes.
 *
 * An issued invoice is immutable, so an error or a return after issue is
 * corrected by a credit note rather than by editing or voiding. Voiding
 * was already refused once a payment existed, and told the user to raise
 * a credit note that did not exist — this closes that dead end.
 *
 * The note is a document in its own right, numbered in its own series,
 * with its own PDF and its own ledger entry. It is applied in full
 * against the invoice it corrects, so the customer's balance falls the
 * moment it is issued.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { demo, newId } from "@/lib/demo-store";
import { isDemo, getCompanySettings, getCurrentStaff, getInvoice } from "@/lib/data";
import { can } from "@/lib/permissions";
import { businessDate, computeInvoiceTotals, round2 } from "@/lib/accounting";
import { fiscalYearLabel, nextDocumentNumber, postEntry } from "@/lib/ledger";
import { recordMovement } from "@/lib/inventory";
import { money } from "@/lib/format";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export interface CreditNoteInput {
  invoiceId: string;
  /** invoice_item id -> quantity being credited. Zero or missing credits nothing. */
  quantities: Record<string, number>;
  reason: string;
  /** Whether the goods came back and should go on the shelf again. */
  restock: boolean;
}

export async function createCreditNote(input: CreditNoteInput): Promise<Result<{ id: string; number: string; total: number }>> {
  const staff = await getCurrentStaff();
  if (!can(staff?.role, "invoice:write")) return { ok: false, error: "Your role does not permit this action." };
  if (!input.reason.trim()) return { ok: false, error: "Give a reason. It prints on the credit note and explains the ledger entry." };

  const invoice = await getInvoice(input.invoiceId);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (invoice.status !== "issued") return { ok: false, error: "Only an issued invoice can be credited." };
  if (invoice.type === "credit_note") return { ok: false, error: "A credit note cannot itself be credited." };

  // Quantities already credited, so the same line cannot be credited twice.
  const priorCredits = await creditedQuantities(input.invoiceId);

  const lines = invoice.items
    .map((item) => {
      const asked = Math.floor(Number(input.quantities[item.id] ?? 0));
      const alreadyCredited = priorCredits.get(item.id) ?? 0;
      return { item, quantity: asked, remaining: item.quantity - alreadyCredited };
    })
    .filter((l) => l.quantity > 0);

  if (lines.length === 0) return { ok: false, error: "Choose at least one line and a quantity to credit." };

  for (const l of lines) {
    if (l.quantity > l.remaining) {
      return {
        ok: false,
        error: l.remaining <= 0
          ? `${l.item.name} has already been credited in full.`
          : `${l.item.name} has only ${l.remaining} left to credit.`,
      };
    }
  }

  const settings = await getCompanySettings();
  // The credit note carries the invoice's tax rate, not today's. Crediting
  // a sale taxed at 17% at today's 18% would hand back tax never collected.
  const totals = computeInvoiceTotals(
    lines.map((l) => ({ quantity: l.quantity, unit_price: l.item.unit_price })),
    0, 0, invoice.tax_rate,
  );
  if (totals.total <= 0) return { ok: false, error: "The credit works out to nothing." };

  const iso = businessDate();
  if (iso < (invoice.issue_date ?? iso)) {
    return { ok: false, error: "A credit note cannot predate the invoice it corrects." };
  }

  // Its own gapless series, scoped to the fiscal year like invoices.
  const fy = fiscalYearLabel(new Date(iso), settings.fiscal_year_start_month);
  const short = fy.slice(2, 4) + fy.slice(-2);
  const seq = await nextDocumentNumber(`${settings.credit_note_prefix}-${fy}`);
  const number = `${settings.credit_note_prefix}-${short}-${String(seq).padStart(5, "0")}`;

  // Post before marking issued, same ordering as an invoice: a posting
  // failure must not leave a numbered document with no entry behind it.
  const posted = await postEntry({
    entry_date: iso,
    narration: `Credit note ${number} against ${invoice.invoice_number} · ${input.reason.trim()}`,
    source_type: "credit_note",
    source_id: input.invoiceId,
    lines: [
      { system_key: "sales_returns", debit: totals.taxable, memo: number },
      ...(totals.tax_amount > 0 ? [{ system_key: "output_tax" as const, debit: totals.tax_amount }] : []),
      { system_key: "accounts_receivable", credit: totals.total, party_id: invoice.customer.id, memo: number },
    ],
  });
  if (!posted.ok) return { ok: false, error: `Ledger posting failed: ${posted.error}` };

  // Goods physically returned go back on the shelf and their cost comes
  // out of cost of sales, otherwise margin stays overstated.
  if (input.restock) {
    const restocked = await restockLines(lines, input.invoiceId, iso);
    if (!restocked.ok) return restocked;
  }

  const noteId = newId();
  const seller = invoice.seller;
  const buyer = invoice.buyer;

  if (isDemo) {
    demo.acc.invoices.unshift({
      id: noteId, invoice_number: number, type: "credit_note", status: "issued",
      order_id: invoice.order_id, customer_id: invoice.customer.id,
      seller, buyer, currency: invoice.currency, tax_rate: invoice.tax_rate,
      subtotal: totals.subtotal, discount: 0, freight: 0,
      tax_amount: totals.tax_amount, total: totals.total,
      issue_date: iso, due_date: iso, terms_days: 0, notes: input.reason.trim(),
      pdf_path: null, pdf_sha256: null, journal_entry_id: posted.entryId,
      credit_note_for: input.invoiceId, converted_from: null, valid_until: null, period_start: null, period_end: null, sent_at: null, sent_to: null,
      issued_by: staff?.id ?? null, issued_at: new Date().toISOString(),
      voided_at: null, void_reason: null, created_by: staff?.id ?? null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    lines.forEach((l, i) =>
      demo.acc.invoiceItems.push({
        id: newId(), invoice_id: noteId, order_item_id: l.item.order_item_id,
        sku: l.item.sku, name: l.item.name, unit_of_measure: l.item.unit_of_measure,
        quantity: l.quantity, unit_price: l.item.unit_price,
        line_total: round2(l.quantity * l.item.unit_price), sort_order: i,
      }),
    );
  } else {
    const supabase = await createClient();
    const { data, error } = await supabase.from("invoices").insert({
      invoice_number: number, type: "credit_note", status: "issued",
      order_id: invoice.order_id, customer_id: invoice.customer.id,
      seller, buyer, currency: invoice.currency, tax_rate: invoice.tax_rate,
      subtotal: totals.subtotal, tax_amount: totals.tax_amount, total: totals.total,
      issue_date: iso, due_date: iso, terms_days: 0, notes: input.reason.trim(),
      journal_entry_id: posted.entryId, credit_note_for: input.invoiceId,
      issued_by: staff?.id ?? null, issued_at: new Date().toISOString(),
    }).select("id").single();
    if (error || !data) return { ok: false, error: error?.message ?? "Could not save the credit note." };

    const { error: itemsError } = await supabase.from("invoice_items").insert(
      lines.map((l, i) => ({
        invoice_id: data.id, order_item_id: l.item.order_item_id,
        sku: l.item.sku, name: l.item.name, unit_of_measure: l.item.unit_of_measure,
        quantity: l.quantity, unit_price: l.item.unit_price,
        line_total: round2(l.quantity * l.item.unit_price), sort_order: i,
      })),
    );
    if (itemsError) return { ok: false, error: itemsError.message };
  }

  // Apply it against the invoice so the customer's balance falls now.
  // It rides the allocation table that receipts use, sharing the credit
  // note's journal entry, so a single query still explains any balance.
  const applied = Math.min(totals.total, invoice.balance);
  if (applied > 0) {
    const allocation = {
      invoice_id: input.invoiceId, amount: applied, paid_on: iso,
      method: "adjustment" as const, reference: number,
      note: `Credit note: ${input.reason.trim()}`,
      journal_entry_id: posted.entryId, recorded_by: staff?.id ?? null,
    };
    if (isDemo) {
      demo.acc.payments.push({
        id: newId(), ...allocation,
        reversed_at: null, reversal_reason: null, reversed_by: null,
        created_at: new Date().toISOString(),
      });
    } else {
      const { error } = await (await createClient()).from("invoice_payments").insert(allocation);
      if (error) return { ok: false, error: error.message };
    }
  }

  revalidateAll(input.invoiceId, invoice.customer.id);
  return { ok: true, data: { id: noteId, number, total: totals.total } };
}

/** How much of each invoice line has already been credited. */
async function creditedQuantities(invoiceId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();

  const notes = isDemo
    ? demo.acc.invoices.filter((i) => i.credit_note_for === invoiceId && i.status === "issued")
    : ((await (await createClient()).from("invoices").select("id").eq("credit_note_for", invoiceId).eq("status", "issued")).data ?? []);
  if (notes.length === 0) return out;

  const noteIds = notes.map((n) => n.id);
  const items = isDemo
    ? demo.acc.invoiceItems.filter((i) => noteIds.includes(i.invoice_id))
    : ((await (await createClient()).from("invoice_items").select("*").in("invoice_id", noteIds)).data ?? []);

  // Credit note lines carry the original order_item_id, which is what ties
  // them back to the invoice line they are crediting.
  const original = isDemo
    ? demo.acc.invoiceItems.filter((i) => i.invoice_id === invoiceId)
    : ((await (await createClient()).from("invoice_items").select("*").eq("invoice_id", invoiceId)).data ?? []);

  for (const credited of items) {
    const match = original.find(
      (o) => (credited.order_item_id && o.order_item_id === credited.order_item_id) || o.sku === credited.sku,
    );
    if (match) out.set(match.id, (out.get(match.id) ?? 0) + credited.quantity);
  }
  return out;
}

/** Puts credited goods back on the shelf and takes their cost out of COGS. */
async function restockLines(
  lines: { item: { sku: string; name: string }; quantity: number }[],
  invoiceId: string,
  on: string,
): Promise<Result> {
  const products = isDemo
    ? demo.products
    : ((await (await createClient()).from("products").select("*")).data ?? []);

  const priced = lines
    .map((l) => ({ product: products.find((p) => p.sku === l.item.sku), quantity: l.quantity, name: l.item.name }))
    .filter((l) => l.product);

  const cost = round2(priced.reduce((a, l) => a + l.quantity * Number(l.product!.cost_price ?? 0), 0));

  let entryId: string | null = null;
  if (cost > 0) {
    const posted = await postEntry({
      entry_date: on,
      narration: "Goods returned to stock on credit note",
      source_type: "credit_note",
      source_id: invoiceId,
      lines: [
        { system_key: "inventory", debit: cost },
        { system_key: "cogs", credit: cost },
      ],
    });
    if (!posted.ok) return { ok: false, error: `Could not post the stock return: ${posted.error}` };
    entryId = posted.entryId;
  }

  for (const l of priced) {
    const res = await recordMovement(
      {
        product_id: l.product!.id, quantity: l.quantity, reason: "return_in",
        unit_cost: Number(l.product!.cost_price ?? 0), invoice_id: invoiceId,
        note: "Returned on credit note", moved_on: on,
      },
      entryId,
    );
    if (!res.ok) return { ok: false, error: res.error };
  }
  return { ok: true };
}

function revalidateAll(invoiceId: string, customerId: string) {
  for (const p of [
    "/admin", "/admin/orders", "/admin/accounts", "/admin/receivables",
    "/admin/inventory", `/admin/customers/${customerId}`, "/portal/orders",
  ]) revalidatePath(p);
  revalidatePath(`/admin/invoices/${invoiceId}`);
}

/** Used by the UI to show what is still creditable on each line. */
export async function creditableLines(invoiceId: string): Promise<Record<string, number>> {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) return {};
  const credited = await creditedQuantities(invoiceId);
  const out: Record<string, number> = {};
  for (const item of invoice.items) out[item.id] = item.quantity - (credited.get(item.id) ?? 0);
  return out;
}

/** A plain-language summary for the confirmation step. */
export async function describeCredit(invoiceId: string, quantities: Record<string, number>): Promise<string> {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) return "";
  const lines = invoice.items.filter((i) => (quantities[i.id] ?? 0) > 0);
  const totals = computeInvoiceTotals(
    lines.map((l) => ({ quantity: quantities[l.id], unit_price: l.unit_price })),
    0, 0, invoice.tax_rate,
  );
  return `${lines.length} line${lines.length === 1 ? "" : "s"} · ${money(totals.total)}`;
}
