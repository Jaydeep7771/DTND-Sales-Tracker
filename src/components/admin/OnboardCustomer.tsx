"use client";

// Onboard a customer: creates the auth user and emails temporary credentials.
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Modal } from "@/components/ui";
import { onboardCustomer } from "@/lib/actions";

export default function OnboardCustomer({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, start] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    setResult(null);
    start(async () => {
      const res = await onboardCustomer({ company_name: company, email });
      if (!res.ok) return setResult({ ok: false, msg: res.error });
      setResult({ ok: true, msg: `Account created. Temporary password: ${res.data!.tempPassword}${demo ? " (demo: no email sent)" : " — emailed to the customer."}` });
      setCompany(""); setEmail("");
      router.refresh();
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Onboard customer</Button>
      {open && (
        <Modal
          title="Onboard customer"
          sub="Creates a portal login and sends a welcome email with temporary credentials."
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Close</Button>
              <Button type="submit" form="onboard" disabled={busy}>{busy ? "Creating…" : "Create account"}</Button>
            </>
          }
        >
          <form id="onboard" onSubmit={submit} className="p-5 flex flex-col gap-3.5">
            {result && <p className={`rounded-lg border px-3 py-2 text-[13px] ${result.ok ? "bg-success-bg border-success-bd text-success" : "bg-danger-bg border-danger-bd text-danger"}`}>{result.msg}</p>}
            <Field label="Company name"><Input required value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Meezan Hardware Co." /></Field>
            <Field label="Login email"><Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="orders@company.pk" /></Field>
          </form>
        </Modal>
      )}
    </>
  );
}
