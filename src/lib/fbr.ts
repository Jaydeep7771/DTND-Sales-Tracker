/**
 * FBR sales tax return data.
 *
 * The existing summary gave output tax, input tax and the net for each
 * month. That is the answer to "how much do I pay", and it is not what
 * the return asks for. Annex-C is a line-by-line listing of every
 * domestic supply: who you sold to and their registration number, what
 * you sold under which HS code, at what rate, the value excluding tax
 * and the tax itself. Without it somebody retypes a month of invoices
 * into the portal by hand.
 *
 * This file builds those rows and, just as importantly, says what is
 * missing. A file the portal rejects on upload is worse than no file,
 * because it is found out at the deadline.
 */
import { round2 } from "@/lib/accounting";

/**
 * How FBR classifies the buyer. It changes the return, not just the
 * label: a supply to an unregistered person can attract further tax.
 */
export type BuyerType = "registered" | "unregistered" | "end_consumer";

export interface AnnexCRow {
  buyer_registration: string;   // STRN, NTN, or CNIC for a consumer
  buyer_name: string;
  buyer_type: BuyerType;
  document_type: "Sale Invoice" | "Credit Note";
  document_number: string;
  document_date: string;
  hs_code: string;
  sale_type: string;
  rate: number;                 // percent
  value_excluding_tax: number;
  sales_tax: number;
  further_tax: number;
  total_value: number;
  /** Set when this row would be rejected, and why. */
  problems: string[];
}

export interface AnnexCReport {
  month: string;                // YYYY-MM
  rows: AnnexCRow[];
  totals: { value: number; tax: number; further: number; total: number };
  /** Rows FBR would reject, and the distinct reasons, for the screen. */
  invalid: number;
  issues: { reason: string; count: number }[];
}

/** The default description FBR expects for ordinary taxable goods. */
export const STANDARD_SALE_TYPE = "Goods at standard rate (default)";

/**
 * Further tax is charged on taxable supplies to a person who is not
 * sales-tax registered. The rate is a policy number that has moved
 * before, so it is a constant here rather than being spread through the
 * code, and it is reported as an exposure rather than charged
 * automatically — whether it applies to a given supply is the company's
 * tax adviser's call, not this file's.
 */
export const FURTHER_TAX_RATE = 0.03;

export function buyerTypeOf(buyer: { strn?: string | null; ntn?: string | null; cnic?: string | null }): BuyerType {
  if (buyer.strn?.trim()) return "registered";
  if (buyer.ntn?.trim()) return "unregistered";
  return "end_consumer";
}

export function buyerRegistrationOf(buyer: { strn?: string | null; ntn?: string | null; cnic?: string | null }): string {
  return (buyer.strn || buyer.ntn || buyer.cnic || "").trim();
}

export const BUYER_TYPE_LABEL: Record<BuyerType, string> = {
  registered: "Registered",
  unregistered: "Unregistered",
  end_consumer: "End consumer",
};

export interface AnnexCInput {
  month: string;
  invoices: {
    invoice_number: string | null;
    issue_date: string | null;
    type: "tax_invoice" | "credit_note" | "proforma";
    status: string;
    tax_rate: number;
    discount: number;
    freight: number;
    buyer: { name: string; strn?: string | null; ntn?: string | null; cnic?: string | null };
    items: { sku: string; name: string; hs_code: string | null; line_total: number }[];
  }[];
  /** Whether to compute the further-tax exposure on unregistered buyers. */
  furtherTax?: boolean;
}

/**
 * One row per invoice per HS code.
 *
 * Aggregating within an invoice is what the portal expects — it wants a
 * tax figure per commodity classification, not per stock line — and it
 * keeps a fifty-line invoice from becoming fifty rows of the return.
 */
export function buildAnnexC(input: AnnexCInput): AnnexCReport {
  const rows: AnnexCRow[] = [];

  for (const inv of input.invoices) {
    if (inv.status !== "issued" || !inv.issue_date) continue;
    // A proforma is an offer; nothing has been supplied, so it is not a
    // return item at all.
    if (inv.type === "proforma") continue;
    if (!inv.issue_date.startsWith(input.month)) continue;

    const sign = inv.type === "credit_note" ? -1 : 1;
    const gross = inv.items.reduce((a, l) => a + l.line_total, 0);
    if (gross <= 0) continue;

    // Discount and freight live on the invoice, not the line. They are
    // spread across the lines in proportion so that the sum of the rows
    // reconciles to the invoice, which is the first thing an officer
    // checks.
    const net = gross - inv.discount + inv.freight;
    const scale = gross > 0 ? net / gross : 1;

    const byHs = new Map<string, { value: number; missing: boolean }>();
    for (const l of inv.items) {
      const hs = (l.hs_code ?? "").trim();
      const key = hs || "—";
      const row = byHs.get(key) ?? { value: 0, missing: !hs };
      row.value += l.line_total * scale;
      byHs.set(key, row);
    }

    const buyerType = buyerTypeOf(inv.buyer);
    const registration = buyerRegistrationOf(inv.buyer);
    const ratePct = round2(inv.tax_rate * 100);

    for (const [hs, { value, missing }] of byHs) {
      const valueExcl = round2(sign * value);
      const tax = round2(valueExcl * inv.tax_rate);
      const further = input.furtherTax && buyerType !== "registered"
        ? round2(valueExcl * FURTHER_TAX_RATE)
        : 0;

      const problems: string[] = [];
      if (missing) problems.push("No HS code on one or more items");
      if (!registration) problems.push("Buyer has no STRN, NTN or CNIC");
      else if (buyerType === "end_consumer" && registration.replace(/\D/g, "").length !== 13) {
        problems.push("CNIC is not 13 digits");
      }
      if (!inv.invoice_number) problems.push("No document number");

      rows.push({
        buyer_registration: registration,
        buyer_name: inv.buyer.name,
        buyer_type: buyerType,
        document_type: inv.type === "credit_note" ? "Credit Note" : "Sale Invoice",
        document_number: inv.invoice_number ?? "",
        document_date: inv.issue_date,
        hs_code: missing ? "" : hs,
        sale_type: STANDARD_SALE_TYPE,
        rate: ratePct,
        value_excluding_tax: valueExcl,
        sales_tax: tax,
        further_tax: further,
        total_value: round2(valueExcl + tax + further),
        problems,
      });
    }
  }

  rows.sort((a, b) => a.document_date.localeCompare(b.document_date) || a.document_number.localeCompare(b.document_number));

  const counts = new Map<string, number>();
  let invalid = 0;
  for (const r of rows) {
    if (r.problems.length) invalid += 1;
    for (const p of r.problems) counts.set(p, (counts.get(p) ?? 0) + 1);
  }

  return {
    month: input.month,
    rows,
    totals: {
      value: round2(rows.reduce((a, r) => a + r.value_excluding_tax, 0)),
      tax: round2(rows.reduce((a, r) => a + r.sales_tax, 0)),
      further: round2(rows.reduce((a, r) => a + r.further_tax, 0)),
      total: round2(rows.reduce((a, r) => a + r.total_value, 0)),
    },
    invalid,
    issues: [...counts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** The Annex-C column headings, in the order the portal expects them. */
export const ANNEX_C_HEADER = [
  "Buyer Registration No",
  "Buyer Name",
  "Buyer Type",
  "Document Type",
  "Document Number",
  "Document Date",
  "HS Code",
  "Sale Type",
  "Rate",
  "Value of Sales Excluding Sales Tax",
  "Sales Tax",
  "Further Tax",
  "Total Value of Sales",
];

export function annexCCells(r: AnnexCRow): (string | number)[] {
  return [
    r.buyer_registration,
    r.buyer_name,
    BUYER_TYPE_LABEL[r.buyer_type],
    r.document_type,
    r.document_number,
    r.document_date,
    r.hs_code,
    r.sale_type,
    r.rate,
    r.value_excluding_tax,
    r.sales_tax,
    r.further_tax,
    r.total_value,
  ];
}
