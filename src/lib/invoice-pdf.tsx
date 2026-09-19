/**
 * Invoice PDF. Rendered from the frozen snapshot on the invoice row, never
 * from live order or product data, so a reissued PDF is byte-identical to
 * the one the customer received.
 */
import "server-only";
import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
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

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 56, paddingHorizontal: 40, fontFamily: "Plex", fontSize: 9.5, color: INK },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  mono: { fontFamily: "PlexMono" },
  label: { fontSize: 7, letterSpacing: 0.8, color: SLATE, fontWeight: 600, textTransform: "uppercase" },

  brandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 },
  mark: { width: 26, height: 26, backgroundColor: NAVY, color: "#fff", borderRadius: 5, textAlign: "center", paddingTop: 7, fontSize: 9, fontFamily: "PlexMono" },
  company: { fontSize: 12, fontWeight: 600 },
  docTitle: { fontSize: 17, fontWeight: 600, textAlign: "right" },

  partiesRow: { flexDirection: "row", gap: 28, marginBottom: 18 },
  party: { flex: 1 },

  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 5, marginBottom: 2 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: BORDER, paddingVertical: 6 },
  cDesc: { flex: 1, paddingRight: 8 },
  cQty: { width: 52, textAlign: "right" },
  cRate: { width: 78, textAlign: "right" },
  cAmt: { width: 86, textAlign: "right" },

  totalsWrap: { flexDirection: "row", justifyContent: "flex-end", marginTop: 10 },
  totals: { width: 232 },
  totalLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  grand: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, borderTopWidth: 1, borderTopColor: INK, marginTop: 4 },

  note: { marginTop: 22, padding: 10, backgroundColor: "#F8FAFC", borderRadius: 4 },
  footer: { position: "absolute", bottom: 26, left: 40, right: 40, borderTopWidth: 0.5, borderTopColor: BORDER, paddingTop: 7, fontSize: 7.5, color: SLATE, flexDirection: "row", justifyContent: "space-between" },
  watermark: { position: "absolute", top: 300, left: 0, right: 0, textAlign: "center", fontSize: 76, color: "#F0F3F7", fontWeight: 600 },
});

interface Party { name?: string; address?: string; city?: string; country?: string; ntn?: string; strn?: string; email?: string; phone?: string; bank?: string }

function fmt(n: number, currency: string) {
  return `${currency} ${Math.round(n).toLocaleString("en-US")}`;
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const TITLES: Record<string, string> = { tax_invoice: "Tax Invoice", proforma: "Proforma Invoice", credit_note: "Credit Note" };

function PartyBlock({ heading, p }: { heading: string; p: Party }) {
  return (
    <View style={s.party}>
      <Text style={[s.label, { marginBottom: 4 }]}>{heading}</Text>
      <Text style={{ fontWeight: 600, fontSize: 10.5, marginBottom: 2 }}>{p.name ?? "—"}</Text>
      {p.address ? <Text style={{ color: SLATE, lineHeight: 1.45 }}>{p.address}</Text> : null}
      {p.city ? <Text style={{ color: SLATE }}>{[p.city, p.country].filter(Boolean).join(", ")}</Text> : null}
      {p.email ? <Text style={{ color: SLATE, marginTop: 2 }}>{p.email}</Text> : null}
      {p.ntn ? <Text style={[s.mono, { color: SLATE, marginTop: 3, fontSize: 8 }]}>NTN {p.ntn}</Text> : null}
      {p.strn ? <Text style={[s.mono, { color: SLATE, fontSize: 8 }]}>STRN {p.strn}</Text> : null}
    </View>
  );
}

export function InvoiceDocument({ invoice }: { invoice: InvoiceView }) {
  const seller = (invoice.seller ?? {}) as Party;
  const buyer = (invoice.buyer ?? {}) as Party;
  const cur = invoice.currency;
  const isDraft = invoice.status === "draft";
  const isVoid = invoice.status === "void";
  const taxPct = (invoice.tax_rate * 100).toFixed(invoice.tax_rate * 100 % 1 === 0 ? 0 : 2);

  return (
    <Document title={invoice.invoice_number ?? "Draft invoice"} author={seller.name ?? "Dynamic Traders"}>
      <Page size="A4" style={s.page}>
        {(isDraft || isVoid) && <Text style={s.watermark} fixed>{isVoid ? "VOID" : "DRAFT"}</Text>}

        <View style={s.brandRow}>
          <View style={{ flexDirection: "row", gap: 9 }}>
            <Text style={s.mark}>DT</Text>
            <View>
              <Text style={s.company}>{seller.name ?? "Dynamic Traders & Distributors"}</Text>
              <Text style={{ fontSize: 7, letterSpacing: 0.8, color: SLATE, textTransform: "uppercase", marginTop: 1 }}>Wholesale distribution</Text>
            </View>
          </View>
          <View>
            <Text style={s.docTitle}>{TITLES[invoice.type] ?? "Invoice"}</Text>
            <Text style={[s.mono, { textAlign: "right", marginTop: 3, fontSize: 10 }]}>{invoice.invoice_number ?? "DRAFT"}</Text>
          </View>
        </View>

        <View style={s.partiesRow}>
          <PartyBlock heading="From" p={seller} />
          <PartyBlock heading="Bill to" p={buyer} />
          <View style={{ width: 150 }}>
            {[
              ["Issue date", fmtDate(invoice.issue_date)],
              ["Due date", fmtDate(invoice.due_date)],
              ["Terms", `Net ${invoice.terms_days}`],
              ["Order", invoice.order_number ?? "—"],
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
            <Text style={[s.cQty, s.mono]}>{l.quantity.toLocaleString("en-US")}</Text>
            <Text style={[s.cRate, s.mono]}>{Math.round(l.unit_price).toLocaleString("en-US")}</Text>
            <Text style={[s.cAmt, s.mono, { fontWeight: 600 }]}>{Math.round(l.line_total).toLocaleString("en-US")}</Text>
          </View>
        ))}

        <View style={s.totalsWrap}>
          <View style={s.totals}>
            <View style={s.totalLine}>
              <Text style={{ color: SLATE }}>Subtotal</Text>
              <Text style={s.mono}>{fmt(invoice.subtotal, cur)}</Text>
            </View>
            {invoice.discount > 0 && (
              <View style={s.totalLine}>
                <Text style={{ color: SLATE }}>Discount</Text>
                <Text style={s.mono}>-{fmt(invoice.discount, cur)}</Text>
              </View>
            )}
            {invoice.freight > 0 && (
              <View style={s.totalLine}>
                <Text style={{ color: SLATE }}>Freight</Text>
                <Text style={s.mono}>{fmt(invoice.freight, cur)}</Text>
              </View>
            )}
            <View style={s.totalLine}>
              <Text style={{ color: SLATE }}>Sales tax {taxPct}%</Text>
              <Text style={s.mono}>{fmt(invoice.tax_amount, cur)}</Text>
            </View>
            <View style={s.grand}>
              <Text style={{ fontWeight: 600, fontSize: 11 }}>Total due</Text>
              <Text style={[s.mono, { fontWeight: 600, fontSize: 13 }]}>{fmt(invoice.total, cur)}</Text>
            </View>
            {invoice.paid > 0 && (
              <>
                <View style={s.totalLine}>
                  <Text style={{ color: SLATE }}>Paid</Text>
                  <Text style={s.mono}>-{fmt(invoice.paid, cur)}</Text>
                </View>
                <View style={[s.totalLine, { borderTopWidth: 0.5, borderTopColor: BORDER, paddingTop: 5 }]}>
                  <Text style={{ fontWeight: 600 }}>Balance</Text>
                  <Text style={[s.mono, { fontWeight: 600 }]}>{fmt(invoice.balance, cur)}</Text>
                </View>
              </>
            )}
          </View>
        </View>

        {(invoice.notes || seller.bank) && (
          <View style={s.note}>
            {invoice.notes ? <Text style={{ lineHeight: 1.5 }}>{invoice.notes}</Text> : null}
            {seller.bank ? (
              <>
                <Text style={[s.label, { marginTop: invoice.notes ? 7 : 0, marginBottom: 3 }]}>Payment details</Text>
                <Text style={[s.mono, { fontSize: 8, lineHeight: 1.5 }]}>{seller.bank}</Text>
              </>
            ) : null}
          </View>
        )}

        <View style={s.footer} fixed>
          <Text>{seller.name ?? "Dynamic Traders & Distributors"}{seller.phone ? ` · ${seller.phone}` : ""}</Text>
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
