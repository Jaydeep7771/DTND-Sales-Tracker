"use client";

// Search + category chips + "Add product" trigger. Filters live in the URL so
// the server component re-queries; the modal is local state.
import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui";
import AddProductModal from "./AddProductModal";
import type { CategoryCount } from "@/lib/types";

export function AddProductButton({ categories, demo }: { categories: string[]; demo: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Add product</Button>
      {open && <AddProductModal categories={categories} demo={demo} onClose={() => setOpen(false)} />}
    </>
  );
}

export function InventoryFilters({ categories, total, catalogTotal }: { categories: CategoryCount[]; total: number; catalogTotal: number }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const q = params.get("q") ?? "";
  const cat = params.get("category") ?? "All";

  function update(next: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) { if (v) p.set(k, v); else p.delete(k); }
    p.delete("page");
    startTransition(() => router.replace(`${path}?${p.toString()}`));
  }

  const chips = [{ name: "All", count: catalogTotal }, ...categories];

  return (
    <div className="px-3.5 py-3 border-b border-border flex gap-2.5 flex-wrap items-center">
      <input
        defaultValue={q}
        onChange={(e) => update({ q: e.target.value || null })}
        placeholder="Search name or SKU"
        className="flex-1 min-w-[180px] max-w-[300px] border border-border bg-surface-soft rounded-lg px-[11px] py-2 text-[13px] outline-none focus:border-accent focus:bg-surface"
      />
      <div className="flex gap-1.5 flex-wrap">
        {chips.map((c) => {
          const on = cat === c.name;
          return (
            <button
              key={c.name}
              type="button"
              onClick={() => update({ category: c.name === "All" ? null : c.name })}
              className={`border rounded-full px-3 py-1.5 text-xs font-medium cursor-pointer ${on ? "bg-navy border-navy text-white" : "bg-surface border-border-strong text-slate-dark hover:border-muted"}`}
            >
              {c.name}
            </button>
          );
        })}
      </div>
      <span className="ml-auto font-mono text-[11.5px] text-slate">{total} of {catalogTotal} shown</span>
    </div>
  );
}
