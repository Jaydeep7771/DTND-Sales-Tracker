"use client";

/**
 * Company settings.
 *
 * Laid out as one scrolling page with a sticky section rail rather than
 * tabs: settings are read far more often than changed, and a finance user
 * checking "what rate are we on?" should not have to guess which tab it
 * lives behind. One save button covers the page, and it stays disabled
 * until something actually changes, so there is no doubt about whether an
 * edit was committed.
 *
 * The invoice preview on the right redraws as you type. Template, accent
 * colour and currency notation are hard to judge from a form field, and
 * the alternative is issuing a real invoice to find out.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input, Select, Textarea, Toggle } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { updateCompanySettings, type SettingsPatch } from "@/lib/settings-actions";
import { CURRENCIES, currencyFromSettings, currencyPrefix, percent } from "@/lib/money";
import InvoicePreview from "./InvoicePreview";
import type { CompanySettings } from "@/types/database";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const SECTIONS = [
  { id: "identity", label: "Company" },
  { id: "currency", label: "Currency" },
  { id: "tax", label: "Tax" },
  { id: "invoicing", label: "Invoicing" },
  { id: "template", label: "Invoice design" },
  { id: "fiscal", label: "Fiscal year" },
] as const;

const TEMPLATES: { id: "classic" | "modern" | "compact"; name: string; note: string }[] = [
  { id: "classic", name: "Classic", note: "Restrained letterhead. Reads as a formal tax document." },
  { id: "modern", name: "Modern", note: "Accent banner across the head and a filled total." },
  { id: "compact", name: "Compact", note: "Tighter rows, for orders with many line items." },
];

// Mirrors the font check in invoice-pdf.tsx: the embedded IBM Plex subset
// covers Latin-1 and the euro, so other marks cannot be printed.
const PDF_SAFE_SYMBOL = /^[ -~ -ÿ€]+$/;

const SWATCHES = ["#123A5E", "#0B6539", "#7C2D12", "#4C1D95", "#0E7490", "#111827"];

function SectionCard({ id, title, sub, children }: { id: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-24">
      <div className="px-5 py-4 border-b border-border">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-slate mt-0.5">{sub}</div>
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

export default function SettingsForm({ initial }: { initial: CompanySettings }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CompanySettings>(initial);

  // The rate is stored as a fraction but entered as a percentage, which is
  // how everyone talks about it. Kept as a string so "17." is typeable.
  const [ratePct, setRatePct] = useState(() => String(Number((initial.default_tax_rate * 100).toFixed(4))));

  function set<K extends keyof CompanySettings>(key: K, value: CompanySettings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const parsedRate = Number(ratePct) / 100;
  const rateValid = ratePct.trim() !== "" && Number.isFinite(parsedRate) && parsedRate >= 0 && parsedRate <= 1;

  const dirty = useMemo(() => {
    if (Math.abs(parsedRate - initial.default_tax_rate) > 1e-9 && rateValid) return true;
    return (Object.keys(form) as (keyof CompanySettings)[]).some((k) => k !== "default_tax_rate" && k !== "updated_at" && form[k] !== initial[k]);
  }, [form, initial, parsedRate, rateValid]);

  function save() {
    setError(null);
    if (!rateValid) return setError("Enter the tax rate as a percentage between 0 and 100.");

    const patch: SettingsPatch = { ...form, default_tax_rate: Number(parsedRate.toFixed(6)) };
    delete (patch as Record<string, unknown>).id;
    delete (patch as Record<string, unknown>).updated_at;

    start(async () => {
      const res = await updateCompanySettings(patch);
      if (!res.ok) return setError(res.error);
      toast.push("Settings saved", "success");
      if (res.data?.warning) toast.push(res.data.warning, "info");
      router.refresh();
    });
  }

  const cur = currencyFromSettings(form);
  const sample = 213816.5;

  return (
    <div className="flex flex-col gap-5">
      {/* Sticky action bar: the page is long, so saving must never be off-screen. */}
      <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-canvas/95 backdrop-blur flex items-center justify-between gap-3 flex-wrap">
        <nav className="flex gap-1 flex-wrap">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="text-[12px] text-slate hover:text-navy-hover border border-border rounded-full px-2.5 py-1 bg-surface">
              {s.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2.5">
          {dirty ? <Badge tone="warning">Unsaved changes</Badge> : <span className="text-[12px] text-slate">All changes saved</span>}
          <Button onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : "Save settings"}</Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-danger-bg border border-danger-bd px-3.5 py-2.5 text-[13px] text-danger">{error}</p>
      )}

      <div className="grid gap-5 items-start grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-5 min-w-0">
          {/* ------------------------------------------------- company */}
          <SectionCard id="identity" title="Company" sub="Printed at the top of every invoice and used as the sender on email.">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <Field label="Legal name" className="sm:col-span-2">
                <Input value={form.legal_name} onChange={(e) => set("legal_name", e.target.value)} />
              </Field>
              <Field label="Tagline">
                <Input value={form.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="Wholesale distribution" />
              </Field>
              <Field label="Logo initials">
                <Input value={form.logo_initials} maxLength={3} onChange={(e) => set("logo_initials", e.target.value.toUpperCase())} />
              </Field>
              <Field label="Address" className="sm:col-span-2">
                <Textarea rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} />
              </Field>
              <Field label="City">
                <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
              </Field>
              <Field label="Country">
                <Input value={form.country} onChange={(e) => set("country", e.target.value)} />
              </Field>
              <Field label="Phone">
                <Input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value || null)} />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value || null)} />
              </Field>
            </div>
          </SectionCard>

          {/* ------------------------------------------------- currency */}
          <SectionCard id="currency" title="Currency and numbers" sub="Applies across the admin console, the customer portal and every PDF.">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <Field label="Currency">
                <Select
                  value={form.currency_code}
                  onChange={(e) => {
                    const c = CURRENCIES.find((x) => x.code === e.target.value);
                    setForm((f) => ({ ...f, currency_code: e.target.value, currency_symbol: c?.symbol ?? f.currency_symbol }));
                  }}
                >
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                </Select>
              </Field>
              <Field label="Symbol">
                <Input value={form.currency_symbol} maxLength={4} onChange={(e) => set("currency_symbol", e.target.value)} />
              </Field>
              <Field label="Show amounts as">
                <Select value={form.currency_display} onChange={(e) => set("currency_display", e.target.value as "code" | "symbol")}>
                  <option value="code">Code — {form.currency_code} 1,000</option>
                  <option value="symbol">Symbol — {form.currency_symbol} 1,000</option>
                </Select>
              </Field>
              <Field label="Decimal places">
                <Select value={String(form.decimal_places)} onChange={(e) => set("decimal_places", Number(e.target.value))}>
                  <option value="0">0 — whole units</option>
                  <option value="2">2 — paisa / cents</option>
                  <option value="3">3</option>
                </Select>
              </Field>
              <Field label="Digit grouping" className="sm:col-span-2">
                <Select value={form.number_locale} onChange={(e) => set("number_locale", e.target.value)}>
                  <option value="en-US">International — 1,234,567</option>
                  <option value="en-IN">Lakh and crore — 12,34,567</option>
                </Select>
              </Field>
            </div>
            {form.currency_display === "symbol" && !PDF_SAFE_SYMBOL.test(form.currency_symbol) && (
              <p className="mt-3.5 text-[12px] text-warning bg-warning-bg border border-warning-bd rounded-lg px-3 py-2">
                The PDF font has no glyph for “{form.currency_symbol}”, so invoices will print
                “{form.currency_code}” instead. Screens still show the symbol.
              </p>
            )}
            <div className="mt-4 rounded-lg bg-surface-soft border border-border px-3.5 py-2.5 flex items-baseline justify-between gap-3">
              <span className="label">Preview</span>
              <span className="font-mono text-[15px] font-semibold">
                {currencyPrefix(cur)} {sample.toLocaleString(cur.locale, { minimumFractionDigits: cur.decimals, maximumFractionDigits: cur.decimals })}
              </span>
            </div>
          </SectionCard>

          {/* ------------------------------------------------- tax */}
          <SectionCard id="tax" title="Tax" sub="One rate, read by the catalogue, the cart, the order screens and invoices alike.">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <Field label="Rate (%)">
                <Input mono inputMode="decimal" value={ratePct} onChange={(e) => setRatePct(e.target.value)} />
              </Field>
              <Field label="What to call it">
                <Select value={form.tax_label} onChange={(e) => set("tax_label", e.target.value)}>
                  {["Sales Tax", "GST", "VAT", "Tax"].map((l) => <option key={l} value={l}>{l}</option>)}
                </Select>
              </Field>
              <Field label="NTN">
                <Input mono value={form.ntn ?? ""} onChange={(e) => set("ntn", e.target.value || null)} placeholder="0000000-0" />
              </Field>
              <Field label="STRN">
                <Input mono value={form.strn ?? ""} onChange={(e) => set("strn", e.target.value || null)} />
              </Field>
            </div>
            <p className="mt-3.5 text-[12px] text-slate leading-relaxed">
              {rateValid
                ? <>Quoted as <strong className="text-ink">{form.tax_label} {percent(parsedRate)}</strong> on the cart, at checkout and on invoices.</>
                : <span className="text-danger">Enter a percentage between 0 and 100.</span>}
              {" "}Changing it affects new orders and new invoices only; anything already issued keeps the rate it was raised at.
            </p>
          </SectionCard>

          {/* ------------------------------------------------- invoicing */}
          <SectionCard id="invoicing" title="Invoicing" sub="Numbering, payment terms and the details printed on each document.">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
              <Field label="Invoice prefix">
                <Input mono value={form.invoice_prefix} onChange={(e) => set("invoice_prefix", e.target.value.toUpperCase())} />
              </Field>
              <Field label="Credit note prefix">
                <Input mono value={form.credit_note_prefix} onChange={(e) => set("credit_note_prefix", e.target.value.toUpperCase())} />
              </Field>
              <Field label="Payment terms (days)">
                <Input mono type="number" min="0" value={form.default_terms_days} onChange={(e) => set("default_terms_days", Math.max(0, Number(e.target.value) || 0))} />
              </Field>
              <Field label="Bank and payment instructions" className="sm:col-span-3">
                <Textarea rows={3} value={form.bank_details ?? ""} onChange={(e) => set("bank_details", e.target.value || null)} placeholder={"Meezan Bank, SITE Branch\nAccount title: Dynamic Traders & Distributors\nIBAN: PK00MEZN0000000000000000"} />
              </Field>
              <Field label="Default note on new invoices" className="sm:col-span-3">
                <Textarea rows={2} value={form.invoice_default_notes ?? ""} onChange={(e) => set("invoice_default_notes", e.target.value || null)} placeholder="Goods remain the property of the seller until paid in full." />
              </Field>
            </div>
            <p className="mt-3.5 text-[12px] text-slate">
              Next number in this series: <span className="font-mono text-ink">{form.invoice_prefix}-····-00001</span> onwards.
              Changing the prefix starts a new series; issued invoices keep their numbers.
            </p>
          </SectionCard>

          {/* ------------------------------------------------- design */}
          <SectionCard id="template" title="Invoice design" sub="Chosen here, frozen onto each invoice as it is issued.">
            <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-3">
              {TEMPLATES.map((t) => {
                const on = form.invoice_template === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => set("invoice_template", t.id)}
                    aria-pressed={on}
                    className={`text-left rounded-lg border p-3 cursor-pointer bg-surface transition-colors ${on ? "border-accent ring-2 ring-accent/25" : "border-border hover:border-border-strong"}`}
                  >
                    <TemplateThumb template={t.id} accent={form.accent_color} />
                    <div className="text-[13px] font-semibold mt-2.5">{t.name}</div>
                    <div className="text-[11.5px] text-slate mt-0.5 leading-snug">{t.note}</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 grid gap-4 grid-cols-1 sm:grid-cols-2">
              <Field label="Accent colour">
                <div className="flex items-center gap-2 flex-wrap">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      onClick={() => set("accent_color", c)}
                      className={`w-7 h-7 rounded-full cursor-pointer border-2 ${form.accent_color.toLowerCase() === c.toLowerCase() ? "border-ink" : "border-transparent"}`}
                      style={{ background: c }}
                    />
                  ))}
                  <Input mono value={form.accent_color} onChange={(e) => set("accent_color", e.target.value)} className="w-[110px]" />
                </div>
              </Field>
              <Field label="Footer line">
                <Input value={form.invoice_footer_note ?? ""} onChange={(e) => set("invoice_footer_note", e.target.value || null)} placeholder="Thank you for your business." />
              </Field>
            </div>

            <div className="mt-4 divide-y divide-border-soft border border-border rounded-lg">
              {([
                ["invoice_show_bank", "Print payment details", "Bank instructions appear in the note block."],
                ["invoice_show_tax_ids", "Print NTN and STRN", "Required on a tax invoice in Pakistan."],
                ["invoice_show_signature", "Signature line", "A ruled line for an authorised signatory."],
              ] as const).map(([key, label, note]) => (
                <div key={key} className="flex items-center justify-between gap-4 px-3.5 py-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium">{label}</div>
                    <div className="text-[11.5px] text-slate mt-0.5">{note}</div>
                  </div>
                  <Toggle on={form[key]} label={label} onChange={(v) => set(key, v)} />
                </div>
              ))}
            </div>
          </SectionCard>

          {/* ------------------------------------------------- fiscal */}
          <SectionCard id="fiscal" title="Fiscal year" sub="Scopes invoice numbering and the ledger's year label.">
            <Field label="Year starts in" className="sm:max-w-[280px]">
              <Select value={String(form.fiscal_year_start_month)} onChange={(e) => set("fiscal_year_start_month", Number(e.target.value))}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </Select>
            </Field>
            <p className="mt-3 text-[12px] text-slate">
              July is the Pakistani tax year. Moving this changes which year new documents are numbered under.
            </p>
          </SectionCard>
        </div>

        {/* Live preview, sticky so it stays beside whichever section is being edited. */}
        <div className="xl:sticky xl:top-16">
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
              <div>
                <div className="text-[13px] font-semibold">Invoice preview</div>
                <div className="text-[11.5px] text-slate mt-0.5">Updates as you type.</div>
              </div>
              <Badge tone="info">{TEMPLATES.find((t) => t.id === form.invoice_template)?.name}</Badge>
            </div>
            <div className="p-4 bg-surface-soft">
              <InvoicePreview settings={{ ...form, default_tax_rate: rateValid ? parsedRate : initial.default_tax_rate }} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** A 3-line sketch of each template, enough to tell them apart at a glance. */
function TemplateThumb({ template, accent }: { template: "classic" | "modern" | "compact"; accent: string }) {
  const rows = template === "compact" ? 6 : 4;
  return (
    <div className="h-[72px] rounded-md border border-border bg-white overflow-hidden flex flex-col">
      {template === "modern" ? (
        <div className="h-[18px] flex items-center px-2 gap-1" style={{ background: accent }}>
          <span className="w-2 h-2 rounded-[2px] bg-white/70" />
          <span className="h-1 w-8 rounded-full bg-white/60" />
        </div>
      ) : (
        <div className="h-[18px] flex items-center px-2 gap-1 border-b border-border-soft">
          <span className="w-2 h-2 rounded-[2px]" style={{ background: accent }} />
          <span className="h-1 w-8 rounded-full bg-border-strong" />
        </div>
      )}
      <div className="flex-1 px-2 py-1.5 flex flex-col justify-start gap-[3px]">
        {Array.from({ length: rows }).map((_, i) => (
          <span key={i} className="h-[2px] rounded-full bg-border-strong" style={{ width: `${90 - i * 7}%` }} />
        ))}
      </div>
      <div className="px-2 pb-1.5">
        <span className="block h-[5px] w-1/2 ml-auto rounded-[2px]" style={{ background: template === "modern" ? accent : "var(--color-border-strong, #CBD5E1)" }} />
      </div>
    </div>
  );
}
