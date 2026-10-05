import { PageHeading } from "@/components/ui";
import PricingView from "@/components/admin/PricingView";
import { getCurrentStaff, getCustomers, getPriceLists, getPriceRules, getProducts } from "@/lib/data";
import { requirePage } from "@/lib/guard";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  await requirePage("pricing:read");

  const [lists, rules, products, customers, me] = await Promise.all([
    getPriceLists(),
    // Every rule, both scopes. The catalogue is small enough that one
    // read beats paging a screen whose whole job is comparison.
    getPriceRules(),
    getProducts({ perPage: 10000 }),
    getCustomers(),
    getCurrentStaff(),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        eyebrow="Commercial"
        title="Pricing"
        sub="Trade tiers, negotiated contracts and volume breaks. The most specific rule wins: a customer contract beats their tier, and a tier beats list price."
      />
      <PricingView
        lists={lists}
        rules={rules}
        products={products.rows.map((p) => ({ id: p.id, sku: p.sku, name: p.name, price: p.price, unit_of_measure: p.unit_of_measure }))}
        customers={customers.map((c) => ({ id: c.id, name: c.company_name ?? c.email, price_list_id: c.price_list_id }))}
        canEdit={can(me?.role, "pricing:write")}
      />
    </div>
  );
}
