"use client";

// Invite acceptance: set a password (live) and go straight to the catalog.
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";
import { acceptInvite } from "@/lib/actions";

export default function AcceptInvite({ token, email, company, demo }: { token: string; email: string; company: string; demo: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!demo && password !== confirm) return setError("Passwords do not match.");
    start(async () => {
      const res = await acceptInvite(token, password);
      if (!res.ok) return setError(res.error);
      router.push("/portal?welcome=1");
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <div className="text-lg font-semibold">Welcome, {company}</div>
        <div className="text-[13px] text-slate mt-1">
          Your wholesale account is ready for <span className="font-mono">{email}</span>.{demo ? " Demo mode: no password needed, just continue." : " Choose a password to finish setting up."}
        </div>
      </div>
      {error && <p className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}
      {!demo && (
        <>
          <Field label="Password"><Input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="Confirm password"><Input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        </>
      )}
      <div className="bg-info-bg border border-info-bd rounded-lg p-[11px] text-xs text-info">
        Once inside you can browse the full catalog, add items to your cart, submit orders for approval and track every order&apos;s status.
      </div>
      <Button size="lg" type="submit" disabled={busy}>{busy ? "Setting up…" : "Continue to the catalog"}</Button>
    </form>
  );
}
