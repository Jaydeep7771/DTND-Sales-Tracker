"use client";

// Product catalog: filter rail (collapsible on mobile) + card grid with
// "Load more" (fetches the next page via a server action so only 9 products
// ship per request). Adding to cart gives a toast instead of hijacking the
// screen with the drawer, so buyers can keep adding.
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge, Button, stockTone } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { useCart } from "./CartProvider";
import { loadCatalogPage } from "@/lib/actions";
import { money, num, stockState } from "@/lib/format";
import { currencyPrefix } from "@/lib/money";
import type { CategoryCount, PricedProduct, ProductPage } from "@/lib/types";

type Sort = "ordered" | "price" | "newest";

export default function Catalog({ initial, categories }: { initial: ProductPage; categories: CategoryCount[] }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [, start] = useTransition();
  const [rows, setRows] = useState<PricedProduct[]>(initial.rows);
  const [page, setPage] = useState(initial.page);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<Sort>("ordered");
  const [min, setMin] = useState(""); const [max, setMax] = useState("");
  const [inStockOnly, setInStockOnly] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = params.get("q") ?? "";
  const cat = params.get("category") ?? "All";

  function update(next: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) { if (v) p.set(k, v); else p.delete(k); }
    start(() => router.replace(`${path}?${p.toString()}`));
  }
  function onSearch(value: string) {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => update({ q: value || null }), 300);
  }
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  async function loadMore() {
    setLoading(true);
    const next = await loadCatalogPage({ q, category: cat, page: page + 1 });
    setRows((r) => [...r, ...next.rows.filter((n) => !r.some((x) => x.id === n.id))]);
    setPage(next.page);
    setLoading(false);
  }

  const visible = rows
    // Filter and sort on the price this customer actually pays, not on
    // list price. Sorting a rate-carded catalogue by list price puts the
    // cards in an order that does not match the numbers on them.
    .filter((p) => (!inStockOnly || p.availability.available > 0) && (!min || p.pricing.unit_price >= Number(min)) && (!max || p.pricing.unit_price <= Number(max)))
    .sort((a, b) => (sort === "price" ? a.pricing.unit_price - b.pricing.unit_price : sort === "newest" ? b.created_at.localeCompare(a.created_at) : 0));

  const chips = [{ name: "All", count: initial.catalogTotal }, ...categories];
  const activeFilters = (cat !== "All" ? 1 : 0) + (min || max ? 1 : 0) + (inStockOnly ? 0 : 1);

  const rail = (
    <>
      <div>
        <div className="label mb-[9px]">Category</div>
        <div className="flex flex-col gap-0.5">
          {chips.map((c) => {
            const on = cat === c.name;
            return (
              <Link key={c.name} href={c.name === "All" ? "/portal" : `/portal?category=${encodeURIComponent(c.name)}`} aria-current={on ? "true" : undefined} className={`flex items-center justify-between rounded-[7px] px-2.5 py-2 text-[13px] ${on ? "bg-selected text-navy font-semibold hover:text-navy" : "text-slate-strong hover:bg-surface-soft"}`}>
                <span>{c.name}</span>
                <span className="font-mono text-[11px] text-muted">{c.count}</span>
              </Link>
            );
          })}
        </div>
      </div>
      <div>
        <div className="label mb-[9px]">Unit price ({currencyPrefix()})</div>
        <div className="flex gap-2">
          <input value={min} onChange={(e) => setMin(e.target.value)} placeholder="Min" inputMode="numeric" aria-label="Minimum price" className="flex-1 min-w-0 border border-border rounded-[7px] px-2.5 py-2 text-[12.5px] font-mono outline-none bg-surface-soft focus:border-accent focus:bg-surface" />
          <input value={max} onChange={(e) => setMax(e.target.value)} placeholder="Max" inputMode="numeric" aria-label="Maximum price" className="flex-1 min-w-0 border border-border rounded-[7px] px-2.5 py-2 text-[12.5px] font-mono outline-none bg-surface-soft focus:border-accent focus:bg-surface" />
        </div>
      </div>
      <div>
        <div className="label mb-[9px]">Availability</div>
        <label className="flex items-center gap-2 text-[13px] text-slate-dark"><input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} className="accent-accent" />In stock only</label>
      </div>
      <Button variant="secondary" onClick={() => { setMin(""); setMax(""); setInStockOnly(true); setSort("ordered"); setFiltersOpen(false); router.replace("/portal"); }}>Reset filters</Button>
    </>
  );

  return (
    <div className="grid gap-5 items-start grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]">
      {/* Mobile: filters collapse behind a button so products are visible first. */}
      <div className="md:hidden">
        <Button variant="secondary" className="w-full" onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen}>
          {filtersOpen ? "Hide filters" : "Filters"}{activeFilters > 0 && <span className="font-mono text-[11px] bg-navy text-white rounded-full px-1.5">{activeFilters}</span>}
        </Button>
        {filtersOpen && <aside className="mt-3 bg-surface border border-border rounded-[10px] p-4 flex flex-col gap-[18px]">{rail}</aside>}
      </div>
      <aside className="hidden md:flex bg-surface border border-border rounded-[10px] p-4 flex-col gap-[18px] sticky top-[120px]">{rail}</aside>

      <div className="min-w-0 flex flex-col gap-3.5">
        <div className="flex items-center gap-3 flex-wrap">
          <input defaultValue={q} onChange={(e) => onSearch(e.target.value)} placeholder={`Search ${initial.catalogTotal} products`} aria-label="Search products" className="flex-1 min-w-[200px] border border-border bg-surface rounded-lg px-[13px] py-2.5 text-[13.5px] outline-none focus:border-accent" />
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort" className="border border-border bg-surface rounded-lg px-3 py-2.5 text-[13px] outline-none">
            <option value="ordered">Sort: Most ordered</option>
            <option value="price">Price: low to high</option>
            <option value="newest">Newest</option>
          </select>
          <span className="font-mono text-[11.5px] text-slate">{initial.total} of {initial.catalogTotal} shown</span>
        </div>

        <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
          {visible.map((p) => <ProductCard key={p.id} p={p} />)}
          {visible.length === 0 && (
            <div className="col-span-full py-12 text-center">
              <div className="text-[13.5px] font-medium">No products match these filters</div>
              <div className="text-[12.5px] text-slate mt-1">Try a broader search, another category, or include out-of-stock items.</div>
            </div>
          )}
        </div>

        {page < initial.pages && (
          <div className="flex flex-col items-center gap-1.5 pt-1.5">
            <Button variant="secondary" size="lg" onClick={loadMore} disabled={loading}>{loading ? "Loading…" : "Load more products"}</Button>
            <span className="font-mono text-[11px] text-muted">{rows.length} of {initial.total} loaded</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ProductCard({ p }: { p: PricedProduct }) {
  const cart = useCart();
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const st = stockState(p.stock_quantity, p.reorder_point);
  const inCart = cart.lines.find((l) => l.product_id === p.id)?.quantity;

  const available = p.availability.available;
  // Backorder is a per-product decision now, not a side effect of
  // nothing checking. Everything else is capped at what is free.
  const capped = p.allow_backorder ? qty : Math.min(qty, Math.max(0, available));
  const canOrder = p.allow_backorder || available > 0;

  // The price on the card is the entry price. If buying more is cheaper,
  // say so on the card rather than hiding it until checkout.
  const { unit_price, list_price, source, source_name, next_break } = p.pricing;

  async function add() {
    const res = await cart.add(p.id, capped);
    if (!res.ok) return toast.push(res.error ?? "Could not add that.", "error");
    if (res.clamped) {
      toast.push(`Only ${res.available} of ${p.name} available — added ${res.quantity}.`, "info", { label: "View cart", onClick: () => cart.setOpen(true) });
    } else {
      toast.push(`Added ${num(capped)} × ${p.name}`, "success", { label: "View cart", onClick: () => cart.setOpen(true) });
    }
    setQty(1);
  }

  return (
    <div className="bg-surface border border-border rounded-[10px] overflow-hidden flex flex-col hover:border-[#c3d0de] hover:shadow-[0_6px_18px_rgba(15,27,43,.07)] transition-shadow">
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

        <div className="mt-auto flex flex-col gap-1">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[17px] font-semibold">{money(unit_price)}</span>
            <span className="text-[11px] text-slate">/ unit</span>
            {unit_price < list_price && <span className="font-mono text-[11px] text-muted line-through">{money(list_price)}</span>}
            {inCart && <span className="ml-auto font-mono text-[10.5px] text-success font-semibold">{num(inCart)} in cart</span>}
          </div>

          {source !== "list" && (
            <span className="self-start text-[10.5px] font-semibold rounded px-1.5 py-px bg-success-bg text-success border border-success-bd">
              {source === "contract" ? "Your contract price" : `${source_name ?? "Trade"} rate`}
            </span>
          )}
          {next_break && (
            <div className="font-mono text-[10.5px] text-slate">
              {num(next_break.min_quantity)}+ at {money(next_break.unit_price)}
            </div>
          )}

          {/* Free stock, not stock on hand: some of the shelf is already
              promised to approved orders that have not shipped. */}
          <div className="font-mono text-[10.5px] text-slate">
            {available > 0
              ? `${num(available)} available`
              : p.allow_backorder ? "Out of stock · backorder" : "Out of stock"}
          </div>
        </div>

        <div className="flex gap-2">
          <div className="flex items-center border border-border rounded-[7px] overflow-hidden">
            <button type="button" aria-label="Decrease quantity" onClick={() => setQty((q) => Math.max(1, q - 1))} className="border-0 bg-surface-soft text-slate-dark w-8 h-9 sm:w-7 sm:h-[34px] cursor-pointer text-sm">–</button>
            <input value={qty} aria-label="Quantity" inputMode="numeric" onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} className="w-[38px] border-0 text-center font-mono text-[13px] outline-none" />
            <button type="button" aria-label="Increase quantity" onClick={() => setQty((q) => q + 1)} className="border-0 bg-surface-soft text-slate-dark w-8 h-9 sm:w-7 sm:h-[34px] cursor-pointer text-sm">+</button>
          </div>
          <Button className="flex-1 h-9 sm:h-[34px] py-0 text-[12.5px] rounded-[7px]" disabled={!canOrder || cart.busy} onClick={add}>
            {!canOrder ? "Out of stock" : p.allow_backorder && available <= 0 ? "Backorder" : "Add to cart"}
          </Button>
        </div>
        {canOrder && !p.allow_backorder && qty > available && (
          <div className="text-[11px] text-warning">Capped at the {num(available)} available.</div>
        )}
      </div>
    </div>
  );
}
