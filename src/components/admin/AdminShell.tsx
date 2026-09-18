"use client";

// Admin console frame: collapsible navy sidebar (drawer on small screens) +
// white top bar with a working global search (⌘K / Ctrl+K).
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { num } from "@/lib/format";
import { signOut } from "@/lib/actions";

const NAV: [string, string][] = [
  ["/admin", "Dashboard"],
  ["/admin/inventory", "Inventory"],
  ["/admin/orders", "Orders"],
  ["/admin/customers", "Customers"],
  ["/admin/cms", "CMS Settings"],
];
const COLLAPSE_KEY = "dtnd-admin-collapsed";

export interface AdminShellProps {
  children: ReactNode;
  pendingCount: number;
  totalSkus: number;
  lowStockCount: number;
  admin: { name: string; title: string; initials: string };
  topOffset: number; // height of the demo screen bar above, so sticky headers stack
  demo: boolean;
}

export default function AdminShell({ children, pendingCount, totalSkus, lowStockCount, admin, topOffset, demo }: AdminShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const path = usePathname();
  const router = useRouter();
  const search = useRef<HTMLInputElement>(null);

  // Persist collapse preference; keyboard shortcut for search.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a persisted preference after hydration
    try { if (localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true); } catch {}
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); search.current?.focus(); search.current?.select(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleCollapse() {
    setCollapsed((c) => { try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch {} return !c; });
  }

  // Global search: order numbers go to the order queue, anything else to inventory.
  function onSearch(e: FormEvent) {
    e.preventDefault();
    const q = search.current?.value.trim() ?? "";
    if (!q) return;
    if (/^dt-?\d+$/i.test(q)) router.push(`/admin/orders?q=${encodeURIComponent(q)}`);
    else if (/^[a-z]{3}-\d{4}$/i.test(q)) router.push(`/admin/inventory?q=${encodeURIComponent(q)}`);
    else router.push(`/admin/inventory?q=${encodeURIComponent(q)}`);
    search.current?.blur();
  }

  const sidebar = (
    <>
      <div className="flex items-center gap-2.5 px-1">
        <div className="w-[30px] h-[30px] shrink-0 rounded-[7px] bg-accent flex items-center justify-center font-mono font-semibold text-[13px] text-white">DT</div>
        {(!collapsed || drawer) && (
          <div className="leading-[1.15] overflow-hidden">
            <div className="text-[13px] font-semibold text-white whitespace-nowrap">Dynamic Traders</div>
            <div className="text-[10px] tracking-[.1em] uppercase text-sidebar-muted">Admin console</div>
          </div>
        )}
      </div>

      <nav className="flex flex-col gap-[3px]" aria-label="Admin">
        {NAV.map(([href, label]) => {
          const on = href === "/admin" ? path === "/admin" : path.startsWith(href);
          const badge = href === "/admin/orders" && pendingCount > 0 ? pendingCount : null;
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-current={on ? "page" : undefined}
              onClick={() => setDrawer(false)}
              className={`flex items-center gap-2.5 rounded-[7px] px-2.5 py-[9px] text-[13px] border-l-[3px] ${on ? "bg-navy-hover text-white font-semibold border-accent hover:text-white" : "text-sidebar-text font-medium border-transparent hover:text-white hover:bg-[#16304b]"}`}
            >
              <span className={`w-2 h-2 shrink-0 rounded-sm ${on ? "bg-[#7fb4ec]" : "bg-[#5a7591]"}`} />
              {(!collapsed || drawer) && <span className="whitespace-nowrap flex-1">{label}</span>}
              {(!collapsed || drawer) && badge && <span className="font-mono text-[10.5px] bg-danger text-white rounded-full px-1.5 py-px">{badge}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2.5">
        {(!collapsed || drawer) && (
          <Link href="/admin/inventory" className="border border-sidebar-line bg-sidebar-card rounded-lg p-2.5 block hover:border-accent">
            <div className="text-[10px] tracking-[.1em] uppercase text-sidebar-muted font-semibold">Catalog health</div>
            <div className="font-mono text-lg text-white mt-1">{num(totalSkus)} SKUs</div>
            <div className={`text-[11px] mt-0.5 ${lowStockCount ? "text-warning-dot" : "text-[#7fd4a4]"}`}>{lowStockCount ? `${lowStockCount} below reorder point` : "All stock above reorder point"}</div>
          </Link>
        )}
        <button
          type="button"
          onClick={toggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden lg:block bg-transparent border border-sidebar-line text-[#9fb6cd] rounded-[7px] p-2 text-[11px] cursor-pointer font-mono tracking-[.06em] hover:text-white"
        >
          {collapsed ? "»" : "« Collapse"}
        </button>
      </div>
    </>
  );

  return (
    <div className="flex items-stretch flex-1 min-h-0">
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex shrink-0 bg-sidebar text-[#c7d5e5] flex-col p-3 pt-4 gap-[18px] transition-[width] duration-150 sticky self-start"
        style={{ width: collapsed ? 74 : 232, top: topOffset, height: `calc(100vh - ${topOffset}px)` }}
      >
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-[70] bg-[rgba(15,27,43,.5)]" onClick={() => setDrawer(false)}>
          <aside className="w-[260px] h-full bg-sidebar text-[#c7d5e5] flex flex-col p-3 pt-4 gap-[18px] shadow-[20px_0_50px_rgba(15,27,43,.35)]" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col bg-canvas">
        <header className="bg-surface border-b border-border px-3 sm:px-5 py-2.5 sm:py-3 flex items-center gap-2.5 sm:gap-3.5 sticky z-20" style={{ top: topOffset }}>
          <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu" className="lg:hidden shrink-0 w-9 h-9 rounded-lg border border-border bg-surface text-slate-dark cursor-pointer flex flex-col items-center justify-center gap-[3px]">
            <span className="w-4 h-[1.5px] bg-current" /><span className="w-4 h-[1.5px] bg-current" /><span className="w-4 h-[1.5px] bg-current" />
          </button>
          <form onSubmit={onSearch} role="search" className="flex-1 min-w-0 max-w-[460px] flex items-center gap-2 bg-canvas border border-border rounded-lg px-[11px] py-2 focus-within:border-accent">
            <span className="font-mono text-xs text-muted" aria-hidden>⌕</span>
            <input ref={search} placeholder="Search SKU, order number…" aria-label="Search" className="flex-1 min-w-0 border-0 bg-transparent outline-none text-[13px] text-ink" />
            <span className="hidden sm:inline font-mono text-[10px] text-muted border border-border bg-surface rounded px-[5px] py-px" aria-hidden>⌘K</span>
          </form>
          <div className="flex items-center gap-2.5 ml-auto">
            <Link href="/admin/orders?status=pending" className="relative flex items-center gap-[7px] border border-border bg-surface rounded-lg px-[11px] py-[7px] text-xs font-medium text-slate-dark hover:border-accent hover:text-navy-hover">
              <span className={`w-[7px] h-[7px] rounded-full ${pendingCount ? "bg-danger" : "bg-border-strong"}`} />
              <span className="hidden sm:inline">New orders</span>
              {pendingCount > 0 && <span className="font-mono text-[11px] bg-danger text-white rounded-[9px] px-1.5 py-px">{pendingCount}</span>}
            </Link>
            <div className="w-px h-[26px] bg-border hidden sm:block" />
            <div className="flex items-center gap-[9px]">
              <div className="w-8 h-8 rounded-full bg-navy text-white flex items-center justify-center text-xs font-semibold" title={admin.name}>{admin.initials}</div>
              <div className="leading-[1.2] hidden md:block">
                <div className="text-[12.5px] font-semibold">{admin.name}</div>
                <div className="text-[11px] text-slate">{admin.title}</div>
              </div>
              {!demo && (
                <button type="button" onClick={() => signOut().then(() => router.push("/login"))} className="text-[11.5px] text-slate bg-transparent border-0 cursor-pointer hover:text-danger">Sign out</button>
              )}
            </div>
          </div>
        </header>

        <main className="px-3 sm:px-5 pt-4 sm:pt-[22px] pb-10 flex flex-col gap-5">{children}</main>
      </div>
    </div>
  );
}
