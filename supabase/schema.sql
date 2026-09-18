-- =====================================================================
-- B2B Inventory / Ordering / Tracking Portal — Supabase schema (POC)
-- Run this in the Supabase SQL editor (or `supabase db push`).
-- All primary keys are UUIDs. RLS is enabled on every table.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- Enums ----------------------------------------------------
create type public.user_role         as enum ('admin', 'customer');
create type public.order_status      as enum ('pending', 'approved', 'rejected', 'fulfilled');
create type public.announcement_type as enum ('announcement', 'faq');

-- ---------- users ----------------------------------------------------
-- Profile row mirroring auth.users. id == auth.users.id so RLS can use auth.uid().
create table public.users (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null unique,
  role         public.user_role not null default 'customer',
  company_name text,
  created_at   timestamptz not null default now()
);

-- Auto-create a profile whenever an auth user is created.
-- Role/company come from raw_user_meta_data set by the admin onboarding flow
-- (supabase.auth.admin.createUser({ user_metadata: { role, company_name } })).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, role, company_name)
  values (
    new.id,
    new.email,
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'customer'),
    new.raw_user_meta_data ->> 'company_name'
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper used by RLS policies. SECURITY DEFINER avoids recursive RLS on users.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'admin');
$$;

-- ---------- products -------------------------------------------------
create table public.products (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text,
  price          numeric(12,2) not null check (price >= 0),
  image_url      text,
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  is_archived    boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index products_active_idx on public.products (is_archived, created_at desc);

-- ---------- orders ---------------------------------------------------
create table public.orders (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.users (id) on delete restrict,
  status      public.order_status not null default 'pending',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_status_idx   on public.orders (status);

-- ---------- order_items ---------------------------------------------
create table public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete cascade,
  product_id        uuid not null references public.products (id) on delete restrict,
  quantity          integer not null check (quantity > 0),
  price_at_purchase numeric(12,2) not null check (price_at_purchase >= 0)
);
create index order_items_order_idx on public.order_items (order_id);

-- ---------- announcements (CMS) -------------------------------------
create table public.announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  content    text not null,
  type       public.announcement_type not null default 'announcement',
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create index announcements_active_idx on public.announcements (is_active, created_at desc);

-- ---------- updated_at trigger --------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.users         enable row level security;
alter table public.products      enable row level security;
alter table public.orders        enable row level security;
alter table public.order_items   enable row level security;
alter table public.announcements enable row level security;

-- users: read own row; admins read/write all. Inserts come from the trigger.
create policy "users: self read"   on public.users for select using (id = auth.uid() or public.is_admin());
create policy "users: admin write" on public.users for all    using (public.is_admin()) with check (public.is_admin());

-- products: any signed-in user sees non-archived; admins see and manage all.
create policy "products: read active" on public.products for select
  using (auth.uid() is not null and (not is_archived or public.is_admin()));
create policy "products: admin write" on public.products for all
  using (public.is_admin()) with check (public.is_admin());

-- orders: customers create/read their own; admins read/update all.
create policy "orders: own read"     on public.orders for select using (customer_id = auth.uid() or public.is_admin());
create policy "orders: own insert"   on public.orders for insert with check (customer_id = auth.uid());
create policy "orders: admin update" on public.orders for update using (public.is_admin()) with check (public.is_admin());

-- order_items: follow the parent order. Customers may only add items to their own pending orders.
create policy "order_items: read" on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = auth.uid() or public.is_admin())));
create policy "order_items: own insert" on public.order_items for insert
  with check (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid() and o.status = 'pending'));

-- announcements: everyone signed in reads active; admins manage.
create policy "announcements: read active" on public.announcements for select
  using (auth.uid() is not null and (is_active or public.is_admin()));
create policy "announcements: admin write" on public.announcements for all
  using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
-- Realtime (admin dashboard subscribes to INSERT on orders)
-- =====================================================================
alter publication supabase_realtime add table public.orders;

-- =====================================================================
-- Storage: public bucket for product images. Admins write, anyone reads.
-- =====================================================================
insert into storage.buckets (id, name, public) values ('product-images', 'product-images', true)
  on conflict (id) do nothing;

create policy "product-images: public read" on storage.objects for select
  using (bucket_id = 'product-images');
create policy "product-images: admin write" on storage.objects for insert
  with check (bucket_id = 'product-images' and public.is_admin());
create policy "product-images: admin update" on storage.objects for update
  using (bucket_id = 'product-images' and public.is_admin());
create policy "product-images: admin delete" on storage.objects for delete
  using (bucket_id = 'product-images' and public.is_admin());
