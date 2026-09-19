import Link from "next/link";
import { Badge, Button, Card, PageHeading, stockTone } from "@/components/ui";
import { AddProductButton, InventoryFilters } from "@/components/admin/InventoryToolbar";
import EditProductButton from "@/components/admin/EditProductButton";
import { getCategories, getCurrentStaff, getProducts, isDemo } from "@/lib/data";
import { can } from "@/lib/permissions";
import { money, num, stockState } from "@/lib/format";

const PER_PAGE = 9;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = Number(sp.page ?? 1);
  const showArchived = sp.archived === "1";
  const [staff, products, categories] = await Promise.all([
    getCurrentStaff(),
    getProducts({ q: sp.q, category: sp.category, page, perPage: PER_PAGE, includeArchived: showArchived }),
    getCategories(),
  ]);
  const canWrite = can(staff?.role, "product:write");
  const from = products.total === 0 ? 0 : (products.page - 1) * PER_PAGE + 1;
  const to = Math.min(products.page * PER_PAGE, products.total);
  const pageHref = (n: number) => {
    const p = new URLSearchParams();
    if (sp.q) p.set("q", sp.q);
    if (sp.category) p.set("category", sp.category);
    if (showArchived) p.set("archived", "1");
    p.set("page", String(n));
    return `/admin/inventory?${p}`;
  };
  // Window the page numbers around the current page (max 5).
  const startPage = Math.max(1, Math.min(products.page - 2, products.pages - 4));
  const pageNums = Array.from({ length: Math.min(5, products.pages) }, (_, i) => startPage + i);

  return (
    <div className="flex flex-col gap-4">
      <PageHeading
        title="Inventory"
        sub={`${num(products.catalogTotal)} active SKUs across ${categories.length} categories`}
        actions={canWrite ? <AddProductButton categories={categories.map((c) => c.name)} demo={isDemo} /> : undefined}
      />

      <Card className="overflow-hidden">
        <InventoryFilters categories={categories} total={products.total} catalogTotal={products.catalogTotal} />

        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[820px]">
            <thead>
              <tr className="bg-surface-soft">
                <th className="th">SKU</th>
                <th className="th">Product</th>
                <th className="th">Category</th>
                <th className="th th-r">Unit price</th>
                <th className="th th-r">On hand</th>
                <th className="th">Status</th>
                <th className="th th-r"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {products.rows.map((p) => {
                const st = stockState(p.stock_quantity, p.reorder_point);
                return (
                  <tr key={p.id} className={`border-b border-border-soft hover:bg-surface-soft ${p.is_archived ? "opacity-60" : ""}`}>
                    <td className="td font-mono text-xs text-slate whitespace-nowrap">{p.sku}</td>
                    <td className="td font-medium">
                      <div className="flex items-center gap-2.5">
                        {p.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.image_url} alt="" className="w-7 h-7 rounded object-cover border border-border" loading="lazy" />
                        ) : (
                          <span className="hatch w-7 h-7 rounded border border-border shrink-0" aria-hidden />
                        )}
                        <span>
                          {p.name}
                          {p.is_archived && <span className="ml-2 text-[10.5px] font-semibold uppercase tracking-[.06em] text-muted">Archived</span>}
                        </span>
                      </div>
                    </td>
                    <td className="td text-[12.5px] text-slate-strong whitespace-nowrap">{p.category}</td>
                    <td className="td font-mono text-right whitespace-nowrap">{money(p.price)}</td>
                    <td className={`td font-mono text-right ${st === "Backorder" ? "text-danger font-semibold" : st === "Low stock" ? "text-warning font-semibold" : ""}`}>
                      {num(p.stock_quantity)}
                      <span className="block text-[10.5px] text-muted font-normal">reorder at {p.reorder_point}</span>
                    </td>
                    <td className="td"><Badge tone={stockTone[st]}>{st}</Badge></td>
                    <td className="td text-right whitespace-nowrap">{canWrite && <EditProductButton product={p} />}</td>
                  </tr>
                );
              })}
              {products.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center">
                    <div className="text-[13.5px] font-medium">No products match this filter</div>
                    <div className="text-[12.5px] text-slate mt-1">Try a different search or category, or <Link href="/admin/inventory">clear the filters</Link>.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-3.5 py-3 flex items-center justify-between gap-3 flex-wrap border-t border-border bg-surface-softer">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-slate">Showing {from}–{to} of {products.total} filtered ({num(products.catalogTotal)} total)</span>
            <Link href={showArchived ? "/admin/inventory" : "/admin/inventory?archived=1"} className="text-xs font-medium">{showArchived ? "Hide archived" : "Show archived"}</Link>
          </div>
          {products.pages > 1 && (
            <nav className="flex gap-1.5 items-center" aria-label="Pagination">
              <Link href={pageHref(Math.max(1, products.page - 1))} aria-disabled={products.page === 1}><Button variant="secondary" size="sm" disabled={products.page === 1}>Prev</Button></Link>
              {pageNums.map((n) => (
                <Link key={n} href={pageHref(n)} aria-current={n === products.page ? "page" : undefined} className={`border rounded-md px-[11px] py-1.5 font-mono text-xs ${n === products.page ? "bg-navy border-navy text-white hover:text-white" : "bg-surface border-border-strong text-slate-dark"}`}>{n}</Link>
              ))}
              <Link href={pageHref(Math.min(products.pages, products.page + 1))}><Button variant="secondary" size="sm" disabled={products.page === products.pages}>Next</Button></Link>
            </nav>
          )}
        </div>
      </Card>
    </div>
  );
}
