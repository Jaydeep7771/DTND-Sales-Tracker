"use client";

/**
 * Credit limit, hold and terms for one customer.
 *
 * Kept separate from billing details because it is a different decision
 * made by a different person: billing identity is data entry, credit is a
 * commercial judgement that stops orders being approved.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Input, Select, Toggle } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { updateCustomerCredit } from "@/lib/actions";
import { money } from "@/lib/format";
import { currencyPrefix } from "@/lib/money";
import type { UserProfile } from "@/lib/types";

export default function CreditControlCard({
  customer, outstanding, worstDaysPastDue, canEdit, defaultTerms,
}: {
  customer: UserProfile;
  outstanding: number;
  worstDaysPastDue: number;
  canEdit: boolean;
  defaultTerms: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, start] = useTransition();
  const [form, setForm] = useState({
    credit_limit: String(customer.credit_limit ?? 0),
    credit_hold: Boolean(customer.credit_hold),
    payment_terms_days: customer.payment_terms_days === null || customer.payment_terms_days === undefined
      ? "" : String(customer.payment_terms_days),
  });

  const limit = Number(customer.credit_limit ?? 0);
  const used = limit > 0 ? Math.min(100, Math.round((outstanding / limit) * 100)) : 0;
  const headroom = limit > 0 ? limit - outstanding : null;

  function save() {
    start(async () => {
      const res = await updateCustomerCredit(customer.id, {
        credit_limit: Number(form.credit_limit) || 0,
        credit_hold: form.credit_hold,
        payment_terms_days: form.payment_terms_days === "" ? null : Number(form.payment_terms_days),
      });
      if (!res.ok) return toast.push(res.error, "error");
      toast.push("Credit terms updated", "success");
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="px-4 py-3.5 border-b border-border flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Credit control</div>
          <div className="text-xs text-slate mt-0.5">Checked every time an order is approved.</div>
        </div>
        {canEdit && !editing && <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>}
      </div>

      {editing ? (
        <div className="p-4 flex flex-col gap-3.5">
          <label className="flex flex-col gap-1.5">
            <span className="label">Credit limit ({currencyPrefix()})</span>
            <Input
              mono type="number" min="0" step="1000"
              value={form.credit_limit}
              onChange={(e) => setForm((f) => ({ ...f, credit_limit: e.target.value }))}
            />
            <span className="text-[11.5px] text-slate">Zero means no limit, not a limit of zero.</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">Payment terms</span>
            <Select
              value={form.payment_terms_days}
              onChange={(e) => setForm((f) => ({ ...f, payment_terms_days: e.target.value }))}
            >
              <option value="">Company default (Net {defaultTerms})</option>
              {[0, 7, 15, 30, 45, 60, 90].map((d) => (
                <option key={d} value={d}>{d === 0 ? "Due on receipt" : `Net ${d}`}</option>
              ))}
            </Select>
          </label>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <div>
              <div className="text-[13px] font-medium">Credit hold</div>
              <div className="text-[11.5px] text-slate mt-0.5">Blocks approval regardless of the limit.</div>
            </div>
            <Toggle on={form.credit_hold} label="Credit hold" onChange={(v) => setForm((f) => ({ ...f, credit_hold: v }))} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      ) : (
        <div className="p-4 flex flex-col gap-3">
          {customer.credit_hold && (
            <div className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[12.5px] text-danger">
              On credit hold. New orders cannot be approved.
            </div>
          )}

          {limit > 0 ? (
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="label text-[10.5px]">Exposure</span>
                <span className="font-mono text-[12.5px]">{money(outstanding)} of {money(limit)}</span>
              </div>
              {/* A bar, because "72% of limit" is read faster than two numbers. */}
              <div className="h-2 rounded-full bg-surface-softer mt-2 overflow-hidden">
                <div
                  className={`h-full rounded-full ${used >= 100 ? "bg-danger" : used >= 90 ? "bg-warning" : "bg-success"}`}
                  style={{ width: `${Math.max(2, used)}%` }}
                />
              </div>
              <div className="text-[11.5px] text-slate mt-1.5">
                {headroom !== null && headroom > 0
                  ? `${money(headroom)} of headroom left.`
                  : "Limit reached. Further orders will be refused at approval."}
              </div>
            </div>
          ) : (
            <div>
              <div className="label text-[10.5px]">Credit limit</div>
              <div className="text-[13px] text-muted mt-1">No limit set</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="label text-[10.5px]">Payment terms</div>
              <div className="text-[13px] mt-1">
                {customer.payment_terms_days === null || customer.payment_terms_days === undefined
                  ? `Net ${defaultTerms} (company default)`
                  : customer.payment_terms_days === 0 ? "Due on receipt" : `Net ${customer.payment_terms_days}`}
              </div>
            </div>
            <div>
              <div className="label text-[10.5px]">Oldest debt</div>
              <div className={`text-[13px] mt-1 ${worstDaysPastDue > 60 ? "text-danger font-semibold" : worstDaysPastDue > 0 ? "text-warning" : ""}`}>
                {outstanding <= 0 ? "Nothing outstanding"
                  : worstDaysPastDue > 0 ? `${worstDaysPastDue} days past due` : "Within terms"}
              </div>
            </div>
          </div>

          {!customer.credit_hold && limit === 0 && outstanding > 0 && (
            <Badge tone="info">Unlimited credit · set a limit to enable the check</Badge>
          )}
        </div>
      )}
    </Card>
  );
}
