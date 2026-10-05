/**
 * Seeds a live Supabase project with representative trading data.
 *
 *   node scripts/seed-demo.mjs
 *   node scripts/seed-demo.mjs --wipe    (clears seeded data first)
 *
 * This is demonstration data, not a fixture for tests. It exists so the
 * screens have something truthful to show: stock that was bought and
 * dispatched, invoices at different ages, one part-paid, a credit note,
 * a supplier bill with input tax, and expenses that make the profit and
 * loss look like a real month rather than a wall of zeroes.
 *
 * Everything posts through the same double-entry rules the app uses, so
 * if the seed is wrong the database rejects it: the balance constraint on
 * journal_lines is deferred to commit and will refuse an unbalanced
 * entry. A successful run therefore proves the ledger adds up.
 *
 * It writes with the service role, which bypasses row level security.
 * That is the point for seeding, and it is also why this must never be
 * reachable from the app.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------- config
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
if (!cfg.NEXT_PUBLIC_SUPABASE_URL || !cfg.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(cfg.NEXT_PUBLIC_SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const WIPE = process.argv.includes("--wipe");
const TAX = 0.18;

// Dates are relative to today so the aged debtors report always has
// something in every bucket, however long after seeding you look.
const DAY = 86400e3;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);
const stamp = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();

const round2 = (n) => Math.round(n * 100) / 100;
const step = (msg) => console.log(`  ${msg}`);

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) {
    console.error(`\nFailed at: ${label}\n  ${error.message}`);
    process.exit(1);
  }
  return data;
}

// ---------------------------------------------------------------- wipe
async function wipe() {
  step("Clearing seeded data…");
  // Order matters: children before parents, ledger last because
  // everything references it.
  for (const table of [
    "invoice_payments", "invoice_items", "invoices",
    "bill_payments", "bill_items", "bills", "suppliers",
    "stock_movements", "order_messages", "order_items", "orders",
    "announcements", "customer_applications",
  ]) {
    const { error } = await db.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) console.warn(`    ${table}: ${error.message}`);
  }

  // journal_lines and journal_entries are protected by an append-only
  // trigger, so they are removed with the trigger briefly disabled. This
  // is the only place that is acceptable, and only against seed data.
  const { error: ledgerError } = await db.rpc("exec_seed_cleanup").catch(() => ({ error: null }));
  if (ledgerError) console.warn(`    ledger: ${ledgerError.message}`);

  await db.from("products").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await db.from("document_counters").delete().neq("scope", "");

  // Demo customers only. The owner's admin account is left alone.
  const { data: list } = await db.auth.admin.listUsers({ perPage: 200 });
  for (const u of list?.users ?? []) {
    if (u.email?.endsWith(".demo.pk")) await db.auth.admin.deleteUser(u.id);
  }
}

// ---------------------------------------------------------------- ledger
let accounts = {};

async function loadAccounts() {
  const rows = await must("read accounts", db.from("accounts").select("id, system_key").not("system_key", "is", null));
  accounts = Object.fromEntries(rows.map((a) => [a.system_key, a.id]));
}

let entryNo = 0;

/**
 * Posts one balanced entry. Written directly rather than through the
 * post_journal_entry RPC because that function demands is_staff(), and a
 * service-role connection has no auth.uid() to be staff with.
 */
async function post({ date, narration, source, lines }) {
  const debits = round2(lines.reduce((a, l) => a + (l.debit ?? 0), 0));
  const credits = round2(lines.reduce((a, l) => a + (l.credit ?? 0), 0));
  if (Math.abs(debits - credits) > 0.005) {
    console.error(`\nSeed bug: "${narration}" is out of balance by ${round2(debits - credits)}`);
    process.exit(1);
  }

  entryNo += 1;
  const entry = await must(
    `post ${narration}`,
    db.from("journal_entries").insert({
      entry_no: `JV-2026-27-${String(entryNo).padStart(5, "0")}`,
      entry_date: date,
      narration,
      source_type: source,
    }).select("id").single(),
  );

  await must(
    `lines for ${narration}`,
    db.from("journal_lines").insert(
      lines.map((l, i) => ({
        entry_id: entry.id,
        account_id: l.account,
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
        party_id: l.party ?? null,
        memo: l.memo ?? null,
        sort_order: i,
      })),
    ),
  );

  return entry.id;
}

// ---------------------------------------------------------------- data
const CATALOGUE = [
  ["FAS-0140", "Hex Bolt M10 Grade 8.8", "Fasteners", "Box of 100", 1150, 790, 600, 120],
  ["FAS-0177", "Socket Cap Screw M6", "Fasteners", "Box of 100", 890, 605, 820, 150],
  ["FAS-0214", "Nylon Lock Nut M12", "Fasteners", "Box of 100", 640, 430, 1340, 200],
  ["FAS-0251", "Flat Washer 14mm", "Fasteners", "Box of 100", 310, 198, 2100, 300],
  ["FAS-0288", "Threaded Rod 1m", "Fasteners", "Each", 980, 672, 340, 60],
  ["PKG-0325", "Stretch Wrap 500mm", "Packaging", "Each", 1420, 985, 410, 80],
  ["PKG-0362", "Corrugated Box 12x12", "Packaging", "Box of 50", 2240, 1580, 190, 40],
  ["PKG-0399", "Kraft Tape 48mm", "Packaging", "Carton", 1760, 1215, 260, 50],
  ["PKG-0436", "Bubble Roll 750mm", "Packaging", "Each", 2980, 2090, 95, 25],
  ["SAF-0473", "Nitrile Glove L", "Safety Gear", "Box of 100", 1340, 905, 480, 90],
  ["SAF-0510", "Hi-Vis Vest Class 2", "Safety Gear", "Each", 890, 590, 320, 60],
  ["SAF-0547", "Safety Goggle Clear", "Safety Gear", "Each", 640, 415, 540, 100],
  ["SAF-0584", "Steel Toe Boot 42", "Safety Gear", "Each", 5890, 4120, 85, 20],
  ["SAF-0621", "Ear Defender 31dB", "Safety Gear", "Each", 2540, 1760, 140, 30],
  ["ELC-0658", "Cable Gland M20", "Electrical", "Box of 50", 1890, 1290, 310, 60],
  ["ELC-0695", "Copper Lug 16mm2", "Electrical", "Box of 50", 2340, 1640, 175, 40],
  ["ELC-0732", "Terminal Block 12W", "Electrical", "Each", 760, 505, 620, 100],
  ["ELC-0769", "Conduit Clip 20mm", "Electrical", "Box of 100", 520, 338, 890, 150],
  ["LUB-0806", "Lithium Grease 400g", "Lubricants", "Each", 680, 455, 430, 80],
  ["LUB-0843", "Chain Oil 5L", "Lubricants", "Each", 3240, 2280, 120, 30],
  ["LUB-0880", "Cutting Fluid 20L", "Lubricants", "Each", 8900, 6350, 45, 15],
  ["LUB-0917", "Gear Oil 80W-90", "Lubricants", "Each", 2150, 1480, 210, 40],
  ["ADH-0954", "Epoxy 50ml", "Adhesives", "Each", 1120, 760, 280, 50],
  ["ADH-0991", "Threadlocker Blue", "Adhesives", "Each", 1549, 1040, 165, 40],
  ["ADH-1028", "Silicone Sealant", "Adhesives", "Carton", 2680, 1870, 130, 30],
  ["ADH-1065", "Anti-Seize 250g", "Adhesives", "Each", 1980, 1365, 95, 25],
];

const CUSTOMERS = [
  ["Meezan Hardware Co.", "imran@meezanhw.demo.pk", 1500000, "Plot 14, SITE Area", "1234567-8"],
  ["Sindh Industrial Supply", "orders@sindhsupply.demo.pk", 750000, "Korangi Industrial Area", "2298761-4"],
  ["Falcon Engineering Works", "procure@falconew.demo.pk", 0, "Plot 7, North Karachi", null],
  ["Karachi Fabrication Ltd", "stores@kfab.demo.pk", 2000000, "Landhi Industrial Estate", "5567123-9"],
  ["Bahria Trade House", "ali@bahriatrade.demo.pk", 400000, "Bahria Town, Phase 4", null],
  ["Indus Motors Depot", "depot@indusmotors.demo.pk", 1000000, "Shahrah-e-Faisal", "8812445-3"],
  ["Gulberg Builders Mart", "mart@gulbergbm.demo.pk", 600000, "Gulberg Town", null],
];

const SUPPLIERS = [
  ["Indus Fasteners (Pvt) Ltd", "Imran Qureshi", "sales@indusfasteners.pk", "3012345-7", 30],
  ["Karachi Packaging Mills", "Sana Riaz", "orders@kpm.com.pk", "2298761-4", 45],
  ["Pak Lubricants Trading", "Faisal Ahmed", "faisal@paklub.pk", "4411902-2", 15],
];

// ---------------------------------------------------------------- run
console.log("\nSeeding demo data into Supabase\n");

if (WIPE) await wipe();

// Seeding twice would double every balance, and posted entries cannot be
// unwound afterwards because the ledger is append-only. Refuse rather
// than let that happen quietly.
const { count: alreadyPosted } = await db
  .from("journal_entries").select("id", { count: "exact", head: true });
if (alreadyPosted) {
  console.error(`  This project already has ${alreadyPosted} journal entries.`);
  console.error("  Seeding again would double every balance, and posted entries cannot be deleted.");
  console.error("  Use scripts/seed-trading.mjs to add more trading instead.");
  process.exit(1);
}

await loadAccounts();

// ---- company identity, so invoices print as a real business
step("Company settings");
await must("settings", db.from("company_settings").update({
  legal_name: "Dynamic Traders & Distributors",
  address: "Plot 14, Sector 7-A, SITE Area",
  city: "Karachi",
  country: "Pakistan",
  phone: "+92 21 3257 7788",
  email: "accounts@dynamictraders.pk",
  ntn: "3412876-5",
  strn: "17-00-9999-021-55",
  bank_details: "Meezan Bank, SITE Branch\nAccount title: Dynamic Traders & Distributors\nIBAN: PK36MEZN0001230045678901",
  default_tax_rate: TAX,
  default_terms_days: 30,
  invoice_footer_note: "Thank you for your business.",
  invoice_default_notes: "Goods remain the property of the seller until paid in full.",
}).eq("id", true));

// ---- products, brought in at zero and stocked by a movement so the
// count and the stock ledger agree from the first day
step(`Products (${CATALOGUE.length})`);
const products = await must("products", db.from("products").insert(
  CATALOGUE.map(([sku, name, category, uom, price, cost, , reorder]) => ({
    sku, name, category, unit_of_measure: uom,
    price, cost_price: cost, stock_quantity: 0, reorder_point: reorder,
  })),
).select("id, sku, price, cost_price"));

const bySku = Object.fromEntries(products.map((p) => [p.sku, p]));

// ---- opening stock
const openingValue = round2(CATALOGUE.reduce((a, [, , , , , cost, qty]) => a + cost * qty, 0));
step(`Opening stock, ${openingValue.toLocaleString()} at cost`);
const openingEntry = await post({
  date: iso(90),
  narration: "Opening stock brought forward",
  source: "opening",
  lines: [
    { account: accounts.inventory, debit: openingValue, memo: "Opening stock" },
    { account: accounts.opening_balance, credit: openingValue, memo: "Opening stock" },
  ],
});

await must("opening movements", db.from("stock_movements").insert(
  CATALOGUE.map(([sku, , , , , cost, qty]) => ({
    product_id: bySku[sku].id,
    quantity: qty,
    unit_cost: cost,
    value: round2(qty * cost),
    reason: "opening",
    journal_entry_id: openingEntry,
    note: "Opening stock",
    moved_on: iso(90),
  })),
));

// ---- opening bank and capital, so the bank is not a running total from zero
step("Opening bank and capital");
await post({
  date: iso(90),
  narration: "Opening bank balance and owner capital",
  source: "opening",
  lines: [
    { account: accounts.bank, debit: 3500000, memo: "Opening balance" },
    { account: accounts.cash, debit: 120000, memo: "Opening float" },
    { account: accounts.owner_capital, credit: 2000000, memo: "Capital introduced" },
    { account: accounts.opening_balance, credit: 1620000, memo: "Opening balance" },
  ],
});

// ---- customers
step(`Customers (${CUSTOMERS.length})`);
const customers = [];
for (const [company, email, limit, address, ntn] of CUSTOMERS) {
  const { data: created, error } = await db.auth.admin.createUser({
    email,
    password: crypto.randomUUID() + crypto.randomUUID(),
    email_confirm: true,
    user_metadata: { role: "customer", company_name: company },
  });
  if (error) {
    console.error(`    ${email}: ${error.message}`);
    continue;
  }
  // Invited rather than activated: the owner can walk the real onboarding
  // path from the admin screen instead of being handed a password.
  await must(`profile ${email}`, db.from("users").update({
    company_name: company,
    billing_address: `${address}, Karachi`,
    ntn,
    credit_limit: limit,
    credit_hold: company === "Indus Motors Depot",
    invite_token: crypto.randomUUID().replace(/-/g, ""),
    invited_at: new Date().toISOString(),
    invite_expires_at: new Date(Date.now() + 7 * DAY).toISOString(),
  }).eq("id", created.user.id));
  customers.push({ id: created.user.id, company, email });
}

const customerBy = Object.fromEntries(customers.map((c) => [c.company, c]));

// ---- suppliers
step(`Suppliers (${SUPPLIERS.length})`);
await must("suppliers", db.from("suppliers").insert(
  SUPPLIERS.map(([name, contact, email, ntn, terms]) => ({
    name, contact_name: contact, email, ntn,
    payment_terms_days: terms, address: "SITE Area, Karachi",
  })),
));

// ---- orders
const ORDERS = [
  ["Meezan Hardware Co.", "pending", 2, [["FAS-0140", 180], ["PKG-0362", 40], ["SAF-0473", 60], ["ELC-0732", 90]]],
  ["Sindh Industrial Supply", "pending", 1, [["ELC-0658", 50], ["LUB-0806", 70]]],
  ["Falcon Engineering Works", "pending", 0, [["ADH-0991", 25], ["SAF-0547", 40]]],
  ["Karachi Fabrication Ltd", "approved", 4, [["FAS-0288", 60], ["FAS-0214", 150]]],
  ["Bahria Trade House", "approved", 3, [["PKG-0325", 70]]],
  ["Indus Motors Depot", "fulfilled", 48, [["LUB-0917", 80], ["LUB-0806", 120]]],
  ["Gulberg Builders Mart", "fulfilled", 22, [["ADH-1028", 45]]],
  ["Meezan Hardware Co.", "fulfilled", 70, [["FAS-0177", 300], ["PKG-0436", 35]]],
  ["Sindh Industrial Supply", "rejected", 14, [["SAF-0621", 20]]],
];

step(`Orders (${ORDERS.length})`);
const placed = [];
for (const [company, status, daysAgo, lines] of ORDERS) {
  const customer = customerBy[company];
  if (!customer) continue;

  const order = await must(`order for ${company}`, db.from("orders").insert({
    customer_id: customer.id,
    status,
    delivery_address: "Warehouse 3 - SITE Area, Karachi",
    required_by: iso(daysAgo - 7),
    created_at: stamp(daysAgo),
  }).select("id, order_number").single());

  const items = await must(`items for ${order.order_number}`, db.from("order_items").insert(
    lines.map(([sku, qty]) => ({
      order_id: order.id,
      product_id: bySku[sku].id,
      quantity: qty,
      price_at_purchase: bySku[sku].price,
    })),
  ).select("id, product_id, quantity, price_at_purchase"));

  placed.push({ ...order, customer, status, daysAgo, items, lines });
}

// ---- dispatch the fulfilled orders: stock out, cost of sale posted
const dispatched = placed.filter((o) => o.status === "fulfilled");
step(`Dispatching ${dispatched.length} fulfilled orders`);
for (const order of dispatched) {
  const cost = round2(order.lines.reduce((a, [sku, qty]) => a + bySku[sku].cost_price * qty, 0));
  const entry = await post({
    date: iso(order.daysAgo),
    narration: `Cost of goods dispatched on order ${order.order_number}`,
    source: "dispatch",
    lines: [
      { account: accounts.cogs, debit: cost, memo: order.order_number },
      { account: accounts.inventory, credit: cost, memo: order.order_number },
    ],
  });

  await must(`dispatch ${order.order_number}`, db.from("stock_movements").insert(
    order.lines.map(([sku, qty]) => ({
      product_id: bySku[sku].id,
      quantity: -qty,
      unit_cost: bySku[sku].cost_price,
      value: round2(-qty * bySku[sku].cost_price),
      reason: "dispatch",
      order_id: order.id,
      journal_entry_id: entry,
      moved_on: iso(order.daysAgo),
    })),
  ));
}

// ---- invoice them, at ages that spread across the aging buckets
step(`Invoicing ${dispatched.length} orders`);
const invoices = [];
let invoiceSeq = 0;
for (const order of dispatched) {
  invoiceSeq += 1;
  const subtotal = round2(order.lines.reduce((a, [sku, qty]) => a + bySku[sku].price * qty, 0));
  const tax = round2(subtotal * TAX);
  const total = round2(subtotal + tax);
  const number = `INV-2627-${String(invoiceSeq).padStart(5, "0")}`;

  // Created as a draft because a trigger refuses lines on an issued
  // invoice, then flipped to issued once the lines are in.
  const invoice = await must(`invoice ${number}`, db.from("invoices").insert({
    invoice_number: number,
    type: "tax_invoice",
    status: "draft",
    order_id: order.id,
    customer_id: order.customer.id,
    currency: "PKR",
    tax_rate: TAX,
    subtotal, tax_amount: tax, total,
    issue_date: iso(order.daysAgo),
    due_date: iso(order.daysAgo - 30),
    terms_days: 30,
    created_at: stamp(order.daysAgo),
  }).select("id").single());

  await must(`invoice items ${number}`, db.from("invoice_items").insert(
    order.lines.map(([sku, qty], i) => {
      const line = order.items.find((it) => it.product_id === bySku[sku].id);
      return {
        invoice_id: invoice.id,
        order_item_id: line?.id ?? null,
        sku,
        name: CATALOGUE.find((c) => c[0] === sku)[1],
        unit_of_measure: CATALOGUE.find((c) => c[0] === sku)[3],
        quantity: qty,
        unit_price: bySku[sku].price,
        line_total: round2(bySku[sku].price * qty),
        sort_order: i,
      };
    }),
  ));

  const entry = await post({
    date: iso(order.daysAgo),
    narration: `Invoice ${number} to ${order.customer.company}`,
    source: "invoice",
    lines: [
      { account: accounts.accounts_receivable, debit: total, party: order.customer.id, memo: number },
      { account: accounts.sales_revenue, credit: subtotal },
      { account: accounts.output_tax, credit: tax },
    ],
  });

  await must(`issue ${number}`, db.from("invoices").update({
    status: "issued",
    journal_entry_id: entry,
    seller: {
      name: "Dynamic Traders & Distributors",
      address: "Plot 14, Sector 7-A, SITE Area",
      city: "Karachi", country: "Pakistan",
      ntn: "3412876-5", strn: "17-00-9999-021-55",
      phone: "+92 21 3257 7788",
      bank: "Meezan Bank, SITE Branch\nIBAN: PK36MEZN0001230045678901",
      tagline: "Wholesale distribution", initials: "DT",
      template: "classic", accent: "#123A5E", tax_label: "Sales Tax",
      show_bank: true, show_tax_ids: true,
      currency_symbol: "PKR", currency_display: "code", decimals: 0, locale: "en-US",
    },
    buyer: { name: order.customer.company, email: order.customer.email },
    issued_at: stamp(order.daysAgo),
  }).eq("id", invoice.id));

  invoices.push({ id: invoice.id, number, total, customer: order.customer, daysAgo: order.daysAgo });
}

// ---- one invoice part paid, so the book is not uniformly unpaid
const partPaid = invoices.find((i) => i.daysAgo === 48) ?? invoices[0];
if (partPaid) {
  const amount = round2(partPaid.total * 0.4);
  step(`Receipt of ${amount.toLocaleString()} against ${partPaid.number}`);
  const entry = await post({
    date: iso(20),
    narration: `Receipt from ${partPaid.customer.company} · TT-88213`,
    source: "payment",
    lines: [
      { account: accounts.bank, debit: amount, memo: "TT-88213" },
      { account: accounts.accounts_receivable, credit: amount, party: partPaid.customer.id, memo: partPaid.number },
    ],
  });
  await must("receipt", db.from("invoice_payments").insert({
    invoice_id: partPaid.id,
    amount,
    paid_on: iso(20),
    method: "bank_transfer",
    reference: "TT-88213",
    journal_entry_id: entry,
  }));
}

// ---- a supplier bill, so input tax exists to set against output tax
step("Supplier bill with input tax");
const supplier = await must("read supplier", db.from("suppliers").select("id, name").limit(1).single());
const billGoods = 420000;
const billTax = round2(billGoods * TAX);
const billEntry = await post({
  date: iso(12),
  narration: `Bill BILL-2627-00001 from ${supplier.name} · SI-99214`,
  source: "bill",
  lines: [
    { account: accounts.inventory, debit: billGoods, memo: "BILL-2627-00001" },
    { account: accounts.input_tax, debit: billTax },
    { account: accounts.accounts_payable, credit: round2(billGoods + billTax), memo: `${supplier.name} SI-99214` },
  ],
});
const bill = await must("bill", db.from("bills").insert({
  supplier_id: supplier.id,
  supplier_ref: "SI-99214",
  bill_number: "BILL-2627-00001",
  status: "posted",
  bill_date: iso(12),
  due_date: iso(-18),
  terms_days: 30,
  tax_rate: TAX,
  subtotal: billGoods,
  tax_amount: billTax,
  total: round2(billGoods + billTax),
  journal_entry_id: billEntry,
  posted_at: stamp(12),
}).select("id").single());

await must("bill items", db.from("bill_items").insert([
  { bill_id: bill.id, product_id: bySku["FAS-0140"].id, description: "Hex Bolt M10 Grade 8.8", quantity: 300, unit_cost: 790, line_total: 237000, sort_order: 0 },
  { bill_id: bill.id, product_id: bySku["FAS-0177"].id, description: "Socket Cap Screw M6", quantity: 300, unit_cost: 610, line_total: 183000, sort_order: 1 },
]));

await must("bill stock", db.from("stock_movements").insert([
  { product_id: bySku["FAS-0140"].id, quantity: 300, unit_cost: 790, value: 237000, reason: "purchase", journal_entry_id: billEntry, moved_on: iso(12), note: "Goods received" },
  { product_id: bySku["FAS-0177"].id, quantity: 300, unit_cost: 610, value: 183000, reason: "purchase", journal_entry_id: billEntry, moved_on: iso(12), note: "Goods received" },
]));

// ---- running costs, so the profit and loss is not revenue with no expenses
step("Operating expenses");
for (const [daysAgo, account, amount, narration] of [
  [35, "rent", 150000, "Office and warehouse rent"],
  [35, "salaries", 480000, "Staff salaries"],
  [33, "utilities", 38500, "Electricity and water"],
  [30, "freight_expense", 62000, "Delivery charges"],
  [5, "rent", 150000, "Office and warehouse rent"],
  [5, "salaries", 480000, "Staff salaries"],
  [3, "utilities", 41200, "Electricity and water"],
  [2, "other_expenses", 18750, "Bank charges and stationery"],
]) {
  await post({
    date: iso(daysAgo),
    narration,
    source: "manual",
    lines: [
      { account: accounts[account], debit: amount },
      { account: accounts.bank, credit: amount },
    ],
  });
}

// ---- document counters, so the next real invoice continues the run
step("Document counters");
await must("counters", db.from("document_counters").upsert([
  { scope: "INV-2026-27", last_value: invoiceSeq },
  { scope: "BILL-2026-27", last_value: 1 },
  { scope: "JV-2026-27", last_value: entryNo },
], { onConflict: "scope" }));

// ---- announcements
step("Announcements and FAQs");
await must("announcements", db.from("announcements").insert([
  { title: "Holiday shipping schedule", content: "Orders placed after 20 Dec dispatch from 26 Dec. Cut-off for same-week delivery is 14:00 daily.", type: "announcement", priority: 1 },
  { title: "New price list effective 1 Nov", content: "Contract customers will receive the updated schedule by email.", type: "announcement", priority: 2 },
  { title: "What is the minimum order value?", content: "PKR 25,000 per order for standard accounts.", type: "faq", priority: 1 },
  { title: "How long does approval take?", content: "Usually within 2 business hours during 09:00 to 18:00.", type: "faq", priority: 2 },
  { title: "Do you deliver outside Sindh?", content: "Yes. Freight is quoted at approval.", type: "faq", priority: 3 },
]));

// ---- an application waiting in the review queue
await must("application", db.from("customer_applications").insert({
  company_name: "Clifton Hardware Mart",
  contact_name: "Bilal Siddiqui",
  email: "bilal@cliftonhardware.demo.pk",
  phone: "+92 300 2214477",
  address: "Shop 14, Block 5, Clifton",
  city: "Karachi",
  ntn: "7781234-5",
  business_type: "Hardware store",
  years_trading: 6,
  note: "Referred by Meezan Hardware. Looking for monthly terms.",
}));

// ---- prove it adds up
const { data: tb } = await db.from("account_balances").select("total_debit, total_credit");
const debits = round2((tb ?? []).reduce((a, r) => a + Number(r.total_debit), 0));
const credits = round2((tb ?? []).reduce((a, r) => a + Number(r.total_credit), 0));

console.log(`\n  Ledger: debits ${debits.toLocaleString()} / credits ${credits.toLocaleString()}`);
console.log(
  Math.abs(debits - credits) < 0.005
    ? "  In balance.\n"
    : `  OUT OF BALANCE by ${round2(debits - credits)} — investigate before using this data.\n`,
);
console.log("  Done. Sign in and look at /admin.\n");
