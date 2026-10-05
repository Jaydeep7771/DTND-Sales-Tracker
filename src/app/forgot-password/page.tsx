"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@/components/ui";
import { requestPasswordReset } from "@/lib/access-actions";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, start] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await requestPasswordReset(email);
      if (!res.ok) return setError(res.error);
      setSent(true);
    });
  }

  return (
    <div className="flex-1 flex items-center justify-center bg-sidebar p-6">
      <div className="bg-surface rounded-xl w-full max-w-[400px] p-7 flex flex-col gap-4 shadow-[0_24px_60px_rgba(15,27,43,.35)]">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-navy text-white flex items-center justify-center font-mono font-semibold">DT</div>
          <div className="leading-[1.15]">
            <div className="text-[15px] font-semibold">Reset your password</div>
            <div className="text-[10.5px] tracking-[.09em] uppercase text-slate">Wholesale portal</div>
          </div>
        </div>

        {sent ? (
          <>
            {/* Always the same message, whether or not the address is
                registered. Confirming which emails have accounts would
                hand a stranger a list of customers. */}
            <p className="text-[13px] text-slate-dark leading-relaxed">
              If <span className="text-ink">{email}</span> has an account with us, a reset link is on its way.
              It is valid for one hour.
            </p>
            <p className="text-[12.5px] text-slate">
              Nothing arrived? Check spam, or call the office and we will sort it out.
            </p>
            <Link href="/login" className="text-[13px] text-navy-hover no-underline">Back to sign in</Link>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <p className="text-[13px] text-slate">
              Enter the email you sign in with and we will send you a link to set a new password.
            </p>
            {error && <p role="alert" className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}
            <Field label="Email">
              <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button size="lg" type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</Button>
            <Link href="/login" className="text-[12.5px] text-slate no-underline hover:text-navy-hover text-center">Back to sign in</Link>
          </form>
        )}
      </div>
    </div>
  );
}
