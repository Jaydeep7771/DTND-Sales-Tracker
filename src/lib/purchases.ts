"use server";

/**
 * Suppliers, purchase bills and supplier payments.
 *
 * This is the half of the ledger that was missing. Without it the books
 * recorded output tax with no input tax to set against it, which
 * overstates a sales tax return, and the business could not see what it
 * owed.
 *
 * Posting a bill does three things at once, because they are one event:
 * it brings the goods into stock, it recalculates the moving average
 * cost, and it posts Dr Inventory / Dr Input Tax / Cr Accounts Payable.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { demo, newId } from "@/lib/demo-store";
import { isDemo, getCompanySettings, getCurrentStaff, getSupplier, getBill } from "@/lib/data";
import { can } from "@/lib/permissions";
import { addDays, businessDate, round2, type PaymentMethod } from "@/lib/accounting";
import { fiscalYearLabel, nextDocumentNumber, postEntry, reverseEntry } from "@/lib/ledger";
import { movingAverage, recordMovement } from "@/lib/inventory";
import { money } from "@/lib/format";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function deny(capability: Parameters<typeof can>[1]): Promise<Result | null> {
  const staff = await getCurrentStaff();
  if (can(staff?.role, capability)) return null;
  return { ok: false, error: "Your role does not permit this action." };
}

function revalidateAll() {
  for (const p of ["/admin", "/admin/suppliers", "/admin/bills", "/admin/accounts", "/admin/inventory", "/admin/reports", "/admin/payables"]) {
    revalidatePath(p);
  }
}

// ---------------------------------------------------------------- suppliers
export interface SupplierInput {
  name: string; contact_name: string; email: string; phone: string;
  address: string; ntn: string; strn: string; payment_terms_days: number; notes: string;
}

export async function saveSupplier(id: string | null, input: SupplierInput): Promise<Result<{ id: string }>> {
  const denied = await deny("invoice:write"); if (denied) return denied;
  if (!input.name.trim()) return { ok: false, error: "A supplier needs a name." };
  if (!Number.isInteger(input.payment_terms_days) || input.payment_terms_days < 0) {
    return { ok: false, error: "Payment terms must be a whole number of days." };
  }

  const row = {
    name: input.name.trim(),
    contact_name: input.contact_name.trim() || null,
    email: input.email.trim() || null,
    phone: input.phone.trim() || null,
    address: input.address.trim() || null,
    ntn: input.ntn.trim() || null,
    strn: input.strn.trim() || null,
    payment_terms_days: input.payment_terms_days,
    notes: input.notes.trim() || null,
  };

  if (isDemo) {
    if (id) {
      const s = demo.acc.suppliers.find((s) => s.id === id);
      if (!s) return { ok: false, error: "Supplier not found." };
      Object.assign(s, row, { updated_at: new Date().toISOString() });
      revalidateAll();
      return { ok: true, data: { id } };
    }
    const newSupplier = {
      ...row, id: newId(), is_active: true,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    demo.acc.suppliers.unshift(newSupplier);
    revalidateAll();
    return { ok: true, data: { id: newSupplier.id } };
  }

  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("suppliers").update(row).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidateAll();
    return { ok: true, data: { id } };
  }
  const { data, error } = await supabase.from("suppliers").insert(row).select("id").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not save the supplier." };
  revalidateAll();
  return { ok: true, data: { id: data.id } };
}

// ---------------------------------------------------------------- bills
export interface BillLineInput {
  product_id: string | null;
  description: string;
  quantity: number;
  unit_cost: number;
}

export interface BillInput {
  supplier_id: string;
  supplier_ref: string;
  bill_date: string;
  terms_days: number;
  tax_rate: number;
  freight: number;
  notes: string;
  lines: BillLineInput[];
}

/**
 * Enters and posts a purchase bill in one step.
 *
 * There is no draft stage, unlike a sales invoice. A sales invoice is a
 * document this business creates and may still be deciding about; a
 * purchase bill is a document that has already arrived, and holding it as
 * a draft just means the payable is missing from the books.
 */
export async function postBill(input: BillInput): Promise<Result<{ id: string; number: string; total: number }>> {
  const denied = await deny("invoice:write"); if (denied) return denied;

  if (!input.supplier_ref.trim()) {
    return { ok: false, error: "Enter the supplier's own invoice number. It is what the tax authority matches on." };
  }
  if (input.bill_date > businessDate()) return { ok: false, error: "A bill cannot be dated in the future." };

  const lines = input.lines
    .map((l) => ({ ...l, quantity: Math.floor(l.quantity), unit_cost: round2(l.unit_cost) }))
    .filter((l) => l.quantity > 0 && l.description.trim());
  if (lines.length === 0) return { ok: false, error: "Add at least one line with a quantity." };
  if (lines.some((l) => l.unit_cost < 0)) return { ok: false, error: "A unit cost cannot be negative." };

  const supplier = await getSupplier(input.supplier_id);
  if (!supplier) return { ok: false, error: "Supplier not found." };

  // The same supplier invoice entered twice is the most common error in
  // purchase entry, and double-counts both the payable and the input tax.
  const duplicate = await billWithRef(input.supplier_id, input.supplier_ref.trim());
  if (duplicate) {
    return { ok: false, error: `${supplier.name} invoice ${input.supplier_ref.trim()} is already entered as ${duplicate.bill_number}.` };
  }

  const goods = round2(lines.reduce((a, l) => a + l.quantity * l.unit_cost, 0));
  const freight = round2(Math.max(0, input.freight));
  const taxable = round2(goods + freight);
  const tax = round2(taxable * input.tax_rate);
  const total = round2(taxable + tax);

  const settings = await getCompanySettings();
  const fy = fiscalYearLabel(new Date(input.bill_date), settings.fiscal_year_start_month);
  const short = fy.slice(2, 4) + fy.slice(-2);
  const seq = await nextDocumentNumber(`BILL-${fy}`);
  const number = `BILL-${short}-${String(seq).padStart(5, "0")}`;
  const due = addDays(input.bill_date, input.terms_days);

  // Freight on a purchase is part of the cost of getting goods to the
  // warehouse, so it is capitalised into inventory rather than expensed.
  const posted = await postEntry({
    entry_date: input.bill_date,
    narration: `Bill ${number} from ${supplier.name} · ${input.supplier_ref.trim()}`,
    source_type: "bill",
    lines: [
      { system_key: "inventory", debit: taxable, memo: number },
      ...(tax > 0 ? [{ system_key: "input_tax" as const, debit: tax }] : []),
      { system_key: "accounts_payable", credit: total, party_id: null, memo: `${supplier.name} ${input.supplier_ref.trim()}` },
    ],
  });
  if (!posted.ok) return { ok: false, error: `Ledger posting failed: ${posted.error}` };

  const staff = await getCurrentStaff();
  const billId = newId();
  const header = {
    supplier_id: input.supplier_id, supplier_ref: input.supplier_ref.trim(),
    bill_number: number, status: "posted" as const,
    bill_date: input.bill_date, due_date: due, terms_days: input.terms_days,
    tax_rate: input.tax_rate, subtotal: goods, freight, tax_amount: tax, total,
    notes: input.notes.trim() || null, journal_entry_id: posted.entryId,
    posted_by: staff?.id ?? null, posted_at: new Date().toISOString(),
  };

  if (isDemo) {
    demo.acc.bills.unshift({
      ...header, id: billId, voided_at: null, void_reason: null,
      created_by: staff?.id ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    lines.forEach((l, i) =>
      demo.acc.billItems.push({
        id: newId(), bill_id: billId, product_id: l.product_id,
        description: l.description.trim(), quantity: l.quantity, unit_cost: l.unit_cost,
        line_total: round2(l.quantity * l.unit_cost), sort_order: i,
      }),
    );
  } else {
    const supabase = await createClient();
    const { data, error } = await supabase.from("bills").insert(header).select("id").single();
    if (error || !data) return { ok: false, error: error?.message ?? "Could not save the bill." };
    const { error: itemsError } = await supabase.from("bill_items").insert(
      lines.map((l, i) => ({
        bill_id: data.id, product_id: l.product_id, description: l.description.trim(),
        quantity: l.quantity, unit_cost: l.unit_cost,
        line_total: round2(l.quantity * l.unit_cost), sort_order: i,
      })),
    );
    if (itemsError) return { ok: false, error: itemsError.message };
  }

  // Receiving the goods: stock in, and the moving average recalculated.
  // Freight is spread across the lines by value, because it is part of
  // what each unit cost to get here.
  const freightRate = goods > 0 ? freight / goods : 0;
  for (const l of lines) {
    if (!l.product_id) continue;      // a service line has no stock effect
    const landed = round2(l.unit_cost * (1 + freightRate));
    const updated = await receiveIntoStock(l.product_id, l.quantity, landed, posted.entryId, input.bill_date);
    if (!updated.ok) return updated;
  }

  revalidateAll();
  return { ok: true, data: { id: billId, number, total } };
}

/** Brings goods in and rolls the moving average forward. */
async function receiveIntoStock(
  productId: string, quantity: number, unitCost: number, entryId: string, on: string,
): Promise<Result> {
  const product = isDemo
    ? demo.products.find((p) => p.id === productId)
    : (await (await createClient()).from("products").select("*").eq("id", productId).single()).data;
  if (!product) return { ok: false, error: "A product on this bill no longer exists." };

  const nextCost = movingAverage(product.stock_quantity, Number(product.cost_price ?? 0), quantity, unitCost);

  const moved = await recordMovement(
    { product_id: productId, quantity, reason: "purchase", unit_cost: unitCost, moved_on: on, note: "Goods received" },
    entryId,
  );
  if (!moved.ok) return moved;

  if (isDemo) {
    const p = demo.products.find((p) => p.id === productId);
    if (p) p.cost_price = nextCost;
  } else {
    const { error } = await (await createClient()).from("products").update({ cost_price: nextCost }).eq("id", productId);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

async function billWithRef(supplierId: string, ref: string) {
  if (isDemo) {
    return demo.acc.bills.find((b) => b.supplier_id === supplierId && b.supplier_ref === ref && b.status !== "void") ?? null;
  }
  const { data } = await (await createClient())
    .from("bills").select("bill_number")
    .eq("supplier_id", supplierId).eq("supplier_ref", ref).neq("status", "void").maybeSingle();
  return data;
}

// ---------------------------------------------------------------- payments
export interface SupplierPaymentInput {
  billId: string;
  amount: number;
  paid_on: string;
  method: PaymentMethod;
  reference: string;
  note: string;
}

const REFERENCE_REQUIRED: PaymentMethod[] = ["bank_transfer", "cheque", "online"];

export async function paySupplier(input: SupplierPaymentInput): Promise<Result<{ entryNo: string }>> {
  const denied = await deny("payment:write"); if (denied) return denied;

  const amount = round2(input.amount);
  if (!(amount > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  if (input.paid_on > businessDate()) return { ok: false, error: "A payment cannot be dated in the future." };
  if (REFERENCE_REQUIRED.includes(input.method) && !input.reference.trim()) {
    return { ok: false, error: "A reference is required so the payment can be reconciled against the bank." };
  }

  const bill = await getBill(input.billId);
  if (!bill) return { ok: false, error: "Bill not found." };
  if (bill.status !== "posted") return { ok: false, error: "Only a posted bill can be paid." };
  if (amount > bill.balance + 0.005) {
    return { ok: false, error: `${bill.bill_number} only has ${money(bill.balance)} outstanding.` };
  }

  const posted = await postEntry({
    entry_date: input.paid_on,
    narration: `Payment to ${bill.supplier_name}${input.reference.trim() ? ` · ${input.reference.trim()}` : ""}`,
    source_type: "payment",
    lines: [
      { system_key: "accounts_payable", debit: amount, memo: bill.bill_number ?? undefined },
      { system_key: input.method === "cash" ? "cash" : "bank", credit: amount, memo: input.reference.trim() || undefined },
    ],
  });
  if (!posted.ok) return { ok: false, error: `Ledger posting failed: ${posted.error}` };

  const staff = await getCurrentStaff();
  const row = {
    bill_id: input.billId, amount, paid_on: input.paid_on, method: input.method,
    reference: input.reference.trim() || null, note: input.note.trim() || null,
    journal_entry_id: posted.entryId, recorded_by: staff?.id ?? null,
  };

  if (isDemo) {
    demo.acc.billPayments.push({
      ...row, id: newId(), reversed_at: null, reversal_reason: null, reversed_by: null,
      created_at: new Date().toISOString(),
    });
  } else {
    const { error } = await (await createClient()).from("bill_payments").insert(row);
    if (error) return { ok: false, error: error.message };
  }

  revalidateAll();
  return { ok: true, data: { entryNo: posted.entryNo } };
}

/**
 * Voids a posted bill: reverses the ledger entry and takes the goods back
 * out of stock. Refused once any payment exists, because unwinding a
 * payment as well would hide that money actually moved.
 */
export async function voidBill(billId: string, reason: string): Promise<Result> {
  const denied = await deny("invoice:write"); if (denied) return denied;
  if (!reason.trim()) return { ok: false, error: "Give a reason so the ledger explains itself." };

  const bill = await getBill(billId);
  if (!bill) return { ok: false, error: "Bill not found." };
  if (bill.status !== "posted") return { ok: false, error: "Only a posted bill can be voided." };
  if (bill.paid > 0) return { ok: false, error: "This bill has payments against it. Reverse the payment first." };

  if (bill.journal_entry_id) {
    const reversed = await reverseEntry(bill.journal_entry_id, `Void of ${bill.bill_number}: ${reason.trim()}`);
    if (!reversed.ok) return { ok: false, error: `Could not reverse the ledger entry: ${reversed.error}` };
  }

  // The goods go back out. Cost is left where it is: the moving average
  // has already absorbed this receipt and unwinding it exactly would
  // require the full history, so the next stocktake corrects any drift.
  for (const l of bill.items) {
    if (!l.product_id) continue;
    const res = await recordMovement({
      product_id: l.product_id, quantity: -l.quantity, reason: "adjustment",
      unit_cost: l.unit_cost, note: `Voided bill ${bill.bill_number}`,
    });
    if (!res.ok) return { ok: false, error: res.error };
  }

  const patch = { status: "void" as const, voided_at: new Date().toISOString(), void_reason: reason.trim() };
  if (isDemo) {
    Object.assign(demo.acc.bills.find((b) => b.id === billId)!, patch);
  } else {
    const { error } = await (await createClient()).from("bills").update(patch).eq("id", billId);
    if (error) return { ok: false, error: error.message };
  }

  revalidateAll();
  return { ok: true };
}
