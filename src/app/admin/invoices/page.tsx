import { PageHeading } from "@/components/ui";
import InvoicesView from "@/components/admin/InvoicesView";
import { getCurrentStaff, getCustomers, getInvoices } from "@/lib/data";
import { requirePage } from "@/lib/guard";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  await requirePage("invoice:read");

  const [invoices, customers, me] = await Promise.all([
    getInvoices(),
    getCustomers(),
    getCurrentStaff(),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        eyebrow="Billing"
        title="Invoices"
        sub="Every document raised, in one place. Tax invoices, credit notes and proformas, with what is still owed against each."
      />
      <InvoicesView
        invoices={invoices}
        customers={customers.map((c) => ({
          id: c.id,
          name: c.company_name ?? c.email,
          consolidated: c.consolidated_billing,
        }))}
        canInvoice={can(me?.role, "invoice:write")}
      />
    </div>
  );
}
