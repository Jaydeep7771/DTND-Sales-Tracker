"use client";

/**
 * Whether this customer can sign in, and the state of their invite.
 *
 * Kept distinct from credit control on the same page, because the two get
 * confused: a credit hold leaves them in the portal looking at their
 * history and unable to order, while suspension closes the door. Using
 * the wrong one either locks out a good customer over a late payment or
 * leaves a former one browsing your wholesale prices.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Modal, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import CopyLink from "./CopyLink";
import { reissueInvite, setAccountActive } from "@/lib/access-actions";
import { shortDateTime } from "@/lib/format";
import type { UserProfile } from "@/lib/types";

export default function AccountAccessCard({ customer, canEdit }: { customer: UserProfile; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [suspending, setSuspending] = useState(false);
  const [reason, setReason] = useState("");
  const [link, setLink] = useState<{ url: string; sent: boolean } | null>(null);

  const expired = !!customer.invite_expires_at && customer.invite_expires_at < new Date().toISOString();
  const awaiting = !customer.activated_at;

  function suspend() {
    start(async () => {
      const res = await setAccountActive(customer.id, false, reason);
      if (!res.ok) return toast.push(res.error, "error");
      toast.push("Access suspended", "info");
      setSuspending(false);
      router.refresh();
    });
  }

  function restore() {
    start(async () => {
      const res = await setAccountActive(customer.id, true, "");
      if (!res.ok) return toast.push(res.error, "error");
      toast.push("Access restored", "success");
      router.refresh();
    });
  }

  function resend() {
    start(async () => {
      const res = await reissueInvite(customer.id);
      if (!res.ok) return toast.push(res.error, "error");
      setLink({ url: res.data!.url, sent: res.data!.sent });
      router.refresh();
    });
  }

  return (
    <>
      <Card>
        <div className="px-4 py-3.5 border-b border-border flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Sign-in access</div>
            <div className="text-xs text-slate mt-0.5">Whether they can get into the portal at all.</div>
          </div>
          {customer.is_active
            ? <Badge tone={awaiting ? "info" : "success"}>{awaiting ? "Invited" : "Active"}</Badge>
            : <Badge tone="danger">Suspended</Badge>}
        </div>

        <div className="p-4 flex flex-col gap-3">
          {!customer.is_active && (
            <div className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2.5">
              <div className="text-[12.5px] text-danger font-medium">Cannot sign in</div>
              {customer.suspend_reason && <div className="text-[11.5px] text-danger mt-1">{customer.suspend_reason}</div>}
              {customer.suspended_at && <div className="text-[11px] text-danger/80 mt-1">Since {shortDateTime(customer.suspended_at)}</div>}
            </div>
          )}

          {customer.is_active && awaiting && (
            <div className={`rounded-lg px-3 py-2.5 border ${expired ? "bg-warning-bg border-warning-bd" : "bg-info-bg border-info-bd"}`}>
              <div className={`text-[12.5px] font-medium ${expired ? "text-warning" : "text-info"}`}>
                {expired ? "Invite link has expired" : "Invite sent, not yet accepted"}
              </div>
              <div className={`text-[11.5px] mt-1 ${expired ? "text-warning" : "text-info"}`}>
                {customer.invite_expires_at
                  ? expired
                    ? `Expired ${shortDateTime(customer.invite_expires_at)}. Issue a new one.`
                    : `Valid until ${shortDateTime(customer.invite_expires_at)}.`
                  : "This invite predates expiry being enforced, so it still works."}
              </div>
            </div>
          )}

          {customer.is_active && !awaiting && (
            <div className="text-[12.5px] text-slate">
              Activated {customer.activated_at ? shortDateTime(customer.activated_at) : "—"}. They can reset their own
              password from the sign-in page, so there is no need to re-invite them.
            </div>
          )}

          {canEdit && (
            <div className="flex gap-2 flex-wrap">
              {awaiting && customer.is_active && (
                <Button variant="secondary" size="sm" disabled={busy} onClick={resend}>
                  {expired ? "Issue a new link" : "Resend invite"}
                </Button>
              )}
              {customer.is_active ? (
                <Button variant="destructive" size="sm" disabled={busy} onClick={() => { setSuspending(true); setReason(""); }}>
                  Suspend access
                </Button>
              ) : (
                <Button size="sm" disabled={busy} onClick={restore}>Restore access</Button>
              )}
            </div>
          )}
        </div>
      </Card>

      {suspending && (
        <Modal
          title={`Suspend ${customer.company_name ?? customer.email}?`}
          sub="They are signed out immediately and cannot sign in again until you restore it."
          onClose={() => setSuspending(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setSuspending(false)} disabled={busy}>Cancel</Button>
              <Button variant="destructive" onClick={suspend} disabled={busy || !reason.trim()}>
                {busy ? "Suspending…" : "Suspend access"}
              </Button>
            </>
          }
        >
          <div className="p-5 flex flex-col gap-3">
            <Field label="Reason">
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Account closed at the customer's request." />
            </Field>
            <p className="text-[11.5px] text-slate leading-relaxed">
              If you only want to stop them ordering while they settle an overdue invoice, use the credit
              hold above instead. That leaves them able to sign in and see their account.
            </p>
          </div>
        </Modal>
      )}

      {link && (
        <Modal
          title="New invite link"
          sub={link.sent ? "Emailed to them. It expires in seven days." : "Email is not configured, so send this yourself. It expires in seven days."}
          onClose={() => setLink(null)}
          footer={<Button onClick={() => setLink(null)}>Done</Button>}
        >
          <div className="p-5"><CopyLink url={link.url} /></div>
        </Modal>
      )}
    </>
  );
}
