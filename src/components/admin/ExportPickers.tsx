"use client";

/**
 * Period pickers that live in the URL.
 *
 * In the query string rather than in component state so the page stays a
 * server component, the download links are built server-side with the
 * right dates already in them, and an accountant can bookmark or send
 * "the September pack" as a link.
 */
import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card, Field, Input } from "@/components/ui";

export default function ExportPickers({ from, to, month }: { from: string; to: string; month: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [busy, start] = useTransition();

  function set(next: Record<string, string>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) { if (v) p.set(k, v); else p.delete(k); }
    start(() => router.replace(`${path}?${p.toString()}`));
  }

  // Shortcuts for the ranges anyone actually asks for.
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const shortcuts: [string, { from: string; to: string }][] = [
    ["This month", {
      from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
      to: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))),
    }],
    ["Last month", {
      from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))),
      to: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))),
    }],
    ["Last quarter", {
      from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1))),
      to: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))),
    }],
  ];

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <Field label="Period from">
          <Input type="date" value={from} onChange={(e) => set({ from: e.target.value })} />
        </Field>
        <Field label="Period to">
          <Input type="date" value={to} onChange={(e) => set({ to: e.target.value })} />
        </Field>
        <Field label="Tax period (Annex-C)">
          <Input type="month" value={month} onChange={(e) => set({ month: e.target.value })} />
        </Field>
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        {shortcuts.map(([label, range]) => (
          <button
            key={label}
            type="button"
            onClick={() => set(range)}
            className="text-[12px] rounded-full px-2.5 py-1 border border-border bg-surface text-slate-dark cursor-pointer hover:border-accent"
          >
            {label}
          </button>
        ))}
        {busy && <span className="text-[11.5px] text-muted">Updating…</span>}
      </div>
    </Card>
  );
}
