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
| `/admin/customers/[id]` | Customer detail: receivables tiles, invoices, orders, the customer ledger with running balance, editable billing and tax identity, and portal access |
| `/admin/customers` | Customer list with invite status and the live invite link (copy / open / resend email / new link), and **Onboard customer** which creates the account, generates the single-use link and emails it |
| `/invite/[token]` | Customer opens the invite link, sets a password, and lands in the catalog |
| `/admin/cms` | Announcements and FAQs with publish toggles |
| `/portal` | Catalog with filter rail, 9-per-page "Load more", add to cart |
| `/portal/checkout` | Review order, delivery details, submit (status `pending`) |
| `/portal/orders` | Active-order timeline, order history, and the conversation: a sent-back order shows the admin's comment and proposed quantities, which the customer can accept and resubmit, reply to, or withdraw |
| `/design-system` | Palette, type, controls and layout rules |
| `/login` | Email + password sign-in |

## Roles

| Role | Can do |
| --- | --- |
| admin | Everything, including finance. A single operator is never locked out. |
| finance | Invoices, payments, ledger and reports. Reads orders, products and customers but cannot approve orders or change the catalog. |
| customer | Portal only. |

Permissions come from one capability map in `src/lib/permissions.ts`. Navigation, route guards and server actions all read from it, so adding an `operations` role later is a one-line change. Guarding happens at three layers: the navigation hides what you cannot use, the route redirects if you type the URL, and the server action refuses regardless. In live mode row level security is the real boundary.

In demo mode a dropdown beside the avatar switches between the admin and finance personas.

## Accounting

Run `supabase/02-accounting.sql` after `schema.sql`. It adds a double-entry general ledger, invoicing and receivables.

The ledger is the foundation: every financial document posts one balanced journal entry, and the trial balance, profit and loss, balance sheet, ledgers and aging are all queries over `journal_lines` rather than separately maintained totals. The database enforces the rules rather than the UI. Debits must equal credits, posted entries are append-only so corrections are reversing entries, issued invoices are immutable, and closing a period blocks posting into it. Invoice numbering uses a locked counter rather than a sequence, because sequences leak numbers on rollback and tax authorities require an unbroken run.

The posting rules are listed on the Chart of accounts screen for your accountant to review. Accounts are found by `system_key`, not by code, so the chart can be renumbered to match an existing one without breaking any posting rule.

Invoice PDFs go to a private bucket, unlike product images. An invoice exposes pricing and tax identity, so downloads are served through a signed URL to the owner or to staff.

## Invoicing

Finance raises invoices from the **Invoice** tab on any approved order, so the order context stays in view. The draft prefills with whatever is still uninvoiced, which means a part shipment can be billed now and the balance later. Issuing does four things in one step: allocates the gapless number, freezes the seller and buyer snapshot, posts the ledger entry, and renders the PDF. Then it emails the customer with the PDF attached.

Posting the ledger happens **before** the invoice is marked issued, so a posting failure leaves an editable draft rather than an unposted document. Issued invoices cannot be edited. A mistake is voided, which posts a reversing entry and never reuses the number.

The PDF is rendered from the frozen snapshot rather than from live order data, so re-downloading an old invoice gives the same document the customer received. Download is served by an authorized route rather than an unguessable URL: staff may fetch any invoice, a customer only their own issued ones.

Dates on financial documents use the business calendar, set to Asia/Karachi. A server running in UTC would otherwise date an invoice raised at 01:00 in Karachi to the previous day, which is not acceptable on a tax document.

## Email

Invite emails are sent through [Resend](https://resend.com) whenever `RESEND_API_KEY` is set, in demo mode too. Set `EMAIL_FROM` to a verified sender (e.g. `Dynamic Traders <orders@yourdomain.com>`) and `NEXT_PUBLIC_APP_URL` to the public site URL so links resolve. Without a key, the admin still gets the link and a preview of the exact message in the portal. The template lives in `src/lib/email.ts` (HTML + plain text).

## UX conventions

- **Feedback for every action.** Mutations confirm with a toast (bottom-right); errors stay inline next to the form.
- **No dead controls.** Every button does something; placeholders were removed rather than left inert.
- **Destructive actions ask why.** Reject requires a reason, which is posted to the order thread. Send back proposes changes instead.
- **Modals** close on Escape and backdrop click, trap focus, lock page scroll, and slide up as sheets on phones.
- **Responsive.** Admin sidebar becomes a drawer below 1024px; the portal filter rail collapses behind a "Filters" button below 768px.
- **Keyboard.** ⌘K / Ctrl+K focuses the admin search (order numbers → orders, anything else → inventory). Visible focus rings everywhere.
- **Triage cues.** Order queue shows relative time, flags orders over the 4h SLA, and dots orders where the customer replied last.
- **Loading states** via `loading.tsx` skeletons so navigation never looks frozen.

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
