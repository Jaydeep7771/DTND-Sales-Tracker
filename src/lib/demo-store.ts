// In-memory demo data, seeded from the design prototype. Used whenever
// Supabase keys are not configured so the app is runnable out of the box.
// State lives on globalThis so it survives Next.js dev HMR reloads.
import type { StockMovement, Product, Announcement, UserProfile, OrderStatus, OrderMessage } from "@/types/database";
import { seedAccounting, type DemoAccounting } from "@/lib/demo-accounting";

interface DemoOrder {
  id: string;
  order_number: string;
  customer_id: string;
  status: OrderStatus;
  delivery_address: string | null;
  required_by: string | null;
  note: string | null;
  created_at: string;
  items: { id: string; product_id: string; quantity: number; price_at_purchase: number }[];
}

interface DemoState {
  products: Product[];
  customers: UserProfile[];
  orders: DemoOrder[];
  announcements: Announcement[];
  messages: OrderMessage[];
  staff: UserProfile[];
  acc: DemoAccounting;
  stock: StockMovement[];
  nextOrderNumber: number;
}

const CATS = [
  { name: "Fasteners", code: "FAS", items: ["Hex Bolt M10 Grade 8.8", "Socket Cap Screw M6", "Nylon Lock Nut M12", "Flat Washer 14mm", "Threaded Rod 1m", "Self-Tap Screw #8"] },
  { name: "Packaging", code: "PKG", items: ["Stretch Wrap 500mm", "Corrugated Box 12×12", "Kraft Tape 48mm", "Bubble Roll 750mm", "Pallet Strap 16mm", "Void Fill Paper"] },
  { name: "Safety Gear", code: "SAF", items: ["Nitrile Glove L", "Hi-Vis Vest Class 2", "Safety Goggle Clear", "Steel Toe Boot 42", "Ear Defender 31dB", "Hard Hat Vented"] },
  { name: "Electrical", code: "ELC", items: ["Cable Gland M20", "Copper Lug 16mm²", "Terminal Block 12W", "Conduit Clip 20mm", "Heat Shrink Kit", "Cord Grip Strain"] },
  { name: "Lubricants", code: "LUB", items: ["Lithium Grease 400g", "Chain Oil 5L", "Penetrating Spray", "Cutting Fluid 20L", "Dry PTFE Spray", "Gear Oil 80W-90"] },
  { name: "Adhesives", code: "ADH", items: ["Epoxy 50ml", "Threadlocker Blue", "Cyanoacrylate 20g", "Silicone Sealant", "Contact Cement 1L", "Anti-Seize 250g"] },
];
const UOM = ["Each", "Box of 50", "Carton", "Pallet", "Box of 100", "Each"];

function uuid(seed: string): string {
  // Deterministic pseudo-uuid so ids are stable across reloads.
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hex = h.toString(16).padStart(8, "0");
  return `${hex}-0000-4000-8000-${hex}${hex.slice(0, 4)}`;
}

function daysAgo(days: number, hour = 9, minute = 12): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function seed(): DemoState {
  const now = new Date().toISOString();
  const products: Product[] = [];
  CATS.forEach((c, ci) => {
    c.items.forEach((name, ii) => {
      const i = ci * 6 + ii;
      const stock = [0, 8, 140, 620, 42, 1880, 96, 12][i % 8] + ii * 7;
      products.push({
        id: uuid("p" + i),
        sku: c.code + "-" + String(140 + i * 37).padStart(4, "0"),
        name,
        description: null,
        category: c.name,
        unit_of_measure: UOM[i % UOM.length],
        price: 92 + ((i * 617) % 90) * 31,
        // Cost sits a realistic 22-34% below the selling price, so gross
        // margin is a plausible figure to look at rather than a round one.
        cost_price: Math.round((92 + ((i * 617) % 90) * 31) * (0.66 + (i % 7) * 0.02)),
        image_url: null,
        stock_quantity: stock,
        reorder_point: 40 + (i % 5) * 20,
        is_archived: false,
        created_at: now,
        updated_at: now,
      });
    });
  });
  const bySku = (sku: string) => products.find((p) => p.sku === sku) ?? products[0];

  const customers: UserProfile[] = [
    ["Meezan Hardware Co.", "imran@meezanhw.pk"],
    ["Sindh Industrial Supply", "orders@sindhsupply.pk"],
    ["Falcon Engineering Works", "procure@falconew.com"],
    ["Karachi Fabrication Ltd", "stores@kfab.pk"],
    ["Bahria Trade House", "ali@bahriatrade.pk"],
    ["Indus Motors Depot", "depot@indusmotors.pk"],
    ["Gulberg Builders Mart", "mart@gulbergbm.pk"],
  ].map(([company, email]) => ({ id: uuid(email), email, role: "customer" as const, company_name: company, billing_address: "Warehouse 3, SITE Area, Karachi", ntn: null, strn: null, invite_token: null, invited_at: now, activated_at: now, created_at: now }));

  const staff: UserProfile[] = [
    { id: uuid("admin"), email: "rashid@dynamictraders.pk", role: "admin", company_name: "Rashid Khan", billing_address: null, ntn: null, strn: null, invite_token: null, invited_at: now, activated_at: now, created_at: now },
    { id: uuid("finance"), email: "accounts@dynamictraders.pk", role: "finance", company_name: "Nadia Aslam", billing_address: null, ntn: null, strn: null, invite_token: null, invited_at: now, activated_at: now, created_at: now },
  ];
  const byEmail = (e: string) => customers.find((c) => c.email === e)!;

  // [name, sku, qty, price]
  const mk = (
    n: number, email: string, status: OrderStatus, created: string,
    lines: [string, number, number][],
  ): DemoOrder => ({
    id: uuid("o" + n),
    order_number: "DT-" + n,
    customer_id: byEmail(email).id,
    status,
    delivery_address: "Warehouse 3 — SITE Area, Karachi",
    required_by: new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10),
    note: null,
    created_at: created,
    items: lines.map(([sku, qty, price], i) => ({ id: uuid(`o${n}l${i}`), product_id: bySku(sku).id, quantity: qty, price_at_purchase: price })),
  });

  // The prototype's SKUs don't all exist in the generated catalog; map to real ones.
  const orders: DemoOrder[] = [
    mk(24188, "imran@meezanhw.pk", "pending", daysAgo(0, 9, 12), [["FAS-0140", 2400, 92], ["FAS-0214", 1800, 140], ["PKG-0362", 60, 1450], ["SAF-0584", 40, 2100]]),
    mk(24187, "orders@sindhsupply.pk", "pending", daysAgo(0, 8, 40), [["ELC-0806", 500, 180], ["ELC-0954", 25, 2400]]),
    mk(24186, "procure@falconew.com", "pending", daysAgo(1, 17, 5), [["LUB-1139", 18, 8600], ["ADH-1287", 60, 740]]),
    mk(24181, "stores@kfab.pk", "approved", daysAgo(1, 11, 22), [["FAS-0288", 300, 310], ["SAF-0769", 90, 980]]),
    mk(24179, "ali@bahriatrade.pk", "approved", daysAgo(2, 15, 48), [["PKG-0399", 800, 96]]),
    mk(24170, "depot@indusmotors.pk", "fulfilled", daysAgo(3, 10, 2), [["LUB-1213", 120, 2150], ["LUB-1028", 240, 480]]),
    mk(24166, "mart@gulbergbm.pk", "fulfilled", daysAgo(4, 13, 36), [["ADH-1361", 400, 340]]),
    mk(24151, "imran@meezanhw.pk", "fulfilled", daysAgo(9, 10, 0), [["FAS-0177", 5000, 123], ["PKG-0436", 200, 2015]]),
    mk(24140, "imran@meezanhw.pk", "rejected", daysAgo(16, 14, 0), [["SAF-0621", 30, 2540]]),
  ];

  const announcements: Announcement[] = [
    { id: uuid("a1"), title: "Holiday shipping delays (20–24 Sept)", content: "Orders placed after 20 Sept dispatch from 24 Sept. Cut-off for same-week delivery is 14:00 daily.", type: "announcement", priority: 1, expires_at: new Date(Date.now() + 8 * 86400e3).toISOString(), is_active: true, created_at: now },
    { id: uuid("a2"), title: "New price list effective 1 Oct", content: "Contract customers will receive the updated schedule by email.", type: "announcement", priority: 2, expires_at: null, is_active: true, created_at: now },
    { id: uuid("a3"), title: "Warehouse 2 stocktake notice", content: "Warehouse 2 will be closed for stocktake on 3 Oct.", type: "announcement", priority: 3, expires_at: null, is_active: false, created_at: now },
    { id: uuid("f1"), title: "What is the minimum order value?", content: "PKR 25,000 per order for standard accounts.", type: "faq", priority: 1, expires_at: null, is_active: true, created_at: now },
    { id: uuid("f2"), title: "How long does approval take?", content: "Usually within 2 business hours during 09:00–18:00.", type: "faq", priority: 2, expires_at: null, is_active: true, created_at: now },
    { id: uuid("f3"), title: "Can I lock prices before approval?", content: "Prices lock for 48 hours once an order is submitted.", type: "faq", priority: 3, expires_at: null, is_active: false, created_at: now },
    { id: uuid("f4"), title: "Do you deliver outside Sindh?", content: "Yes, freight is quoted at approval.", type: "faq", priority: 4, expires_at: null, is_active: true, created_at: now },
  ];

  // Seeded orders have to be possible. Stock is relieved at dispatch now,
  // so opening stock must cover everything approved but not yet sent, plus
  // everything already fulfilled. Without this the fixture would contain
  // orders the warehouse could never have met.
  const committed = new Map<string, number>();
  for (const o of orders) {
    if (o.status !== "approved" && o.status !== "fulfilled") continue;
    for (const it of o.items) committed.set(it.product_id, (committed.get(it.product_id) ?? 0) + it.quantity);
  }
  for (const p of products) {
    const need = committed.get(p.id) ?? 0;
    if (need > 0) p.stock_quantity += need;
  }

  // Opening stock has to exist in the ledger as well as on the shelf,
  // otherwise Inventory reads zero on the balance sheet while the
  // warehouse is full. One entry brings the whole catalogue on:
  // Dr Inventory / Cr Opening Balance Equity.
  const acc = seedAccounting(uuid);
  const stock: StockMovement[] = [];
  const openingValue = products.reduce((a, p) => a + p.stock_quantity * p.cost_price, 0);

  if (openingValue > 0) {
    const entryId = uuid("open-entry");
    const inventory = acc.accounts.find((a) => a.system_key === "inventory")!;
    const equity = acc.accounts.find((a) => a.system_key === "opening_balance")!;
    const today = now.slice(0, 10);

    acc.entries.push({
      id: entryId, entry_no: "JV-OPEN-00001", entry_date: today,
      narration: "Opening stock brought forward", source_type: "stock", source_id: null,
      reversal_of: null, posted_by: null, posted_at: now,
    });
    acc.lines.push(
      { id: uuid("open-l1"), entry_id: entryId, account_id: inventory.id, debit: openingValue, credit: 0, party_id: null, memo: "Opening stock", sort_order: 0 },
      { id: uuid("open-l2"), entry_id: entryId, account_id: equity.id, debit: 0, credit: openingValue, party_id: null, memo: "Opening stock", sort_order: 1 },
    );

    products.forEach((p, i) => {
      if (p.stock_quantity <= 0) return;
      stock.push({
        id: uuid("open-m" + i), product_id: p.id, quantity: p.stock_quantity,
        unit_cost: p.cost_price, value: p.stock_quantity * p.cost_price,
        reason: "opening", order_id: null, invoice_id: null, journal_entry_id: entryId,
        note: "Opening stock", moved_on: today, created_by: null, created_at: now,
      });
    });
  }

  // Orders already marked fulfilled must have moved their stock and posted
  // their cost, otherwise the demo shows revenue with no cost against it
  // and a gross margin of 100%.
  for (const o of orders.filter((o) => o.status === "fulfilled")) {
    const priced = o.items
      .map((it) => {
        const p = products.find((x) => x.id === it.product_id);
        return p ? { product: p, quantity: it.quantity, unit_cost: p.cost_price } : null;
      })
      .filter((x): x is { product: Product; quantity: number; unit_cost: number } => x !== null);

    const cost = priced.reduce((a, l) => a + l.quantity * l.unit_cost, 0);
    if (cost <= 0) continue;

    const entryId = uuid("disp-" + o.order_number);
    const cogs = acc.accounts.find((a) => a.system_key === "cogs")!;
    const inventory = acc.accounts.find((a) => a.system_key === "inventory")!;
    const day = o.created_at.slice(0, 10);

    acc.entries.push({
      id: entryId, entry_no: `JV-OPEN-${o.order_number}`, entry_date: day,
      narration: `Cost of goods dispatched on order ${o.order_number}`,
      source_type: "dispatch", source_id: o.id, reversal_of: null, posted_by: null, posted_at: o.created_at,
    });
    acc.lines.push(
      { id: uuid("disp-d-" + o.order_number), entry_id: entryId, account_id: cogs.id, debit: cost, credit: 0, party_id: null, memo: o.order_number, sort_order: 0 },
      { id: uuid("disp-c-" + o.order_number), entry_id: entryId, account_id: inventory.id, debit: 0, credit: cost, party_id: null, memo: o.order_number, sort_order: 1 },
    );

    priced.forEach((l, i) => {
      l.product.stock_quantity = Math.max(0, l.product.stock_quantity - l.quantity);
      stock.push({
        id: uuid("disp-m-" + o.order_number + i), product_id: l.product.id, quantity: -l.quantity,
        unit_cost: l.unit_cost, value: -(l.quantity * l.unit_cost), reason: "dispatch",
        order_id: o.id, invoice_id: null, journal_entry_id: entryId, note: null,
        moved_on: day, created_by: null, created_at: o.created_at,
      });
    });
  }

  return { products, customers, orders, announcements, messages: [], staff, acc, stock, nextOrderNumber: 24189 };
}

// Bump when DemoState changes shape so HMR-preserved state is reseeded.
const DEMO_VERSION = 7; // products gained cost, stock ledger added
const g = globalThis as unknown as { __dtndDemo?: DemoState; __dtndDemoVersion?: number };
if (!g.__dtndDemo || g.__dtndDemoVersion !== DEMO_VERSION) {
  g.__dtndDemo = seed();
  g.__dtndDemoVersion = DEMO_VERSION;
}
export const demo: DemoState = g.__dtndDemo;

/** The customer the portal acts as in demo mode. */
export const DEMO_CUSTOMER_EMAIL = "imran@meezanhw.pk";
export const DEMO_ADMIN = { name: "Rashid Khan", title: "Operations admin", initials: "RK" };
/** Cookie naming which staff persona the demo console acts as. */
export const DEMO_ROLE_COOKIE = "dtnd-demo-role";
/** Stable id for the demo admin, used as message author. */
export const DEMO_ADMIN_ID = uuid("admin");

export function newId(): string {
  return crypto.randomUUID();
}
