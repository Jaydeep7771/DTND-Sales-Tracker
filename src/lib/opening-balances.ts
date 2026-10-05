"use server";

/**
 * Opening balances: what the business was worth the day before it started
 * using this system.
 *
 * Without this, go-live starts every balance at zero. The bank reads as
 * receipts-less-payments-since-Tuesday, customers who owe you money owe
 * nothing, and the balance sheet describes a company with no history.
 *
 * Two decisions shape the whole thing:
 *
 * 1. Customer and supplier balances are entered as INDIVIDUAL documents,
 *    not as one lump against receivables. A lump is faster to type and
 *    breaks aging, statements and receipt allocation on day one, because
 *    there is nothing to age, list or allocate against.
 *
 * 2. The contra side is Opening Balance Equity, never revenue or expense.
 *    Those sales were made before go-live; recognising them now would
 *    inflate this year's profit with last year's trading.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { demo, newId } from "@/lib/demo-store";
import {
  isDemo, getAccounts, getCompanySettings, getCurrentStaff,
  getCustomers, getDayBook, getSuppliers,
} from "@/lib/data";
import { can } from "@/lib/permissions";
import { businessDate, round2 } from "@/lib/accounting";
import { postEntry } from "@/lib/ledger";
import { createPeriod, setPeriodClosed } from "@/lib/settings-actions";
import { money } from "@/lib/format";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export interface OpeningAccountRow {
  account_id: string;
  /** Positive is a debit for an asset, a credit for a liability or equity. */
  amount: number;
}

export interface OpeningDocumentRow {
  party_id: string;
  reference: string;
  document_date: string;
  due_date: string;
  amount: number;
}

export interface OpeningBalancesInput {
  as_at: string;
  accounts: OpeningAccountRow[];
  customers: OpeningDocumentRow[];
  suppliers: OpeningDocumentRow[];
  /** Close everything up to as_at once posted, so nothing can slip behind it. */
  lock: boolean;
}

/** Has this already been done? Committing twice would double every balance. */
export async function openingBalancesPosted(): Promise<{ posted: boolean; on: string | null }> {
  const entries = await getDayBook({ source: "opening", limit: 1 });
  return { posted: entries.length > 0, on: entries[0]?.entry_date ?? null };
}

/**
 * Totals the whole submission the way the posting will, so the screen can
 * show what is still out of balance before anything is written.
 */
export async function previewOpeningBalances(input: OpeningBalancesInput): Promise<{
  debits: number; credits: number; difference: number; toEquity: number;
}> {
  const accounts = await getAccounts();
  const byId = new Map(accounts.map((a) => [a.id, a]));

  let debits = 0;
  let credits = 0;

  for (const row of input.accounts) {
    const account = byId.get(row.account_id);
    const amount = round2(row.amount);
    if (!account || amount === 0) continue;
    if (account.type === "asset" || account.type === "expense") debits += amount;
    else credits += amount;
  }
  debits += round2(input.customers.reduce((a, c) => a + round2(c.amount), 0));
  credits += round2(input.suppliers.reduce((a, s) => a + round2(s.amount), 0));

  const difference = round2(debits - credits);
  return { debits: round2(debits), credits: round2(credits), difference, toEquity: difference };
}

export async function commitOpeningBalances(input: OpeningBalancesInput): Promise<Result<{ entries: number; equity: number; warning?: string }>> {
  const staff = await getCurrentStaff();
  if (!can(staff?.role, "settings:finance")) {
    return { ok: false, error: "Only finance and admin can set opening balances." };
  }

  const already = await openingBalancesPosted();
  if (already.posted) {
    return {
      ok: false,
      error: `Opening balances were already posted as at ${already.on}. Committing again would double every balance. Reverse the opening entries from the day book first.`,
    };
  }

  if (!input.as_at) return { ok: false, error: "Pick the date these balances are as at." };
  if (input.as_at > businessDate()) return { ok: false, error: "Opening balances cannot be dated in the future." };

  const accounts = await getAccounts();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const equity = accounts.find((a) => a.system_key === "opening_balance");
  const receivable = accounts.find((a) => a.system_key === "accounts_receivable");
  const payable = accounts.find((a) => a.system_key === "accounts_payable");
  if (!equity || !receivable || !payable) {
    return { ok: false, error: "The chart of accounts is missing Opening Balance Equity, Receivables or Payables. Run the SQL migrations first." };
  }

  // Validate before writing anything, so a bad row on the end cannot leave
  // half the balances posted.
  const accountRows = input.accounts
    .map((r) => ({ ...r, amount: round2(r.amount) }))
    .filter((r) => r.amount !== 0);
  for (const row of accountRows) {
    const account = byId.get(row.account_id);
    if (!account) return { ok: false, error: "One of the account rows refers to an account that no longer exists." };
    if (account.is_group) return { ok: false, error: `${account.name} is a heading and holds no postings.` };
    if (account.system_key === "opening_balance") {
      return { ok: false, error: "Opening Balance Equity is the balancing figure. It is worked out, not entered." };
    }
    if (account.system_key === "accounts_receivable" || account.system_key === "accounts_payable") {
      return {
        ok: false,
        error: `Enter ${account.name} as individual ${account.system_key === "accounts_receivable" ? "customer invoices" : "supplier bills"} below, not as a single figure. Otherwise aging and statements have nothing to work with.`,
      };
    }
  }

  const customers = await getCustomers();
  const suppliers = await getSuppliers();
  const customerRows = input.customers.map((r) => ({ ...r, amount: round2(r.amount) })).filter((r) => r.amount > 0);
  const supplierRows = input.suppliers.map((r) => ({ ...r, amount: round2(r.amount) })).filter((r) => r.amount > 0);

  for (const row of customerRows) {
    if (!customers.some((c) => c.id === row.party_id)) return { ok: false, error: "One of the customer rows has no customer." };
    if (!row.reference.trim()) return { ok: false, error: "Every opening invoice needs the original invoice number, so the customer recognises it." };
  }
  for (const row of supplierRows) {
    if (!suppliers.some((s) => s.id === row.party_id)) return { ok: false, error: "One of the supplier rows has no supplier." };
    if (!row.reference.trim()) return { ok: false, error: "Every opening bill needs the supplier's invoice number." };
  }

  const duplicateRef = findDuplicate(customerRows.map((r) => r.reference.trim()));
  if (duplicateRef) return { ok: false, error: `Invoice number ${duplicateRef} appears twice.` };

  const preview = await previewOpeningBalances({ ...input, accounts: accountRows, customers: customerRows, suppliers: supplierRows });
  if (preview.debits === 0 && preview.credits === 0) {
    return { ok: false, error: "Nothing to post. Enter at least one balance." };
  }

  const settings = await getCompanySettings();
  const iso = input.as_at;
  let entries = 0;

  // ---- 1. Account balances, as one entry, against Opening Balance Equity
  if (accountRows.length > 0) {
    const lines = accountRows.map((row) => {
      const account = byId.get(row.account_id)!;
      const debitNormal = account.type === "asset" || account.type === "expense";
      return debitNormal
        ? { account_id: account.id, debit: row.amount, memo: "Opening balance" }
        : { account_id: account.id, credit: row.amount, memo: "Opening balance" };
    });
    const net = round2(
      lines.reduce((a, l) => a + ("debit" in l ? (l.debit ?? 0) : 0) - ("credit" in l ? (l.credit ?? 0) : 0), 0),
    );
    if (net !== 0) {
      lines.push(net > 0
        ? { account_id: equity.id, credit: net, memo: "Opening balance" }
        : { account_id: equity.id, debit: Math.abs(net), memo: "Opening balance" });
    }
    const posted = await postEntry({
      entry_date: iso,
      narration: `Opening balances as at ${iso}`,
      source_type: "opening",
      lines,
    });
    if (!posted.ok) return { ok: false, error: `Could not post opening balances: ${posted.error}` };
    entries += 1;
  }

  // ---- 2. Customer invoices, one document each, one entry for the set
  if (customerRows.length > 0) {
    const total = round2(customerRows.reduce((a, r) => a + r.amount, 0));
    const posted = await postEntry({
      entry_date: iso,
      narration: `Opening customer balances as at ${iso}`,
      source_type: "opening",
      lines: [
        ...customerRows.map((r) => ({
          account_id: receivable.id, debit: r.amount, party_id: r.party_id, memo: r.reference.trim(),
        })),
        { account_id: equity.id, credit: total, memo: "Opening receivables" },
      ],
    });
    if (!posted.ok) return { ok: false, error: `Could not post customer balances: ${posted.error}` };
    entries += 1;

    const created = await createOpeningInvoices(customerRows, posted.entryId, settings.currency_code, staff?.id ?? null);
    if (!created.ok) return created;
  }

  // ---- 3. Supplier bills, the mirror image
  if (supplierRows.length > 0) {
    const total = round2(supplierRows.reduce((a, r) => a + r.amount, 0));
    const posted = await postEntry({
      entry_date: iso,
      narration: `Opening supplier balances as at ${iso}`,
      source_type: "opening",
      lines: [
        { account_id: equity.id, debit: total, memo: "Opening payables" },
        ...supplierRows.map((r) => ({
          account_id: payable.id, credit: r.amount, memo: `${supplierName(suppliers, r.party_id)} ${r.reference.trim()}`,
        })),
      ],
    });
    if (!posted.ok) return { ok: false, error: `Could not post supplier balances: ${posted.error}` };
    entries += 1;

    const created = await createOpeningBills(supplierRows, posted.entryId, staff?.id ?? null);
    if (!created.ok) return created;
  }

  // ---- 4. Lock everything behind the go-live date
  //
  // Reported rather than silently skipped. A lock that quietly fails is
  // worse than no lock, because the screen would say the books were
  // protected while backdated entries sailed through.
  let warning: string | undefined;
  if (input.lock) {
    warning = await lockBeforeGoLive(iso);
  }

  revalidatePath("/", "layout");
  return { ok: true, data: { entries, equity: preview.toEquity, warning } };
}

/**
 * Closes everything up to the go-live date, so nothing can be posted
 * behind the opening position.
 *
 * Existing periods are closed in place rather than ignored, and if one
 * overlaps the span being created the caller is told which, because the
 * alternative is a lock that appears to work and does not.
 */
async function lockBeforeGoLive(asAt: string): Promise<string | undefined> {
  const { getPeriods } = await import("@/lib/data");

  // Anything already defined that ends before go-live belongs to history.
  const existing = await getPeriods();
  for (const p of existing) {
    if (p.ends_on <= asAt && !p.closed_at) await setPeriodClosed(p.id, true);
  }

  const covers = existing.some((p) => p.starts_on <= "2000-01-02" && p.ends_on >= asAt);
  if (covers) return undefined;

  const name = `Before go-live (to ${asAt})`;
  const made = await createPeriod({ name, starts_on: "2000-01-01", ends_on: asAt });
  if (made.ok) {
    const period = (await getPeriods()).find((p) => p.name === name);
    if (period) await setPeriodClosed(period.id, true);
    return undefined;
  }

  const clash = existing.find((p) => p.starts_on <= asAt && p.ends_on >= "2000-01-01");
  return `Opening balances posted, but the go-live lock could not be applied: it overlaps ${clash ? `the period "${clash.name}"` : "an existing period"}. Close the periods before ${asAt} by hand on the Period close screen, otherwise entries can still be backdated behind your opening position.`;
}

/**
 * One invoice per outstanding amount, so the aged schedule, statements
 * and receipt allocation all work from the first day. They carry no tax:
 * the tax on those sales was reported before go-live and must not appear
 * in this year's return.
 */
async function createOpeningInvoices(
  rows: OpeningDocumentRow[], entryId: string, currency: string, by: string | null,
): Promise<Result> {
  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    invoice_number: r.reference.trim(),
    type: "tax_invoice" as const,
    status: "issued" as const,
    order_id: null,
    customer_id: r.party_id,
    seller: {}, buyer: {},
    currency,
    tax_rate: 0,
    subtotal: r.amount, discount: 0, freight: 0, tax_amount: 0, total: r.amount,
    issue_date: r.document_date,
    due_date: r.due_date || r.document_date,
    terms_days: 0,
    notes: "Opening balance brought forward. Raised before this system was in use.",
    journal_entry_id: entryId,
    issued_by: by,
    issued_at: now,
  }));

  if (isDemo) {
    for (const p of payload) {
      demo.acc.invoices.unshift({
        ...p, id: newId(), pdf_path: null, pdf_sha256: null, credit_note_for: null,
        converted_from: null, valid_until: null, period_start: null, period_end: null, sent_at: null, sent_to: null,
        voided_at: null, void_reason: null, created_by: by, created_at: now, updated_at: now,
      });
    }
    return { ok: true };
  }

  const { error } = await (await createClient()).from("invoices").insert(payload);
  if (error) {
    return {
      ok: false,
      error: error.message.includes("duplicate")
        ? "One of those invoice numbers already exists in the system."
        : error.message,
    };
  }
  return { ok: true };
}

/** The same for what the business owes. */
async function createOpeningBills(
  rows: OpeningDocumentRow[], entryId: string, by: string | null,
): Promise<Result> {
  const now = new Date().toISOString();
  const payload = rows.map((r, i) => ({
    supplier_id: r.party_id,
    supplier_ref: r.reference.trim(),
    bill_number: `OB-${String(i + 1).padStart(5, "0")}`,
    status: "posted" as const,
    bill_date: r.document_date,
    due_date: r.due_date || r.document_date,
    terms_days: 0,
    tax_rate: 0,
    subtotal: r.amount, freight: 0, tax_amount: 0, total: r.amount,
    notes: "Opening balance brought forward.",
    journal_entry_id: entryId,
    posted_by: by,
    posted_at: now,
  }));

  if (isDemo) {
    for (const p of payload) {
      demo.acc.bills.unshift({
        ...p, id: newId(), voided_at: null, void_reason: null,
        created_by: by, created_at: now, updated_at: now,
      });
    }
    return { ok: true };
  }

  const { error } = await (await createClient()).from("bills").insert(payload);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

function supplierName(suppliers: { id: string; name: string }[], id: string): string {
  return suppliers.find((s) => s.id === id)?.name ?? "Supplier";
}

function findDuplicate(values: string[]): string | null {
  const seen = new Set<string>();
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) return v;
    seen.add(key);
  }
  return null;
}

/** Used by the screen to explain what the balancing figure will be. */
export async function describeEquityPosting(difference: number): Promise<string> {
  if (Math.abs(difference) < 0.005) return "Nothing goes to Opening Balance Equity: the figures balance on their own.";
  return difference > 0
    ? `${money(difference)} will be credited to Opening Balance Equity, which is the net worth you are bringing in.`
    : `${money(Math.abs(difference))} will be debited to Opening Balance Equity, meaning the business is starting with negative net worth.`;
}
