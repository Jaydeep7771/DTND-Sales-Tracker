import { Card, PageHeading } from "@/components/ui";
import PeriodManager from "@/components/admin/PeriodManager";
import { getCurrentStaff, getPeriods } from "@/lib/data";
import { requirePage } from "@/lib/guard";
import { can } from "@/lib/permissions";

export default async function PeriodsPage() {
  await requirePage("ledger:read");
  const [periods, staff] = await Promise.all([getPeriods(), getCurrentStaff()]);
  const canEdit = can(staff?.role, "settings:finance");

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        eyebrow="Controls"
        title="Period close"
        sub="Lock a month once it has been reported, so a filed figure cannot change underneath you."
      />

      <PeriodManager periods={periods} canEdit={canEdit} />

      <Card className="px-5 py-4">
        <div className="text-[13px] font-semibold mb-2">Why this exists</div>
        <ul className="text-[12.5px] text-slate-dark leading-relaxed flex flex-col gap-1.5 list-disc pl-4">
          <li>The ledger is append-only, so a mistake is corrected by a reversing entry rather than an edit. Without period locking, that reversal can still be <em>dated</em> into a month you have already filed.</li>
          <li>Closing is enforced by the database, not by this screen. A posting into a closed period is refused wherever it comes from.</li>
          <li>Close a month only after the trial balance and the tax figures for it have been checked.</li>
        </ul>
      </Card>
    </div>
  );
}
