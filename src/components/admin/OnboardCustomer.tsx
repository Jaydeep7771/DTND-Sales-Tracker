"use client";

// Onboard a customer: creates the portal account, generates a single-use
// invite link and emails it. The modal then shows the link, delivery status
// and a preview of the email.
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Modal } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { onboardCustomer, type InviteResult } from "@/lib/actions";
import InvitePanel from "./InvitePanel";

export default function OnboardCustomer() {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [busy, start] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await onboardCustomer({ company_name: company, email });
      if (!res.ok) return setError(res.error);
      setResult(res.data!);
      toast.push(res.data!.email.sent ? `Invite emailed to ${res.data!.email.to}` : `${company.trim()} created. Email not sent, copy the link.`, res.data!.email.sent ? "success" : "info");
      router.refresh();
    });
  }

  function close() {
    setOpen(false); setResult(null); setCompany(""); setEmail(""); setError(null);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Onboard customer</Button>
      {open && (
        <Modal
          title={result ? `Invite ready for ${company.trim()}` : "Onboard customer"}
          sub={result ? "The link is single-use. It lets the customer set a password and go straight to the catalog." : "Creates a portal account and emails the customer a single-use invite link."}
          onClose={close}
          footer={
            result ? (
              <Button type="button" onClick={close}>Done</Button>
            ) : (
              <>
                <Button variant="secondary" type="button" onClick={close}>Cancel</Button>
                <Button type="submit" form="onboard" disabled={busy}>{busy ? "Creating…" : "Create account & send invite"}</Button>
              </>
            )
          }
        >
          {result ? (
            <div className="p-5"><InvitePanel result={result} /></div>
          ) : (
            <form id="onboard" onSubmit={submit} className="p-5 flex flex-col gap-3.5">
              {error && <p className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}
              <Field label="Company name"><Input required value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Meezan Hardware Co." /></Field>
              <Field label="Login email"><Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="orders@company.pk" /></Field>
              <div className="text-xs text-slate">The customer receives a welcome email with the activation link. You can also copy the link from the next screen or from the customer list at any time.</div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
