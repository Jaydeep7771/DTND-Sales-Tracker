"use client";

/**
 * An HTML stand-in for the invoice PDF, so the template, accent colour and
 * currency notation can be judged while editing rather than by issuing a
 * real document and opening the attachment.
 *
 * It deliberately mirrors invoice-pdf.tsx rather than sharing code with
 * it: @react-pdf/renderer cannot run in the browser, and keeping the
 * preview as plain markup means it costs nothing to render on every
 * keystroke. The numbers are a fixed sample, not live data.
 */
import { currencyFromSettings, currencyPrefix, percent } from "@/lib/money";
import type { CompanySettings } from "@/types/database";

const SAMPLE = [
  { name: "Tapal Danedar Black Tea", sku: "TEA-TPL-900", qty: 24, rate: 1450 },
  { name: "Nestlé Milkpak UHT 1L", sku: "DRY-NSL-1000", qty: 48, rate: 310 },
  { name: "Sufi Cooking Oil 5L", sku: "OIL-SUF-5000", qty: 12, rate: 2890 },
];

export default function InvoicePreview({ settings }: { settings: CompanySettings }) {
  const cur = currencyFromSettings(settings);
  const fmt = (n: number) =>
    n.toLocaleString(cur.locale, { minimumFractionDigits: cur.decimals, maximumFractionDigits: cur.decimals });
  const withCur = (n: number) => `${currencyPrefix(cur)} ${fmt(n)}`;

  const subtotal = SAMPLE.reduce((a, l) => a + l.qty * l.rate, 0);
  const tax = Math.round(subtotal * settings.default_tax_rate);
  const total = subtotal + tax;

  const accent = settings.accent_color;
  const modern = settings.invoice_template === "modern";
  const compact = settings.invoice_template === "compact";
  const pad = compact ? "px-4 py-3.5" : "px-5 py-4";

  const brand = (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-2">
        <span
          className={`w-[22px] h-[22px] rounded-[4px] text-[8px] font-mono flex items-center justify-center shrink-0 ${modern ? "text-white border border-white/55" : "text-white"}`}
          style={modern ? undefined : { background: accent }}
        >
          {settings.logo_initials}
        </span>
        <div className="min-w-0">
          <div className={`font-semibold leading-tight ${compact ? "text-[10px]" : "text-[11px]"} ${modern ? "text-white" : "text-ink"}`}>
            {settings.legal_name}
          </div>
          <div className={`text-[7px] uppercase tracking-[.09em] mt-0.5 ${modern ? "text-white/75" : "text-slate"}`}>
            {settings.tagline}
          </div>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={`font-semibold ${compact ? "text-[12px]" : "text-[14px]"} ${modern ? "text-white" : "text-ink"}`}>Tax Invoice</div>
        <div className={`font-mono text-[9px] mt-0.5 ${modern ? "text-white/85" : "text-slate-strong"}`}>
          {settings.invoice_prefix}-2627-00042
        </div>
      </div>
    </div>
  );

  return (
    <div className="bg-white rounded-md border border-border overflow-hidden shadow-[0_1px_3px_rgba(15,27,43,.08)] text-ink">
      {modern ? <div className="px-4 py-3.5" style={{ background: accent }}>{brand}</div> : <div className={`${pad} border-b border-border-soft`}>{brand}</div>}

      <div className={pad}>
        {/* parties */}
        <div className="flex gap-4 mb-3">
          {[
            { heading: "From", name: settings.legal_name, line: [settings.city, settings.country].filter(Boolean).join(", "), ntn: settings.ntn },
            { heading: "Bill to", name: "Al-Rehman Kiryana Store", line: "Gulshan-e-Iqbal, Karachi", ntn: "4567890-1" },
          ].map((p) => (
            <div key={p.heading} className="flex-1 min-w-0">
              <div className="text-[7px] uppercase tracking-[.09em] text-slate font-semibold">{p.heading}</div>
              <div className="text-[9px] font-semibold mt-1 truncate">{p.name}</div>
              <div className="text-[8px] text-slate truncate">{p.line}</div>
              {settings.invoice_show_tax_ids && p.ntn && (
                <div className="text-[7.5px] text-slate font-mono mt-0.5">NTN {p.ntn}</div>
              )}
            </div>
          ))}
          <div className="w-[82px] shrink-0 text-[8px]">
            {[["Issued", "03 Oct 2026"], ["Due", `Net ${settings.default_terms_days}`]].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-1">
                <span className="text-slate">{k}</span>
                <span className="font-semibold">{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* lines */}
        <div className="border-b pb-1 mb-0.5 flex text-[7px] uppercase tracking-[.08em] text-slate font-semibold" style={{ borderColor: modern ? accent : "#0F1B2B" }}>
          <span className="flex-1">Description</span>
          <span className="w-[30px] text-right">Qty</span>
          <span className="w-[52px] text-right">Amount</span>
        </div>
        {SAMPLE.map((l) => (
          <div key={l.sku} className={`flex border-b border-border-soft ${compact ? "py-1" : "py-1.5"}`}>
            <div className="flex-1 min-w-0 pr-2">
              <div className="text-[8.5px] font-semibold truncate">{l.name}</div>
              <div className="text-[7px] text-slate font-mono">{l.sku}</div>
            </div>
            <span className="w-[30px] text-right text-[8.5px] font-mono self-center">{l.qty}</span>
            <span className="w-[52px] text-right text-[8.5px] font-mono font-semibold self-center">{fmt(l.qty * l.rate)}</span>
          </div>
        ))}

        {/* totals */}
        <div className="flex justify-end mt-2">
          <div className="w-[160px]">
            <div className="flex justify-between text-[8.5px] py-0.5">
              <span className="text-slate">Subtotal</span>
              <span className="font-mono">{withCur(subtotal)}</span>
            </div>
            <div className="flex justify-between text-[8.5px] py-0.5">
              <span className="text-slate">{settings.tax_label} {percent(settings.default_tax_rate)}</span>
              <span className="font-mono">{withCur(tax)}</span>
            </div>
            <div
              className={`flex justify-between items-baseline mt-1 ${modern ? "rounded-[3px] px-2 py-1.5 text-white" : "pt-1.5 border-t border-ink"}`}
              style={modern ? { background: accent } : undefined}
            >
              <span className="text-[9px] font-semibold">Total due</span>
              <span className="text-[10.5px] font-mono font-semibold">{withCur(total)}</span>
            </div>
          </div>
        </div>

        {settings.invoice_show_bank && settings.bank_details && (
          <div className="mt-3 rounded-[3px] bg-surface-soft px-2.5 py-2">
            <div className="text-[7px] uppercase tracking-[.09em] text-slate font-semibold mb-0.5">Payment details</div>
            <div className="text-[7.5px] font-mono text-slate-strong whitespace-pre-line line-clamp-3">{settings.bank_details}</div>
          </div>
        )}

        {settings.invoice_show_signature && (
          <div className="mt-5 flex justify-end">
            <div className="w-[120px] border-t border-ink pt-1 text-center text-[7px] text-slate">Authorised signatory</div>
          </div>
        )}

        {settings.invoice_footer_note && (
          <div className="mt-3 text-center text-[7px] text-slate">{settings.invoice_footer_note}</div>
        )}
      </div>
    </div>
  );
}
