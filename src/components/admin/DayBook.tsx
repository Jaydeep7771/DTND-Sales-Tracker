"use client";

/**
 * The day book: every entry with its lines.
 *
 * This is the screen that explains a balance. The trial balance says Rent
 * is 450,000; this says which three payments made it so. It had to exist
 * before posting by hand did, because an entry you cannot see is an entry
 * you cannot correct.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { postManualEntry, recordExpense, reverseJournalEntry } from "@/lib/journal-actions";
import { businessDate, round2 } from "@/lib/accounting";
import { money, shortDate } from "@/lib/format";
import { currencyPrefix } from "@/lib/money";
import type { JournalEntryView } from "@/lib/data";
import type { AccountRow } from "@/types/database";

const SOURCE_LABEL: Record<string, string> = {
  invoice: "Invoice", payment: "Payment", credit_note: "Credit note",
  bill: "Bill", dispatch: "Dispatch", stock: "Stock", manual: "Manual",
};

export default function DayBook({
  entries, accounts, canPost,
}: {
  entries: JournalEntryView[];
  accounts: AccountRow[];
  canPost: boolean;
}) {
  const [expense, setExpense] = useState(false);
  const [journal, setJournal] = useState(false);
  const [reversing, setReversing] = useState<JournalEntryView | null>(null);
  const [open, setOpen] = useState<string | null>(entries[0]?.id ?? null);

  const postable = accounts.filter((a) => !a.is_group);

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[12.5px] text-slate">
          {entries.length} entr{entries.length === 1 ? "y" : "ies"}, newest first.
        </div>
        {canPost && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setJournal(true)}>Journal entry</Button>
            <Button size="sm" onClick={() => setExpense(true)}>Record a payment</Button>
          </div>
        )}
      </div>

      <Card className="overflow-hidden">
        {entries.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-slate">Nothing posted in this range.</div>
        ) : (
          <div className="flex flex-col">
            {entries.map((e) => {
              const isOpen = open === e.id;
              return (
                <div key={e.id} className="border-t border-border-soft first:border-t-0">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : e.id)}
                    className="w-full text-left px-5 py-3 bg-transparent border-0 cursor-pointer hover:bg-surface-soft flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="font-mono text-[12.5px] font-medium">{e.entry_no}</span>
                        <Badge tone={e.source_type === "manual" ? "warning" : "info"}>
                          {SOURCE_LABEL[e.source_type ?? "manual"] ?? e.source_type}
                        </Badge>
                        {e.reversal_of && <Badge tone="danger">Reversal</Badge>}
                        {e.reversed_by && <Badge tone="danger">Reversed by {e.reversed_by}</Badge>}
                      </div>
                      <div className="text-[12.5px] text-slate-dark mt-1 truncate">{e.narration}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-[13.5px] font-semibold">{money(e.total)}</div>
                      <div className="text-[11.5px] text-slate mt-0.5">{shortDate(e.entry_date)}</div>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-5 pb-4">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr>
                            <th className="th">Account</th>
                            <th className="th">Memo</th>
                            <th className="th th-r w-[120px]">Debit</th>
                            <th className="th th-r w-[120px]">Credit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {e.lines.map((l, i) => (
                            <tr key={i} className="border-t border-border-soft">
                              <td className="td">
                                <span className="font-mono text-[11.5px] text-slate mr-2">{l.code}</span>
                                <span className="text-[13px]">{l.name}</span>
                                {l.party_name && <span className="text-[11.5px] text-slate ml-2">· {l.party_name}</span>}
                              </td>
                              <td className="td text-[12px] text-slate">{l.memo ?? "—"}</td>
                              <td className="td text-right font-mono text-[12.5px]">{l.debit > 0 ? money(l.debit) : ""}</td>
                              <td className="td text-right font-mono text-[12.5px]">{l.credit > 0 ? money(l.credit) : ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {canPost && !e.reversed_by && (
                        <div className="flex justify-end mt-3">
                          <Button variant="destructive" size="sm" onClick={() => setReversing(e)}>Reverse this entry</Button>
                        </div>
                      )}
                      {e.reversed_by && (
                        <div className="mt-3 text-[11.5px] text-slate">
                          Already reversed by {e.reversed_by}. The original stays on record, which is the point.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {expense && <ExpenseModal accounts={postable} onClose={() => setExpense(false)} />}
      {journal && <JournalModal accounts={postable} onClose={() => setJournal(false)} />}
      {reversing && <ReverseModal entry={reversing} onClose={() => setReversing(null)} />}
    </>
  );
}

// ---------------------------------------------------------------- expense
function ExpenseModal({ accounts, onClose }: { accounts: AccountRow[]; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Only expenses to spend on, only assets to spend from. Narrowing the
  // lists is what lets this form avoid the words debit and credit.
  const expenses = accounts.filter((a) => a.type === "expense");
  const sources = accounts.filter((a) => a.type === "asset" && ["cash", "bank"].includes(a.system_key ?? ""));
  const fallbackSources = sources.length > 0 ? sources : accounts.filter((a) => a.type === "asset");

  const [form, setForm] = useState({
    expense_account_id: expenses[0]?.id ?? "",
    paid_from_account_id: fallbackSources[0]?.id ?? "",
    amount: "",
    spent_on: businessDate(),
    description: "",
    reference: "",
  });

  function save() {
    setError(null);
    start(async () => {
      const res = await recordExpense({ ...form, amount: Number(form.amount) || 0 });
      if (!res.ok) return setError(res.error);
      toast.push(`Posted as ${res.data!.entryNo}`, "success");
      router.refresh();
      onClose();
    });
  }

  const chosen = expenses.find((a) => a.id === form.expense_account_id);
  const from = fallbackSources.find((a) => a.id === form.paid_from_account_id);

  return (
    <Modal
      title="Record a payment"
      sub="Rent, salaries, utilities, fuel, bank charges — anything the business paid for that is not a supplier bill."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !(Number(form.amount) > 0) || !form.description.trim()}>
            {busy ? "Posting…" : "Post payment"}
          </Button>
        </>
      }
    >
      <div className="p-5 grid gap-3.5 grid-cols-1 sm:grid-cols-2">
        {error && <p role="alert" className="sm:col-span-2 rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}

        <Field label="What was it for?" className="sm:col-span-2">
          <Select value={form.expense_account_id} onChange={(e) => setForm((f) => ({ ...f, expense_account_id: e.target.value }))}>
            {expenses.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>

        <Field label={`Amount (${currencyPrefix()})`}>
          <Input mono type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
        </Field>
        <Field label="Date">
          <Input type="date" max={businessDate()} value={form.spent_on} onChange={(e) => setForm((f) => ({ ...f, spent_on: e.target.value }))} />
        </Field>

        <Field label="Paid from">
          <Select value={form.paid_from_account_id} onChange={(e) => setForm((f) => ({ ...f, paid_from_account_id: e.target.value }))}>
            {fallbackSources.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Reference">
          <Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} placeholder="Cheque or transfer no." />
        </Field>

        <Field label="Description" className="sm:col-span-2">
          <Input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="e.g. Office rent for October, Shop 4 SITE"
          />
        </Field>

        {chosen && from && Number(form.amount) > 0 && (
          <div className="sm:col-span-2 rounded-lg border border-border bg-surface-soft px-3.5 py-2.5">
            <div className="label mb-1.5">This will post</div>
            <div className="font-mono text-[12px] text-slate-dark">
              Dr {chosen.name} {money(Number(form.amount))}<br />
              Cr {from.name} {money(Number(form.amount))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- journal
interface Line { key: string; account_id: string; debit: string; credit: string; memo: string }
const blankLine = (): Line => ({ key: crypto.randomUUID(), account_id: "", debit: "", credit: "", memo: "" });

function JournalModal({ accounts, onClose }: { accounts: AccountRow[]; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [entryDate, setEntryDate] = useState(businessDate());
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine(), blankLine()]);

  const debits = round2(lines.reduce((a, l) => a + (Number(l.debit) || 0), 0));
  const credits = round2(lines.reduce((a, l) => a + (Number(l.credit) || 0), 0));
  const diff = round2(debits - credits);
  const balanced = Math.abs(diff) < 0.005 && debits > 0;

  function setLine(key: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function save() {
    setError(null);
    start(async () => {
      const res = await postManualEntry({
        entry_date: entryDate,
        narration,
        lines: lines.map((l) => ({
          account_id: l.account_id,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          memo: l.memo,
        })),
      });
      if (!res.ok) return setError(res.error);
      toast.push(`Posted as ${res.data!.entryNo}`, "success");
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal
      title="Journal entry"
      sub="For depreciation, accruals, drawings and corrections. The entry must balance before it can be posted."
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !balanced || !narration.trim()}>
            {busy ? "Posting…" : "Post entry"}
          </Button>
        </>
      }
    >
      <div className="p-5 flex flex-col gap-4">
        {error && <p role="alert" className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}

        <div className="grid gap-3.5 grid-cols-1 sm:grid-cols-[160px_minmax(0,1fr)]">
          <Field label="Date">
            <Input type="date" max={businessDate()} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </Field>
          <Field label="Narration">
            <Input
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              placeholder="e.g. Depreciation on delivery van for October"
            />
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="label">Lines</span>
            <button
              type="button"
              onClick={() => setLines((ls) => [...ls, blankLine()])}
              className="text-[11.5px] text-navy-hover bg-transparent border-0 cursor-pointer"
            >
              Add line
            </button>
          </div>

          <div className="border border-border rounded-lg overflow-x-auto">
            <table className="w-full border-collapse min-w-[620px]">
              <thead>
                <tr className="bg-surface-soft">
                  <th className="th">Account</th>
                  <th className="th">Memo</th>
                  <th className="th th-r w-[120px]">Debit</th>
                  <th className="th th-r w-[120px]">Credit</th>
                  <th className="th w-[40px]" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key} className="border-t border-border-soft">
                    <td className="td">
                      <Select value={l.account_id} onChange={(e) => setLine(l.key, { account_id: e.target.value })} className="py-1.5">
                        <option value="">Choose an account…</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                      </Select>
                    </td>
                    <td className="td">
                      <Input value={l.memo} onChange={(e) => setLine(l.key, { memo: e.target.value })} className="py-1.5" />
                    </td>
                    <td className="td">
                      <Input
                        mono type="number" min="0" step="0.01" value={l.debit}
                        onChange={(e) => setLine(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })}
                        className="py-1.5 text-right"
                      />
                    </td>
                    <td className="td">
                      <Input
                        mono type="number" min="0" step="0.01" value={l.credit}
                        onChange={(e) => setLine(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })}
                        className="py-1.5 text-right"
                      />
                    </td>
                    <td className="td text-center">
                      {lines.length > 2 && (
                        <button
                          type="button"
                          aria-label="Remove line"
                          onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                          className="text-slate hover:text-danger bg-transparent border-0 cursor-pointer text-[15px] leading-none"
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={`mt-2.5 rounded-lg border px-3 py-2 text-[12.5px] flex items-center justify-between gap-3 ${
            balanced ? "bg-success-bg border-success-bd text-success" : "bg-warning-bg border-warning-bd text-warning"
          }`}>
            <span>
              {balanced ? "Balanced." : debits === 0 && credits === 0 ? "Enter the lines." : `Out of balance by ${money(Math.abs(diff))}.`}
            </span>
            <span className="font-mono">Dr {money(debits)} · Cr {money(credits)}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- reverse
function ReverseModal({ entry, onClose }: { entry: JournalEntryView; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  function save() {
    setError(null);
    start(async () => {
      const res = await reverseJournalEntry(entry.id, reason);
      if (!res.ok) return setError(res.error);
      toast.push(`Reversed by ${res.data!.entryNo}`, "info");
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal
      title={`Reverse ${entry.entry_no}`}
      sub="The original stays on record. A mirror entry is posted against it, dated today."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={save} disabled={busy || !reason.trim()}>
            {busy ? "Reversing…" : "Post reversal"}
          </Button>
        </>
      }
    >
      <div className="p-5 flex flex-col gap-3.5">
        {error && <p role="alert" className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}
        <div className="rounded-lg border border-border bg-surface-soft px-3.5 py-2.5 text-[12.5px] text-slate-dark">
          {entry.narration} · {money(entry.total)} · {shortDate(entry.entry_date)}
        </div>
        <Field label="Reason">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Posted to the wrong account." />
        </Field>
        <p className="text-[11.5px] text-slate leading-relaxed">
          The reversal is dated today, not the date of the original. That is deliberate: a month you have
          already reported cannot be changed after the fact.
        </p>
      </div>
    </Modal>
  );
}
