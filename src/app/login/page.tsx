"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";
import { signIn } from "@/lib/actions";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await signIn(email, password);
      if (!res.ok) return setError(res.error);
      router.push(res.data!.role === "admin" ? "/admin" : "/portal");
    });
  }

  return (
    <div className="flex-1 flex items-center justify-center bg-sidebar p-6">
      <form onSubmit={submit} className="bg-surface rounded-xl w-full max-w-[400px] p-7 flex flex-col gap-4 shadow-[0_24px_60px_rgba(15,27,43,.35)]">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-navy text-white flex items-center justify-center font-mono font-semibold">DT</div>
          <div className="leading-[1.15]">
            <div className="text-[15px] font-semibold">Dynamic Traders &amp; Distributors</div>
            <div className="text-[10.5px] tracking-[.09em] uppercase text-slate">Wholesale portal</div>
          </div>
        </div>
        <div className="text-[13px] text-slate">Sign in with the credentials emailed to you when your account was created.</div>
        {error && <p className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Field label="Email"><Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><Input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button size="lg" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
      </form>
    </div>
  );
}
