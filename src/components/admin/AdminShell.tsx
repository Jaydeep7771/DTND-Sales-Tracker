"use client";

// Admin console frame: collapsible navy sidebar + white top bar.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { num } from "@/lib/format";

const NAV: [string, string][] = [
  ["/admin", "Dashboard"],
  ["/admin/inventory", "Inventory"],
  ["/admin/orders", "Orders"],
  ["/admin/customers", "Customers"],
  ["/admin/cms", "CMS Settings"],
];

export interface AdminShellProps {
  children: ReactNode;
  pendingCount: number;
  totalSkus: number;
  lowStockCount: number;
  admin: { name: string; title: string; initials: string };
  topOffset: number; // height of the demo screen bar above, so sticky headers stack
}

export default function AdminShell({ children, pendingCount, totalSkus, lowStockCount, admin, topOffset }: AdminShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const path = usePathname();

  return (
    <div className="flex items-stretch flex-1 min-h-0">
      <aside
        className="shrink-0 bg-sidebar text-[#c7d5e5] flex flex-col p-3 pt-4 gap-[18px] transition-[width] duration-150 sticky self-start"
        style={{ width: collapsed ? 74 : 232, top: topOffset, height: `calc(100vh - ${topOffset}px)` }}
      >
        <div className="flex items-center gap-2.5 px-1">
          <div className="w-[30px] h-[30px] shrink-0 rounded-[7px] bg-accent flex items-center justify-center font-mono font-semibold text-[13px] text-white">DT</div>
          {!collapsed && (
            <div className="leading-[1.15] overflow-hidden">
              <div className="text-[13px] font-semibold text-white whitespace-nowrap">Dynamic Traders</div>
              <div className="text-[10px] tracking-[.1em] uppercase text-sidebar-muted">Admin console</div>
            </div>
          )}
        </div>

        <nav className="flex flex-col gap-[3px]">
          {NAV.map(([href, label]) => {
            const on = href === "/admin" ? path === "/admin" : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                title={label}
                className={`flex items-center gap-2.5 rounded-[7px] px-2.5 py-[9px] text-[13px] border-l-[3px] ${on ? "bg-navy-hover text-white font-semibold border-accent hover:text-white" : "text-sidebar-text font-medium border-transparent hover:text-white"}`}
              >
                <span className={`w-2 h-2 shrink-0 rounded-sm ${on ? "bg-[#7fb4ec]" : "bg-[#5a7591]"}`} />
                {!collapsed && <span className="whitespace-nowrap">{label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-2.5">
          {!collapsed && (
            <div className="border border-sidebar-line bg-sidebar-card rounded-lg p-2.5">
              <div className="text-[10px] tracking-[.1em] uppercase text-sidebar-muted font-semibold">Catalog health</div>
              <div className="font-mono text-lg text-white mt-1">{num(totalSkus)} SKUs</div>
              <div className="text-[11px] text-warning-dot mt-0.5">{lowStockCount} below reorder point</div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="bg-transparent border border-sidebar-line text-[#9fb6cd] rounded-[7px] p-2 text-[11px] cursor-pointer font-mono tracking-[.06em] hover:text-white"
          >
            {collapsed ? "»" : "« Collapse"}
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col bg-canvas">
        <header className="bg-surface border-b border-border px-5 py-3 flex items-center gap-3.5 flex-wrap sticky z-20" style={{ top: topOffset }}>
          <div className="flex-1 min-w-[200px] max-w-[460px] flex items-center gap-2 bg-canvas border border-border rounded-lg px-[11px] py-2 focus-within:border-accent">
            <span className="font-mono text-xs text-muted">⌕</span>
            <input placeholder="Search SKUs, orders, customers…" className="flex-1 min-w-0 border-0 bg-transparent outline-none text-[13px] text-ink" />
            <span className="font-mono text-[10px] text-muted border border-border bg-surface rounded px-[5px] py-px">⌘K</span>
          </div>
          <div className="flex items-center gap-2.5 ml-auto">
            <Link href="/admin/orders" className="relative flex items-center gap-[7px] border border-border bg-surface rounded-lg px-[11px] py-[7px] text-xs font-medium text-slate-dark hover:border-accent hover:text-navy-hover">
              <span className={`w-[7px] h-[7px] rounded-full ${pendingCount ? "bg-danger" : "bg-border-strong"}`} />
              New orders
              {pendingCount > 0 && <span className="font-mono text-[11px] bg-danger text-white rounded-[9px] px-1.5 py-px">{pendingCount}</span>}
            </Link>
            <div className="w-px h-[26px] bg-border" />
            <div className="flex items-center gap-[9px]">
              <div className="w-8 h-8 rounded-full bg-navy text-white flex items-center justify-center text-xs font-semibold">{admin.initials}</div>
              <div className="leading-[1.2]">
                <div className="text-[12.5px] font-semibold">{admin.name}</div>
                <div className="text-[11px] text-slate">{admin.title}</div>
              </div>
            </div>
          </div>
        </header>

        <main className="px-5 pt-[22px] pb-10 flex flex-col gap-5">{children}</main>
      </div>
    </div>
  );
}
