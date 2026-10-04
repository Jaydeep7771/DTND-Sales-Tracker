import { PageHeading } from "@/components/ui";
import DayBook from "@/components/admin/DayBook";
import { getAccounts, getCurrentStaff, getDayBook } from "@/lib/data";
import { requirePage } from "@/lib/guard";
import { can } from "@/lib/permissions";

export default async function JournalPage({ searchParams }: { searchParams: Promise<{ account?: string; from?: string; to?: string }> }) {
  await requirePage("ledger:read");
  const { account, from, to } = await searchParams;

  const [entries, accounts, staff] = await Promise.all([
    getDayBook({ accountId: account, from, to }),
    getAccounts(),
    getCurrentStaff(),
  ]);

  const focused = account ? accounts.find((a) => a.id === account) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        eyebrow="Ledger"
        title={focused ? `Day book · ${focused.name}` : "Day book"}
        sub={
          focused
            ? `Every entry touching ${focused.code} ${focused.name}, shown whole.`
            : "Every entry with its lines. This is the screen that explains a balance."
        }
      />
      <DayBook entries={entries} accounts={accounts} canPost={can(staff?.role, "ledger:post")} />
    </div>
  );
}
