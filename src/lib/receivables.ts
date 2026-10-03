/**
 * Aged receivables and credit control.
 *
 * Aging buckets run from the DUE date, not the issue date. An invoice on
 * Net 60 is not thirty days late on day thirty-one, and collections only
 * ever act on days past due.
 */
import { round2 } from "@/lib/accounting";

export type AgeBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

export const BUCKET_LABEL: Record<AgeBucket, string> = {
  current: "Not yet due",
  d1_30: "1–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90_plus: "90+ days",
};

export const BUCKET_ORDER: AgeBucket[] = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"];

/** Days past due. Negative while the invoice is still within terms. */
export function daysPastDue(dueDate: string | null, today = new Date()): number {
  if (!dueDate) return 0;
  const due = new Date(`${dueDate}T12:00:00Z`).getTime();
  const now = new Date(`${today.toISOString().slice(0, 10)}T12:00:00Z`).getTime();
  return Math.round((now - due) / 86400e3);
}

export function bucketOf(dueDate: string | null, today = new Date()): AgeBucket {
  const d = daysPastDue(dueDate, today);
  if (d <= 0) return "current";
  if (d <= 30) return "d1_30";
  if (d <= 60) return "d31_60";
  if (d <= 90) return "d61_90";
  return "d90_plus";
}

export interface AgingRow {
  customer_id: string;
  company_name: string;
  email: string;
  credit_limit: number;
  credit_hold: boolean;
  outstanding: number;
  buckets: Record<AgeBucket, number>;
  worst_days: number;
  open_invoices: number;
}

export interface AgingTotals {
  outstanding: number;
  buckets: Record<AgeBucket, number>;
  overdue: number;
}

export function emptyBuckets(): Record<AgeBucket, number> {
  return { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
}

/** Builds the aged schedule from open invoices. */
export function buildAging(
  invoices: { customer: { id: string; company_name: string; email: string }; due_date: string | null; balance: number; status: string }[],
  customers: { id: string; credit_limit?: number | null; credit_hold?: boolean | null }[],
  today = new Date(),
): { rows: AgingRow[]; totals: AgingTotals } {
  const byCustomer = new Map<string, AgingRow>();

  for (const inv of invoices) {
    if (inv.status !== "issued" || inv.balance <= 0.005) continue;
    const c = customers.find((x) => x.id === inv.customer.id);
    const row =
      byCustomer.get(inv.customer.id) ??
      {
        customer_id: inv.customer.id,
        company_name: inv.customer.company_name,
        email: inv.customer.email,
        credit_limit: Number(c?.credit_limit ?? 0),
        credit_hold: Boolean(c?.credit_hold),
        outstanding: 0,
        buckets: emptyBuckets(),
        worst_days: 0,
        open_invoices: 0,
      };

    const bucket = bucketOf(inv.due_date, today);
    row.buckets[bucket] = round2(row.buckets[bucket] + inv.balance);
    row.outstanding = round2(row.outstanding + inv.balance);
    row.worst_days = Math.max(row.worst_days, daysPastDue(inv.due_date, today));
    row.open_invoices += 1;
    byCustomer.set(inv.customer.id, row);
  }

  const rows = [...byCustomer.values()].sort((a, b) => b.worst_days - a.worst_days || b.outstanding - a.outstanding);

  const totals: AgingTotals = { outstanding: 0, buckets: emptyBuckets(), overdue: 0 };
  for (const r of rows) {
    totals.outstanding = round2(totals.outstanding + r.outstanding);
    for (const b of BUCKET_ORDER) totals.buckets[b] = round2(totals.buckets[b] + r.buckets[b]);
  }
  totals.overdue = round2(totals.outstanding - totals.buckets.current);

  return { rows, totals };
}

export type CreditVerdict =
  | { ok: true; warning?: string }
  | { ok: false; reason: string };

/**
 * The credit decision at approval.
 *
 * A hold is a hard stop. A limit is also a hard stop, because a limit that
 * can be clicked through is not a limit. Age alone warns rather than
 * blocks: a long-overdue invoice may be in dispute over one line, and
 * refusing all trade over it is a commercial decision, not a system one.
 */
export function creditCheck(input: {
  outstanding: number;
  orderValue: number;
  creditLimit: number;
  creditHold: boolean;
  worstDaysPastDue: number;
}, moneyFmt: (n: number) => string): CreditVerdict {
  if (input.creditHold) {
    return { ok: false, reason: "This customer is on credit hold. Release the hold on their account before approving further orders." };
  }

  const exposure = round2(input.outstanding + input.orderValue);
  if (input.creditLimit > 0 && exposure > input.creditLimit) {
    return {
      ok: false,
      reason: `This order takes the customer to ${moneyFmt(exposure)} against a credit limit of ${moneyFmt(input.creditLimit)}. Collect payment or raise the limit before approving.`,
    };
  }

  if (input.worstDaysPastDue > 60) {
    return { ok: true, warning: `Approved, but this customer has an invoice ${input.worstDaysPastDue} days past due. Chase it before dispatch.` };
  }
  if (input.creditLimit > 0 && exposure > input.creditLimit * 0.9) {
    return { ok: true, warning: `Approved. This customer is now at ${moneyFmt(exposure)} of a ${moneyFmt(input.creditLimit)} limit.` };
  }
  return { ok: true };
}
