"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

export default function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }
  return (
    <div className="flex items-center gap-2">
      <input readOnly value={url} onFocus={(e) => e.target.select()} className="flex-1 min-w-0 font-mono text-xs border border-border rounded-lg px-3 py-2 bg-surface-soft outline-none" />
      <Button size="sm" variant="secondary" type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
      <a href={url} target="_blank" rel="noreferrer" className="text-xs font-medium whitespace-nowrap">Open ↗</a>
    </div>
  );
}
