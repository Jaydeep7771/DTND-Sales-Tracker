"use client";

// Admin ↔ customer conversation on an order. Used on both sides.
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Textarea } from "@/components/ui";
import { shortDateTime } from "@/lib/format";
import type { OrderMessage } from "@/lib/types";

export default function OrderThread({
  orderId,
  messages,
  me,
  canReply,
  onReply,
  customerName,
}: {
  orderId: string;
  messages: OrderMessage[];
  me: "admin" | "customer";
  canReply: boolean;
  onReply: (orderId: string, body: string) => Promise<{ ok: boolean; error?: string }>;
  customerName: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await onReply(orderId, body);
      if (!res.ok) return setError(res.error ?? "Could not send.");
      setBody("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Conversation</span>
        <span className="font-mono text-[11px] text-slate">{messages.length} message{messages.length === 1 ? "" : "s"}</span>
      </div>
      {messages.length === 0 && <div className="text-[13px] text-slate">No messages yet.</div>}
      <div className="flex flex-col gap-2.5">
        {messages.map((m) => {
          const mine = m.author_role === me;
          return (
            <div key={m.id} className={`flex flex-col gap-1 max-w-[85%] ${mine ? "self-end items-end" : "self-start items-start"}`}>
              <div className="flex items-center gap-2 text-[11px] text-slate">
                <span className="font-semibold text-slate-dark">{m.author_role === "admin" ? "Dynamic Traders (admin)" : customerName}</span>
                <span className="font-mono">{shortDateTime(m.created_at)}</span>
              </div>
              <div className={`rounded-lg px-3 py-2 text-[13px] whitespace-pre-wrap leading-[1.5] border ${m.author_role === "admin" ? "bg-info-bg border-info-bd text-ink" : "bg-surface-soft border-border text-ink"}`}>{m.body}</div>
            </div>
          );
        })}
      </div>
      {canReply && (
        <form onSubmit={submit} className="flex flex-col gap-2 pt-1">
          <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={me === "admin" ? "Reply to the customer…" : "Reply to Dynamic Traders…"} />
          {error && <div className="text-xs text-danger">{error}</div>}
          <div className="flex justify-end"><Button size="sm" variant="secondary" type="submit" disabled={busy || !body.trim()}>{busy ? "Sending…" : "Send reply"}</Button></div>
        </form>
      )}
    </div>
  );
}
