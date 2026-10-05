/**
 * Invoice PDF. Rendered from the frozen snapshot on the invoice row, never
 * from live order or product data, so a reissued PDF is byte-identical to
 * the one the customer received.
 *
 * Presentation (template, accent colour, tagline, which blocks to print)
 * is part of that snapshot too. Switching the template in settings
 * therefore changes the next invoice, not the ones already sent.
 */
import "server-only";
import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { percent } from "@/lib/money";
import type { InvoiceView } from "@/lib/types";

const FONTS = path.join(process.cwd(), "src", "lib", "pdf-fonts");
let registered = false;

function registerFonts() {
  if (registered) return;
  Font.register({
    family: "Plex",
    fonts: [
      { src: path.join(FONTS, "IBMPlexSans-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONTS, "IBMPlexSans-SemiBold.ttf"), fontWeight: 600 },
    ],
  });
  Font.register({ family: "PlexMono", src: path.join(FONTS, "IBMPlexMono-Regular.ttf") });
  Font.registerHyphenationCallback((word) => [word]); // never hyphenate product names
  registered = true;
}

const INK = "#0F1B2B";
const SLATE = "#64748B";
const BORDER = "#E2E8F0";
const NAVY = "#123A5E";

export type InvoiceTemplate = "classic" | "modern" | "compact";

/**
 * The three templates differ in header treatment and density, not in
 * content: every one carries the same legally required fields.
 *
 *  classic  — restrained letterhead, the default
 *  modern   — accent banner across the head, accent grand total
 *  compact  — tighter type and rows, for long orders
 */
const DENSITY: Record<InvoiceTemplate, { base: number; rowPad: number; pageTop: number; gap: number }> = {
  classic: { base: 9.5, rowPad: 6, pageTop: 36, gap: 22 },
  modern: { base: 9.5, rowPad: 6.5, pageTop: 0, gap: 20 },
  compact: { base: 8.5, rowPad: 3.5, pageTop: 28, gap: 14 },
};

type Styles = ReturnType<typeof sheet>;

function sheet(template: InvoiceTemplate, accent: string) {
  const d = DENSITY[template];
  return StyleSheet.create({
    page: { paddingTop: d.pageTop, paddingBottom: 56, paddingHorizontal: template === "modern" ? 0 : 40, fontFamily: "Plex", fontSize: d.base, color: INK },
    body: { paddingHorizontal: template === "modern" ? 40 : 0 },
    row: { flexDirection: "row" },
    between: { flexDirection: "row", justifyContent: "space-between" },
    mono: { fontFamily: "PlexMono" },
    label: { fontSize: 7, letterSpacing: 0.8, color: SLATE, fontWeight: 600, textTransform: "uppercase" },

    brandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: d.gap },
    banner: { backgroundColor: accent, color: "#fff", paddingVertical: 20, paddingHorizontal: 40, marginBottom: d.gap, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
    mark: { width: 26, height: 26, backgroundColor: accent, color: "#fff", borderRadius: 5, textAlign: "center", paddingTop: 7, fontSize: 9, fontFamily: "PlexMono" },
    markOnBanner: { width: 26, height: 26, borderWidth: 1, borderColor: "rgba(255,255,255,.55)", color: "#fff", borderRadius: 5, textAlign: "center", paddingTop: 7, fontSize: 9, fontFamily: "PlexMono" },
    company: { fontSize: template === "compact" ? 11 : 12, fontWeight: 600 },
    docTitle: { fontSize: template === "compact" ? 14 : 17, fontWeight: 600, textAlign: "right" },

    partiesRow: { flexDirection: "row", gap: 28, marginBottom: template === "compact" ? 12 : 18 },
    party: { flex: 1 },

    th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: template === "modern" ? accent : INK, paddingBottom: 5, marginBottom: 2 },
    tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: BORDER, paddingVertical: d.rowPad },
    cDesc: { flex: 1, paddingRight: 8 },
    cQty: { width: 52, textAlign: "right" },
    cRate: { width: 78, textAlign: "right" },
    cAmt: { width: 86, textAlign: "right" },

    totalsWrap: { flexDirection: "row", justifyContent: "flex-end", marginTop: 10 },
    totals: { width: 232 },
    totalLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
    grand: {
      flexDirection: "row", justifyContent: "space-between", marginTop: 4,
      ...(template === "modern"
        ? { backgroundColor: accent, color: "#fff", paddingVertical: 8, paddingHorizontal: 9, borderRadius: 4 }
        : { paddingVertical: 7, borderTopWidth: 1, borderTopColor: INK }),
    },

    note: { marginTop: template === "compact" ? 14 : 22, padding: 10, backgroundColor: "#F8FAFC", borderRadius: 4 },
    sign: { marginTop: 26, flexDirection: "row", justifyContent: "flex-end" },
    signLine: { width: 170, borderTopWidth: 0.5, borderTopColor: INK, paddingTop: 4, textAlign: "center", fontSize: 7.5, color: SLATE },
    footer: { position: "absolute", bottom: 26, left: 40, right: 40, borderTopWidth: 0.5, borderTopColor: BORDER, paddingTop: 7, fontSize: 7.5, color: SLATE, flexDirection: "row", justifyContent: "space-between" },
    footerNote: { position: "absolute", bottom: 42, left: 40, right: 40, fontSize: 7, color: SLATE, textAlign: "center" },
    watermark: { position: "absolute", top: 300, left: 0, right: 0, textAlign: "center", fontSize: 76, color: "#F0F3F7", fontWeight: 600 },
  });
}

/** Everything frozen about the seller, including how the page should look. */
interface Party {
  name?: string; address?: string; city?: string; country?: string;
  ntn?: string; strn?: string; email?: string; phone?: string; bank?: string;
  tagline?: string; initials?: string;
  template?: InvoiceTemplate; accent?: string;
  footer_note?: string; show_bank?: boolean; show_signature?: boolean; show_tax_ids?: boolean;
  tax_label?: string; currency_symbol?: string; currency_display?: string; decimals?: number; locale?: string;
}

/**
 * The embedded IBM Plex subset covers Latin-1 and a few currency marks.
 * A symbol outside it (د.إ, ﷼, ₨, ₹) would print as blank or wrong glyphs
 * on a tax document, so the PDF falls back to the ISO code. On screen the
 * symbol still shows, because the browser can substitute a font.
 */
const FONT_SAFE = /^[ -~ -ÿ€]+$/;

function printableSymbol(symbol: string | undefined, code: string): string {
  return symbol && FONT_SAFE.test(symbol) ? symbol : code;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Styles are passed in because they depend on the chosen template. */
function PartyBlock({ heading, p, s, compact, showTaxIds }: {
  heading: string; p: Party; s: Styles; compact: boolean; showTaxIds: boolean;
}) {
  return (
    <View style={s.party}>
      <Text style={[s.label, { marginBottom: 4 }]}>{heading}</Text>
      <Text style={{ fontWeight: 600, fontSize: compact ? 9.5 : 10.5, marginBottom: 2 }}>{p.name ?? "—"}</Text>
      {p.address ? <Text style={{ color: SLATE, lineHeight: 1.45 }}>{p.address}</Text> : null}
      {p.city ? <Text style={{ color: SLATE }}>{[p.city, p.country].filter(Boolean).join(", ")}</Text> : null}
      {p.email ? <Text style={{ color: SLATE, marginTop: 2 }}>{p.email}</Text> : null}
      {showTaxIds && p.ntn ? <Text style={[s.mono, { color: SLATE, marginTop: 3, fontSize: 8 }]}>NTN {p.ntn}</Text> : null}
      {showTaxIds && p.strn ? <Text style={[s.mono, { color: SLATE, fontSize: 8 }]}>STRN {p.strn}</Text> : null}
    </View>
  );
}

const TITLES: Record<string, string> = { tax_invoice: "Tax Invoice", proforma: "Proforma Invoice", credit_note: "Credit Note" };

export function InvoiceDocument({ invoice }: { invoice: InvoiceView }) {
  const seller = (invoice.seller ?? {}) as Party;
  const buyer = (invoice.buyer ?? {}) as Party;

  const template: InvoiceTemplate = seller.template ?? "classic";
  const accent = seller.accent ?? NAVY;
  const s = sheet(template, accent);
  const showTaxIds = seller.show_tax_ids !== false;

  // The document prints the currency exactly as it was configured when
  // issued, so an old invoice never silently re-denominates.
  const locale = seller.locale ?? "en-US";
  const decimals = seller.decimals ?? 0;
  const prefix = seller.currency_display === "symbol" ? printableSymbol(seller.currency_symbol, invoice.currency) : invoice.currency;
  const qty = (n: number) => n.toLocaleString(locale);
  const plain = (n: number) => n.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const fmt = (n: number) => `${prefix} ${plain(n)}`;

  const isDraft = invoice.status === "draft";
  const isVoid = invoice.status === "void";
  const onBanner = template === "modern";
  const compact = template === "compact";

  const title = TITLES[invoice.type] ?? "Invoice";
  const companyName = seller.name ?? "Dynamic Traders & Distributors";
  const header = (
    <>
      <View style={{ flexDirection: "row", gap: 9 }}>
        <Text style={onBanner ? s.markOnBanner : s.mark}>{seller.initials ?? "DT"}</Text>
        <View>
          <Text style={s.company}>{companyName}</Text>
          <Text style={{ fontSize: 7, letterSpacing: 0.8, color: onBanner ? "rgba(255,255,255,.75)" : SLATE, textTransform: "uppercase", marginTop: 1 }}>
            {seller.tagline ?? "Wholesale distribution"}
          </Text>
        </View>
      </View>
      <View>
        <Text style={s.docTitle}>{title}</Text>
        <Text style={[s.mono, { textAlign: "right", marginTop: 3, fontSize: 10 }]}>{invoice.invoice_number ?? "DRAFT"}</Text>
      </View>
    </>
  );

  return (
    <Document title={invoice.invoice_number ?? "Draft invoice"} author={companyName}>
      <Page size="A4" style={s.page}>
        {(isDraft || isVoid) && <Text style={s.watermark} fixed>{isVoid ? "VOID" : "DRAFT"}</Text>}

        {onBanner ? <View style={s.banner}>{header}</View> : <View style={s.brandRow}>{header}</View>}

        <View style={s.body}>
          <View style={s.partiesRow}>
            <PartyBlock heading="From" p={seller} s={s} compact={compact} showTaxIds={showTaxIds} />
            <PartyBlock heading="Bill to" p={buyer} s={s} compact={compact} showTaxIds={showTaxIds} />
            <View style={{ width: 150 }}>
              {[
                // A proforma has no due date and nothing is owed on it,
                // so it shows its expiry instead. Printing "Net 30" on a
                // quote invites somebody to treat it as a bill.
                [invoice.type === "proforma" ? "Quote date" : "Issue date", fmtDate(invoice.issue_date)],
                ...(invoice.type === "proforma"
                  ? [["Valid until", fmtDate(invoice.valid_until)] as [string, string]]
                  : [
                      ["Due date", fmtDate(invoice.due_date)] as [string, string],
                      ["Terms", `Net ${invoice.terms_days}`] as [string, string],
                    ]),
                ...(invoice.period_start
                  ? [["Period", `${fmtDate(invoice.period_start)} – ${fmtDate(invoice.period_end)}`] as [string, string]]
                  : []),
                ["Order", invoice.order_numbers.length ? invoice.order_numbers.join(", ") : "—"],
              ].map(([k, v]) => (
                <View key={k} style={[s.between, { paddingVertical: 2 }]}>
                  <Text style={{ color: SLATE }}>{k}</Text>
                  <Text style={{ fontWeight: 600 }}>{v}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={s.th}>
            <Text style={[s.label, s.cDesc]}>Description</Text>
            <Text style={[s.label, s.cQty]}>Qty</Text>
            <Text style={[s.label, s.cRate]}>Rate</Text>
            <Text style={[s.label, s.cAmt]}>Amount</Text>
          </View>

          {invoice.items.map((l) => (
            <View key={l.id} style={s.tr} wrap={false}>
              <View style={s.cDesc}>
                <Text style={{ fontWeight: 600 }}>{l.name}</Text>
                <Text style={[s.mono, { color: SLATE, fontSize: 7.5, marginTop: 1.5 }]}>{l.sku} · {l.unit_of_measure}</Text>
              </View>
              <Text style={[s.cQty, s.mono]}>{qty(l.quantity)}</Text>
              <Text style={[s.cRate, s.mono]}>{plain(l.unit_price)}</Text>
              <Text style={[s.cAmt, s.mono, { fontWeight: 600 }]}>{plain(l.line_total)}</Text>
            </View>
          ))}

          <View style={s.totalsWrap}>
            <View style={s.totals}>
              <View style={s.totalLine}>
                <Text style={{ color: SLATE }}>Subtotal</Text>
                <Text style={s.mono}>{fmt(invoice.subtotal)}</Text>
              </View>
              {invoice.discount > 0 && (
                <View style={s.totalLine}>
                  <Text style={{ color: SLATE }}>Discount</Text>
                  <Text style={s.mono}>-{fmt(invoice.discount)}</Text>
                </View>
              )}
              {invoice.freight > 0 && (
                <View style={s.totalLine}>
                  <Text style={{ color: SLATE }}>Freight</Text>
                  <Text style={s.mono}>{fmt(invoice.freight)}</Text>
                </View>
              )}
              <View style={s.totalLine}>
                <Text style={{ color: SLATE }}>{seller.tax_label ?? "Sales Tax"} {percent(invoice.tax_rate)}</Text>
                <Text style={s.mono}>{fmt(invoice.tax_amount)}</Text>
              </View>
              <View style={s.grand}>
                <Text style={{ fontWeight: 600, fontSize: 11, color: onBanner ? "#fff" : INK }}>Total due</Text>
                <Text style={[s.mono, { fontWeight: 600, fontSize: 13, color: onBanner ? "#fff" : INK }]}>{fmt(invoice.total)}</Text>
              </View>
              {invoice.paid > 0 && (
                <>
                  <View style={[s.totalLine, { marginTop: 4 }]}>
                    <Text style={{ color: SLATE }}>Paid</Text>
                    <Text style={s.mono}>-{fmt(invoice.paid)}</Text>
                  </View>
                  <View style={[s.totalLine, { borderTopWidth: 0.5, borderTopColor: BORDER, paddingTop: 5 }]}>
                    <Text style={{ fontWeight: 600 }}>Balance</Text>
                    <Text style={[s.mono, { fontWeight: 600 }]}>{fmt(invoice.balance)}</Text>
                  </View>
                </>
              )}
            </View>
          </View>

          {(invoice.notes || (seller.bank && seller.show_bank !== false)) && (
            <View style={s.note}>
              {invoice.notes ? <Text style={{ lineHeight: 1.5 }}>{invoice.notes}</Text> : null}
              {seller.bank && seller.show_bank !== false ? (
                <>
                  <Text style={[s.label, { marginTop: invoice.notes ? 7 : 0, marginBottom: 3 }]}>Payment details</Text>
                  <Text style={[s.mono, { fontSize: 8, lineHeight: 1.5 }]}>{seller.bank}</Text>
                </>
              ) : null}
            </View>
          )}

          {seller.show_signature && (
            <View style={s.sign}>
              <Text style={s.signLine}>Authorised signatory, {companyName}</Text>
            </View>
          )}
        </View>

        {seller.footer_note ? <Text style={s.footerNote} fixed>{seller.footer_note}</Text> : null}
        <View style={s.footer} fixed>
          <Text>{companyName}{seller.phone ? ` · ${seller.phone}` : ""}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(invoice: InvoiceView): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<InvoiceDocument invoice={invoice} />);
}
