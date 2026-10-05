"use client";

/**
 * Month-end statements, and the aged debtors export.
 *
 * The run only emails accounts that owe something. A statement reading
 * "you owe nothing" has its place, but thirty of them in one batch is
 * how a sender gets filtered to junk, and the accounts that matter go
 * with it. Any individual account can still be sent from its own page.
 */
import { useState, useTransition } from "react";
import { Button, Card, Field, Input, Modal } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { runStatements, type StatementRunRow } from "@/lib/statement-actions";
import { exportHref } from "@/lib/export-links";
import { money, num } from "@/lib/format";

export default function StatementRun({ canSend }: { canSend: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[12.5px] text-slate">
          Send every account that owes something its statement, or take the schedule for your accountant.
        </div>
        <div className="flex gap-2">
          <a
            href={exportHref("aged-debtors", {})}
            className="text-[12.5px] font-medium rounded-[7px] px-3 py-1.5 border border-border bg-surface no-underline hover:border-accent"
          >
            Export aged debtors
          </a>
          {canSend && <Button size="sm" onClick={() => setOpen(true)}>Send statements</Button>}
        </div>
      </Card>
      {open && <RunModal onClose={() => setOpen(false)} />}
    </>
  );
}

function RunModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [busy, start] = useTransition();
  const [rows, setRows] = useState<StatementRunRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Three months to today, which is the window a buyer can reconcile.
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [from, setFrom] = useState(iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1))));
  const [to, setTo] = useState(iso(now));

  return (
    <Modal
      title="Send statements"
      sub="One email per account with an outstanding balance, with the statement attached as a PDF. Accounts that are square are skipped."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Close</Button>
          <Button
            disabled={busy}
            onClick={() => start(async () => {
              setError(null);
              const res = await runStatements(from, to);
              if (!res.ok) return setError(res.error);
              setRows(res.data!.rows);
              const sent = res.data!.rows.filter((r) => r.sent).length;
              toast.push(
                sent ? `${sent} statement${sent === 1 ? "" : "s"} emailed.` : "Nothing was sent — check the mail provider.",
                sent ? "success" : "info",
              );
            })}
          >
            {busy ? "Sending…" : "Send"}
          </Button>
        </>
      }
    >
      <div className="p-5 flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Period from"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Period to"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>

        {error && <div className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</div>}

        {rows && (
          <div className="border border-border rounded-lg overflow-hidden max-h-[280px] overflow-y-auto">
            {rows.map((r) => (
              <div key={r.customerId} className="px-3 py-2 border-b border-border-soft last:border-0 flex items-center justify-between gap-3">
                <span className="text-[13px] font-medium">{r.company}</span>
                <span className="text-right">
                  <span className="font-mono text-[12px] mr-3">{money(r.due)}</span>
                  <span className={`text-[12px] ${r.sent ? "text-success" : "text-danger"}`}>
                    {r.sent ? "sent" : r.reason ?? "not sent"}
                  </span>
                </span>
              </div>
            ))}
            <div className="px-3 py-2 bg-surface-softer text-[12px] text-slate">
              {num(rows.filter((r) => r.sent).length)} of {num(rows.length)} sent.
            </div>
          </div>
        )}

        <div className="text-[12px] text-slate">
          Each statement shows the opening balance, everything that moved it, the closing balance and
          the age of what is still open. The customer can also pull it themselves from the portal at
          any time.
        </div>
      </div>
    </Modal>
  );
}
