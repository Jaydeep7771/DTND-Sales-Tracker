/**
 * Shared accounting vocabulary. Kept free of server imports so both the
 * posting engine and client components can use it.
 */

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type InvoiceType = "proforma" | "tax_invoice" | "credit_note";
export type InvoiceStatus = "draft" | "issued" | "void";
export type PaymentMethod = "bank_transfer" | "cheque" | "cash" | "online" | "adjustment";

/** Stable handles the posting engine uses to find accounts. */
export type SystemKey =
  | "cash" | "bank" | "accounts_receivable" | "inventory" | "input_tax" | "supplier_advances"
  | "accounts_payable" | "output_tax" | "customer_advances" | "withholding_payable"
  | "owner_capital" | "retained_earnings"
  | "sales_revenue" | "sales_returns" | "other_income"
  | "cogs" | "freight_expense" | "salaries" | "rent" | "utilities" | "other_expenses";

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parent_id: string | null;
  system_key: SystemKey | null;
  is_group: boolean;
  is_active: boolean;
}

export interface AccountBalance extends Account {
  total_debit: number;
  total_credit: number;
  balance: number;
}

/** One side of a journal entry. Exactly one of debit or credit is non-zero. */
export interface JournalLineInput {
  system_key?: SystemKey;
  account_id?: string;
  debit?: number;
  credit?: number;
  party_id?: string | null;
  memo?: string | null;
}

export interface JournalEntryInput {
  entry_date: string;          // ISO date
  narration: string;
  source_type?: "invoice" | "payment" | "credit_note" | "bill" | "manual";
  source_id?: string;
  lines: JournalLineInput[];
}

export interface JournalLine {
  id: string;
  entry_id: string;
  account_id: string;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  party_id: string | null;
  memo: string | null;
}

export interface JournalEntry {
  id: string;
  entry_no: string;
  entry_date: string;
  narration: string;
  source_type: string | null;
  source_id: string | null;
  reversal_of: string | null;
  posted_at: string;
  lines: JournalLine[];
}

/** Debit-positive account types. Used for balance signing and report layout. */
export const DEBIT_NORMAL: AccountType[] = ["asset", "expense"];

export function isDebitNormal(type: AccountType): boolean {
  return DEBIT_NORMAL.includes(type);
}

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
};

/** Rounds to 2dp using integer paisa maths, avoiding float drift. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Throws unless debits equal credits. The database enforces this too. */
export function assertBalanced(lines: JournalLineInput[]): void {
  const debit = round2(lines.reduce((a, l) => a + (l.debit ?? 0), 0));
  const credit = round2(lines.reduce((a, l) => a + (l.credit ?? 0), 0));
  if (debit !== credit) {
    throw new Error(`Journal entry out of balance: debits ${debit}, credits ${credit}`);
  }
  if (debit === 0) throw new Error("Journal entry has no value");
}

/**
 * Posting rules, documented in one place so an accountant can check them
 * without reading application code.
 */
export const POSTING_RULES = [
  { event: "Sales invoice issued", debit: ["Accounts Receivable"], credit: ["Sales Revenue", "Output Sales Tax"] },
  { event: "Payment received", debit: ["Bank or Cash"], credit: ["Accounts Receivable"] },
  { event: "Credit note issued", debit: ["Sales Returns", "Output Sales Tax"], credit: ["Accounts Receivable"] },
  { event: "Goods dispatched", debit: ["Cost of Goods Sold"], credit: ["Inventory"] },
  { event: "Purchase bill recorded", debit: ["Inventory", "Input Sales Tax"], credit: ["Accounts Payable"] },
  { event: "Payment to supplier", debit: ["Accounts Payable"], credit: ["Bank or Cash"] },
] as const;
