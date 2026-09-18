"use client";

// Prototype-style screen bar. Rendered only in demo mode (no Supabase keys)
// so reviewers can hop between admin and portal without signing in.
import Link from "next/link";
import { usePathname } from "next/navigation";

const SCREENS: [string, string][] = [
  ["/admin", "Admin · Overview"],
  ["/admin/inventory", "Inventory"],
  ["/admin/orders", "Orders"],
  ["/admin/cms", "CMS"],
  ["/portal", "Portal · Catalog"],
  ["/portal/checkout", "Cart & checkout"],
  ["/portal/orders", "Order tracking"],
  ["/design-system", "Design system"],
];

export default function ScreenSwitcher() {
  const path = usePathname();
  return (
    <div className="bg-topbar text-[#94a7bd] flex flex-wrap items-center gap-2 px-3.5 py-2 sticky top-0 z-[60]">
      <span className="font-mono text-[10px] tracking-[.14em] uppercase text-[#64809e] pr-1.5">Screens</span>
      {SCREENS.map(([href, label]) => {
        const on = path === href;
        return (
          <Link
            key={href}
            href={href}
            className={`border rounded-md px-2.5 py-[5px] text-xs font-medium whitespace-nowrap ${on ? "bg-accent border-accent text-white hover:text-white" : "border-[#2a3f58] text-[#a8bdd2] hover:text-white"}`}
          >
            {label}
          </Link>
        );
      })}
      <span className="ml-auto font-mono text-[10px] text-[#64809e]">demo data · add Supabase keys to go live</span>
    </div>
  );
}
