"use client";

// Onboard a customer: creates the portal account and produces a single-use
// invite link (also emailed when Resend is configured).
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Modal } from "@/components/ui";
import { onboardCustomer } from "@/lib/actions";
import CopyLink from "./CopyLink";

export default function OnboardCustomer({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await onboardCustomer({ company_name: company, email });
      if (!res.ok) return setError(res.error);
      setLink(res.data!.inviteUrl);
      router.refresh();
    });
  }

  function close() {
    setOpen(false); setLink(null); setCompany(""); setEmail(""); setError(null);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Onboard customer</Button>
      {open && (
        <Modal
          title={link ? "Invite link ready" : "Onboard customer"}
          sub={link ? "Share this link with the customer. It is single-use and lets them set a password and start ordering." : "Creates a portal account and an invite link for the customer."}
          onClose={close}
          footer={
            link ? (
              <Button type="button" onClick={close}>Done</Button>
            ) : (
              <>
                <Button variant="secondary" type="button" onClick={close}>Cancel</Button>
                <Button type="submit" form="onboard" disabled={busy}>{busy ? "Creating…" : "Create account & invite link"}</Button>
              </>
            )
          }
        >
          {link ? (
            <div className="p-5 flex flex-col gap-3.5">
              <div className="rounded-lg bg-success-bg border border-success-bd px-3 py-2 text-[13px] text-success">
                Account created for <strong>{company}</strong> ({email}).{demo ? " Demo mode: no email is sent, so copy the link below." : " An invite email has been sent if email is configured."}
              </div>
              <CopyLink url={link} />
              <div className="text-xs text-slate">Opening the link takes the customer to a page where they set their password, then straight into the catalog. You can regenerate the link from the customer list if it expires or gets lost.</div>
            </div>
          ) : (
            <form id="onboard" onSubmit={submit} className="p-5 flex flex-col gap-3.5">
              {error && <p className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}
              <Field label="Company name"><Input required value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Meezan Hardware Co." /></Field>
              <Field label="Login email"><Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="orders@company.pk" /></Field>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
