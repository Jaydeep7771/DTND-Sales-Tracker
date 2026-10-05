import Link from "next/link";
import RegistrationForm from "@/components/RegistrationForm";

export const metadata = { title: "Apply for a trade account · Dynamic Traders" };

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-border bg-surface">
        <div className="max-w-[860px] mx-auto px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-[7px] bg-navy text-white font-mono text-[11px] flex items-center justify-center">DT</span>
            <div>
              <div className="text-[14px] font-semibold leading-tight">Dynamic Traders &amp; Distributors</div>
              <div className="text-[10.5px] tracking-[.09em] uppercase text-slate">Wholesale distribution</div>
            </div>
          </div>
          <Link href="/login" className="text-[13px] text-navy-hover no-underline">Sign in</Link>
        </div>
      </header>

      <main className="max-w-[860px] mx-auto px-5 py-8 sm:py-12">
        <h1 className="text-[26px] font-semibold tracking-[-.01em]">Apply for a trade account</h1>
        <p className="text-[14px] text-slate mt-2 max-w-[560px] leading-relaxed">
          Wholesale pricing, monthly terms and an online portal to place and track orders.
          Tell us about your business and we will come back within two business days.
        </p>

        <div className="mt-7">
          <RegistrationForm />
        </div>
      </main>
    </div>
  );
}
