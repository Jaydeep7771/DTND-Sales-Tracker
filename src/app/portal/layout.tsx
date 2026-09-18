import { redirect } from "next/navigation";
import ScreenSwitcher from "@/components/ScreenSwitcher";
import { CartProvider } from "@/components/portal/CartProvider";
import PortalHeader from "@/components/portal/PortalHeader";
import { getAnnouncements, getCurrentUser, isDemo } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!isDemo && !user) redirect("/login");

  const banners = await getAnnouncements({ type: "announcement", activeOnly: true });
  const banner = banners[0];
  const topOffset = isDemo ? 37 : 0;
  const company = user?.company_name ?? user?.email ?? "Customer";
  const account = "Account #" + (user?.id.replace(/\D/g, "").slice(0, 4).padEnd(4, "0") ?? "0000");

  return (
    <CartProvider>
      {isDemo && <ScreenSwitcher />}
      <div className="flex-1 flex flex-col bg-canvas-portal">
        <PortalHeader company={company} account={account} topOffset={topOffset} />
        {banner && (
          <div className="bg-warning-bg border-b border-warning-bd">
            <div className="max-w-[1280px] mx-auto px-5 py-[11px] flex items-center gap-3 flex-wrap">
              <span className="font-mono text-[10px] tracking-[.1em] uppercase font-semibold text-warning bg-[#f7e4be] rounded px-[7px] py-[3px]">Notice</span>
              <span className="text-[13px] text-[#6b4708] flex-1 min-w-[200px]"><strong className="font-semibold">{banner.title}.</strong> {banner.content}</span>
            </div>
          </div>
        )}
        <main className="max-w-[1280px] w-full mx-auto px-5 pt-[22px] pb-12">{children}</main>
      </div>
    </CartProvider>
  );
}
