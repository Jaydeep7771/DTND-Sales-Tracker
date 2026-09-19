"use client";

// Billing and tax identity. These fields print on every invoice, so the
// card says so plainly and flags what is still missing.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Input, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { updateCustomerBilling } from "@/lib/actions";
import type { UserProfile } from "@/lib/types";

export default function BillingDetailsCard({ customer, canEdit }: { customer: UserProfile; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, start] = useTransition();
  const [form, setForm] = useState({
    company_name: customer.company_name ?? "",
    billing_address: customer.billing_address ?? "",
    ntn: customer.ntn ?? "",
    strn: customer.strn ?? "",
  });

  const missing = [
    !customer.billing_address && "billing address",
    !customer.ntn && "NTN",
    !customer.strn && "STRN",
  ].filter(Boolean) as string[];

  function save() {
    start(async () => {
      const res = await updateCustomerBilling(customer.id, form);
      if (!res.ok) return toast.push(res.error, "error");
      toast.push("Billing details updated", "success");
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="px-4 py-3.5 border-b border-border flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Billing details</div>
          <div className="text-xs text-slate mt-0.5">Printed on every invoice.</div>
        </div>
        {canEdit && !editing && <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>}
      </div>

      {editing ? (
        <div className="p-4 flex flex-col gap-3.5">
          <label className="flex flex-col gap-1.5">
            <span className="label">Company name</span>
            <Input value={form.company_name} onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">Billing address</span>
            <Textarea rows={3} value={form.billing_address} onChange={(e) => setForm((f) => ({ ...f, billing_address: e.target.value }))} placeholder="Street, area, city" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="label">NTN</span>
              <Input mono value={form.ntn} onChange={(e) => setForm((f) => ({ ...f, ntn: e.target.value }))} placeholder="0000000-0" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label">STRN</span>
              <Input mono value={form.strn} onChange={(e) => setForm((f) => ({ ...f, strn: e.target.value }))} placeholder="00-00-0000-000-00" />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      ) : (
        <div className="p-4 flex flex-col gap-3">
          {missing.length > 0 && (
            <div className="rounded-lg bg-warning-bg border border-warning-bd px-3 py-2 text-[12.5px] text-warning">
              Missing {missing.join(", ")}. Invoices will print without {missing.length === 1 ? "it" : "them"}.
            </div>
          )}
          {[
            ["Legal name", customer.company_name],
            ["Billing address", customer.billing_address],
            ["NTN", customer.ntn],
            ["STRN", customer.strn],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="label text-[10.5px]">{k}</div>
              <div className={`text-[13px] mt-1 ${v ? "text-ink" : "text-muted"} ${k === "NTN" || k === "STRN" ? "font-mono" : ""} whitespace-pre-line`}>
                {v || "Not set"}
              </div>
            </div>
          ))}
          {missing.length === 0 && <Badge tone="success">Ready for tax invoicing</Badge>}
        </div>
      )}
    </Card>
  );
}
