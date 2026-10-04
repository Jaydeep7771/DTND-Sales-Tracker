import { Card, PageHeading } from "@/components/ui";
import OpeningBalances from "@/components/admin/OpeningBalances";
import { getAccounts, getCurrentStaff, getCustomers, getSuppliers } from "@/lib/data";
import { openingBalancesPosted } from "@/lib/opening-balances";
import { requirePage } from "@/lib/guard";
import { can } from "@/lib/permissions";

export default async function OpeningBalancesPage() {
  await requirePage("settings:finance");
  const [accounts, customers, suppliers, staff, state] = await Promise.all([
    getAccounts(), getCustomers(), getSuppliers(), getCurrentStaff(), openingBalancesPosted(),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        eyebrow="Go live"
        title="Opening balances"
        sub="What the business was worth the day before it started using this system."
      />

      {!state.posted && (
        <Card className="px-5 py-4">
          <div className="text-[13px] font-semibold mb-2">Before you start</div>
          <ul className="text-[12.5px] text-slate-dark leading-relaxed flex flex-col gap-1.5 list-disc pl-4">
            <li>Have your last trial balance, bank statements, and the list of unpaid customer invoices and supplier bills to hand.</li>
            <li>Nothing posts until you press the button at the bottom, and the running total tells you what is still out of balance.</li>
            <li>Opening entries never touch sales or expenses. Those sales were made before go-live, and counting them now would inflate this year&apos;s profit with last year&apos;s trading.</li>
            <li>This can only be done once. Doing it twice would double every balance.</li>
          </ul>
        </Card>
      )}

      <OpeningBalances
        accounts={accounts}
        customers={customers}
        suppliers={suppliers}
        alreadyPosted={state.posted}
        postedOn={state.on}
        canPost={can(staff?.role, "settings:finance")}
      />
    </div>
  );
}
