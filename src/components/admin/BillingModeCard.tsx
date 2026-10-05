"use client";

/**
 * Per order, or once a month.
 *
 * It sits on the account rather than in settings because it is a
 * commercial arrangement with one customer, and it changes when they are
 * expected to pay: a consolidated invoice dated month-end on 30 day
 * terms gives an order placed on the 1st nearly sixty days, which is a
 * real cost and should be a deliberate choice.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, Toggle } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { setConsolidatedBilling } from "@/lib/invoice-actions";
import type { UserProfile } from "@/lib/types";

export default function BillingModeCard({ customer, canEdit }: { customer: UserProfile; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const on = Boolean(customer.consolidated_billing);

  return (
    <Card>
      <div className="px-4 py-3.5 border-b border-border flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">Billing frequency</div>
        <Badge tone={on ? "info" : "success"}>{on ? "Monthly" : "Per order"}</Badge>
      </div>
      <div className="px-4 py-3.5 flex flex-col gap-3">
        <Toggle
          on={on}
          label="Bill this account once per period"
          onChange={(next) => start(async () => {
            if (!canEdit) return;
            const res = await setConsolidatedBilling(customer.id, next);
            if (!res.ok) return toast.push(res.error, "error");
            toast.push(next ? "Now billed monthly." : "Now billed per order.", "success");
            router.refresh();
          })}
        />
        <div className="text-[12.5px] text-slate leading-[1.5]">
          {on
            ? "The monthly billing run on the Invoices screen raises one draft covering every order in the period that is not already invoiced. Orders can still be invoiced individually if something needs to go out sooner."
            : "Each approved order is invoiced on its own. Turn this on for a frequent buyer who would rather settle one invoice a month than eight."}
        </div>
        {busy && <div className="text-[11.5px] text-muted">Saving…</div>}
      </div>
    </Card>
  );
}
