"use client";

/**
 * Accounting periods.
 *
 * Closing a period is the control that stops a figure already filed being
 * changed afterwards. Reopening is deliberately prominent rather than
 * hidden: pretending a period cannot be reopened would be false, and a
 * visible reopen that says what it allows is more honest than a hidden one.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input, Modal } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { createPeriod, setPeriodClosed } from "@/lib/settings-actions";
import { shortDate, shortDateTime } from "@/lib/format";
import type { PeriodRow } from "@/types/database";

/** Last day of the month holding `iso`, as a date string. */
function endOfMonth(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function PeriodManager({ periods, canEdit }: { periods: PeriodRow[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<{ period: PeriodRow; closing: boolean } | null>(null);

  // Defaults to last month, which is what finance is almost always closing.
  const lastMonth = new Date();
  lastMonth.setUTCDate(1);
  lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
  const defaultStart = lastMonth.toISOString().slice(0, 10);

  const [form, setForm] = useState({
    name: `${MONTHS[lastMonth.getUTCMonth()]} ${lastMonth.getUTCFullYear()}`,
    starts_on: defaultStart,
    ends_on: endOfMonth(defaultStart),
  });

  function add() {
    start(async () => {
      const res = await createPeriod(form);
      if (!res.ok) return toast.push(res.error, "error");
      toast.push(`${form.name} added`, "success");
      setAdding(false);
      router.refresh();
    });
  }

  function toggle(period: PeriodRow, closing: boolean) {
    start(async () => {
      const res = await setPeriodClosed(period.id, closing);
      if (!res.ok) return toast.push(res.error, "error");
      toast.push(closing ? `${period.name} closed` : `${period.name} reopened`, closing ? "success" : "info");
      setConfirming(null);
      router.refresh();
    });
  }

  return (
    <>
      <Card className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Accounting periods</div>
            <div className="text-xs text-slate mt-0.5">
              Closing a period blocks any further posting into it, including corrections.
            </div>
          </div>
          {canEdit && <Button size="sm" onClick={() => setAdding(true)}>Add period</Button>}
        </div>

        {periods.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="text-[13px] text-slate">No periods defined, so nothing is locked.</div>
            <div className="text-[12px] text-muted mt-1.5 max-w-[460px] mx-auto">
              Add one for each month you have filed. Until a period is closed, an entry can be
              backdated into a month you have already reported.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[560px]">
              <thead>
                <tr className="bg-surface-soft">
                  <th className="th px-5">Period</th>
                  <th className="th px-3">From</th>
                  <th className="th px-3">To</th>
                  <th className="th px-3">Status</th>
                  <th className="th th-r px-5">Action</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id} className="border-t border-border-soft">
                    <td className="px-5 py-3 text-[13.5px] font-medium">{p.name}</td>
                    <td className="px-3 py-3 text-[12.5px] text-slate-strong whitespace-nowrap">{shortDate(p.starts_on)}</td>
                    <td className="px-3 py-3 text-[12.5px] text-slate-strong whitespace-nowrap">{shortDate(p.ends_on)}</td>
                    <td className="px-3 py-3">
                      {p.closed_at ? (
                        <div className="flex flex-col gap-1">
                          <Badge tone="success">Closed</Badge>
                          <span className="text-[11px] text-slate">{shortDateTime(p.closed_at)}</span>
                        </div>
                      ) : (
                        <Badge tone="warning">Open</Badge>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {canEdit && (
                        <Button
                          size="sm"
                          variant={p.closed_at ? "destructive" : "secondary"}
                          disabled={busy}
                          onClick={() => setConfirming({ period: p, closing: !p.closed_at })}
                        >
                          {p.closed_at ? "Reopen" : "Close"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {adding && (
        <Modal
          title="Add an accounting period"
          sub="Periods cannot overlap, so that whether a date is closed always has one answer."
          onClose={() => setAdding(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAdding(false)} disabled={busy}>Cancel</Button>
              <Button onClick={add} disabled={busy}>{busy ? "Adding…" : "Add period"}</Button>
            </>
          }
        >
          <div className="p-5 grid gap-3.5 grid-cols-1 sm:grid-cols-2">
            <Field label="Name" className="sm:col-span-2">
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="From">
              <Input
                type="date" value={form.starts_on}
                onChange={(e) => setForm((f) => ({ ...f, starts_on: e.target.value, ends_on: endOfMonth(e.target.value) }))}
              />
            </Field>
            <Field label="To">
              <Input type="date" value={form.ends_on} onChange={(e) => setForm((f) => ({ ...f, ends_on: e.target.value }))} />
            </Field>
          </div>
        </Modal>
      )}

      {confirming && (
        <Modal
          title={confirming.closing ? `Close ${confirming.period.name}?` : `Reopen ${confirming.period.name}?`}
          sub={
            confirming.closing
              ? "Nothing can be posted into these dates afterwards, including reversals and corrections."
              : "Postings into these dates become possible again, which can change a figure you have already reported."
          }
          onClose={() => setConfirming(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(null)} disabled={busy}>Cancel</Button>
              <Button
                variant={confirming.closing ? "primary" : "destructive"}
                disabled={busy}
                onClick={() => toggle(confirming.period, confirming.closing)}
              >
                {busy ? "Working…" : confirming.closing ? "Close period" : "Reopen period"}
              </Button>
            </>
          }
        >
          <div className="p-5 text-[13px] text-slate-dark leading-relaxed">
            {confirming.closing ? (
              <>
                Check the trial balance and the sales tax figures for{" "}
                <strong className="text-ink">{confirming.period.name}</strong> before closing. A mistake found
                afterwards has to be corrected in a later period, which is the normal treatment but changes
                which month the correction lands in.
              </>
            ) : (
              <>
                Reopening is sometimes necessary, but if{" "}
                <strong className="text-ink">{confirming.period.name}</strong> has already been filed, a change
                now will put your books out of step with the return. Prefer a correcting entry in the current period.
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
