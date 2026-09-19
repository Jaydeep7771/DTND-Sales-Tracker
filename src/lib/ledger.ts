/**
 * Posting engine. The only route into the general ledger.
 *
 * Callers describe an entry in business terms using system keys, for
 * example "debit accounts_receivable, credit sales_revenue". This module
 * resolves keys to accounts, checks the entry balances, allocates the
 * entry number and posts atomically.
 */
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { demo } from "@/lib/demo-store";
import { isDemo } from "@/lib/data";
import { assertBalanced, businessDate, round2, type JournalEntryInput, type SystemKey } from "@/lib/accounting";
import type { AccountRow } from "@/types/database";

export type PostResult = { ok: true; entryId: string; entryNo: string } | { ok: false; error: string };

/** "2026-27" for a July fiscal year start. */
export function fiscalYearLabel(date: Date, startMonth = 7): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const start = month >= startMonth ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

async function loadAccounts(): Promise<AccountRow[]> {
  if (isDemo) return demo.acc.accounts;
  const { data } = await (await createClient()).from("accounts").select("*");
  return data ?? [];
}

/** Allocates the next gapless number for a scope. */
async function nextNumber(scope: string): Promise<number> {
  if (isDemo) {
    demo.acc.counters[scope] = (demo.acc.counters[scope] ?? 0) + 1;
    return demo.acc.counters[scope];
  }
  const { data, error } = await (await createClient()).rpc("next_document_number", { p_scope: scope });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function nextDocumentNumber(scope: string): Promise<number> {
  return nextNumber(scope);
}

/**
 * Posts a balanced entry. Returns an error result rather than throwing so
 * callers can surface it in the UI without a try/catch at every site.
 */
export async function postEntry(input: JournalEntryInput): Promise<PostResult> {
  try {
    const accounts = await loadAccounts();
    const byKey = new Map(accounts.filter((a) => a.system_key).map((a) => [a.system_key as SystemKey, a]));
    const byId = new Map(accounts.map((a) => [a.id, a]));

    // Resolve every line to a real, postable account.
    const resolved = input.lines.map((l) => {
      const account = l.account_id ? byId.get(l.account_id) : l.system_key ? byKey.get(l.system_key) : undefined;
      if (!account) throw new Error(`Unknown account: ${l.system_key ?? l.account_id ?? "unspecified"}`);
      if (account.is_group) throw new Error(`Cannot post to the group account ${account.code} ${account.name}`);
      return {
        account_id: account.id,
        debit: round2(l.debit ?? 0),
        credit: round2(l.credit ?? 0),
        party_id: l.party_id ?? null,
        memo: l.memo ?? null,
      };
    }).filter((l) => l.debit > 0 || l.credit > 0);

    assertBalanced(resolved);

    const date = new Date(input.entry_date);
    const scope = `JV-${fiscalYearLabel(date, isDemo ? demo.acc.settings.fiscal_year_start_month : 7)}`;
    const seq = await nextNumber(scope);
    const entryNo = `${scope}-${String(seq).padStart(5, "0")}`;

    if (isDemo) {
      const id = crypto.randomUUID();
      demo.acc.entries.unshift({
        id,
        entry_no: entryNo,
        entry_date: input.entry_date,
        narration: input.narration,
        source_type: input.source_type ?? "manual",
        source_id: input.source_id ?? null,
        reversal_of: null,
        posted_by: null,
        posted_at: new Date().toISOString(),
      });
      resolved.forEach((l, i) =>
        demo.acc.lines.push({ id: crypto.randomUUID(), entry_id: id, sort_order: i, ...l }),
      );
      return { ok: true, entryId: id, entryNo };
    }

    const { data, error } = await (await createClient()).rpc("post_journal_entry", {
      p_entry_no: entryNo,
      p_entry_date: input.entry_date,
      p_narration: input.narration,
      p_source_type: input.source_type ?? "manual",
      p_source_id: input.source_id ?? null,
      p_lines: resolved,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, entryId: data as string, entryNo };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not post entry." };
  }
}

/**
 * Reverses an entry by posting its mirror image. The ledger is
 * append-only, so this is the only correction mechanism.
 */
export async function reverseEntry(entryId: string, reason: string): Promise<PostResult> {
  if (isDemo) {
    const original = demo.acc.entries.find((e) => e.id === entryId);
    if (!original) return { ok: false, error: "Entry not found." };
    const lines = demo.acc.lines.filter((l) => l.entry_id === entryId);
    const res = await postEntry({
      entry_date: businessDate(),
      narration: `Reversal of ${original.entry_no}: ${reason}`,
      source_type: "manual",
      lines: lines.map((l) => ({ account_id: l.account_id, debit: l.credit, credit: l.debit, party_id: l.party_id, memo: l.memo ?? undefined })),
    });
    if (res.ok) {
      const posted = demo.acc.entries.find((e) => e.id === res.entryId);
      if (posted) posted.reversal_of = entryId;
    }
    return res;
  }

  const supabase = await createClient();
  const { data: original } = await supabase.from("journal_entries").select("entry_no").eq("id", entryId).single();
  const { data: lines } = await supabase.from("journal_lines").select("*").eq("entry_id", entryId);
  if (!original || !lines?.length) return { ok: false, error: "Entry not found." };
  return postEntry({
    entry_date: businessDate(),
    narration: `Reversal of ${original.entry_no}: ${reason}`,
    source_type: "manual",
    lines: lines.map((l) => ({ account_id: l.account_id, debit: l.credit, credit: l.debit, party_id: l.party_id, memo: l.memo ?? undefined })),
  });
}
