import Link from "next/link";
import { Badge, Button, Card, PageHeading, stockTone } from "@/components/ui";
import { AddProductButton, InventoryFilters } from "@/components/admin/InventoryToolbar";
import { getCategories, getProducts, isDemo } from "@/lib/data";
import { money, num, stockState } from "@/lib/format";

const PER_PAGE = 9;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = Number(sp.page ?? 1);
  const [products, categories] = await Promise.all([
    getProducts({ q: sp.q, category: sp.category, page, perPage: PER_PAGE }),
    getCategories(),
  ]);
  const from = products.total === 0 ? 0 : (products.page - 1) * PER_PAGE + 1;
  const to = Math.min(products.page * PER_PAGE, products.total);
  const pageHref = (n: number) => {
    const p = new URLSearchParams();
    if (sp.q) p.set("q", sp.q);
    if (sp.category) p.set("category", sp.category);
    p.set("page", String(n));
    return `/admin/inventory?${p}`;
  };
  const pageNums = Array.from({ length: Math.min(4, products.pages) }, (_, i) => i + 1);

  return (
    <div className="flex flex-col gap-4">
      <PageHeading
        title="Inventory"
        sub={`${num(products.catalogTotal)} active SKUs across ${categories.length} categories`}
        actions={
          <>
            <Button variant="secondary">Import CSV</Button>
            <AddProductButton categories={categories.map((c) => c.name)} demo={isDemo} />
          </>
        }
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
                <th className="th th-r" />
              </tr>
            </thead>
            <tbody>
              {products.rows.map((p) => {
                const st = stockState(p.stock_quantity, p.reorder_point);
                return (
                  <tr key={p.id} className="border-b border-border-soft hover:bg-surface-soft">
                    <td className="td font-mono text-xs text-slate whitespace-nowrap">{p.sku}</td>
                    <td className="td font-medium">
                      <div className="flex items-center gap-2.5">
                        {p.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.image_url} alt="" className="w-7 h-7 rounded object-cover border border-border" loading="lazy" />
                        ) : (
                          <span className="hatch w-7 h-7 rounded border border-border shrink-0" />
                        )}
                        {p.name}
                      </div>
                    </td>
                    <td className="td text-[12.5px] text-slate-strong whitespace-nowrap">{p.category}</td>
                    <td className="td font-mono text-right whitespace-nowrap">{money(p.price)}</td>
                    <td className="td font-mono text-right">{num(p.stock_quantity)}</td>
                    <td className="td"><Badge tone={stockTone[st]}>{st}</Badge></td>
                    <td className="td text-right whitespace-nowrap"><Button variant="ghost" size="sm">Edit</Button></td>
                  </tr>
                );
              })}
              {products.rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-[13px] text-slate">No products match this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-3.5 py-3 flex items-center justify-between gap-3 flex-wrap border-t border-border bg-surface-softer">
          <span className="text-xs text-slate">Showing {from}–{to} of {products.total} filtered ({num(products.catalogTotal)} total)</span>
          <div className="flex gap-1.5 items-center">
            <Link href={pageHref(Math.max(1, products.page - 1))}><Button variant="secondary" size="sm">Prev</Button></Link>
            {pageNums.map((n) => (
              <Link key={n} href={pageHref(n)} className={`border rounded-md px-[11px] py-1.5 font-mono text-xs ${n === products.page ? "bg-navy border-navy text-white hover:text-white" : "bg-surface border-border-strong text-slate-dark"}`}>{n}</Link>
            ))}
            <Link href={pageHref(Math.min(products.pages, products.page + 1))}><Button variant="secondary" size="sm">Next</Button></Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
