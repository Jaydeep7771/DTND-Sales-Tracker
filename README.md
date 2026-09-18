# DTND-Sales-Tracker

B2B inventory, ordering and tracking portal for Dynamic Traders & Distributors.
Next.js 16 (App Router) + Tailwind v4 + Supabase, deployable to Vercel for free.

The UI follows the design prototype in `Dynamic Traders Portal (standalone).html`:
navy-and-slate admin console, wholesale customer portal, IBM Plex Sans/Mono, PKR pricing.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. **With no Supabase keys the app runs in demo mode** on
in-memory sample data (the prototype's catalog, orders and announcements), with a
"Screens" bar at the top to hop between admin and portal. Mutations work but reset
when the dev server restarts.

## Go live with Supabase

1. Create a Supabase project and run `supabase/schema.sql` in the SQL editor. It creates
   the tables (UUID keys), enums, RLS policies, the `product-images` bucket + policies,
   the `DT-xxxxx` order-number sequence, and adds `orders` to Realtime.
2. Copy `.env.example` to `.env.local` and fill in the URL, anon key and service-role key.
   Add a Resend key if you want welcome emails on customer onboarding.
3. In Supabase Auth, add your first admin user with user metadata
   `{"role": "admin", "company_name": "Dynamic Traders"}`. The trigger copies it into `public.users`.
4. Restart `npm run dev`. Demo mode switches off automatically, `/login` guards both areas,
   and the admin dashboard receives Realtime toasts when a customer submits an order.

## Screens

| Route | Screen |
| --- | --- |
| `/admin` | Operations overview: metrics, approval queue, low-stock alerts |
| `/admin/inventory` | SKU table with search, category chips, pagination, **Add product** modal (client-side WebP compression → Storage) |
| `/admin/orders` | Order queue in split or kanban view; approve / **send back with comments and adjusted quantities** / reject / mark fulfilled, plus a per-order conversation thread |
| `/admin/customers` | Customer list with invite status, and **Onboard customer** which creates the account and a single-use invite link (emailed when Resend is configured) |
| `/invite/[token]` | Customer opens the invite link, sets a password, and lands in the catalog |
| `/admin/cms` | Announcements and FAQs with publish toggles |
| `/portal` | Catalog with filter rail, 9-per-page "Load more", add to cart |
| `/portal/checkout` | Review order, delivery details, submit (status `pending`) |
| `/portal/orders` | Active-order timeline, order history, and the conversation: a sent-back order shows the admin's comment and proposed quantities, which the customer can accept and resubmit, reply to, or withdraw |
| `/design-system` | Palette, type, controls and layout rules |
| `/login` | Email + password sign-in |

## Structure

```
src/
├── app/
│   ├── admin/            layout (role guard + shell), page, inventory/, orders/, customers/, cms/
│   ├── portal/           layout (cart provider + header + banner), page, checkout/, orders/
│   ├── login/  design-system/  page.tsx (role redirect)
│   ├── globals.css       design tokens as Tailwind @theme variables
│   └── layout.tsx        IBM Plex fonts
├── components/
│   ├── ui/               Button, Badge, Card, Input, Select, Toggle, Modal, PageHeading
│   ├── admin/            AdminShell, AddProductModal, InventoryToolbar, OrdersView, CmsManager, OnboardCustomer, OrderNotifications
│   └── portal/           CartProvider, PortalHeader (+ cart drawer), Catalog, Checkout
├── lib/
│   ├── data.ts           server reads (Supabase or demo store)
│   ├── actions.ts        server actions: createProduct, setOrderStatus, submitOrder, CMS, onboarding, auth
│   ├── demo-store.ts     in-memory sample data used when Supabase isn't configured
│   ├── image.ts          browser-image-compression wrapper
│   ├── format.ts         money / date / stock-state helpers
│   └── supabase/         client.ts, server.ts, admin.ts (service role)
├── proxy.ts              refreshes the Supabase session cookie (live mode)
└── types/database.ts     table types (regenerate with `supabase gen types`)
supabase/schema.sql
```
