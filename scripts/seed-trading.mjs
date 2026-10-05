/**
 * Adds trading history to an already-seeded project.
 *
 *   node scripts/seed-trading.mjs
 *
 * Separate from seed-demo.mjs on purpose. That script sets a project up
 * once: products, customers, opening balances. This one only adds sales,
 * so it can be run again whenever the demo needs to look busier, and it
 * never deletes anything.
 *
 * That split exists because the ledger is append-only by design. There is
 * no supported way to erase posted entries, and there should not be: a
 * ledger you can quietly rewrite is not evidence of anything. So this
 * corrects a thin-looking demo the way a real business would, by trading
 * more, rather than by editing the past.
 *
 * Each order dispatches stock, posts the cost of sale, raises an invoice
 * and posts the receivable. The stock_quantity check constraint refuses
 * anything that would oversell, so the data cannot drift into fiction.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function env() {
  const out = {};
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const at = t.indexOf("=");
    if (at === -1) continue;
    out[t.slice(0, at)] = t.slice(at + 1).replace(/^"|"$/g, "");
  }
  return out;
}

const cfg = env();
const db = createClient(cfg.NEXT_PUBLIC_SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DAY = 86400e3;
const TAX = 0.18;
const iso = (d) => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
const stamp = (d) => new Date(Date.now() - d * DAY).toISOString();
const round2 = (n) => Math.round(n * 100) / 100;

async function must(label, p) {
  const { data, error } = await p;
  if (error) { console.error(`\nFailed at: ${label}\n  ${error.message}`); process.exit(1); }
  return data;
}

const accountRows = await must("accounts", db.from("accounts").select("id, system_key").not("system_key", "is", null));
const acc = Object.fromEntries(accountRows.map((a) => [a.system_key, a.id]));

const products = await must("products", db.from("products").select("id, sku, name, unit_of_measure, price, cost_price, stock_quantity"));
const bySku = Object.fromEntries(products.map((p) => [p.sku, p]));

const customers = await must("customers", db.from("users").select("id, company_name, email").eq("role", "customer"));
const byName = Object.fromEntries(customers.map((c) => [c.company_name, c]));

// Continue the existing runs rather than colliding with them.
const lastEntry = await must("last entry", db.from("journal_entries").select("entry_no").order("entry_no", { ascending: false }).limit(1));
const lastInvoice = await must("last invoice", db.from("invoices").select("invoice_number").not("invoice_number", "is", null).order("invoice_number", { ascending: false }).limit(1));

let entrySeq = lastEntry[0] ? Number(lastEntry[0].entry_no.split("-").pop()) : 0;
let invoiceSeq = lastInvoice[0] ? Number(lastInvoice[0].invoice_number.split("-").pop()) : 0;

async function post({ date, narration, source, lines }) {
  const debits = round2(lines.reduce((a, l) => a + (l.debit ?? 0), 0));
  const credits = round2(lines.reduce((a, l) => a + (l.credit ?? 0), 0));
  if (Math.abs(debits - credits) > 0.005) {
    console.error(`Seed bug: "${narration}" out of balance by ${round2(debits - credits)}`);
    process.exit(1);
  }
  entrySeq += 1;
  const entry = await must(narration, db.from("journal_entries").insert({
    entry_no: `JV-2026-27-${String(entrySeq).padStart(5, "0")}`,
    entry_date: date, narration, source_type: source,
  }).select("id").single());
  await must(`${narration} lines`, db.from("journal_lines").insert(
    lines.map((l, i) => ({
      entry_id: entry.id, account_id: l.account,
      debit: l.debit ?? 0, credit: l.credit ?? 0,
      party_id: l.party ?? null, memo: l.memo ?? null, sort_order: i,
    })),
  ));
  return entry.id;
}

// Spread across the quarter so the aged schedule and the monthly tax
// summary both have something to show in every period.
const SALES = [
  [82, "Meezan Hardware Co.",       [["FAS-0140", 160], ["FAS-0251", 400], ["ELC-0769", 220]]],
  [74, "Karachi Fabrication Ltd",   [["FAS-0214", 320], ["FAS-0177", 140]]],
  [61, "Sindh Industrial Supply",   [["ELC-0658", 60], ["ELC-0732", 180], ["SAF-0473", 90]]],
  [52, "Gulberg Builders Mart",     [["PKG-0325", 85], ["PKG-0399", 55]]],
  [44, "Meezan Hardware Co.",       [["FAS-0140", 140], ["SAF-0473", 110], ["ADH-0954", 60]]],
  [37, "Falcon Engineering Works",  [["ELC-0695", 45], ["LUB-0917", 55]]],
  [29, "Karachi Fabrication Ltd",   [["FAS-0251", 520], ["FAS-0214", 260], ["ELC-0769", 180]]],
  [18, "Bahria Trade House",        [["PKG-0362", 38], ["PKG-0325", 60]]],
  [9,  "Meezan Hardware Co.",       [["SAF-0510", 95], ["SAF-0547", 120]]],

  // A second wave. The first left overheads running ahead of gross
  // profit, which is a real enough position for a quarter but a poor
  // thing for every screen to open on.
  [78, "Indus Motors Depot",        [["LUB-0843", 48], ["LUB-0880", 18], ["ADH-1065", 35]]],
  [66, "Gulberg Builders Mart",     [["FAS-0251", 620], ["FAS-0214", 280], ["ELC-0769", 240]]],
  [57, "Meezan Hardware Co.",       [["SAF-0584", 22], ["SAF-0621", 40], ["SAF-0473", 95]]],
  [48, "Karachi Fabrication Ltd",   [["ELC-0695", 42], ["ELC-0658", 70], ["ELC-0732", 160]]],
  [40, "Sindh Industrial Supply",   [["FAS-0140", 180], ["FAS-0177", 160], ["ADH-0991", 45]]],
  [33, "Bahria Trade House",        [["PKG-0399", 60], ["PKG-0436", 28], ["PKG-0325", 70]]],
  [25, "Falcon Engineering Works",  [["LUB-0917", 60], ["LUB-0806", 140], ["ADH-0954", 70]]],
  [16, "Meezan Hardware Co.",       [["FAS-0288", 110], ["FAS-0251", 480], ["ELC-0769", 200]]],
  [7,  "Karachi Fabrication Ltd",   [["PKG-0362", 42], ["ADH-1028", 38], ["SAF-0547", 90]]],
];

console.log("\nAdding trading history\n");

let revenue = 0;
for (const [daysAgo, company, lines] of SALES) {
  const customer = byName[company];
  if (!customer) { console.warn(`  skipped: no customer "${company}"`); continue; }

  // Skip anything already seeded, so this can be run again after the list
  // is extended without duplicating what is already there.
  //
  // Matched on the order DATE, not the created_at timestamp. Timestamps
  // are recomputed from Date.now() on every run, so comparing them never
  // matched and the whole list was seeded a second time. The date is
  // stable for a given entry in the list, which is what makes this work.
  const dayStart = `${iso(daysAgo)}T00:00:00.000Z`;
  const dayEnd = `${iso(daysAgo)}T23:59:59.999Z`;
  const { data: existing } = await db.from("orders")
    .select("id")
    .eq("customer_id", customer.id)
    .gte("created_at", dayStart)
    .lte("created_at", dayEnd)
    .limit(1);
  if (existing?.length) {
    console.log(`  ${iso(daysAgo)}  already seeded for ${company}, skipped`);
    continue;
  }

  // Refuse rather than oversell. The database would stop it anyway; this
  // gives a readable reason instead of a constraint violation.
  const short = lines.find(([sku, qty]) => !bySku[sku] || bySku[sku].stock_quantity < qty);
  if (short) {
    console.warn(`  skipped ${company} on ${iso(daysAgo)}: not enough ${short[0]}`);
    continue;
  }

  const order = await must("order", db.from("orders").insert({
    customer_id: customer.id,
    status: "fulfilled",
    delivery_address: "Warehouse 3 - SITE Area, Karachi",
    required_by: iso(daysAgo - 5),
    created_at: stamp(daysAgo),
  }).select("id, order_number").single());

  const items = await must("order items", db.from("order_items").insert(
    lines.map(([sku, qty]) => ({
      order_id: order.id, product_id: bySku[sku].id,
      quantity: qty, price_at_purchase: bySku[sku].price,
    })),
  ).select("id, product_id"));

  // Dispatch: stock out and the cost of sale.
  const cost = round2(lines.reduce((a, [sku, qty]) => a + Number(bySku[sku].cost_price) * qty, 0));
  const dispatchEntry = await post({
    date: iso(daysAgo),
    narration: `Cost of goods dispatched on order ${order.order_number}`,
    source: "dispatch",
    lines: [
      { account: acc.cogs, debit: cost, memo: order.order_number },
      { account: acc.inventory, credit: cost, memo: order.order_number },
    ],
  });

  await must("dispatch", db.from("stock_movements").insert(
    lines.map(([sku, qty]) => ({
      product_id: bySku[sku].id, quantity: -qty,
      unit_cost: bySku[sku].cost_price, value: round2(-qty * Number(bySku[sku].cost_price)),
      reason: "dispatch", order_id: order.id,
      journal_entry_id: dispatchEntry, moved_on: iso(daysAgo),
    })),
  ));
  for (const [sku, qty] of lines) bySku[sku].stock_quantity -= qty;

  // Invoice.
  invoiceSeq += 1;
  const number = `INV-2627-${String(invoiceSeq).padStart(5, "0")}`;
  const subtotal = round2(lines.reduce((a, [sku, qty]) => a + Number(bySku[sku].price) * qty, 0));
  const tax = round2(subtotal * TAX);
  const total = round2(subtotal + tax);
  revenue += subtotal;

  const invoice = await must("invoice", db.from("invoices").insert({
    invoice_number: number, type: "tax_invoice", status: "draft",
    order_id: order.id, customer_id: customer.id,
    currency: "PKR", tax_rate: TAX,
    subtotal, tax_amount: tax, total,
    issue_date: iso(daysAgo), due_date: iso(daysAgo - 30), terms_days: 30,
    created_at: stamp(daysAgo),
  }).select("id").single());

  await must("invoice items", db.from("invoice_items").insert(
    lines.map(([sku, qty], i) => ({
      invoice_id: invoice.id,
      order_item_id: items.find((it) => it.product_id === bySku[sku].id)?.id ?? null,
      sku, name: bySku[sku].name, unit_of_measure: bySku[sku].unit_of_measure,
      quantity: qty, unit_price: bySku[sku].price,
      line_total: round2(Number(bySku[sku].price) * qty), sort_order: i,
    })),
  ));

  const invoiceEntry = await post({
    date: iso(daysAgo),
    narration: `Invoice ${number} to ${company}`,
    source: "invoice",
    lines: [
      { account: acc.accounts_receivable, debit: total, party: customer.id, memo: number },
      { account: acc.sales_revenue, credit: subtotal },
      { account: acc.output_tax, credit: tax },
    ],
  });

  await must("issue", db.from("invoices").update({
    status: "issued",
    journal_entry_id: invoiceEntry,
    seller: {
      name: "Dynamic Traders & Distributors",
      address: "Plot 14, Sector 7-A, SITE Area", city: "Karachi", country: "Pakistan",
      ntn: "3412876-5", strn: "17-00-9999-021-55", phone: "+92 21 3257 7788",
      bank: "Meezan Bank, SITE Branch\nIBAN: PK36MEZN0001230045678901",
      tagline: "Wholesale distribution", initials: "DT",
      template: "classic", accent: "#123A5E", tax_label: "Sales Tax",
      show_bank: true, show_tax_ids: true,
      currency_symbol: "PKR", currency_display: "code", decimals: 0, locale: "en-US",
    },
    buyer: { name: company, email: customer.email },
    issued_at: stamp(daysAgo),
  }).eq("id", invoice.id));

  // Older invoices are mostly settled; recent ones are still out. That is
  // what makes the aged schedule worth looking at.
  if (daysAgo > 40) {
    const paidOn = Math.max(1, daysAgo - 28);
    const payEntry = await post({
      date: iso(paidOn),
      narration: `Receipt from ${company} · TT-${90000 + invoiceSeq}`,
      source: "payment",
      lines: [
        { account: acc.bank, debit: total, memo: `TT-${90000 + invoiceSeq}` },
        { account: acc.accounts_receivable, credit: total, party: customer.id, memo: number },
      ],
    });
    await must("receipt", db.from("invoice_payments").insert({
      invoice_id: invoice.id, amount: total, paid_on: iso(paidOn),
      method: "bank_transfer", reference: `TT-${90000 + invoiceSeq}`,
      journal_entry_id: payEntry,
    }));
  }

  console.log(`  ${iso(daysAgo)}  ${number}  ${company.padEnd(26)} ${total.toLocaleString()}`);
}

await must("counters", db.from("document_counters").upsert([
  { scope: "INV-2026-27", last_value: invoiceSeq },
  { scope: "JV-2026-27", last_value: entrySeq },
], { onConflict: "scope" }));

const { data: tb } = await db.from("account_balances").select("total_debit, total_credit");
const debits = round2((tb ?? []).reduce((a, r) => a + Number(r.total_debit), 0));
const credits = round2((tb ?? []).reduce((a, r) => a + Number(r.total_credit), 0));

console.log(`\n  Added ${revenue.toLocaleString()} of revenue`);
console.log(`  Ledger: debits ${debits.toLocaleString()} / credits ${credits.toLocaleString()}`);
console.log(Math.abs(debits - credits) < 0.005 ? "  In balance.\n" : "  OUT OF BALANCE — investigate.\n");
