import { redirect } from "next/navigation";
import ScreenSwitcher from "@/components/ScreenSwitcher";
import FormatBootstrap from "@/components/FormatBootstrap";
import { CartProvider } from "@/components/portal/CartProvider";
import PortalHeader from "@/components/portal/PortalHeader";
import Banner from "@/components/portal/Banner";
import { getAnnouncements, getCart, getCompanySettings, getCurrentUser, getOrders, isDemo } from "@/lib/data";
import { currencyFromSettings } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!isDemo && !user) redirect("/login");

  const [banners, orders, settings, cart] = await Promise.all([
    getAnnouncements({ type: "announcement", activeOnly: true }),
    user ? getOrders({ customerId: user.id }) : Promise.resolve([]),
    getCompanySettings(),
    getCart(),
  ]);
  const banner = banners[0];
  const topOffset = isDemo ? 37 : 0;
  const company = user?.company_name ?? user?.email ?? "Customer";
  const account = "Account #" + (user?.id.replace(/\D/g, "").slice(0, 4).padEnd(4, "0") ?? "0000");
  const actionNeeded = orders.filter((o) => o.status === "changes_requested").length;

  return (
    <>
      {/* Currency and tax wording first, so every child formats correctly. */}
      <FormatBootstrap
        currency={currencyFromSettings(settings)}
        tax={{ rate: settings.default_tax_rate, label: settings.tax_label }}
      />
      <CartProvider initial={cart}>
      {isDemo && <ScreenSwitcher />}
      <div className="flex-1 flex flex-col bg-canvas-portal">
        <PortalHeader company={company} account={account} topOffset={topOffset} demo={isDemo} actionNeeded={actionNeeded} />
        {banner && <Banner announcement={banner} />}
        <main className="max-w-[1280px] w-full mx-auto px-4 sm:px-5 pt-4 sm:pt-[22px] pb-12">{children}</main>
      </div>
      </CartProvider>
    </>
  );
}
