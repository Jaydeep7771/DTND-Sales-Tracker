"use client";

// Per-customer invite state in the customer table. Pending invites show the
// live link with copy/open, plus "Resend email" and "New link".
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { regenerateInvite, resendInvite, type InviteResult } from "@/lib/actions";
import CopyLink from "./CopyLink";
import InvitePanel from "./InvitePanel";
import { shortDateTime } from "@/lib/format";
import type { UserProfile } from "@/lib/types";

export default function InviteStatus({ customer, inviteUrl }: { customer: UserProfile; inviteUrl: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [result, setResult] = useState<InviteResult | null>(null);
  const [busy, start] = useTransition();

  if (customer.activated_at) {
    return (
      <div className="flex flex-col gap-0.5 items-start">
        <Badge tone="success">Active</Badge>
        <span className="text-[10.5px] text-muted">since {shortDateTime(customer.activated_at)}</span>
      </div>
    );
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string; data?: InviteResult }>, label: string) {
    start(async () => {
      const r = await fn();
      if (!r.ok || !r.data) return toast.push(r.error ?? "Failed", "error");
      setResult(r.data);
      toast.push(r.data.email.sent ? `${label}: email sent to ${r.data.email.to}` : `${label}: link ready (email not sent)`, r.data.email.sent ? "success" : "info");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 items-start min-w-[320px] max-w-[460px]">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge tone="warning">Invite pending</Badge>
        {customer.invited_at && <span className="text-[10.5px] text-muted">sent {shortDateTime(customer.invited_at)}</span>}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => resendInvite(customer.id), "Resent")}>Resend email</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => regenerateInvite(customer.id), "New link")}>New link</Button>
      </div>
      {result ? <InvitePanel result={result} compact /> : inviteUrl && <CopyLink url={inviteUrl} />}
    </div>
  );
}
