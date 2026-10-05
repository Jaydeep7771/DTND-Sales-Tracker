/**
 * Customer account statements.
 *
 * A statement is not a list of invoices. It is the customer's account
 * with us over a period: what they owed at the start, everything that
 * moved it, and what they owe at the end. Built strictly from the
 * receivable control account rather than from the invoice table, because
 * that is the only record that already includes receipts, credit notes,
 * write-offs and any manual adjustment somebody posted by hand.
 *
 * Only lines on accounts_receivable count. A customer advance sits on a
 * liability account and withholding tax sits on its own receivable, and
 * both carry the same party id; including them would double-count the
 * entry that created them. They are reported separately as memoranda,
 * which is where a buyer expects to see them anyway.
 */
import { bucketOf, emptyBuckets, type AgeBucket } from "@/lib/receivables";
import { round2 } from "@/lib/accounting";

export interface StatementLine {
  id: string;
  date: string;
  entry_no: string;
  description: string;
  /** Increases what they owe: an invoice. */
  debit: number;
  /** Reduces it: a receipt, a credit note, a write-off. */
  credit: number;
  /** Running balance after this line. */
  balance: number;
}

export interface Statement {
  from: string;
  to: string;
  opening: number;
  lines: StatementLine[];
  closing: number;
  totals: { debits: number; credits: number };
  /** Ageing of the closing balance, by the invoices still open at `to`. */
  aging: Record<AgeBucket, number>;
  /** Unapplied cash held on account. Reduces what is really due. */
  advance: number;
  /** Tax the customer withheld and owes us a certificate for. */
  withheld: number;
  /** Oldest unpaid item, in days past due. */
  worstDays: number;
  /** Open invoices making up the closing balance. */
  openItems: { number: string; date: string; due: string | null; total: number; balance: number }[];
}

/** A ledger line as the statement needs it, before filtering by date. */
export interface StatementSource {
  id: string;
  entry_no: string;
  entry_date: string;
  narration: string;
  debit: number;
  credit: number;
}

export interface OpenItem {
  number: string;
  issue_date: string | null;
  due_date: string | null;
  total: number;
  balance: number;
}

export function buildStatement(input: {
  rows: StatementSource[];
  from: string;
  to: string;
  advance: number;
  withheld: number;
  openItems: OpenItem[];
  today?: Date;
}): Statement {
  const { from, to } = input;
  const today = input.today ?? new Date();

  const sorted = [...input.rows].sort(
    (a, b) => a.entry_date.localeCompare(b.entry_date) || a.entry_no.localeCompare(b.entry_no),
  );

  // Everything before the window collapses into one opening figure. That
  // is the whole point of a statement period: the customer should not
  // have to re-read last quarter to understand this one.
  let opening = 0;
  for (const r of sorted) {
    if (r.entry_date >= from) break;
    opening += r.debit - r.credit;
  }
  opening = round2(opening);

  let balance = opening;
  let debits = 0;
  let credits = 0;
  const lines: StatementLine[] = [];

  for (const r of sorted) {
    if (r.entry_date < from || r.entry_date > to) continue;
    balance = round2(balance + r.debit - r.credit);
    debits += r.debit;
    credits += r.credit;
    lines.push({
      id: r.id,
      date: r.entry_date,
      entry_no: r.entry_no,
      description: r.narration,
      debit: round2(r.debit),
      credit: round2(r.credit),
      balance,
    });
  }

  // Aged against the invoices that are actually still open, not against
  // the statement lines: a part-paid invoice ages on its own due date,
  // and the receipt that part-paid it has no age of its own.
  const aging = emptyBuckets();
  let worstDays = 0;
  const openAtClose = input.openItems.filter((i) => i.balance > 0.005 && (!i.issue_date || i.issue_date <= to));
  for (const i of openAtClose) {
    aging[bucketOf(i.due_date, today)] += i.balance;
    const over = i.due_date ? Math.floor((today.getTime() - new Date(`${i.due_date}T00:00:00Z`).getTime()) / 86400000) : 0;
    if (over > worstDays) worstDays = over;
  }
  for (const k of Object.keys(aging) as AgeBucket[]) aging[k] = round2(aging[k]);

  return {
    from,
    to,
    opening,
    lines,
    closing: balance,
    totals: { debits: round2(debits), credits: round2(credits) },
    aging,
    advance: round2(input.advance),
    withheld: round2(input.withheld),
    worstDays,
    openItems: openAtClose.map((i) => ({
      number: i.number,
      date: i.issue_date ?? "",
      due: i.due_date,
      total: round2(i.total),
      balance: round2(i.balance),
    })),
  };
}

/**
 * What the customer actually has to pay.
 *
 * The closing balance is what the ledger says. Cash we are already
 * holding on account reduces it, and so does tax they withheld, because
 * that money went to the tax authority on our behalf and they do not owe
 * it to us twice. Printing a demand that ignores either is how a
 * statement starts an argument.
 */
export function amountDue(s: Statement): number {
  return round2(Math.max(0, s.closing - s.advance));
}
