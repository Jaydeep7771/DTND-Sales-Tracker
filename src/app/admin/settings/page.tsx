import { PageHeading } from "@/components/ui";
import SettingsForm from "@/components/admin/SettingsForm";
import { getCompanySettings } from "@/lib/data";
import { requirePage } from "@/lib/guard";
import { shortDate } from "@/lib/format";

export default async function SettingsPage() {
  // Finance and admin only; the capability map is the single gate.
  await requirePage("settings:finance");
  const settings = await getCompanySettings();

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        eyebrow="Configuration"
        title="Settings"
        sub={`Company identity, currency, tax and invoice presentation · last changed ${shortDate(settings.updated_at)}`}
      />
      <SettingsForm initial={settings} />
    </div>
  );
}
