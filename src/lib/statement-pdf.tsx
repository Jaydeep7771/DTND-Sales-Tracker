/**
 * Account statement PDF.
 *
 * Deliberately plainer than the invoice. A statement is a reconciliation
 * document — the reader's job is to tick it against their own ledger —
 * so it gets one dense table, an ageing strip and the figure to pay, and
 * nothing that competes with those for attention.
 *
 * Rendered live rather than from a snapshot, unlike an invoice. An
 * invoice is a legal document that must never change after issue; a
 * statement is a position as at a date, and if a receipt was posted this
 * morning the customer should see it.
 */
import "server-only";
import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { BUCKET_LABEL, BUCKET_ORDER } from "@/lib/receivables";
import { amountDue, type Statement } from "@/lib/statements";
import type { CompanySettings, UserProfile } from "@/types/database";

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
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

const INK = "#0F1B2B";
const SLATE = "#64748B";
const BORDER = "#E2E8F0";
const DANGER = "#B42318";

/** The vendored fonts cover Latin only; anything else prints as boxes. */
const FONT_SAFE = /^[ -~ -ÿ€]+$/;

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 56, paddingHorizontal: 40, fontFamily: "Plex", fontSize: 9, color: INK },
  between: { flexDirection: "row", justifyContent: "space-between" },
  row: { flexDirection: "row" },
  mono: { fontFamily: "PlexMono" },
  label: { fontSize: 7, letterSpacing: 0.8, color: SLATE, fontWeight: 600, textTransform: "uppercase" },
  company: { fontSize: 12, fontWeight: 600 },
  title: { fontSize: 15, fontWeight: 600, textAlign: "right" },
  muted: { color: SLATE },

  partyBox: { flex: 1, paddingRight: 16 },
  head: { flexDirection: "row", borderBottomWidth: 1, borderColor: INK, paddingBottom: 4, marginTop: 18 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: BORDER, paddingVertical: 4.5 },
  cDate: { width: 56 },
  cRef: { width: 78 },
  cDesc: { flex: 1, paddingRight: 8 },
  cNum: { width: 68, textAlign: "right" },

  totalRow: { flexDirection: "row", borderTopWidth: 1, borderColor: INK, paddingTop: 5, marginTop: 2 },
  due: { marginTop: 16, borderWidth: 1, borderColor: INK, padding: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  ageing: { marginTop: 16, flexDirection: "row", borderWidth: 0.5, borderColor: BORDER },
  ageCell: { flex: 1, padding: 6, borderRightWidth: 0.5, borderColor: BORDER },

  footer: { position: "absolute", bottom: 26, left: 40, right: 40, fontSize: 7.5, color: SLATE, textAlign: "center" },
});

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${d.toLocaleString("en", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
}

export function StatementDocument({
  statement, customer, settings,
}: {
  statement: Statement;
  customer: UserProfile;
  settings: CompanySettings;
}) {
  const prefix =
    settings.currency_display === "symbol" && settings.currency_symbol && FONT_SAFE.test(settings.currency_symbol)
      ? settings.currency_symbol
      : settings.currency_code;

  const n = (v: number) =>
    `${prefix} ${new Intl.NumberFormat(settings.number_locale || "en-PK", {
      minimumFractionDigits: settings.decimal_places ?? 0,
      maximumFractionDigits: settings.decimal_places ?? 0,
    }).format(v)}`;

  const due = amountDue(statement);

  return (
    <Document title={`Statement ${statement.from} to ${statement.to}`} author={settings.legal_name}>
      <Page size="A4" style={s.page} wrap>
        <View style={s.between}>
          <View>
            <Text style={s.company}>{settings.legal_name}</Text>
            <Text style={[s.muted, { marginTop: 2 }]}>{settings.address}</Text>
            <Text style={s.muted}>{settings.city}, {settings.country}</Text>
            {settings.ntn && <Text style={[s.muted, s.mono, { marginTop: 3, fontSize: 8 }]}>NTN {settings.ntn}</Text>}
          </View>
          <View>
            <Text style={s.title}>Account statement</Text>
            <Text style={[s.muted, { textAlign: "right", marginTop: 3 }]}>
              {fmtDate(statement.from)} to {fmtDate(statement.to)}
            </Text>
          </View>
        </View>

        <View style={[s.row, { marginTop: 20 }]}>
          <View style={s.partyBox}>
            <Text style={s.label}>Account</Text>
            <Text style={{ fontWeight: 600, marginTop: 3 }}>{customer.company_name ?? customer.email}</Text>
            {customer.billing_address && <Text style={[s.muted, { marginTop: 2 }]}>{customer.billing_address}</Text>}
            {customer.ntn && <Text style={[s.muted, s.mono, { fontSize: 8, marginTop: 2 }]}>NTN {customer.ntn}</Text>}
          </View>
          <View style={{ width: 150 }}>
            {[
              ["Opening balance", n(statement.opening)],
              ["Invoiced", n(statement.totals.debits)],
              ["Paid and credited", n(statement.totals.credits)],
              ["Closing balance", n(statement.closing)],
            ].map(([k, v]) => (
              <View key={k} style={[s.between, { paddingVertical: 2 }]}>
                <Text style={s.muted}>{k}</Text>
                <Text style={[s.mono, { fontWeight: 600 }]}>{v}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.head}>
          <Text style={[s.label, s.cDate]}>Date</Text>
          <Text style={[s.label, s.cRef]}>Reference</Text>
          <Text style={[s.label, s.cDesc]}>Description</Text>
          <Text style={[s.label, s.cNum]}>Debit</Text>
          <Text style={[s.label, s.cNum]}>Credit</Text>
          <Text style={[s.label, s.cNum]}>Balance</Text>
        </View>

        <View style={s.tr}>
          <Text style={s.cDate} />
          <Text style={s.cRef} />
          <Text style={[s.cDesc, { fontWeight: 600 }]}>Balance brought forward</Text>
          <Text style={s.cNum} />
          <Text style={s.cNum} />
          <Text style={[s.cNum, s.mono, { fontWeight: 600 }]}>{n(statement.opening)}</Text>
        </View>

        {statement.lines.map((l) => (
          <View key={l.id} style={s.tr} wrap={false}>
            <Text style={[s.cDate, s.mono, { fontSize: 8 }]}>{fmtDate(l.date).slice(0, 6)}</Text>
            <Text style={[s.cRef, s.mono, { fontSize: 8 }]}>{l.entry_no}</Text>
            <Text style={s.cDesc}>{l.description}</Text>
            <Text style={[s.cNum, s.mono]}>{l.debit ? n(l.debit) : ""}</Text>
            <Text style={[s.cNum, s.mono]}>{l.credit ? n(l.credit) : ""}</Text>
            <Text style={[s.cNum, s.mono]}>{n(l.balance)}</Text>
          </View>
        ))}

        {statement.lines.length === 0 && (
          <View style={s.tr}>
            <Text style={[s.cDesc, s.muted]}>No movement in this period.</Text>
          </View>
        )}

        <View style={s.totalRow}>
          <Text style={[s.cDate]} />
          <Text style={[s.cRef]} />
          <Text style={[s.cDesc, { fontWeight: 600 }]}>Closing balance</Text>
          <Text style={[s.cNum, s.mono]}>{n(statement.totals.debits)}</Text>
          <Text style={[s.cNum, s.mono]}>{n(statement.totals.credits)}</Text>
          <Text style={[s.cNum, s.mono, { fontWeight: 600 }]}>{n(statement.closing)}</Text>
        </View>

        {/* Ageing of what is still open, by the invoice's own due date. */}
        <View style={s.ageing}>
          {BUCKET_ORDER.map((b, i) => (
            <View key={b} style={[s.ageCell, i === BUCKET_ORDER.length - 1 ? { borderRightWidth: 0 } : {}]}>
              <Text style={s.label}>{BUCKET_LABEL[b]}</Text>
              <Text style={[s.mono, { marginTop: 3, color: b === "d90_plus" && statement.aging[b] > 0 ? DANGER : INK }]}>
                {n(statement.aging[b])}
              </Text>
            </View>
          ))}
        </View>

        <View style={s.due}>
          <View>
            <Text style={s.label}>Amount due</Text>
            {statement.advance > 0 && (
              <Text style={[s.muted, { marginTop: 3, fontSize: 8 }]}>
                After {n(statement.advance)} held on account
              </Text>
            )}
            {statement.withheld > 0 && (
              <Text style={[s.muted, { marginTop: 2, fontSize: 8 }]}>
                {n(statement.withheld)} tax withheld — please send the certificate
              </Text>
            )}
          </View>
          <Text style={[s.mono, { fontSize: 16, fontWeight: 600 }]}>{n(due)}</Text>
        </View>

        {settings.bank_details && (
          <View style={{ marginTop: 14 }}>
            <Text style={s.label}>How to pay</Text>
            <Text style={{ marginTop: 3 }}>{settings.bank_details}</Text>
          </View>
        )}

        {settings.statement_note && (
          <Text style={[s.muted, { marginTop: 12, fontSize: 8 }]}>{settings.statement_note}</Text>
        )}

        <Text style={s.footer} fixed>
          This statement is a position as at {fmtDate(statement.to)}. Please report any difference
          within seven days. {settings.email ?? ""} {settings.phone ?? ""}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderStatementPdf(
  statement: Statement,
  customer: UserProfile,
  settings: CompanySettings,
): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<StatementDocument statement={statement} customer={customer} settings={settings} />);
}
