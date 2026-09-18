"use client";

// Wholesale portal header + slide-in cart drawer.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useCart } from "./CartProvider";
import { money, num } from "@/lib/format";

const NAV: [string, string][] = [["/portal", "Shop"], ["/portal/orders", "Order history"]];

export default function PortalHeader({ company, account, topOffset }: { company: string; account: string; topOffset: number }) {
  const path = usePathname();
  const router = useRouter();
  const cart = useCart();

  return (
    <>
      <header className="bg-surface border-b border-border sticky z-20" style={{ top: topOffset }}>
        <div className="max-w-[1280px] mx-auto px-5 py-3.5 flex items-center gap-[22px] flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0 flex-[1_1_220px]">
            <div className="w-8 h-8 shrink-0 rounded-[7px] bg-navy text-white flex items-center justify-center font-mono text-[13px] font-semibold">DT</div>
            <div className="leading-[1.15] min-w-0">
              <div className="text-[14.5px] font-semibold tracking-[-.01em]">Dynamic Traders &amp; Distributors</div>
              <div className="text-[10.5px] tracking-[.09em] uppercase text-slate">Wholesale portal</div>
            </div>
          </div>
          <nav className="flex gap-1 ml-3">
            {NAV.map(([href, label]) => {
              const on = href === "/portal" ? path === "/portal" || path === "/portal/checkout" : path.startsWith(href);
              return (
                <Link key={href} href={href} className={`rounded-[7px] px-[13px] py-2 text-[13.5px] ${on ? "bg-selected text-navy font-semibold hover:text-navy" : "text-slate-strong font-medium"}`}>{label}</Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-3 ml-auto shrink-0">
            <div className="text-right leading-[1.3] min-w-0">
              <div className="text-[12.5px] font-semibold whitespace-nowrap">{company}</div>
              <div className="text-[11px] text-slate whitespace-nowrap">{account} · Net 30</div>
            </div>
            <Button onClick={() => cart.setOpen(true)}>
              Cart
              <span className="font-mono text-[11.5px] bg-accent rounded-full px-[7px] py-px">{cart.lines.length}</span>
            </Button>
          </div>
        </div>
      </header>

      {cart.open && (
        <div className="fixed inset-0 z-[80] flex justify-end bg-[rgba(15,27,43,.45)]" onClick={() => cart.setOpen(false)}>
          <div className="w-full max-w-[420px] bg-surface flex flex-col shadow-[-20px_0_50px_rgba(15,27,43,.25)]" onClick={(e) => e.stopPropagation()}>
            <div className="px-[18px] py-4 border-b border-border flex items-center justify-between">
              <div>
                <div className="text-[15px] font-semibold">Your cart</div>
                <div className="text-xs text-slate mt-0.5">{cart.lines.length} line items · prices locked at submit</div>
              </div>
              <button type="button" onClick={() => cart.setOpen(false)} aria-label="Close" className="border border-border bg-surface text-slate rounded-[7px] w-[30px] h-[30px] text-[15px] cursor-pointer hover:border-muted">×</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {cart.lines.length === 0 && <div className="p-6 text-[13px] text-slate">Your cart is empty. Add products from the catalog.</div>}
              {cart.lines.map((l) => (
                <div key={l.product_id} className="flex gap-3 px-[18px] py-3.5 border-b border-border-soft">
                  <div className="hatch w-12 h-12 shrink-0 rounded-[7px]" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold">{l.name}</div>
                    <div className="font-mono text-[11px] text-slate mt-[3px]">{num(l.quantity)} × {money(l.unit_price)}</div>
                    <button type="button" onClick={() => cart.remove(l.product_id)} className="text-[11px] text-danger bg-transparent border-0 p-0 mt-1 cursor-pointer">Remove</button>
                  </div>
                  <div className="font-mono text-[13px] font-semibold">{money(l.unit_price * l.quantity)}</div>
                </div>
              ))}
            </div>
            <div className="px-[18px] py-4 border-t border-border flex flex-col gap-[11px] bg-surface-softer">
              <div className="flex justify-between items-baseline">
                <span className="text-[13px] text-slate-strong">Estimated total</span>
                <span className="font-mono text-xl font-semibold">{money(cart.total)}</span>
              </div>
              <Button size="lg" disabled={cart.lines.length === 0} onClick={() => { cart.setOpen(false); router.push("/portal/checkout"); }}>Review &amp; submit order</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
