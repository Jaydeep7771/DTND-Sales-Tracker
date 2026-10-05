"use client";

/**
 * Public trade account application.
 *
 * Grouped into who you are, where you trade, and tax identity, because a
 * single column of fourteen inputs is where applicants give up. Tax
 * details are optional: chasing an NTN before someone has even been
 * accepted loses applications, and it can be collected at approval.
 */
import { useState, useTransition, type FormEvent } from "react";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { submitRegistration } from "@/lib/registration-actions";
import { BUSINESS_TYPES } from "@/lib/registration";

const EMPTY = {
  company_name: "", contact_name: "", email: "", phone: "",
  address: "", city: "Karachi", ntn: "", strn: "",
  business_type: BUSINESS_TYPES[0], years_trading: "", note: "",
};

export default function RegistrationForm() {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await submitRegistration(form);
      if (!res.ok) return setError(res.error);
      setDone(res.data!.reference);
    });
  }

  if (done) {
    return (
      <Card className="px-6 py-10 text-center">
        <div className="w-11 h-11 rounded-full bg-success-bg border border-success-bd mx-auto flex items-center justify-center">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-success">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        </div>
        <h2 className="text-[19px] font-semibold mt-4">Application received</h2>
        <p className="text-[13.5px] text-slate mt-2 max-w-[440px] mx-auto leading-relaxed">
          Your reference is <span className="font-mono text-ink">{done}</span>. We review trade applications
          within two business days. If it is approved you will get an email with a link to set your password
          and start ordering.
        </p>
        <p className="text-[12.5px] text-muted mt-4">
          Already have an account? <a href="/login" className="text-navy-hover">Sign in</a>
        </p>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      {error && (
        <p role="alert" className="rounded-lg bg-danger-bg border border-danger-bd px-3.5 py-2.5 text-[13px] text-danger">
          {error}
        </p>
      )}

      <Card className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border">
          <div className="text-sm font-semibold">Your business</div>
          <div className="text-xs text-slate mt-0.5">As it appears on your registration and invoices.</div>
        </div>
        <div className="p-5 grid gap-3.5 grid-cols-1 sm:grid-cols-2">
          <Field label="Registered business name" className="sm:col-span-2">
            <Input required value={form.company_name} onChange={set("company_name")} placeholder="e.g. Clifton Hardware Mart" />
          </Field>
          <Field label="Type of business">
            <Select value={form.business_type} onChange={set("business_type")}>
              {BUSINESS_TYPES.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Years trading">
            <Input mono type="number" min="0" max="200" value={form.years_trading} onChange={set("years_trading")} placeholder="Optional" />
          </Field>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border">
          <div className="text-sm font-semibold">Who we deal with</div>
          <div className="text-xs text-slate mt-0.5">The person who will place and approve orders.</div>
        </div>
        <div className="p-5 grid gap-3.5 grid-cols-1 sm:grid-cols-2">
          <Field label="Contact name">
            <Input required value={form.contact_name} onChange={set("contact_name")} />
          </Field>
          <Field label="Phone">
            <Input required type="tel" value={form.phone} onChange={set("phone")} placeholder="+92 300 0000000" />
          </Field>
          <Field label="Email" className="sm:col-span-2">
            <Input required type="email" value={form.email} onChange={set("email")} placeholder="name@company.pk" />
            <span className="text-[11.5px] text-slate">This becomes your sign-in if we open the account.</span>
          </Field>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border">
          <div className="text-sm font-semibold">Where we deliver</div>
        </div>
        <div className="p-5 grid gap-3.5 grid-cols-1 sm:grid-cols-[minmax(0,1fr)_200px]">
          <Field label="Address">
            <Textarea required rows={2} value={form.address} onChange={set("address")} placeholder="Shop or unit, street, area" />
          </Field>
          <Field label="City">
            <Input required value={form.city} onChange={set("city")} />
          </Field>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border">
          <div className="text-sm font-semibold">Tax details</div>
          <div className="text-xs text-slate mt-0.5">
            Optional now. We need them before we can issue you a tax invoice, so sending them saves a step later.
          </div>
        </div>
        <div className="p-5 grid gap-3.5 grid-cols-1 sm:grid-cols-2">
          <Field label="NTN">
            <Input mono value={form.ntn} onChange={set("ntn")} placeholder="0000000-0" />
          </Field>
          <Field label="STRN">
            <Input mono value={form.strn} onChange={set("strn")} placeholder="00-00-0000-000-00" />
          </Field>
          <Field label="Anything else we should know" className="sm:col-span-2">
            <Textarea rows={2} value={form.note} onChange={set("note")} placeholder="Optional — volumes, references, the lines you buy most" />
          </Field>
        </div>
      </Card>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[12px] text-slate max-w-[420px] leading-relaxed">
          Trade accounts are reviewed before they open, usually within two business days.
          Submitting this does not create an account or a credit line.
        </p>
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? "Submitting…" : "Apply for a trade account"}
        </Button>
      </div>
    </form>
  );
}
