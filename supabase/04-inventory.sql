-- =====================================================================
-- Inventory valuation and cost of goods sold. Run after 03-settings.sql.
--
-- Until now stock was a number on the product row that only the demo path
-- ever changed, and nothing posted the cost side of a sale. Gross profit
-- was therefore unmeasurable and inventory sat on the balance sheet at
-- whatever opening figure was typed in.
--
-- Two things change:
--   1. Every movement of stock is a row, never a silent edit to a count.
--      The count becomes a derived figure that a movement explains.
--   2. Dispatching goods posts Dr Cost of Goods Sold / Cr Inventory at the
--      moving average cost, so the P&L carries the cost of what was sold.
--
-- Stock is relieved at DISPATCH, not at approval. Approving an order is a
-- commercial promise; the goods have not left the warehouse and still
-- belong to the business.
-- =====================================================================

-- Moving average cost. Updated when a purchase bill is received; used to
-- value every issue out of stock.
alter table public.products
  add column if not exists cost_price numeric(12,2) not null default 0 check (cost_price >= 0);

comment on column public.products.cost_price is
  'Moving average unit cost. Valuation basis for COGS; never the selling price.';

create type public.stock_reason as enum (
  'opening',      -- stock on hand when the product was created
  'purchase',     -- goods received against a supplier bill
  'dispatch',     -- goods sent to a customer
  'return_in',    -- customer sent goods back
  'adjustment'    -- stocktake correction, damage, shrinkage
);

-- =====================================================================
-- The stock ledger. Append-only, like the general ledger, because a
-- stocktake difference is evidence and must not be editable away.
-- =====================================================================
create table public.stock_movements (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete restrict,
  -- Signed: positive brings stock in, negative sends it out. One column
  -- rather than a quantity plus a direction flag, because two columns can
  -- disagree and this one cannot.
  quantity    integer not null check (quantity <> 0),
  unit_cost   numeric(12,2) not null default 0 check (unit_cost >= 0),
  value       numeric(14,2) not null,            -- quantity * unit_cost, signed
  reason      public.stock_reason not null,
  order_id    uuid references public.orders (id) on delete restrict,
  invoice_id  uuid references public.invoices (id) on delete restrict,
  journal_entry_id uuid references public.journal_entries (id),
  note        text,
  moved_on    date not null default current_date,
  created_by  uuid references public.users (id),
  created_at  timestamptz not null default now()
);
create index stock_movements_product_idx on public.stock_movements (product_id, moved_on);
create index stock_movements_order_idx   on public.stock_movements (order_id);
create index stock_movements_reason_idx  on public.stock_movements (reason, moved_on);

-- The stock ledger is evidence. Corrections are further movements.
create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function public.block_ledger_mutation();

-- Keep the cached count on the product in step with the ledger, so the
-- catalogue stays a single fast read. The movements remain the truth.
create or replace function public.apply_stock_movement()
returns trigger language plpgsql as $$
begin
  update public.products
     set stock_quantity = stock_quantity + new.quantity,
         updated_at = now()
   where id = new.product_id;
  return new;
end $$;

create trigger stock_movements_apply after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

-- =====================================================================
-- Valuation view. What the Inventory account on the balance sheet should
-- say, product by product, so a difference can be found rather than
-- guessed at.
-- =====================================================================
create or replace view public.inventory_valuation
with (security_invoker = true) as
select p.id, p.sku, p.name, p.category, p.unit_of_measure,
       p.stock_quantity, p.cost_price, p.price,
       round(p.stock_quantity * p.cost_price, 2) as stock_value,
       coalesce((select sum(m.value) from public.stock_movements m where m.product_id = p.id), 0) as ledger_value
  from public.products p
 where not p.is_archived;

-- Gross margin per product over dispatched goods. The number a distributor
-- actually runs on, and impossible to produce before cost existed.
create or replace view public.product_margins
with (security_invoker = true) as
select p.id, p.sku, p.name, p.category,
       coalesce(sum(ii.quantity), 0)                     as units_sold,
       coalesce(sum(ii.line_total), 0)                   as revenue,
       coalesce(sum(ii.quantity * p.cost_price), 0)      as cost,
       coalesce(sum(ii.line_total), 0) - coalesce(sum(ii.quantity * p.cost_price), 0) as gross_profit
  from public.products p
  left join public.invoice_items ii on ii.sku = p.sku
  left join public.invoices i on i.id = ii.invoice_id and i.status = 'issued'
 group by p.id;

-- =====================================================================
-- Stock adjustment account, so a stocktake difference has somewhere to go
-- that is not buried in other expenses.
-- =====================================================================
insert into public.accounts (code, name, type, system_key, is_group) values
  ('5600', 'Stock Adjustments', 'expense', 'stock_adjustment', false),
  ('3300', 'Opening Balance Equity', 'equity', 'opening_balance', false)
on conflict (code) do nothing;

update public.accounts c set parent_id = p.id from public.accounts p
 where p.code = '5000' and c.code = '5600' and c.parent_id is null;
update public.accounts c set parent_id = p.id from public.accounts p
 where p.code = '3000' and c.code = '3300' and c.parent_id is null;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.stock_movements enable row level security;

create policy "stock: staff read"   on public.stock_movements for select using (public.is_staff());
create policy "stock: staff insert" on public.stock_movements for insert with check (public.is_staff());
