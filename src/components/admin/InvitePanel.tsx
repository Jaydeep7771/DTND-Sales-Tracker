"use client";

// Shows an invite link, the email delivery status, and a preview of the
// message the customer received. Used by the onboarding modal and the
// customer list.
import { useState } from "react";
import CopyLink from "./CopyLink";
import type { InviteResult } from "@/lib/actions";

export default function InvitePanel({ result, compact }: { result: InviteResult; compact?: boolean }) {
  const [preview, setPreview] = useState(false);
  const { email } = result;
  return (
    <div className="flex flex-col gap-2.5">
      <CopyLink url={result.inviteUrl} />
      <div className={`rounded-lg border px-3 py-2 text-[12.5px] leading-[1.5] [overflow-wrap:anywhere] ${email.sent ? "bg-success-bg border-success-bd text-success" : "bg-warning-bg border-warning-bd text-warning"}`}>
        {email.sent ? (
          <>Invite email sent to <span className="font-mono">{email.to}</span>.</>
        ) : (
          <>Email not sent to <span className="font-mono">{email.to}</span>: {email.reason}</>
        )}
        {" "}
        <button type="button" onClick={() => setPreview((v) => !v)} className="bg-transparent border-0 p-0 underline cursor-pointer text-inherit font-medium">
          {preview ? "Hide email" : "View email"}
        </button>
      </div>
      {preview && (
        <div className={`border border-border rounded-lg bg-surface-soft overflow-hidden ${compact ? "max-h-[260px] overflow-y-auto" : ""}`}>
          <div className="px-3 py-2 border-b border-border text-[12px] flex flex-col gap-0.5">
            <div><span className="label text-[10px] mr-2">To</span><span className="font-mono">{email.to}</span></div>
            <div><span className="label text-[10px] mr-2">Subject</span><span className="font-medium">{email.subject}</span></div>
          </div>
          <pre className="px-3 py-3 text-[12px] leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere] font-sans text-slate-dark m-0">{email.text}</pre>
        </div>
      )}
    </div>
  );
}
