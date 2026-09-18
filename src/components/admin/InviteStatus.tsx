"use client";

// Per-customer invite state in the customer table: activated, or pending with
// a regenerate button that reveals a fresh link.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@/components/ui";
import { regenerateInvite } from "@/lib/actions";
import CopyLink from "./CopyLink";
import type { UserProfile } from "@/lib/types";

export default function InviteStatus({ customer }: { customer: UserProfile }) {
  const router = useRouter();
  const [link, setLink] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (customer.activated_at) return <Badge tone="success">Active</Badge>;

  return (
    <div className="flex flex-col gap-1.5 items-start">
      <div className="flex items-center gap-2">
        <Badge tone="warning">Invite pending</Badge>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(async () => { const r = await regenerateInvite(customer.id); if (r.ok) { setLink(r.data!.inviteUrl); router.refresh(); } })}>
          {busy ? "…" : link ? "New link" : "Get invite link"}
        </Button>
      </div>
      {link && <div className="w-[420px] max-w-full"><CopyLink url={link} /></div>}
    </div>
  );
}
