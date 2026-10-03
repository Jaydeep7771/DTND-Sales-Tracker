/**
 * Financial statements, derived from the ledger rather than maintained
 * alongside it. Every figure here is a sum of journal lines, so a
 * statement can never disagree with the trial balance.
 */
import { round2, type AccountType } from "@/lib/accounting";
import type { AccountBalance } from "@/lib/accounting";

export interface Period {
  from: string;  // inclusive, YYYY-MM-DD
  to: string;    // inclusive
}

export interface StatementLine {
  code: string;
  name: string;
  system_key: string | null;
  amount: number;
}

export interface StatementSection {
  title: string;
  lines: StatementLine[];
  total: number;
}

/**
 * Profit and loss for a period.
 *
 * Gross profit is separated from operating expenses because for a
 * distributor it is the number that matters: it says whether the buying
 * and selling works before any overhead.
 *
 * Stock adjustments sit below gross profit on purpose. Shrinkage and
 * damage are not the cost of goods a customer bought, and burying them in
 * cost of sales would make the trading margin look worse than it is.
 */
export interface ProfitAndLoss {
  period: Period;
  revenue: StatementSection;
  costOfSales: StatementSection;
  grossProfit: number;
  grossMarginPct: number;
  operatingExpenses: StatementSection;
  otherIncome: StatementSection;
  netProfit: number;
}

const COST_KEYS = ["cogs"];

function lineOf(a: AccountBalance): StatementLine {
  return { code: a.code, name: a.name, system_key: a.system_key, amount: round2(a.balance) };
}

function section(title: string, rows: AccountBalance[]): StatementSection {
  const lines = rows.filter((a) => Math.abs(a.balance) > 0.005).map(lineOf);
  return { title, lines, total: round2(lines.reduce((t, l) => t + l.amount, 0)) };
}

export function buildProfitAndLoss(balances: AccountBalance[], period: Period): ProfitAndLoss {
  const postable = balances.filter((a) => !a.is_group);

  // Sales returns are an income-type contra account, so their balance is
  // already negative in income terms and simply adds in.
  const revenue = section(
    "Revenue",
    postable.filter((a) => a.type === "income" && a.system_key !== "other_income"),
  );
  const costOfSales = section(
    "Cost of sales",
    postable.filter((a) => a.type === "expense" && COST_KEYS.includes(a.system_key ?? "")),
  );
  const operatingExpenses = section(
    "Operating expenses",
    postable.filter((a) => a.type === "expense" && !COST_KEYS.includes(a.system_key ?? "")),
  );
  const otherIncome = section(
    "Other income",
    postable.filter((a) => a.type === "income" && a.system_key === "other_income"),
  );

  const grossProfit = round2(revenue.total - costOfSales.total);
  const netProfit = round2(grossProfit + otherIncome.total - operatingExpenses.total);

  return {
    period,
    revenue,
    costOfSales,
    grossProfit,
    grossMarginPct: revenue.total > 0 ? round2((grossProfit / revenue.total) * 100) : 0,
    operatingExpenses,
    otherIncome,
    netProfit,
  };
}

/**
 * Balance sheet as at a date.
 *
 * Income and expense accounts are never closed into retained earnings by
 * this system, so the profit for the year to date is carried into equity
 * as its own line. Without it the sheet would not balance, and an
 * accountant would spot that in seconds.
 */
export interface BalanceSheet {
  asAt: string;
  assets: StatementSection;
  liabilities: StatementSection;
  equity: StatementSection;
  profitForPeriod: number;
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
  balanced: boolean;
  difference: number;
}

export function buildBalanceSheet(
  balances: AccountBalance[],
  asAt: string,
  profitForPeriod: number,
): BalanceSheet {
  const postable = balances.filter((a) => !a.is_group);

  const assets = section("Assets", postable.filter((a) => a.type === "asset"));
  const liabilities = section("Liabilities", postable.filter((a) => a.type === "liability"));
  const equityAccounts = section("Equity", postable.filter((a) => a.type === "equity"));

  const equity: StatementSection = {
    title: "Equity",
    lines: [
      ...equityAccounts.lines,
      { code: "", name: "Profit for the period", system_key: null, amount: round2(profitForPeriod) },
    ],
    total: round2(equityAccounts.total + profitForPeriod),
  };

  const totalAssets = assets.total;
  const totalLiabilitiesAndEquity = round2(liabilities.total + equity.total);
  const difference = round2(totalAssets - totalLiabilitiesAndEquity);

  return {
    asAt,
    assets,
    liabilities,
    equity,
    profitForPeriod: round2(profitForPeriod),
    totalAssets,
    totalLiabilitiesAndEquity,
    balanced: Math.abs(difference) < 0.005,
    difference,
  };
}

/** Account types that belong on the balance sheet rather than the P&L. */
export const BALANCE_SHEET_TYPES: AccountType[] = ["asset", "liability", "equity"];

/** Convenience ranges for the report pickers. */
export function monthRange(d = new Date()): Period {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return {
    from: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10),
  };
}

/** The fiscal year containing `d`, given the month it starts in. */
export function fiscalYearRange(d = new Date(), startMonth = 7): Period {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const startYear = m >= startMonth ? y : y - 1;
  return {
    from: new Date(Date.UTC(startYear, startMonth - 1, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(startYear + 1, startMonth - 1, 0)).toISOString().slice(0, 10),
  };
}
