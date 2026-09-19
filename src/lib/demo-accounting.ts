// Accounting seed for demo mode. Mirrors the chart of accounts in
// supabase/02-accounting.sql so both modes behave identically.
import type { AccountRow, CompanySettings, Invoice, InvoiceItem, InvoicePayment, JournalEntryRow, JournalLineRow } from "@/types/database";

export interface DemoAccounting {
  accounts: AccountRow[];
  entries: JournalEntryRow[];
  lines: JournalLineRow[];
  invoices: Invoice[];
  invoiceItems: InvoiceItem[];
  payments: InvoicePayment[];
  settings: CompanySettings;
  counters: Record<string, number>;
  nextEntryNo: number;
}

// code, name, type, system_key, is_group
const COA: [string, string, AccountRow["type"], string | null, boolean][] = [
  ["1000", "Current Assets", "asset", null, true],
  ["1010", "Cash in Hand", "asset", "cash", false],
  ["1020", "Bank", "asset", "bank", false],
  ["1100", "Accounts Receivable", "asset", "accounts_receivable", false],
  ["1200", "Inventory", "asset", "inventory", false],
  ["1300", "Input Sales Tax", "asset", "input_tax", false],
  ["1400", "Advances to Suppliers", "asset", "supplier_advances", false],
  ["1500", "Fixed Assets", "asset", null, true],

  ["2000", "Current Liabilities", "liability", null, true],
  ["2100", "Accounts Payable", "liability", "accounts_payable", false],
  ["2200", "Output Sales Tax", "liability", "output_tax", false],
  ["2300", "Advances from Customers", "liability", "customer_advances", false],
  ["2400", "Withholding Tax Payable", "liability", "withholding_payable", false],

  ["3000", "Equity", "equity", null, true],
  ["3100", "Owner Capital", "equity", "owner_capital", false],
  ["3200", "Retained Earnings", "equity", "retained_earnings", false],

  ["4000", "Income", "income", null, true],
  ["4100", "Sales Revenue", "income", "sales_revenue", false],
  ["4200", "Sales Returns and Discounts", "income", "sales_returns", false],
  ["4900", "Other Income", "income", "other_income", false],

  ["5000", "Expenses", "expense", null, true],
  ["5100", "Cost of Goods Sold", "expense", "cogs", false],
  ["5200", "Freight and Delivery", "expense", "freight_expense", false],
  ["5300", "Salaries and Wages", "expense", "salaries", false],
  ["5400", "Rent", "expense", "rent", false],
  ["5500", "Utilities", "expense", "utilities", false],
  ["5900", "Other Expenses", "expense", "other_expenses", false],
];

export function seedAccounting(uuid: (seed: string) => string): DemoAccounting {
  const now = new Date().toISOString();
  const accounts: AccountRow[] = COA.map(([code, name, type, system_key, is_group]) => ({
    id: uuid("acct" + code),
    code,
    name,
    type,
    parent_id: null,
    system_key,
    is_group,
    is_active: true,
    created_at: now,
  }));

  // Parent detail accounts under their group header.
  const groupFor = (code: string) => {
    if (code.startsWith("15")) return "1500";
    return code[0] + "000";
  };
  for (const a of accounts) {
    if (a.is_group) continue;
    const parent = accounts.find((p) => p.is_group && p.code === groupFor(a.code));
    if (parent) a.parent_id = parent.id;
  }

  const settings: CompanySettings = {
    id: true,
    legal_name: "Dynamic Traders & Distributors",
    address: "Plot 14, SITE Area",
    city: "Karachi",
    country: "Pakistan",
    phone: null,
    email: null,
    ntn: null,
    strn: null,
    bank_details: null,
    default_tax_rate: 0.18,
    default_terms_days: 30,
    invoice_prefix: "INV",
    credit_note_prefix: "CN",
    fiscal_year_start_month: 7,
    updated_at: now,
  };

  return { accounts, entries: [], lines: [], invoices: [], invoiceItems: [], payments: [], settings, counters: {}, nextEntryNo: 1 };
}
