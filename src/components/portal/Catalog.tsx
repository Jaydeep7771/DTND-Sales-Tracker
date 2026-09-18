"use client";

// Product catalog: filter rail + card grid with "Load more" (fetches the next
// page via a server action so only 9 products ship per request).
import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge, Button, stockTone } from "@/components/ui";
import { useCart } from "./CartProvider";
import { loadCatalogPage } from "@/lib/actions";
import { money, stockState } from "@/lib/format";
import type { CategoryCount, Product, ProductPage } from "@/lib/types";

type Sort = "ordered" | "price" | "newest";

export default function Catalog({ initial, categories }: { initial: ProductPage; categories: CategoryCount[] }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [, start] = useTransition();
  const [rows, setRows] = useState<Product[]>(initial.rows);
  const [page, setPage] = useState(initial.page);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<Sort>("ordered");
  const [min, setMin] = useState(""); const [max, setMax] = useState("");
  const [inStockOnly, setInStockOnly] = useState(true);

  const q = params.get("q") ?? "";
  const cat = params.get("category") ?? "All";

  function update(next: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) { if (v) p.set(k, v); else p.delete(k); }
    start(() => router.replace(`${path}?${p.toString()}`));
  }

  async function loadMore() {
    setLoading(true);
    const next = await loadCatalogPage({ q, category: cat, page: page + 1 });
    setRows((r) => [...r, ...next.rows.filter((n) => !r.some((x) => x.id === n.id))]);
    setPage(next.page);
    setLoading(false);
  }

  // Client-side refinements on what's loaded.
  const visible = rows
    .filter((p) => (!inStockOnly || p.stock_quantity > 0) && (!min || p.price >= Number(min)) && (!max || p.price <= Number(max)))
    .sort((a, b) => (sort === "price" ? a.price - b.price : sort === "newest" ? b.created_at.localeCompare(a.created_at) : 0));

  const chips = [{ name: "All", count: initial.catalogTotal }, ...categories];

  return (
    <div className="grid gap-5 items-start grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="bg-surface border border-border rounded-[10px] p-4 flex flex-col gap-[18px]">
        <div>
          <div className="label mb-[9px]">Category</div>
          <div className="flex flex-col gap-0.5">
            {chips.map((c) => {
              const on = cat === c.name;
              return (
                <Link key={c.name} href={c.name === "All" ? "/portal" : `/portal?category=${encodeURIComponent(c.name)}`} className={`flex items-center justify-between rounded-[7px] px-2.5 py-2 text-[13px] ${on ? "bg-selected text-navy font-semibold hover:text-navy" : "text-slate-strong"}`}>
                  <span>{c.name}</span>
                  <span className="font-mono text-[11px] text-muted">{c.count}</span>
                </Link>
              );
            })}
          </div>
        </div>
        <div>
          <div className="label mb-[9px]">Unit price</div>
          <div className="flex gap-2">
            <input value={min} onChange={(e) => setMin(e.target.value)} placeholder="Min" inputMode="numeric" className="flex-1 min-w-0 border border-border rounded-[7px] px-2.5 py-2 text-[12.5px] font-mono outline-none bg-surface-soft focus:border-accent focus:bg-surface" />
            <input value={max} onChange={(e) => setMax(e.target.value)} placeholder="Max" inputMode="numeric" className="flex-1 min-w-0 border border-border rounded-[7px] px-2.5 py-2 text-[12.5px] font-mono outline-none bg-surface-soft focus:border-accent focus:bg-surface" />
          </div>
        </div>
        <div>
          <div className="label mb-[9px]">Availability</div>
          <label className="flex items-center gap-2 text-[13px] text-slate-dark"><input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} className="accent-accent" />In stock only</label>
        </div>
        <Button variant="secondary" onClick={() => { setMin(""); setMax(""); setInStockOnly(true); setSort("ordered"); router.replace("/portal"); }}>Reset filters</Button>
      </aside>

      <div className="min-w-0 flex flex-col gap-3.5">
        <div className="flex items-center gap-3 flex-wrap">
          <input defaultValue={q} onChange={(e) => update({ q: e.target.value || null })} placeholder={`Search ${initial.catalogTotal} products`} className="flex-1 min-w-[200px] border border-border bg-surface rounded-lg px-[13px] py-2.5 text-[13.5px] outline-none focus:border-accent" />
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="border border-border bg-surface rounded-lg px-3 py-2.5 text-[13px] outline-none">
            <option value="ordered">Sort: Most ordered</option>
            <option value="price">Price: low to high</option>
            <option value="newest">Newest</option>
          </select>
          <span className="font-mono text-[11.5px] text-slate">{initial.total} of {initial.catalogTotal} shown</span>
        </div>

        <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
          {visible.map((p) => <ProductCard key={p.id} p={p} />)}
          {visible.length === 0 && <div className="col-span-full text-[13px] text-slate py-8 text-center">No products match these filters.</div>}
        </div>

        {page < initial.pages && (
          <div className="flex justify-center pt-1.5">
            <Button variant="secondary" size="lg" onClick={loadMore} disabled={loading}>{loading ? "Loading…" : "Load more products"}</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ProductCard({ p }: { p: Product }) {
  const cart = useCart();
  const [qty, setQty] = useState(1);
  const st = stockState(p.stock_quantity, p.reorder_point);
  return (
    <div className="bg-surface border border-border rounded-[10px] overflow-hidden flex flex-col hover:border-[#c3d0de] hover:shadow-[0_6px_18px_rgba(15,27,43,.07)]">
      <div className="aspect-[4/3] hatch flex items-end justify-between p-2.5 relative">
        {p.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image_url} alt={p.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        )}
        {!p.image_url && <span className="font-mono text-[10px] text-slate bg-[rgba(255,255,255,.85)] rounded px-1.5 py-0.5">product shot</span>}
        <Badge tone={stockTone[st]} className="relative ml-auto text-[10.5px]">{st}</Badge>
      </div>
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div>
          <div className="text-[13.5px] font-semibold leading-[1.3]">{p.name}</div>
          <div className="font-mono text-[11px] text-slate mt-[3px]">{p.sku} · {p.unit_of_measure}</div>
        </div>
        <div className="flex items-baseline gap-1.5 mt-auto">
          <span className="font-mono text-[17px] font-semibold">{money(p.price)}</span>
          <span className="text-[11px] text-slate">/ unit</span>
        </div>
        <div className="flex gap-2">
          <div className="flex items-center border border-border rounded-[7px] overflow-hidden">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="border-0 bg-surface-soft text-slate-dark w-7 h-[34px] cursor-pointer text-sm">–</button>
            <input value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} className="w-[34px] border-0 text-center font-mono text-[13px] outline-none" />
            <button type="button" onClick={() => setQty((q) => q + 1)} className="border-0 bg-surface-soft text-slate-dark w-7 h-[34px] cursor-pointer text-sm">+</button>
          </div>
          <Button className="flex-1 h-[34px] py-0 text-[12.5px] rounded-[7px]" disabled={p.stock_quantity === 0} onClick={() => cart.add({ product_id: p.id, name: p.name, sku: p.sku, unit_price: p.price }, qty)}>
            {p.stock_quantity === 0 ? "Backorder" : "Add to cart"}
          </Button>
        </div>
      </div>
    </div>
  );
}
