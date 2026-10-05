import { PageHeading } from "@/components/ui";
import ApplicationsView from "@/components/admin/ApplicationsView";
import { getCurrentStaff } from "@/lib/data";
import { getApplications } from "@/lib/registration-actions";
import { requirePage } from "@/lib/guard";
import { can } from "@/lib/permissions";

export default async function ApplicationsPage() {
  await requirePage("customer:read");
  const [applications, staff] = await Promise.all([getApplications(), getCurrentStaff()]);
  const pending = applications.filter((a) => a.status === "pending").length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        eyebrow="Customers"
        title="Account applications"
        sub={
          pending > 0
            ? `${pending} business${pending === 1 ? "" : "es"} waiting on a decision. Approving opens the account and sends the invite in one step.`
            : "Businesses that applied through the public form."
        }
      />
      <ApplicationsView applications={applications} canReview={can(staff?.role, "customer:write")} />
    </div>
  );
}
