import CmsManager from "@/components/admin/CmsManager";
import { getAnnouncements } from "@/lib/data";
import { requirePage } from "@/lib/guard";

export default async function CmsPage() {
  await requirePage("cms:write");
  const [announcements, faqs] = await Promise.all([getAnnouncements({ type: "announcement" }), getAnnouncements({ type: "faq" })]);
  return <CmsManager announcements={announcements} faqs={faqs} />;
}
