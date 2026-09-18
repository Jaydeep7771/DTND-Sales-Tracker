# B2B Inventory, Ordering & Tracking Portal (POC)

Next.js App Router + Supabase + Vercel. Zero hosting cost on free tiers.

## 1. Project initialization

Run from the parent folder (this directory is `dtnd`). `create-next-app` refuses a non-empty
directory, so scaffold into a temp name and merge, or run it first on a fresh clone.

```bash
npx create-next-app@latest dtnd --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
```

```bash
npm install @supabase/supabase-js @supabase/ssr browser-image-compression resend server-only
```

```bash
npm install -D supabase
```

```bash
cp .env.example .env.local
```

## 2. Database

Paste `supabase/schema.sql` into the Supabase SQL editor and run it. It creates the five tables
(all UUID PKs), enums, RLS policies, the `product-images` storage bucket + policies, and adds
`orders` to the realtime publication.

Create the first admin in Supabase Auth (Dashboard → Authentication → Add user) with
user metadata `{"role": "admin", "company_name": "Your Co"}`. The `on_auth_user_created`
trigger copies that into `public.users`.

## 3. Folder structure

```
src/
├── app/
│   ├── layout.tsx                  # Root layout (fonts, Tailwind)
│   ├── page.tsx                    # Redirects to /login or role home
│   ├── (auth)/
│   │   └── login/page.tsx          # Email + password sign-in
│   ├── (admin)/                    # Route group: layout guards role === 'admin'
│   │   ├── layout.tsx              # Sidebar + realtime new-order toast
│   │   └── admin/
│   │       ├── page.tsx            # Dashboard (pending orders, low stock)
│   │       ├── products/
│   │       │   ├── page.tsx        # Product table
│   │       │   ├── new/page.tsx    # <AddProductForm />
│   │       │   └── [id]/page.tsx   # Edit / archive
│   │       ├── orders/
│   │       │   ├── page.tsx        # All orders, filter by status
│   │       │   └── [id]/page.tsx   # Approve / reject
│   │       ├── customers/
│   │       │   ├── page.tsx        # Customer list
│   │       │   └── new/page.tsx    # Onboard → server action → welcome email
│   │       └── cms/page.tsx        # Announcements / FAQs CRUD
│   ├── (customer)/                 # Route group: layout guards role === 'customer'
│   │   ├── layout.tsx              # Top nav + cart badge
│   │   └── portal/
│   │       ├── page.tsx            # Catalog (paginated, lazy images)
│   │       ├── cart/page.tsx       # Cart → submit order (status 'pending')
│   │       ├── orders/
│   │       │   ├── page.tsx        # Order history
│   │       │   └── [id]/page.tsx   # Order detail + status
│   │       └── announcements/page.tsx
│   └── api/
│       └── customers/route.ts      # (optional) if you prefer Route Handlers over Server Actions
├── components/
│   ├── admin/AddProductForm.tsx    # ✅ written
│   ├── admin/OrderNotifications.tsx# Supabase realtime subscription on orders INSERT
│   ├── customer/ProductGrid.tsx
│   ├── customer/CartProvider.tsx
│   └── ui/                         # Buttons, inputs, badges
├── lib/
│   ├── supabase/client.ts          # ✅ browser client
│   ├── supabase/server.ts          # ✅ server client (cookies)
│   ├── supabase/admin.ts           # ✅ service-role client (server only)
│   ├── image.ts                    # ✅ client-side compression
│   ├── email.ts                    # Resend welcome email
│   └── auth.ts                     # getSessionUser(), requireRole()
├── types/database.ts               # ✅ hand-written; regenerate with supabase gen types
└── middleware.ts                    # Refresh session cookie, redirect unauthenticated
supabase/
└── schema.sql                      # ✅
```

## 4. First component

`src/components/admin/AddProductForm.tsx` — compresses the chosen image in a Web Worker
(WebP, ≤200 KB, ≤1200 px), uploads it to the `product-images` bucket, then inserts the
product row. If the insert fails the upload is removed so no orphan files remain.

Drop it into `src/app/(admin)/admin/products/new/page.tsx`:

```tsx
import AddProductForm from "@/components/admin/AddProductForm";
export default function NewProductPage() {
  return <AddProductForm />;
}
```
# DTND-Sales-Tracker
