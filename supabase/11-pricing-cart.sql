-- =====================================================================
-- Customer pricing, stock availability and a server-side cart.
-- Run after 10-hardening.sql.
--
-- Three gaps, and they are related more than they look:
--
--   * One price for everybody. A wholesale distributor does not work
--     that way. A distributor buys at a different price from a retailer,
--     a negotiated contract beats the tier, and a pallet is cheaper per
--     unit than a box. None of that could be expressed.
--   * The cart ignored stock. A customer could order 5,000 of something
--     there are 12 of, and nobody found out until approval.
--   * The cart lived in localStorage. Build it on a phone in the
--     warehouse, open the laptop, it is gone. It was also invisible to
--     us, so an abandoned cart could not be followed up.
-- =====================================================================


-- =====================================================================
-- Price lists.
--
-- A price list is a tier: Standard, Distributor, Key account. Customers
-- sit on one. Exactly one list is the default, which is what a brand new
-- customer gets and what the public catalogue shows.
-- =====================================================================
create table public.price_lists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- At most one default. A partial unique index is the cheapest way to say
-- that in Postgres and it is enforced by the database, not by hope.
create unique index price_lists_one_default on public.price_lists (is_default) where is_default;

alter table public.users
  add column if not exists price_list_id uuid references public.price_lists (id) on delete set null;

comment on column public.users.price_list_id is
  'Tier this customer buys at. Null falls back to the default list, then to products.price.';


-- =====================================================================
-- Price rules.
--
-- One table covers all three of the things that were missing, because
-- they are the same idea at different scopes:
--
--   contract price   = a rule scoped to one customer, min_quantity 1
--   tier price       = a rule scoped to a price list
--   volume discount  = several rules for the same scope at rising
--                      min_quantity
--
-- Resolution is most-specific-wins: a customer rule beats a list rule,
-- a list rule beats products.price. Within a scope the applicable rule
-- is the one with the highest min_quantity the line reaches.
-- =====================================================================
create table public.price_rules (
  id            uuid primary key default gen_random_uuid(),

  -- Exactly one scope. A rule belongs to a list or to a customer, never
  -- both and never neither.
  price_list_id uuid references public.price_lists (id) on delete cascade,
  customer_id   uuid references public.users (id) on delete cascade,

  product_id    uuid not null references public.products (id) on delete cascade,
  min_quantity  integer not null default 1 check (min_quantity >= 1),
  unit_price    numeric(12,2) not null check (unit_price >= 0),

  -- A contract has a term. Null at either end means open-ended.
  valid_from    date,
  valid_to      date,

  note          text,
  created_by    uuid references public.users (id),
  created_at    timestamptz not null default now(),

  constraint price_rules_one_scope check (
    (price_list_id is not null and customer_id is null)
    or (price_list_id is null and customer_id is not null)
  ),
  constraint price_rules_term check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

-- Two rules for the same scope, product and break quantity would make
-- the resolved price depend on row order. Forbid it.
create unique index price_rules_list_break
  on public.price_rules (price_list_id, product_id, min_quantity) where price_list_id is not null;
create unique index price_rules_customer_break
  on public.price_rules (customer_id, product_id, min_quantity) where customer_id is not null;

create index price_rules_product_idx on public.price_rules (product_id);


-- =====================================================================
-- Availability.
--
-- stock_quantity is what is on the shelf. Some of it is already spoken
-- for: an approved order has been promised to somebody but has not
-- shipped yet, so its stock is not relieved and is not free either. A
-- fulfilled order has already been deducted, so it must not be counted
-- twice.
--
-- Pending orders are deliberately NOT committed. They have not been
-- approved and counting them would let an unapproved order block real
-- demand.
-- =====================================================================
-- Deliberately NOT security_invoker. Under the caller's own RLS a
-- customer can only see their own orders, so "committed" would count
-- only their commitments and every product would look more available
-- than it is — which is precisely the bug this view exists to prevent.
-- It runs as owner and is narrowed to the active catalogue instead.
create view public.product_availability as
select
  p.id as product_id,
  p.stock_quantity as on_hand,
  coalesce(c.committed, 0)::integer as committed,
  (p.stock_quantity - coalesce(c.committed, 0))::integer as available
from public.products p
left join (
  select oi.product_id, sum(oi.quantity) as committed
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.status = 'approved'
  group by oi.product_id
) c on c.product_id = p.id
where not p.is_archived;

-- The view is a read of aggregate stock, not of anybody's orders.
revoke all on public.product_availability from public;
grant select on public.product_availability to authenticated;

comment on view public.product_availability is
  'on_hand less stock promised to approved-but-not-yet-dispatched orders. Can go negative if stock was adjusted down after approval; that is real and should be visible.';

-- Backorder is now a deliberate per-product decision rather than
-- something that happened because nothing checked. Default false, so the
-- hole closes; turn it on for the lines you genuinely restock to order.
alter table public.products
  add column if not exists allow_backorder boolean not null default false;

comment on column public.products.allow_backorder is
  'When true a customer may order beyond available stock and the line ships on restock.';


-- =====================================================================
-- Cart.
--
-- Server-side so it follows the buyer between devices, and so an
-- abandoned cart is something we can see. Deliberately stores only
-- product and quantity: the price is resolved fresh on every read, so a
-- cart left for a week cannot check out at last week's price.
-- =====================================================================
create table public.cart_items (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.users (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  quantity    integer not null check (quantity > 0),
  added_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (customer_id, product_id)
);
create index cart_items_customer_idx on public.cart_items (customer_id, added_at);


-- =====================================================================
-- Row level security.
-- =====================================================================
alter table public.price_lists  enable row level security;
alter table public.price_rules  enable row level security;
alter table public.cart_items   enable row level security;

-- Which tier a customer sits on, resolved the same way the application
-- resolves it. Used by the rules policy below.
create or replace function public.my_price_list()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select u.price_list_id from public.users u where u.id = auth.uid()),
    (select l.id from public.price_lists l where l.is_default and l.is_active limit 1)
  );
$$;
-- Postgres grants EXECUTE to PUBLIC on every new function, so take that
-- back first. Supabase's default privileges then re-grant anon and
-- authenticated explicitly, and anon's grant is left in place on
-- purpose: an anonymous select on price_rules still has to evaluate the
-- policy below, and the function tells anon nothing — with no auth.uid()
-- it returns the id of the default tier, which is public information.
revoke execute on function public.my_price_list() from public;
grant execute on function public.my_price_list() to authenticated;

-- Price lists are just names; a customer may see them so the catalogue
-- can label where a price came from.
create policy "price_lists: read"  on public.price_lists for select using (auth.uid() is not null);
create policy "price_lists: admin" on public.price_lists for all
  using (public.is_admin()) with check (public.is_admin());

-- Rules are narrower. A customer sees their own contract and their own
-- tier's rate card, and nothing else: what another account negotiated,
-- or what a better tier pays, is not theirs to read.
create policy "price_rules: read" on public.price_rules for select using (
  public.is_staff()
  or customer_id = auth.uid()
  or (customer_id is null and price_list_id = public.my_price_list())
);
create policy "price_rules: admin" on public.price_rules for all
  using (public.is_admin()) with check (public.is_admin());

-- A cart is private. Staff cannot read it either: there is no reason for
-- an operator to watch a customer shop, and the order is the record.
create policy "cart_items: own" on public.cart_items for all
  using (customer_id = auth.uid()) with check (customer_id = auth.uid());


-- =====================================================================
-- Seed the default tier so pricing resolves on day one.
-- =====================================================================
insert into public.price_lists (name, description, is_default)
values ('Standard', 'List price. Applies to any customer not placed on another tier.', true)
on conflict (name) do nothing;
