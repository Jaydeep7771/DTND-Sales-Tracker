import Catalog from "@/components/portal/Catalog";
import { getCategories, getProducts } from "@/lib/data";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [products, categories] = await Promise.all([getProducts({ q: sp.q, category: sp.category, page: 1, perPage: 9 }), getCategories()]);
  // Key on the filter so client state (loaded pages) resets when filters change.
  return <Catalog key={`${sp.q ?? ""}|${sp.category ?? ""}`} initial={products} categories={categories} />;
}
