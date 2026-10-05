"use client";

/**
 * Statement for one account.
 *
 * The range defaults to the last three months, which is what a buyer can
 * actually reconcile in one sitting. Longer than that and it stops being
 * a statement and becomes a ledger, which is what the customer's own
 * ledger tab already is.
 */
import { useState, useTransition } from "react";
import { Button, Card, Input } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { sendStatement } from "@/lib/statement-actions";
import { exportHref } from "@/lib/export-links";
import { money, shortDateTime } from "@/lib/format";
import type { UserProfile } from "@/lib/types";

function defaults(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)).toISOString().slice(0, 10);
  return { from, to };
}

export default function StatementCard({
  customer, outstanding, canSend,
}: {
  customer: UserProfile;
  outstanding: number;
  canSend: boolean;
}) {
  const d = defaults();
  const [from, setFrom] = useState(d.from);
  const [to, setTo] = useState(d.to);
  const [busy, start] = useTransition();
  const toast = useToast();

  const q = { from, to, customer: customer.id };

  return (
    <Card>
      <div className="px-4 py-3.5 border-b border-border flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">Account statement</div>
        <span className="font-mono text-[13px] font-semibold">{money(outstanding)}</span>
      </div>

      <div className="px-4 py-3.5 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1.5">
            <span className="label">From</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">To</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>

        <div className="flex gap-2 flex-wrap">
          <a href={`/api/statements/${customer.id}/pdf?from=${from}&to=${to}`} target="_blank" rel="noreferrer">
            <Button variant="secondary" size="sm">View PDF</Button>
          </a>
          <a href={exportHref("statement", q)}>
            <Button variant="secondary" size="sm">CSV</Button>
          </a>
          {canSend && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => start(async () => {
                const res = await sendStatement(customer.id, from, to);
                if (!res.ok) return toast.push(res.error, "error");
                toast.push(
                  res.data!.sent ? `Emailed to ${res.data!.to}` : `Not sent: ${res.data!.reason}`,
                  res.data!.sent ? "success" : "info",
                );
              })}
            >
              {busy ? "Sending…" : "Email statement"}
            </Button>
          )}
        </div>

        <div className="text-[11.5px] text-slate leading-[1.5]">
          {customer.statement_sent_at
            ? <>Last sent {shortDateTime(customer.statement_sent_at)} to {customer.statement_sent_to}.</>
            : <>Never sent. The customer can also download it themselves from the portal.</>}
        </div>
      </div>
    </Card>
  );
}
