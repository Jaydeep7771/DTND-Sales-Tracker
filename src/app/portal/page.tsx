import Catalog from "@/components/portal/Catalog";
import { getCategories, getCurrentUser, getProducts } from "@/lib/data";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [products, categories, user] = await Promise.all([
    getProducts({ q: sp.q, category: sp.category, page: 1, perPage: 9 }),
    getCategories(),
    sp.welcome ? getCurrentUser() : null,
  ]);
  return (
    <>
      {sp.welcome && (
        <div className="mb-4 bg-success-bg border border-success-bd rounded-lg px-4 py-3 text-[13px] text-success">
          Welcome{user?.company_name ? `, ${user.company_name}` : ""}. Your account is active. Browse the catalog, add items to your cart and submit an order for approval; you can track every order under <strong>Order history</strong>.
        </div>
      )}
      {/* Key on the filter so client state (loaded pages) resets when filters change. */}
      <Catalog key={`${sp.q ?? ""}|${sp.category ?? ""}`} initial={products} categories={categories} />
    </>
  );
}
