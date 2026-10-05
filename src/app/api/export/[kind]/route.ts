/**
 * Every download in the system, behind one guard.
 *
 * One route rather than a handler per report, because the thing that
 * must not be got wrong is identical for all of them: who is allowed to
 * ask. Staff with report access can take anything; a customer can take
 * their own statement and nothing else. Spreading that check across
 * nine endpoints is how one of them ends up missing it.
 *
 * Everything is generated from the ledger on request. Nothing is cached
 * and nothing is stored, so an export taken twice is the same file, and
 * a correction posted in between shows up in the second one.
 */
import { NextResponse } from "next/server";
import {
  getAccounts, getAging, getAnnexC, getBills, getCashFlow, getCompanySettings, getCurrentStaff,
  getCurrentUser, getCustomers, getDayBook, getExportEntries, getInvoices, getProducts,
  getSalesTaxSummary, getStatement, getTrialBalance,
} from "@/lib/data";
import { can } from "@/lib/permissions";
import { csvFile, exportFilename, type CsvValue } from "@/lib/csv";
import { toQuickBooksAccountsCsv, toQuickBooksCsv, toTallyXml } from "@/lib/accounting-export";
import { ANNEX_C_HEADER, annexCCells, BUYER_TYPE_LABEL } from "@/lib/fbr";
import { buildProfitAndLoss, buildBalanceSheet, comparePnl, fiscalYearRange, priorPeriod } from "@/lib/reports";
import { businessDate, SETTLEMENT_LABEL } from "@/lib/accounting";
import { BUCKET_LABEL, BUCKET_ORDER } from "@/lib/receivables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports a customer may take. Everything else is staff only. */
const CUSTOMER_KINDS = new Set(["statement"]);

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? businessDate();
  const customerId = url.searchParams.get("customer") ?? "";
  const month = url.searchParams.get("month") ?? businessDate().slice(0, 7);

  const staff = await getCurrentStaff();
  const isStaffViewer = can(staff?.role, "report:read") || can(staff?.role, "invoice:read");

  if (!isStaffViewer) {
    // A customer may take their own statement. Anything else, and any
    // attempt to name somebody else's account, is simply not found —
    // no hint that the report exists.
    const user = await getCurrentUser();
    if (!user || !CUSTOMER_KINDS.has(kind)) return new NextResponse("Not found", { status: 404 });
    if (customerId && customerId !== user.id) return new NextResponse("Not found", { status: 404 });
  }

  const settings = await getCompanySettings();
  const company = settings.legal_name || "Dynamic Traders & Distributors";
  const stamp = [`Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`];

  const built = await build(kind, {
    company, from, to, customerId, month, stamp,
    viewerId: isStaffViewer ? null : (await getCurrentUser())?.id ?? null,
  });
  if (!built) return new NextResponse("Unknown export", { status: 404 });

  return new NextResponse(built.body, {
    headers: {
      "Content-Type": built.contentType,
      "Content-Disposition": `attachment; filename="${built.filename}"`,
      // A financial extract should never sit in a shared cache.
      "Cache-Control": "private, no-store",
    },
  });
}

interface Ctx {
  company: string;
  from: string;
  to: string;
  customerId: string;
  month: string;
  stamp: string[];
  /** Set when the caller is a customer, forcing the statement to their own id. */
  viewerId: string | null;
}

interface Built { body: string; contentType: string; filename: string }

const CSV = "text/csv; charset=utf-8";
const XML = "application/xml; charset=utf-8";

async function build(kind: string, c: Ctx): Promise<Built | null> {
  const head = (title: string, extra: string[][] = []) => [
    [c.company], [title], ...(c.from ? [["Period", c.from, "to", c.to]] : [["As at", c.to]]), ...extra, c.stamp,
  ];
  const file = (name: string, body: string, ext = "csv", ct = CSV): Built => ({
    body, contentType: ct, filename: exportFilename(name, { from: c.from, to: c.to }, ext),
  });

  switch (kind) {
    // ---------------------------------------------------------- ledger
    case "day-book": {
      const entries = await getDayBook({ from: c.from || undefined, to: c.to, limit: 10000 });
      const rows: CsvValue[][] = [];
      for (const e of entries.slice().reverse()) {
        for (const l of e.lines) {
          rows.push([e.entry_date, e.entry_no, e.narration, l.code, l.name, l.party_name ?? "", l.memo ?? "", l.debit || "", l.credit || ""]);
        }
      }
      return file("day-book", csvFile({
        preamble: head("Day book"),
        header: ["Date", "Entry", "Narration", "Account code", "Account", "Party", "Memo", "Debit", "Credit"],
        rows,
        footer: [["", "", "", "", "", "", "Totals",
          rows.reduce((a, r) => a + Number(r[7] || 0), 0),
          rows.reduce((a, r) => a + Number(r[8] || 0), 0)]],
      }));
    }

    case "trial-balance": {
      const rows = await getTrialBalance({ from: c.from || undefined, to: c.to });
      return file("trial-balance", csvFile({
        preamble: head("Trial balance"),
        header: ["Code", "Account", "Type", "Debit", "Credit", "Balance"],
        rows: rows.map((r) => [r.code, r.name, r.type, r.total_debit, r.total_credit, r.balance]),
        footer: [["", "", "Totals", rows.reduce((a, r) => a + r.total_debit, 0), rows.reduce((a, r) => a + r.total_credit, 0), ""]],
      }));
    }

    // ------------------------------------------------------ statements
    case "profit-and-loss": {
      const period = { from: c.from, to: c.to };
      const pnl = buildProfitAndLoss(await getTrialBalance(period), period);
      const prior = priorPeriod(period);
      const cmp = comparePnl(pnl, buildProfitAndLoss(await getTrialBalance(prior), prior));

      const rows: CsvValue[][] = [];
      for (const s of cmp.sections) {
        rows.push([s.title, "", "", "", ""]);
        for (const l of s.lines) rows.push([`  ${l.code} ${l.name}`, l.current, l.prior, l.change, l.changePct ?? ""]);
        rows.push([`Total ${s.title.toLowerCase()}`, s.current, s.prior, s.change, s.changePct ?? ""]);
        rows.push([]);
      }
      return file("profit-and-loss", csvFile({
        preamble: head("Profit and loss", [["Compared with", prior.from, "to", prior.to]]),
        header: ["", "Current", "Prior", "Change", "Change %"],
        rows,
        footer: [
          ["Gross profit", cmp.grossProfit.current, cmp.grossProfit.prior, cmp.grossProfit.change, cmp.grossProfit.changePct ?? ""],
          ["Gross margin %", cmp.grossMargin.current, cmp.grossMargin.prior, "", ""],
          ["Net profit", cmp.netProfit.current, cmp.netProfit.prior, cmp.netProfit.change, cmp.netProfit.changePct ?? ""],
        ],
      }));
    }

    case "balance-sheet": {
      // Profit for the period is not on the balance sheet's own accounts
      // until the year is closed, so it is computed from the same
      // fiscal-year trial balance the screen uses and passed in.
      const fy = fiscalYearRange(new Date(`${c.to}T00:00:00Z`), (await getCompanySettings()).fiscal_year_start_month);
      const ytd = buildProfitAndLoss(await getTrialBalance({ from: fy.from, to: c.to }), { from: fy.from, to: c.to });
      const bs = buildBalanceSheet(await getTrialBalance({ to: c.to }), c.to, ytd.netProfit);
      const rows: CsvValue[][] = [];
      for (const s of [bs.assets, bs.liabilities, bs.equity]) {
        rows.push([s.title, ""]);
        for (const l of s.lines) rows.push([`  ${l.code} ${l.name}`, l.amount]);
        rows.push([`Total ${s.title.toLowerCase()}`, s.total]);
        rows.push([]);
      }
      return file("balance-sheet", csvFile({
        preamble: head("Balance sheet"),
        header: ["", "Amount"],
        rows,
        footer: [["Profit for the period", bs.profitForPeriod], ["Out of balance by", bs.difference]],
      }));
    }

    case "cash-flow": {
      const cf = await getCashFlow(c.from, c.to);
      const rows: CsvValue[][] = [["Opening cash and bank", cf.opening]];
      rows.push([]);
      for (const s of cf.sections) {
        rows.push([s.label, ""]);
        for (const l of s.lines) rows.push([`  ${l.key}`, l.amount]);
        rows.push([`Net ${s.label.toLowerCase()}`, s.total]);
        rows.push([]);
      }
      return file("cash-flow", csvFile({
        preamble: head("Cash flow statement (direct method)"),
        header: ["", "Amount"],
        rows,
        footer: [
          ["Net movement", cf.netChange],
          ["Closing cash and bank", cf.closing],
          ...(Math.abs(cf.unclassified) > 0.005 ? [["Unclassified", cf.unclassified] as CsvValue[]] : []),
        ],
      }));
    }

    // ------------------------------------------------------ receivables
    case "aged-debtors": {
      const { rows, totals } = await getAging();
      return file("aged-debtors", csvFile({
        preamble: head("Aged debtors"),
        header: ["Customer", "Email", "Credit limit", "On hold", "Open invoices", "Worst days overdue",
          ...BUCKET_ORDER.map((b) => BUCKET_LABEL[b]), "Outstanding"],
        rows: rows.map((r) => [
          r.company_name, r.email, r.credit_limit, r.credit_hold ? "Yes" : "No",
          r.open_invoices, r.worst_days, ...BUCKET_ORDER.map((b) => r.buckets[b]), r.outstanding,
        ]),
        footer: [["Totals", "", "", "", "", "", ...BUCKET_ORDER.map((b) => totals.buckets[b]), totals.outstanding]],
      }));
    }

    case "statement": {
      const id = c.viewerId ?? c.customerId;
      if (!id) return null;
      const s = await getStatement(id, c.from, c.to);
      if (!s) return null;
      const customer = (await getCustomers()).find((x) => x.id === id);

      return file("statement", csvFile({
        preamble: head("Account statement", [["Account", customer?.company_name ?? ""]]),
        header: ["Date", "Reference", "Description", "Debit", "Credit", "Balance"],
        rows: [
          ["", "", "Opening balance", "", "", s.opening],
          ...s.lines.map((l) => [l.date, l.entry_no, l.description, l.debit || "", l.credit || "", l.balance]),
        ],
        footer: [
          ["", "", "Totals", s.totals.debits, s.totals.credits, ""],
          ["", "", "Closing balance", "", "", s.closing],
          ...(s.advance > 0 ? [["", "", "Less credit on account", "", "", -s.advance] as CsvValue[]] : []),
          [],
          ["Ageing", ...BUCKET_ORDER.map((b) => BUCKET_LABEL[b])],
          ["", ...BUCKET_ORDER.map((b) => s.aging[b])],
        ],
      }));
    }

    // ------------------------------------------------------- documents
    case "invoices": {
      const all = await getInvoices();
      const rows = all
        .filter((i) => {
          const on = i.issue_date ?? i.created_at.slice(0, 10);
          return (!c.from || on >= c.from) && on <= c.to;
        })
        .map((i) => [
          i.invoice_number ?? "(draft)", i.type, i.status, i.customer.company_name,
          i.order_numbers.join(" "), i.issue_date ?? "", i.due_date ?? "",
          i.subtotal, i.discount, i.freight, i.tax_amount, i.total, i.paid, i.balance,
          SETTLEMENT_LABEL[i.settlement],
        ]);
      return file("invoices", csvFile({
        preamble: head("Invoice register"),
        header: ["Number", "Type", "Status", "Customer", "Orders", "Issued", "Due",
          "Subtotal", "Discount", "Freight", "Tax", "Total", "Paid", "Balance", "Settlement"],
        rows,
      }));
    }

    case "purchases": {
      const bills = await getBills();
      const rows = bills
        .filter((b) => (!c.from || b.bill_date >= c.from) && b.bill_date <= c.to)
        .map((b) => [b.bill_number, b.supplier_name, b.status, b.bill_date, b.due_date ?? "",
          b.subtotal, b.freight, b.tax_amount, b.total, b.paid, b.balance]);
      return file("purchases", csvFile({
        preamble: head("Purchase register"),
        header: ["Bill", "Supplier", "Status", "Dated", "Due", "Subtotal", "Freight", "Input tax", "Total", "Paid", "Balance"],
        rows,
      }));
    }

    case "stock": {
      const products = await getProducts({ perPage: 10000, includeArchived: true });
      return file("stock", csvFile({
        preamble: head("Stock valuation"),
        header: ["SKU", "Name", "Category", "HS code", "Unit", "On hand", "Committed", "Available",
          "Unit cost", "Stock value", "Sell price", "Reorder point", "Archived"],
        rows: products.rows.map((p) => [
          p.sku, p.name, p.category, p.hs_code ?? "", p.unit_of_measure,
          p.stock_quantity, p.availability.committed, p.availability.available,
          p.cost_price, Math.round(p.stock_quantity * p.cost_price * 100) / 100,
          p.price, p.reorder_point, p.is_archived ? "Yes" : "No",
        ]),
        footer: [["", "", "", "", "", "", "", "", "Total",
          products.rows.reduce((a, p) => a + p.stock_quantity * p.cost_price, 0)]],
      }));
    }

    // ------------------------------------------------------- tax return
    case "sales-tax": {
      const months = await getSalesTaxSummary();
      return file("sales-tax-summary", csvFile({
        preamble: head("Sales tax summary"),
        header: ["Month", "Output tax", "Input tax", "Net payable"],
        rows: months.map((m) => [m.month, m.output, m.input, m.net]),
      }));
    }

    case "annex-c": {
      const report = await getAnnexC(c.month);
      return {
        body: csvFile({
          preamble: [
            [c.company],
            ["Annex-C · Domestic sales"],
            ["Tax period", report.month],
            ["Seller NTN", (await getCompanySettings()).ntn ?? ""],
            ["Seller STRN", (await getCompanySettings()).strn ?? ""],
            ...(report.invalid > 0
              ? [[`${report.invalid} of ${report.rows.length} rows are incomplete and will be rejected on upload`]]
              : []),
            ...report.issues.map((i) => [`  ${i.reason}`, String(i.count)]),
            ...c.stamp.map((s) => [s]),
          ],
          header: ANNEX_C_HEADER,
          rows: report.rows.map(annexCCells),
          footer: [
            ["", "", "", "", "", "", "", "", "Totals",
              report.totals.value, report.totals.tax, report.totals.further, report.totals.total],
          ],
        }),
        contentType: CSV,
        filename: exportFilename("annex-c", { from: report.month }, "csv"),
      };
    }

    case "buyer-register": {
      const customers = await getCustomers();
      return file("buyer-register", csvFile({
        preamble: head("Buyer register"),
        header: ["Customer", "Email", "Classification", "STRN", "NTN", "CNIC", "Billing address", "Credit limit", "Terms"],
        rows: customers.map((u) => [
          u.company_name ?? u.email, u.email,
          BUYER_TYPE_LABEL[u.strn ? "registered" : u.ntn ? "unregistered" : "end_consumer"],
          u.strn ?? "", u.ntn ?? "", u.cnic ?? "", u.billing_address ?? "",
          u.credit_limit, u.payment_terms_days ?? "",
        ]),
      }));
    }

    // -------------------------------------------------- other packages
    case "tally": {
      const entries = await getExportEntries(c.from, c.to);
      return {
        body: toTallyXml(entries, c.company),
        contentType: XML,
        filename: exportFilename("tally-vouchers", { from: c.from, to: c.to }, "xml"),
      };
    }

    case "quickbooks": {
      const entries = await getExportEntries(c.from, c.to);
      return file("quickbooks-journal", toQuickBooksCsv(entries, { company: c.company, from: c.from, to: c.to }));
    }

    case "quickbooks-accounts":
      return file("quickbooks-accounts", toQuickBooksAccountsCsv(await getAccounts(), c.company));

    default:
      return null;
  }
}
