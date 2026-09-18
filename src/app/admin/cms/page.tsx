import CmsManager from "@/components/admin/CmsManager";
import { getAnnouncements } from "@/lib/data";

export default async function CmsPage() {
  const [announcements, faqs] = await Promise.all([getAnnouncements({ type: "announcement" }), getAnnouncements({ type: "faq" })]);
  return <CmsManager announcements={announcements} faqs={faqs} />;
}
