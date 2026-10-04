"use server";

/**
 * Posting by hand.
 *
 * Until now the ledger could only be written by the documents that drive
 * it: invoices, receipts, bills, dispatches. Everything else a business
 * does — rent, salaries, utilities, bank charges, depreciation, drawings
 * — had nowhere to go, so roughly half of a real profit and loss was
 * unreachable and the bank balance was a receipts-minus-supplier-payments
 * counter rather than a balance.
 *
 * Two doors onto the same engine:
 *
 *   recordExpense  — the common case, in business language. One thing was
 *                    paid for, out of one account, on one date.
 *   postManualEntry — the escape hatch, in accounting language. Any
 *                    accounts, any number of lines, must balance.
 *
 * Both call postEntry, so the balance rule, period locking, gapless
 * numbering and the append-only ledger all apply without restating them.
 */
import { revalidatePath } from "next/cache";
import { getAccounts, getCurrentStaff, isPeriodClosed } from "@/lib/data";
import { can } from "@/lib/permissions";
import { businessDate, round2 } from "@/lib/accounting";
import { postEntry, reverseEntry } from "@/lib/ledger";
import { money } from "@/lib/format";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function deny(): Promise<Result | null> {
  const staff = await getCurrentStaff();
  if (can(staff?.role, "ledger:post")) return null;
  return { ok: false, error: "Only finance and admin can post to the ledger." };
}

/** Shared date checks, so both doors refuse the same things. */
async function dateProblem(date: string): Promise<string | null> {
  if (!date) return "Pick a date.";
  if (date > businessDate()) return "An entry cannot be dated in the future.";
  if (await isPeriodClosed(date)) {
    return "That date falls in a closed period. Post it to an open period, or reopen the period first.";
  }
  return null;
}

// ---------------------------------------------------------------- expense
export interface ExpenseInput {
  /** Account the cost belongs to, e.g. Rent. */
  expense_account_id: string;
  /** Where the money came from: a bank or cash account. */
  paid_from_account_id: string;
  amount: number;
  spent_on: string;
  description: string;
  reference: string;
}

/**
 * One payment for one thing: Dr the expense, Cr bank or cash.
 *
 * Deliberately not a journal entry screen. The person who pays the rent
 * should not have to know which side is which, and the two-line shape
 * covers nearly every payment a distributor makes.
 */
export async function recordExpense(input: ExpenseInput): Promise<Result<{ entryNo: string }>> {
  const denied = await deny(); if (denied) return denied;

  const amount = round2(input.amount);
  if (!(amount > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  if (!input.description.trim()) return { ok: false, error: "Say what this was for. It is the only explanation the ledger will carry." };

  const problem = await dateProblem(input.spent_on);
  if (problem) return { ok: false, error: problem };

  const accounts = await getAccounts();
  const expense = accounts.find((a) => a.id === input.expense_account_id);
  const paidFrom = accounts.find((a) => a.id === input.paid_from_account_id);
  if (!expense || !paidFrom) return { ok: false, error: "Choose both accounts." };
  if (expense.is_group || paidFrom.is_group) return { ok: false, error: "Group headings hold no postings. Choose a detail account." };
  if (expense.id === paidFrom.id) return { ok: false, error: "The two accounts must be different." };

  // The form only offers asset accounts to pay from, but the action is
  // callable on its own, so it re-checks rather than trusting the caller.
  if (paidFrom.type !== "asset" && paidFrom.type !== "liability") {
    return { ok: false, error: `${paidFrom.name} is not an account money can be paid from.` };
  }

  const posted = await postEntry({
    entry_date: input.spent_on,
    narration: input.description.trim(),
    source_type: "manual",
    lines: [
      { account_id: expense.id, debit: amount, memo: input.reference.trim() || undefined },
      { account_id: paidFrom.id, credit: amount, memo: input.reference.trim() || undefined },
    ],
  });
  if (!posted.ok) return { ok: false, error: posted.error };

  revalidateLedger();
  return { ok: true, data: { entryNo: posted.entryNo } };
}

// ---------------------------------------------------------------- journal
export interface ManualLineInput {
  account_id: string;
  debit: number;
  credit: number;
  memo: string;
  party_id?: string | null;
}

export interface ManualEntryInput {
  entry_date: string;
  narration: string;
  lines: ManualLineInput[];
}

/**
 * A free-form entry for everything the expense form does not cover:
 * depreciation, accruals, prepayments, owner drawings, corrections.
 */
export async function postManualEntry(input: ManualEntryInput): Promise<Result<{ entryNo: string }>> {
  const denied = await deny(); if (denied) return denied;

  if (!input.narration.trim()) {
    return { ok: false, error: "Write a narration. In a year this is all anyone will have to explain the entry." };
  }
  const problem = await dateProblem(input.entry_date);
  if (problem) return { ok: false, error: problem };

  const accounts = await getAccounts();
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const lines = input.lines
    .map((l) => ({ ...l, debit: round2(Math.max(0, l.debit || 0)), credit: round2(Math.max(0, l.credit || 0)) }))
    .filter((l) => l.account_id && (l.debit > 0 || l.credit > 0));

  if (lines.length < 2) return { ok: false, error: "An entry needs at least two lines." };

  for (const l of lines) {
    const account = byId.get(l.account_id);
    if (!account) return { ok: false, error: "One of the lines has no account." };
    if (account.is_group) return { ok: false, error: `${account.code} ${account.name} is a heading and holds no postings.` };
    if (l.debit > 0 && l.credit > 0) {
      return { ok: false, error: `${account.name} has both a debit and a credit. A line is one or the other.` };
    }
  }

  const debits = round2(lines.reduce((a, l) => a + l.debit, 0));
  const credits = round2(lines.reduce((a, l) => a + l.credit, 0));
  if (Math.abs(debits - credits) > 0.005) {
    return {
      ok: false,
      error: `Debits are ${money(debits)} and credits are ${money(credits)}. They have to match, out by ${money(Math.abs(debits - credits))}.`,
    };
  }

  const posted = await postEntry({
    entry_date: input.entry_date,
    narration: input.narration.trim(),
    source_type: "manual",
    lines: lines.map((l) => ({
      account_id: l.account_id,
      debit: l.debit,
      credit: l.credit,
      party_id: l.party_id || undefined,
      memo: l.memo.trim() || undefined,
    })),
  });
  if (!posted.ok) return { ok: false, error: posted.error };

  revalidateLedger();
  return { ok: true, data: { entryNo: posted.entryNo } };
}

/**
 * Reverses any entry from the day book.
 *
 * The ledger is append-only, so this is the only correction available,
 * and it is deliberately the same mechanism documents use. A reversal
 * posted today for an entry dated last month lands in today's period,
 * which is correct: you cannot change a month you have already reported.
 */
export async function reverseJournalEntry(entryId: string, reason: string): Promise<Result<{ entryNo: string }>> {
  const denied = await deny(); if (denied) return denied;
  if (!reason.trim()) return { ok: false, error: "Give a reason. It becomes the narration of the reversing entry." };

  const res = await reverseEntry(entryId, reason.trim());
  if (!res.ok) return { ok: false, error: res.error };

  revalidateLedger();
  return { ok: true, data: { entryNo: res.entryNo } };
}

function revalidateLedger() {
  for (const p of ["/admin", "/admin/accounts", "/admin/journal", "/admin/reports", "/admin/receivables", "/admin/purchases"]) {
    revalidatePath(p);
  }
}
