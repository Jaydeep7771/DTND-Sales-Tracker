"use client";

/**
 * Where the reset email lands.
 *
 * Supabase puts the recovery token in the URL fragment and the browser
 * client exchanges it for a session automatically, so this page waits for
 * that to happen before offering the form. Without the wait, a slow
 * exchange looks like an expired link.
 */
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Field, Input } from "@/components/ui";
import { completePasswordReset } from "@/lib/access-actions";
import { createClient } from "@/lib/supabase/client";

type Stage = "checking" | "ready" | "invalid" | "done";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    // The client fires PASSWORD_RECOVERY once it has read the fragment.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setStage("ready");
    });

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) setStage("ready");
      // Give the fragment exchange a moment before calling it invalid.
      else setTimeout(() => { if (!cancelled) setStage((s) => (s === "checking" ? "invalid" : s)); }, 2500);
    });

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError("The two passwords do not match.");
    start(async () => {
      const res = await completePasswordReset(password);
      if (!res.ok) return setError(res.error);
      setStage("done");
      setTimeout(() => router.push("/login"), 2200);
    });
  }

  return (
    <div className="flex-1 flex items-center justify-center bg-sidebar p-6">
      <div className="bg-surface rounded-xl w-full max-w-[400px] p-7 flex flex-col gap-4 shadow-[0_24px_60px_rgba(15,27,43,.35)]">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-navy text-white flex items-center justify-center font-mono font-semibold">DT</div>
          <div className="leading-[1.15]">
            <div className="text-[15px] font-semibold">Choose a new password</div>
            <div className="text-[10.5px] tracking-[.09em] uppercase text-slate">Wholesale portal</div>
          </div>
        </div>

        {stage === "checking" && <p className="text-[13px] text-slate">Checking your link…</p>}

        {stage === "invalid" && (
          <>
            <p className="text-[13px] text-slate-dark leading-relaxed">
              This reset link has expired or has already been used. Reset links last one hour.
            </p>
            <Link href="/forgot-password" className="text-[13px] text-navy-hover no-underline">Ask for a new one</Link>
          </>
        )}

        {stage === "done" && (
          <>
            <p className="text-[13px] text-success">Password changed. Taking you to sign in…</p>
            <Link href="/login" className="text-[13px] text-navy-hover no-underline">Sign in now</Link>
          </>
        )}

        {stage === "ready" && (
          <form onSubmit={submit} className="flex flex-col gap-4">
            {error && <p role="alert" className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}
            <Field label="New password">
              <Input
                type="password" required minLength={8} autoComplete="new-password"
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
              <span className="text-[11.5px] text-slate">At least 8 characters.</span>
            </Field>
            <Field label="Confirm password">
              <Input
                type="password" required minLength={8} autoComplete="new-password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            <Button size="lg" type="submit" disabled={busy || password.length < 8}>
              {busy ? "Saving…" : "Set password"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
