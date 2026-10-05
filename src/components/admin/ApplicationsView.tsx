"use client";

/**
 * The application review queue.
 *
 * Everything the reviewer needs is on the card, because the decision is
 * "do I want this business as a customer" and that is answered from what
 * they told us, not from a second screen.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Modal, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import CopyLink from "./CopyLink";
import { approveApplication, rejectApplication } from "@/lib/registration-actions";
import { shortDateTime } from "@/lib/format";
import type { BadgeTone } from "@/components/ui";
import type { CustomerApplication } from "@/types/database";

const TONE: Record<string, BadgeTone> = { pending: "warning", approved: "success", rejected: "danger" };
const LABEL: Record<string, string> = { pending: "Awaiting review", approved: "Approved", rejected: "Declined" };

export default function ApplicationsView({
  applications, canReview,
}: {
  applications: CustomerApplication[];
  canReview: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [rejecting, setRejecting] = useState<CustomerApplication | null>(null);
  const [reason, setReason] = useState("");
  const [invite, setInvite] = useState<{ company: string; url: string; sent: boolean } | null>(null);

  const pending = applications.filter((a) => a.status === "pending");
  const reviewed = applications.filter((a) => a.status !== "pending");

  function approve(app: CustomerApplication) {
    start(async () => {
      const res = await approveApplication(app.id, "");
      if (!res.ok) return toast.push(res.error, "error");
      toast.push(`${app.company_name} approved`, "success");
      setInvite({ company: app.company_name, url: res.data!.inviteUrl, sent: res.data!.email.sent });
      router.refresh();
    });
  }

  function reject() {
    if (!rejecting) return;
    start(async () => {
      const res = await rejectApplication(rejecting.id, reason);
      if (!res.ok) return toast.push(res.error, "error");
      toast.push(`${rejecting.company_name} declined`, "info");
      setRejecting(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <>
      {pending.length === 0 && reviewed.length === 0 ? (
        <Card className="px-5 py-12 text-center">
          <div className="text-[13px] text-slate">No applications yet.</div>
          <div className="text-[12px] text-muted mt-1.5">
            They arrive from the public form at <span className="font-mono">/register</span>.
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {pending.length > 0 && (
            <div className="flex flex-col gap-3">
              {pending.map((a) => (
                <Card key={a.id} className="overflow-hidden">
                  <div className="px-5 py-4 flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-[15px] font-semibold">{a.company_name}</span>
                        <Badge tone={TONE[a.status]}>{LABEL[a.status]}</Badge>
                        {a.business_type && <span className="text-[11.5px] text-slate">{a.business_type}</span>}
                      </div>
                      <div className="text-[12px] text-slate mt-1">
                        Applied {shortDateTime(a.created_at)}
                        {a.years_trading !== null && ` · trading ${a.years_trading} year${a.years_trading === 1 ? "" : "s"}`}
                      </div>
                    </div>
                    {canReview && (
                      <div className="flex gap-2">
                        <Button variant="destructive" size="sm" disabled={busy} onClick={() => { setRejecting(a); setReason(""); }}>
                          Decline
                        </Button>
                        <Button variant="success" size="sm" disabled={busy} onClick={() => approve(a)}>
                          {busy ? "Working…" : "Approve and invite"}
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="px-5 pb-4 grid gap-4 grid-cols-1 sm:grid-cols-3">
                    {[
                      ["Contact", `${a.contact_name}\n${a.email}\n${a.phone}`],
                      ["Delivers to", `${a.address}\n${a.city}`],
                      ["Tax identity", a.ntn || a.strn ? `${a.ntn ? `NTN ${a.ntn}` : ""}${a.ntn && a.strn ? "\n" : ""}${a.strn ? `STRN ${a.strn}` : ""}` : "Not supplied"],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <div className="label text-[10.5px]">{label}</div>
                        <div className={`text-[12.5px] mt-1 whitespace-pre-line ${value === "Not supplied" ? "text-muted" : "text-slate-dark"}`}>
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {a.note && (
                    <div className="px-5 pb-4">
                      <div className="rounded-lg bg-surface-soft border border-border px-3.5 py-2.5 text-[12.5px] text-slate-dark">
                        {a.note}
                      </div>
                    </div>
                  )}

                  {!a.ntn && (
                    <div className="px-5 py-2.5 border-t border-border bg-warning-bg text-[11.5px] text-warning">
                      No NTN supplied. You will need it before issuing a tax invoice.
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}

          {reviewed.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border">
                <div className="text-sm font-semibold">Reviewed</div>
              </div>
              <table className="w-full border-collapse">
                <tbody>
                  {reviewed.map((a) => (
                    <tr key={a.id} className="border-t border-border-soft">
                      <td className="px-5 py-3">
                        <div className="text-[13px] font-medium">{a.company_name}</div>
                        <div className="text-[11.5px] text-slate mt-0.5">{a.email}</div>
                      </td>
                      <td className="px-5 py-3 text-[12px] text-slate max-w-[320px]">{a.review_note ?? "—"}</td>
                      <td className="px-5 py-3 text-right">
                        <Badge tone={TONE[a.status]}>{LABEL[a.status]}</Badge>
                        <div className="text-[11px] text-slate mt-1">
                          {a.reviewed_at ? shortDateTime(a.reviewed_at) : ""}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {rejecting && (
        <Modal
          title={`Decline ${rejecting.company_name}?`}
          sub="The reason is emailed to the applicant and kept on file."
          onClose={() => setRejecting(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRejecting(null)} disabled={busy}>Cancel</Button>
              <Button variant="destructive" onClick={reject} disabled={busy || !reason.trim()}>
                {busy ? "Declining…" : "Decline application"}
              </Button>
            </>
          }
        >
          <div className="p-5">
            <Field label="Reason">
              <Textarea
                rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. We do not currently open accounts outside Sindh."
              />
            </Field>
            <p className="text-[11.5px] text-slate mt-2.5 leading-relaxed">
              Write it as the applicant will read it. Somebody told plainly why does not phone the office to ask.
            </p>
          </div>
        </Modal>
      )}

      {invite && (
        <Modal
          title={`${invite.company} is now a customer`}
          sub={invite.sent ? "The invite has been emailed to them." : "Email is not configured, so send them this link yourself."}
          onClose={() => setInvite(null)}
          footer={<Button onClick={() => setInvite(null)}>Done</Button>}
        >
          <div className="p-5 flex flex-col gap-3">
            <CopyLink url={invite.url} />
            <p className="text-[12px] text-slate leading-relaxed">
              The link lets them set a password and expires in seven days. Their address and tax details
              have been copied onto the customer record, so there is nothing to retype.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
