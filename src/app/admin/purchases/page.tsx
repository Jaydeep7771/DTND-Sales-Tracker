import { PageHeading } from "@/components/ui";
import PurchasesView from "@/components/admin/PurchasesView";
import { getBills, getCompanySettings, getCurrentStaff, getProducts, getSalesTaxSummary, getSuppliers } from "@/lib/data";
import { requirePage } from "@/lib/guard";
import { can } from "@/lib/permissions";

export default async function PurchasesPage() {
  await requirePage("report:read");
  const [bills, suppliers, products, taxMonths, settings, staff] = await Promise.all([
    getBills(),
    getSuppliers(),
    getProducts({ perPage: 500 }),
    getSalesTaxSummary(),
    getCompanySettings(),
    getCurrentStaff(),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        eyebrow="Purchases"
        title="Bills and suppliers"
        sub="The buying side of the ledger. Entering a bill brings goods into stock, rolls the moving average cost and records input tax."
      />
      <PurchasesView
        bills={bills}
        suppliers={suppliers}
        products={products.rows}
        taxMonths={taxMonths}
        defaultTaxRate={settings.default_tax_rate}
        canEdit={can(staff?.role, "invoice:write")}
      />
    </div>
  );
}
