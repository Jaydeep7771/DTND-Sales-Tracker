-- =====================================================================
-- Suppliers, purchase bills and input tax. Run after 06-credit-notes.sql.
--
-- Without this the ledger only ever saw the sales side. Output tax was
-- recorded with no input tax to set against it, which overstates a sales
-- tax return, and payables were invisible, so the business could not see
-- what it owed.
--
-- Receiving goods against a bill is also what makes the moving average
-- cost real: until now cost_price could only be typed in by hand.
-- =====================================================================

create type public.bill_status as enum ('draft', 'posted', 'void');

-- Suppliers are a separate table rather than users with a role, because
-- they never sign in. Giving them an auth row would mean creating
-- credentials nobody uses, which is a security liability, not a feature.
create table public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  contact_name  text,
  email         text,
  phone         text,
  address       text,
  ntn           text,
  strn          text,
  payment_terms_days integer not null default 30 check (payment_terms_days >= 0),
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index suppliers_name_idx on public.suppliers (name) where is_active;

create table public.bills (
  id          uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  -- The supplier's own invoice number. Not generated here: it is their
  -- document, and the tax authority matches on their number, not ours.
  supplier_ref text not null,
  -- Our internal reference, gapless, for the purchase day book.
  bill_number text unique,
  status      public.bill_status not null default 'draft',

  bill_date   date not null,
  due_date    date,
  terms_days  integer not null default 30,

  tax_rate    numeric(5,4) not null default 0,
  subtotal    numeric(14,2) not null default 0,
  freight     numeric(14,2) not null default 0 check (freight >= 0),
  tax_amount  numeric(14,2) not null default 0,
  total       numeric(14,2) not null default 0,

  notes       text,
  journal_entry_id uuid references public.journal_entries (id),
  posted_by   uuid references public.users (id),
  posted_at   timestamptz,
  voided_at   timestamptz,
  void_reason text,
  created_by  uuid references public.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- The same supplier invoice must not be entered twice. This is the
  -- single most common error in purchase entry and the easiest to prevent.
  unique (supplier_id, supplier_ref)
);
create index bills_supplier_idx on public.bills (supplier_id, bill_date desc);
create index bills_status_idx   on public.bills (status, due_date);

create table public.bill_items (
  id         uuid primary key default gen_random_uuid(),
  bill_id    uuid not null references public.bills (id) on delete cascade,
  product_id uuid references public.products (id) on delete restrict,
  -- Snapshot, so renaming a product later does not rewrite the bill.
  description text not null,
  quantity   integer not null check (quantity > 0),
  unit_cost  numeric(12,2) not null check (unit_cost >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  sort_order integer not null default 0
);
create index bill_items_bill_idx on public.bill_items (bill_id);

create table public.bill_payments (
  id        uuid primary key default gen_random_uuid(),
  bill_id   uuid not null references public.bills (id) on delete cascade,
  amount    numeric(14,2) not null check (amount > 0),
  paid_on   date not null default current_date,
  method    public.payment_method not null default 'bank_transfer',
  reference text,
  note      text,
  journal_entry_id uuid references public.journal_entries (id),
  recorded_by uuid references public.users (id),
  reversed_at     timestamptz,
  reversal_reason text,
  reversed_by     uuid references public.users (id),
  created_at timestamptz not null default now()
);
create index bill_payments_bill_idx  on public.bill_payments (bill_id);
create index bill_payments_entry_idx on public.bill_payments (journal_entry_id);

-- A posted bill is a tax document and cannot be edited, same rule as an
-- issued invoice. Mistakes are voided and re-entered.
create or replace function public.lock_posted_bill()
returns trigger language plpgsql as $$
begin
  if old.status = 'draft' then return new; end if;
  if to_jsonb(new) - 'status' - 'voided_at' - 'void_reason' - 'updated_at'
   = to_jsonb(old) - 'status' - 'voided_at' - 'void_reason' - 'updated_at'
  then return new; end if;
  raise exception 'Posted bills are immutable. Void it and enter a corrected bill.';
end $$;

create trigger bills_lock before update on public.bills
  for each row execute function public.lock_posted_bill();

create trigger bills_set_updated_at before update on public.bills
  for each row execute function public.set_updated_at();
create trigger suppliers_set_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();

-- =====================================================================
-- Reporting views
-- =====================================================================

-- What is owed on each posted bill.
create or replace view public.bill_balances
with (security_invoker = true) as
select b.id, b.bill_number, b.supplier_ref, b.supplier_id, b.bill_date, b.due_date, b.total,
       coalesce(sum(p.amount), 0)           as paid,
       b.total - coalesce(sum(p.amount), 0) as balance,
       case when b.total - coalesce(sum(p.amount), 0) <= 0 then 'paid'
            when coalesce(sum(p.amount), 0) > 0            then 'part_paid'
            when b.due_date < current_date                 then 'overdue'
            else 'open' end                  as settlement
  from public.bills b
  left join public.bill_payments p on p.bill_id = b.id and p.reversed_at is null
 where b.status = 'posted'
 group by b.id;

-- Aged creditors, the mirror of receivables_aging.
create or replace view public.payables_aging
with (security_invoker = true) as
select b.supplier_id, s.name as supplier_name,
       sum(b.balance) as outstanding,
       sum(case when b.due_date >= current_date                 then b.balance else 0 end) as current_due,
       sum(case when current_date - b.due_date between 1  and 30 then b.balance else 0 end) as days_1_30,
       sum(case when current_date - b.due_date between 31 and 60 then b.balance else 0 end) as days_31_60,
       sum(case when current_date - b.due_date between 61 and 90 then b.balance else 0 end) as days_61_90,
       sum(case when current_date - b.due_date > 90              then b.balance else 0 end) as days_90_plus,
       max(current_date - b.due_date) as worst_days,
       count(*) as open_bills
  from public.bill_balances b
  join public.suppliers s on s.id = b.supplier_id
 where b.balance > 0.005
 group by b.supplier_id, s.name;

-- =====================================================================
-- Sales tax return working. Output tax from invoices less input tax from
-- bills, for the period, which is the figure that gets filed.
-- =====================================================================
create or replace view public.sales_tax_summary
with (security_invoker = true) as
select date_trunc('month', d.doc_date)::date as month,
       sum(d.output_tax) as output_tax,
       sum(d.input_tax)  as input_tax,
       sum(d.output_tax) - sum(d.input_tax) as net_payable
from (
  select i.issue_date as doc_date,
         case when i.type = 'credit_note' then -i.tax_amount else i.tax_amount end as output_tax,
         0::numeric as input_tax
    from public.invoices i
   where i.status = 'issued' and i.type <> 'proforma'
  union all
  select b.bill_date, 0::numeric, b.tax_amount
    from public.bills b
   where b.status = 'posted'
) d
group by 1
order by 1 desc;

-- =====================================================================
-- Row Level Security. Suppliers and purchases are staff-only; a customer
-- must never see what the business pays for its goods.
-- =====================================================================
alter table public.suppliers     enable row level security;
alter table public.bills         enable row level security;
alter table public.bill_items    enable row level security;
alter table public.bill_payments enable row level security;

create policy "suppliers: staff" on public.suppliers     for all using (public.is_staff()) with check (public.is_staff());
create policy "bills: staff"     on public.bills         for all using (public.is_staff()) with check (public.is_staff());
create policy "bill_items: staff" on public.bill_items   for all using (public.is_staff()) with check (public.is_staff());
create policy "bill_pay: staff"  on public.bill_payments for all using (public.is_staff()) with check (public.is_staff());
