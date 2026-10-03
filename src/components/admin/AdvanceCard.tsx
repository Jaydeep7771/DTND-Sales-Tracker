"use client";

/**
 * Money held on account, and tax the customer has deducted at source.
 *
 * Both are positions read from the ledger rather than stored totals, so
 * they cannot drift away from the balance sheet. The card only appears
 * when there is something to say.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Input, Modal } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { applyAdvance } from "@/lib/invoice-actions";
import { allocateOldestFirst, round2 } from "@/lib/accounting";
import { money, shortDate } from "@/lib/format";
import type { InvoiceView } from "@/lib/types";

export default function AdvanceCard({
  customerId, advance, withheld, openInvoices, canApply,
}: {
  customerId: string;
  advance: number;
  withheld: number;
  openInvoices: InvoiceView[];
  canApply: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [applying, setApplying] = useState(false);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [alloc, setAlloc] = useState<Record<string, number>>(() => allocateOldestFirst(openInvoices, advance));

  const applied = useMemo(() => round2(Object.values(alloc).reduce((a, b) => a + (b || 0), 0)), [alloc]);
  const canSubmit = applied > 0 && applied <= advance + 0.005;

  if (advance <= 0.005 && withheld <= 0.005) return null;

  function submit() {
    setError(null);
    start(async () => {
      const res = await applyAdvance(
        customerId,
        Object.entries(alloc).map(([invoice_id, amount]) => ({ invoice_id, amount })),
      );
      if (!res.ok) return setError(res.error);
      toast.push(`${money(res.data!.applied)} applied from the advance`, "success");
      setApplying(false);
      router.refresh();
    });
  }

  return (
    <>
      <Card>
        <div className="px-4 py-3.5 border-b border-border flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">On account</div>
            <div className="text-xs text-slate mt-0.5">Read from the ledger, not a stored total.</div>
          </div>
          {canApply && advance > 0.005 && openInvoices.length > 0 && (
            <Button size="sm" onClick={() => { setAlloc(allocateOldestFirst(openInvoices, advance)); setApplying(true); }}>
              Apply
            </Button>
          )}
        </div>

        <div className="p-4 flex flex-col gap-3.5">
          {advance > 0.005 && (
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="label text-[10.5px]">Advance held</span>
                <span className="font-mono text-[15px] font-semibold text-success">{money(advance)}</span>
              </div>
              <div className="text-[11.5px] text-slate mt-1">
                A liability: the business owes this customer goods or a refund until it is applied.
                {openInvoices.length === 0 && " Nothing is outstanding to apply it to right now."}
              </div>
            </div>
          )}

          {withheld > 0.005 && (
            <div className={advance > 0.005 ? "pt-3 border-t border-border-soft" : ""}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="label text-[10.5px]">Tax withheld at source</span>
                <span className="font-mono text-[15px] font-semibold">{money(withheld)}</span>
              </div>
              <div className="text-[11.5px] text-slate mt-1">
                Already paid to the government on the business&apos;s behalf. Recoverable against its own
                tax liability, so keep the customer&apos;s deduction certificates.
              </div>
            </div>
          )}
        </div>
      </Card>

      {applying && (
        <Modal
          title="Apply the advance"
          sub="No cash moves: it arrived when the advance was taken. This clears the receivable against the money already held."
          onClose={() => setApplying(false)}
          wide
          footer={
            <>
              <Button variant="secondary" onClick={() => setApplying(false)} disabled={busy}>Cancel</Button>
              <Button onClick={submit} disabled={busy || !canSubmit}>
                {busy ? "Applying…" : `Apply ${money(applied)}`}
              </Button>
            </>
          }
        >
          <div className="p-5 flex flex-col gap-3.5">
            {error && <p role="alert" className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}

            <div className="border border-border rounded-lg overflow-x-auto">
              <table className="w-full border-collapse min-w-[460px]">
                <thead>
                  <tr className="bg-surface-soft">
                    <th className="th">Invoice</th>
                    <th className="th">Due</th>
                    <th className="th th-r">Outstanding</th>
                    <th className="th th-r w-[140px]">Apply</th>
                  </tr>
                </thead>
                <tbody>
                  {openInvoices.map((i) => (
                    <tr key={i.id} className="border-t border-border-soft">
                      <td className="td font-mono text-[12.5px] text-navy-hover">{i.invoice_number}</td>
                      <td className="td text-[12.5px] text-slate-strong">{i.due_date ? shortDate(i.due_date) : "—"}</td>
                      <td className="td font-mono text-right text-[12.5px]">{money(i.balance)}</td>
                      <td className="td text-right">
                        <Input
                          mono type="number" min="0" step="0.01"
                          aria-label={`Apply to ${i.invoice_number}`}
                          value={alloc[i.id] ?? ""}
                          onChange={(e) => setAlloc((s) => ({ ...s, [i.id]: Math.max(0, Number(e.target.value) || 0) }))}
                          className="w-[110px] text-right py-1.5"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3">
              <Badge tone={applied > advance + 0.005 ? "danger" : "info"}>
                {applied > advance + 0.005
                  ? `Over the ${money(advance)} held`
                  : `${money(round2(advance - applied))} would remain on account`}
              </Badge>
              <span className="font-mono text-[12.5px]">{money(applied)} of {money(advance)}</span>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
