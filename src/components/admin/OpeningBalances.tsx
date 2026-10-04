"use client";

/**
 * Opening balances.
 *
 * One page rather than a stepped wizard: the figures come off a trial
 * balance and a couple of ledgers, and whoever is typing them wants to
 * move between sections as they find the paperwork, not be marched
 * through it. The running out-of-balance strip at the bottom is what
 * makes that safe.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input, Modal, Select, Toggle } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { commitOpeningBalances } from "@/lib/opening-balances";
import { businessDate, round2 } from "@/lib/accounting";
import { money, shortDate } from "@/lib/format";
import type { AccountRow, Supplier, UserProfile } from "@/types/database";

interface DocRow { key: string; party_id: string; reference: string; document_date: string; due_date: string; amount: string }
const blankDoc = (date: string): DocRow => ({ key: crypto.randomUUID(), party_id: "", reference: "", document_date: date, due_date: date, amount: "" });

export default function OpeningBalances({
  accounts, customers, suppliers, alreadyPosted, postedOn, canPost,
}: {
  accounts: AccountRow[];
  customers: UserProfile[];
  suppliers: Supplier[];
  alreadyPosted: boolean;
  postedOn: string | null;
  canPost: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Yesterday is the usual answer: you start using the system today, so
  // the balances are as they stood at close of business last night.
  const yesterday = useMemo(() => {
    const d = new Date(`${businessDate()}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }, []);

  const [asAt, setAsAt] = useState(yesterday);
  const [lock, setLock] = useState(true);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [customerRows, setCustomerRows] = useState<DocRow[]>([blankDoc(yesterday)]);
  const [supplierRows, setSupplierRows] = useState<DocRow[]>([blankDoc(yesterday)]);

  // Receivables and payables are entered as documents below, and Opening
  // Balance Equity is the balancing figure, so none of the three belongs
  // in the account list.
  const entered = accounts.filter(
    (a) => !a.is_group && !["accounts_receivable", "accounts_payable", "opening_balance"].includes(a.system_key ?? ""),
  );
  const groupOf = (a: AccountRow) => (a.type === "asset" ? "Assets" : a.type === "liability" ? "Liabilities" : a.type === "equity" ? "Equity" : null);
  const sections = ["Assets", "Liabilities", "Equity"] as const;

  const totals = useMemo(() => {
    let debits = 0;
    let credits = 0;
    for (const a of entered) {
      const amount = round2(Number(amounts[a.id]) || 0);
      if (amount === 0) continue;
      if (a.type === "asset" || a.type === "expense") debits += amount;
      else credits += amount;
    }
    debits += round2(customerRows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
    credits += round2(supplierRows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
    const difference = round2(debits - credits);
    return { debits: round2(debits), credits: round2(credits), difference };
  }, [amounts, customerRows, supplierRows, entered]);

  const anything = totals.debits > 0 || totals.credits > 0;

  function commit() {
    setError(null);
    start(async () => {
      const res = await commitOpeningBalances({
        as_at: asAt,
        lock,
        accounts: entered.map((a) => ({ account_id: a.id, amount: Number(amounts[a.id]) || 0 })),
        customers: customerRows
          .filter((r) => r.party_id && Number(r.amount) > 0)
          .map((r) => ({ party_id: r.party_id, reference: r.reference, document_date: r.document_date, due_date: r.due_date, amount: Number(r.amount) })),
        suppliers: supplierRows
          .filter((r) => r.party_id && Number(r.amount) > 0)
          .map((r) => ({ party_id: r.party_id, reference: r.reference, document_date: r.document_date, due_date: r.due_date, amount: Number(r.amount) })),
      });
      if (!res.ok) { setConfirming(false); return setError(res.error); }
      toast.push(`Opening balances posted in ${res.data!.entries} entr${res.data!.entries === 1 ? "y" : "ies"}`, "success");
      if (res.data!.warning) { setError(res.data!.warning); toast.push("The go-live lock needs your attention", "info"); }
      setConfirming(false);
      router.refresh();
    });
  }

  if (alreadyPosted) {
    return (
      <Card className="px-5 py-8 text-center">
        <Badge tone="success">Done</Badge>
        <div className="text-[15px] font-semibold mt-3">Opening balances were posted as at {postedOn ? shortDate(postedOn) : "an earlier date"}.</div>
        <p className="text-[13px] text-slate mt-2 max-w-[520px] mx-auto leading-relaxed">
          They can only be set once, because committing twice would double every balance. If they were
          wrong, reverse the opening entries from the day book and come back.
        </p>
        <div className="mt-4">
          <a href="/admin/journal?source=opening" className="text-[13px] text-navy-hover">Open the day book</a>
        </div>
      </Card>
    );
  }

  return (
    <>
      {error && <p role="alert" className="rounded-lg bg-danger-bg border border-danger-bd px-3.5 py-2.5 text-[13px] text-danger">{error}</p>}

      <Card className="px-5 py-4">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-[200px_minmax(0,1fr)] items-start">
          <Field label="Balances as at">
            <Input type="date" max={businessDate()} value={asAt} onChange={(e) => setAsAt(e.target.value)} />
          </Field>
          <div className="text-[12.5px] text-slate leading-relaxed sm:pt-6">
            The close of business on the day <strong className="text-ink">before</strong> you start using the system.
            Everything below is the position at that moment, and every entry will be dated then.
          </div>
        </div>
      </Card>

      {/* ---------------------------------------------- account balances */}
      {sections.map((section) => {
        const rows = entered.filter((a) => groupOf(a) === section);
        if (rows.length === 0) return null;
        return (
          <Card key={section} className="overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border">
              <div className="text-sm font-semibold">{section}</div>
              <div className="text-xs text-slate mt-0.5">
                {section === "Assets" && "Bank and cash from the statement, stock at cost, anything else the business owns."}
                {section === "Liabilities" && "Loans, tax owed, anything the business owes that is not a supplier bill."}
                {section === "Equity" && "Capital the owner has put in. Leave blank if you are not sure: the balancing figure handles it."}
              </div>
            </div>
            <table className="w-full border-collapse">
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-t border-border-soft">
                    <td className="px-5 py-2.5">
                      <span className="font-mono text-[11.5px] text-slate mr-2">{a.code}</span>
                      <span className="text-[13px]">{a.name}</span>
                    </td>
                    <td className="px-5 py-2 w-[200px]">
                      <Input
                        mono type="number" step="0.01"
                        aria-label={`Opening balance for ${a.name}`}
                        value={amounts[a.id] ?? ""}
                        onChange={(e) => setAmounts((s) => ({ ...s, [a.id]: e.target.value }))}
                        className="py-1.5 text-right"
                        placeholder="0"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        );
      })}

      {/* ---------------------------------------------- customers */}
      <DocumentSection
        title="What customers owe you"
        sub="One line per unpaid invoice, with its original number and due date."
        why="Entered as individual invoices rather than one figure per customer, so the aged schedule, statements and receipt allocation all work from day one. A single lump has nothing to age and nothing to allocate against."
        parties={customers.map((c) => ({ id: c.id, name: c.company_name ?? c.email }))}
        partyLabel="Customer"
        referenceLabel="Their invoice no."
        rows={customerRows}
        setRows={setCustomerRows}
        asAt={asAt}
      />

      {/* ---------------------------------------------- suppliers */}
      <DocumentSection
        title="What you owe suppliers"
        sub="One line per unpaid bill."
        why="Same reasoning: individual bills give you an aged creditors schedule and let a payment be matched to what it settles."
        parties={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        partyLabel="Supplier"
        referenceLabel="Their invoice no."
        rows={supplierRows}
        setRows={setSupplierRows}
        asAt={asAt}
      />

      {/* ---------------------------------------------- balance strip */}
      <Card className="px-5 py-4 sticky bottom-0 z-10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="font-mono text-[13px]">Dr {money(totals.debits)} · Cr {money(totals.credits)}</div>
            <div className="text-[12px] text-slate mt-1 max-w-[560px] leading-relaxed">
              {Math.abs(totals.difference) < 0.005
                ? "These balance on their own, so nothing goes to Opening Balance Equity."
                : totals.difference > 0
                  ? <>{money(totals.difference)} will be credited to <strong className="text-ink">Opening Balance Equity</strong>, which is the net worth you are bringing in.</>
                  : <>{money(Math.abs(totals.difference))} will be debited to <strong className="text-ink">Opening Balance Equity</strong>, meaning the business starts with negative net worth. Worth checking before you commit.</>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-[12.5px] text-slate-dark">
              <Toggle on={lock} label="Lock earlier dates" onChange={setLock} />
              Lock everything before {shortDate(asAt)}
            </label>
            {canPost && (
              <Button onClick={() => setConfirming(true)} disabled={busy || !anything}>Review and post</Button>
            )}
          </div>
        </div>
      </Card>

      {confirming && (
        <Modal
          title="Post opening balances?"
          sub="This can only be done once. Committing twice would double every balance."
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>Back</Button>
              <Button onClick={commit} disabled={busy}>{busy ? "Posting…" : "Post opening balances"}</Button>
            </>
          }
        >
          <div className="p-5 flex flex-col gap-3 text-[13px] text-slate-dark leading-relaxed">
            <div className="rounded-lg border border-border bg-surface-soft px-3.5 py-3 font-mono text-[12.5px]">
              As at {shortDate(asAt)}<br />
              Dr {money(totals.debits)} · Cr {money(totals.credits)}<br />
              {customerRows.filter((r) => r.party_id && Number(r.amount) > 0).length} customer invoice(s) ·{" "}
              {supplierRows.filter((r) => r.party_id && Number(r.amount) > 0).length} supplier bill(s)
            </div>
            <p>
              Check the figures against your last trial balance before posting. Opening entries can be
              reversed from the day book afterwards, but it is much easier to be right the first time.
            </p>
            {lock && (
              <p className="text-warning">
                Everything on or before {shortDate(asAt)} will be locked, so no entry can slip behind
                the opening position.
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- documents
function DocumentSection({
  title, sub, why, parties, partyLabel, referenceLabel, rows, setRows, asAt,
}: {
  title: string; sub: string; why: string;
  parties: { id: string; name: string }[];
  partyLabel: string; referenceLabel: string;
  rows: DocRow[];
  setRows: (fn: (r: DocRow[]) => DocRow[]) => void;
  asAt: string;
}) {
  const total = round2(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0));
  const set = (key: string, patch: Partial<DocRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs text-slate mt-0.5">{sub}</div>
        </div>
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, blankDoc(asAt)])}
          className="text-[11.5px] text-navy-hover bg-transparent border-0 cursor-pointer"
        >
          Add line
        </button>
      </div>

      {parties.length === 0 ? (
        <div className="px-5 py-8 text-center text-[13px] text-slate">
          No {partyLabel.toLowerCase()}s on file yet. Add them first, then come back.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[720px]">
              <thead>
                <tr className="bg-surface-soft">
                  <th className="th">{partyLabel}</th>
                  <th className="th">{referenceLabel}</th>
                  <th className="th">Dated</th>
                  <th className="th">Due</th>
                  <th className="th th-r w-[150px]">Outstanding</th>
                  <th className="th w-[40px]" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-border-soft">
                    <td className="td">
                      <Select value={r.party_id} onChange={(e) => set(r.key, { party_id: e.target.value })} className="py-1.5">
                        <option value="">Choose…</option>
                        {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                    </td>
                    <td className="td">
                      <Input mono value={r.reference} onChange={(e) => set(r.key, { reference: e.target.value })} className="py-1.5" placeholder="INV-0912" />
                    </td>
                    <td className="td">
                      <Input type="date" value={r.document_date} onChange={(e) => set(r.key, { document_date: e.target.value })} className="py-1.5" />
                    </td>
                    <td className="td">
                      <Input type="date" value={r.due_date} onChange={(e) => set(r.key, { due_date: e.target.value })} className="py-1.5" />
                    </td>
                    <td className="td">
                      <Input
                        mono type="number" min="0" step="0.01" value={r.amount}
                        onChange={(e) => set(r.key, { amount: e.target.value })}
                        className="py-1.5 text-right"
                      />
                    </td>
                    <td className="td text-center">
                      {rows.length > 1 && (
                        <button
                          type="button"
                          aria-label="Remove line"
                          onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                          className="text-slate hover:text-danger bg-transparent border-0 cursor-pointer text-[15px] leading-none"
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {total > 0 && (
                <tfoot>
                  <tr className="border-t border-border bg-surface-soft">
                    <td colSpan={4} className="px-4 py-2.5 text-[12.5px] font-medium">Total</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[13px] font-semibold">{money(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="px-5 py-3 border-t border-border bg-surface-soft text-[11.5px] text-slate leading-relaxed">{why}</div>
        </>
      )}
    </Card>
  );
}
