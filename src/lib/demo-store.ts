// In-memory demo data, seeded from the design prototype. Used whenever
// Supabase keys are not configured so the app is runnable out of the box.
// State lives on globalThis so it survives Next.js dev HMR reloads.
import type { Product, Announcement, UserProfile, OrderStatus } from "@/types/database";

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
  ].map(([company, email]) => ({ id: uuid(email), email, role: "customer" as const, company_name: company, created_at: now }));
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

  return { products, customers, orders, announcements, nextOrderNumber: 24189 };
}

const g = globalThis as unknown as { __dtndDemo?: DemoState };
export const demo: DemoState = g.__dtndDemo ?? (g.__dtndDemo = seed());

/** The customer the portal acts as in demo mode. */
export const DEMO_CUSTOMER_EMAIL = "imran@meezanhw.pk";
export const DEMO_ADMIN = { name: "Rashid Khan", title: "Operations admin", initials: "RK" };

export function newId(): string {
  return crypto.randomUUID();
}
