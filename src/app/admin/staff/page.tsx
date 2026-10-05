import { PageHeading } from "@/components/ui";
import StaffView from "@/components/admin/StaffView";
import { getCurrentStaff, getStaff } from "@/lib/data";
import { requirePage } from "@/lib/guard";
import { can } from "@/lib/permissions";

export default async function StaffPage() {
  await requirePage("staff:invite");
  const [staff, me] = await Promise.all([getStaff(), getCurrentStaff()]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        eyebrow="Access"
        title="Staff"
        sub="Who works here, what they can reach, and whether they can sign in."
      />
      <StaffView
        staff={[...staff].sort((a, b) => (a.company_name ?? a.email).localeCompare(b.company_name ?? b.email))}
        meId={me?.id ?? null}
        canManage={can(me?.role, "staff:invite")}
      />
    </div>
  );
}
