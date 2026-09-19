-- =====================================================================
-- Accounting module: double-entry ledger, invoicing, receivables.
-- Run AFTER schema.sql.
--
-- Design notes for review by an accountant:
--   * Every financial document posts a balanced journal entry. Reports
--     (trial balance, P&L, balance sheet, ledgers, aging) are queries over
--     journal_lines, never separately maintained totals.
--   * Posted journal entries are immutable. Corrections are reversing
--     entries, never edits. The database enforces this, not the UI.
--   * Issued invoices are immutable and numbered gaplessly.
--   * Amounts are numeric(14,2). Never floating point.
-- =====================================================================

-- ---------- Enums ----------------------------------------------------
create type public.account_type   as enum ('asset', 'liability', 'equity', 'income', 'expense');
create type public.invoice_type   as enum ('proforma', 'tax_invoice', 'credit_note');
create type public.invoice_status as enum ('draft', 'issued', 'void');
create type public.payment_method as enum ('bank_transfer', 'cheque', 'cash', 'online', 'adjustment');

-- =====================================================================
-- Company settings (single row) — the seller identity printed on invoices
-- =====================================================================
create table public.company_settings (
  id                 boolean primary key default true check (id),
  legal_name         text not null default 'Dynamic Traders & Distributors',
  address            text not null default '',
  city               text not null default 'Karachi',
  country            text not null default 'Pakistan',
  phone              text,
  email              text,
  ntn                text,                              -- National Tax Number
  strn               text,                              -- Sales Tax Registration Number
  bank_details       text,                              -- printed as payment instructions
  default_tax_rate   numeric(5,4) not null default 0.1800 check (default_tax_rate >= 0),
  default_terms_days integer      not null default 30   check (default_terms_days >= 0),
  invoice_prefix     text not null default 'INV',
  credit_note_prefix text not null default 'CN',
  fiscal_year_start_month integer not null default 7 check (fiscal_year_start_month between 1 and 12),
  updated_at         timestamptz not null default now()
);
insert into public.company_settings (id) values (true) on conflict do nothing;

-- =====================================================================
-- Chart of accounts
-- system_key lets the posting engine find an account without depending on
-- its code, so the numbering can be renamed to match your accountant's
-- existing chart without breaking any posting rule.
-- =====================================================================
create table public.accounts (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  type       public.account_type not null,
  parent_id  uuid references public.accounts (id) on delete restrict,
  system_key text unique,                       -- e.g. 'accounts_receivable'
  is_group   boolean not null default false,    -- group headers hold no postings
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create index accounts_type_idx on public.accounts (type, code);

-- =====================================================================
-- Accounting periods. Closing a period freezes posting into it.
-- =====================================================================
create table public.accounting_periods (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  starts_on  date not null,
  ends_on    date not null check (ends_on >= starts_on),
  closed_at  timestamptz,
  closed_by  uuid references public.users (id),
  created_at timestamptz not null default now()
);
create index periods_range_idx on public.accounting_periods (starts_on, ends_on);

-- =====================================================================
-- General ledger
-- =====================================================================
create table public.journal_entries (
  id          uuid primary key default gen_random_uuid(),
  entry_no    text not null unique,
  entry_date  date not null,
  narration   text not null,
  source_type text,                                      -- invoice | payment | credit_note | bill | manual
  source_id   uuid,
  reversal_of uuid references public.journal_entries (id),
  posted_by   uuid references public.users (id),
  posted_at   timestamptz not null default now()
);
create index journal_entries_date_idx   on public.journal_entries (entry_date desc);
create index journal_entries_source_idx on public.journal_entries (source_type, source_id);

create table public.journal_lines (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references public.journal_entries (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete restrict,
  debit      numeric(14,2) not null default 0 check (debit  >= 0),
  credit     numeric(14,2) not null default 0 check (credit >= 0),
  party_id   uuid references public.users (id),          -- customer/supplier subledger
  memo       text,
  sort_order integer not null default 0,
  -- a line is either a debit or a credit, never both, never neither
  constraint journal_line_one_side check ((debit > 0) <> (credit > 0))
);
create index journal_lines_entry_idx   on public.journal_lines (entry_id);
create index journal_lines_account_idx on public.journal_lines (account_id);
create index journal_lines_party_idx   on public.journal_lines (party_id);

-- Debits must equal credits. Deferred so lines can be inserted after the entry.
create or replace function public.assert_journal_balanced()
returns trigger language plpgsql as $$
declare
  v_entry  uuid := coalesce(new.entry_id, old.entry_id);
  v_debit  numeric(14,2);
  v_credit numeric(14,2);
begin
  if not exists (select 1 from public.journal_lines where entry_id = v_entry) then
    return null;                                          -- whole entry removed
  end if;
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_debit, v_credit
    from public.journal_lines where entry_id = v_entry;
  if v_debit <> v_credit then
    raise exception 'Journal entry % is out of balance: debits %, credits %', v_entry, v_debit, v_credit;
  end if;
  return null;
end $$;

create constraint trigger journal_lines_balanced
  after insert or update or delete on public.journal_lines
  deferrable initially deferred
  for each row execute function public.assert_journal_balanced();

-- Posting into a closed period is refused.
create or replace function public.assert_period_open()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.accounting_periods p
     where new.entry_date between p.starts_on and p.ends_on and p.closed_at is not null
  ) then
    raise exception 'The accounting period containing % is closed', new.entry_date;
  end if;
  return new;
end $$;

create trigger journal_entries_period_open before insert on public.journal_entries
  for each row execute function public.assert_period_open();

-- The ledger is append-only. Corrections are reversing entries.
create or replace function public.block_ledger_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'The ledger is append-only. Post a reversing entry instead of editing.';
end $$;

create trigger journal_entries_immutable before update or delete on public.journal_entries
  for each row execute function public.block_ledger_mutation();
create trigger journal_lines_immutable before update or delete on public.journal_lines
  for each row execute function public.block_ledger_mutation();

-- =====================================================================
-- Gapless document numbering.
-- A sequence is NOT used: sequences leak numbers on rollback, and tax
-- authorities require an unbroken run. The counter row is locked for the
-- life of the transaction, so a failed issue reuses the number.
-- =====================================================================
create table public.document_counters (
  scope      text primary key,                  -- e.g. 'INV-2026-27'
  last_value integer not null default 0
);

create or replace function public.next_document_number(p_scope text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.document_counters (scope) values (p_scope) on conflict (scope) do nothing;
  update public.document_counters set last_value = last_value + 1
   where scope = p_scope returning last_value into n;
  return n;
end $$;

-- Posting an entry and its lines must be one transaction, otherwise a
-- failure between the two leaves an unbalanced orphan in the ledger.
-- The client makes a single RPC call, so the deferred balance check runs
-- at commit with every line present.
create or replace function public.post_journal_entry(
  p_entry_no    text,
  p_entry_date  date,
  p_narration   text,
  p_source_type text,
  p_source_id   uuid,
  p_lines       jsonb          -- [{account_id, debit, credit, party_id, memo}]
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_entry uuid;
  v_line  jsonb;
  v_i     integer := 0;
begin
  if not public.is_staff() then
    raise exception 'Not permitted to post to the ledger';
  end if;

  insert into public.journal_entries (entry_no, entry_date, narration, source_type, source_id, posted_by)
  values (p_entry_no, p_entry_date, p_narration, p_source_type, p_source_id, auth.uid())
  returning id into v_entry;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.journal_lines (entry_id, account_id, debit, credit, party_id, memo, sort_order)
    values (
      v_entry,
      (v_line ->> 'account_id')::uuid,
      coalesce((v_line ->> 'debit')::numeric,  0),
      coalesce((v_line ->> 'credit')::numeric, 0),
      nullif(v_line ->> 'party_id', '')::uuid,
      v_line ->> 'memo',
      v_i
    );
    v_i := v_i + 1;
  end loop;

  if v_i = 0 then
    raise exception 'A journal entry needs at least two lines';
  end if;
  return v_entry;
end $$;

-- =====================================================================
-- Invoices. Seller and buyer are frozen as JSON at issue time so a later
-- change to company settings or a customer address cannot rewrite history.
-- =====================================================================
create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_number text unique,                            -- assigned on issue
  type           public.invoice_type   not null default 'tax_invoice',
  status         public.invoice_status not null default 'draft',
  order_id       uuid references public.orders (id) on delete restrict,
  customer_id    uuid not null references public.users (id) on delete restrict,

  -- frozen snapshot
  seller   jsonb not null default '{}'::jsonb,
  buyer    jsonb not null default '{}'::jsonb,
  currency text  not null default 'PKR',
  tax_rate numeric(5,4) not null,
  subtotal   numeric(14,2) not null default 0,
  discount   numeric(14,2) not null default 0 check (discount >= 0),
  freight    numeric(14,2) not null default 0 check (freight  >= 0),
  tax_amount numeric(14,2) not null default 0,
  total      numeric(14,2) not null default 0,

  issue_date date,
  due_date   date,
  terms_days integer not null default 30,
  notes      text,

  pdf_path   text,                                       -- key in the private bucket
  pdf_sha256 text,                                       -- proves the archive equals what was sent
  journal_entry_id uuid references public.journal_entries (id),
  credit_note_for  uuid references public.invoices (id),

  issued_by  uuid references public.users (id),
  issued_at  timestamptz,
  voided_at  timestamptz,
  void_reason text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoices_customer_idx on public.invoices (customer_id, issue_date desc);
create index invoices_status_idx   on public.invoices (status, due_date);
create index invoices_order_idx    on public.invoices (order_id);

create table public.invoice_items (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.invoices (id) on delete cascade,
  order_item_id uuid references public.order_items (id) on delete set null,
  -- snapshot of the product at issue time, never joined back to products
  sku             text not null,
  name            text not null,
  unit_of_measure text not null default 'Each',
  quantity        integer not null check (quantity > 0),
  unit_price      numeric(12,2) not null check (unit_price >= 0),
  line_total      numeric(14,2) not null check (line_total >= 0),
  sort_order      integer not null default 0
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id);
create index invoice_items_orderitem_idx on public.invoice_items (order_item_id);

create table public.invoice_payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  amount      numeric(14,2) not null check (amount > 0),
  paid_on     date not null default current_date,
  method      public.payment_method not null default 'bank_transfer',
  reference   text,
  note        text,
  journal_entry_id uuid references public.journal_entries (id),
  recorded_by uuid references public.users (id),
  created_at  timestamptz not null default now()
);
create index invoice_payments_invoice_idx on public.invoice_payments (invoice_id);

-- Once issued, only the void fields and the PDF pointer may change.
create or replace function public.lock_issued_invoice()
returns trigger language plpgsql as $$
begin
  if old.status = 'draft' then return new; end if;
  if to_jsonb(new) - 'status' - 'voided_at' - 'void_reason' - 'pdf_path' - 'pdf_sha256' - 'updated_at'
   = to_jsonb(old) - 'status' - 'voided_at' - 'void_reason' - 'pdf_path' - 'pdf_sha256' - 'updated_at'
  then return new; end if;
  raise exception 'Issued invoices are immutable. Void it or raise a credit note.';
end $$;

create trigger invoices_lock before update on public.invoices
  for each row execute function public.lock_issued_invoice();

create or replace function public.lock_issued_invoice_items()
returns trigger language plpgsql as $$
declare v_status public.invoice_status;
begin
  select status into v_status from public.invoices
   where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is distinct from 'draft' then
    raise exception 'Lines of an issued invoice cannot be changed.';
  end if;
  return coalesce(new, old);
end $$;

create trigger invoice_items_lock before insert or update or delete on public.invoice_items
  for each row execute function public.lock_issued_invoice_items();

create trigger invoices_set_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

-- =====================================================================
-- Reporting views. security_invoker so row level security still applies.
-- =====================================================================

-- Trial balance source. Signed so assets/expenses are positive when debit.
create or replace view public.account_balances
with (security_invoker = true) as
select a.id, a.code, a.name, a.type, a.system_key, a.is_group,
       coalesce(sum(jl.debit),  0) as total_debit,
       coalesce(sum(jl.credit), 0) as total_credit,
       case when a.type in ('asset', 'expense')
            then coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0)
            else coalesce(sum(jl.credit), 0) - coalesce(sum(jl.debit), 0)
       end as balance
  from public.accounts a
  left join public.journal_lines jl on jl.account_id = a.id
 group by a.id;

-- Outstanding balance per issued invoice, for aging and statements.
create or replace view public.invoice_balances
with (security_invoker = true) as
select i.id, i.invoice_number, i.customer_id, i.issue_date, i.due_date, i.total,
       coalesce(sum(p.amount), 0)           as paid,
       i.total - coalesce(sum(p.amount), 0) as balance,
       case when i.total - coalesce(sum(p.amount), 0) <= 0 then 'paid'
            when coalesce(sum(p.amount), 0) > 0            then 'part_paid'
            when i.due_date < current_date                 then 'overdue'
            else 'open' end                  as settlement
  from public.invoices i
  left join public.invoice_payments p on p.invoice_id = i.id
 where i.status = 'issued' and i.type <> 'proforma'
 group by i.id;

-- How much of each order line has already been invoiced, for partial dispatch.
create or replace view public.order_item_invoiced
with (security_invoker = true) as
select oi.id as order_item_id, oi.order_id, oi.quantity as ordered,
       coalesce(sum(ii.quantity), 0) as invoiced,
       oi.quantity - coalesce(sum(ii.quantity), 0) as remaining
  from public.order_items oi
  left join public.invoice_items ii on ii.order_item_id = oi.id
  left join public.invoices i on i.id = ii.invoice_id and i.status = 'issued'
 group by oi.id;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.company_settings   enable row level security;
alter table public.accounts           enable row level security;
alter table public.accounting_periods enable row level security;
alter table public.journal_entries    enable row level security;
alter table public.journal_lines      enable row level security;
alter table public.invoices           enable row level security;
alter table public.invoice_items      enable row level security;
alter table public.invoice_payments   enable row level security;
alter table public.document_counters  enable row level security;

-- Settings: staff read, staff write.
create policy "settings: staff read"  on public.company_settings for select using (public.is_staff());
create policy "settings: staff write" on public.company_settings for all    using (public.is_staff()) with check (public.is_staff());

-- Chart of accounts and periods: staff only.
create policy "accounts: staff"  on public.accounts           for all using (public.is_staff()) with check (public.is_staff());
create policy "periods: staff"   on public.accounting_periods for all using (public.is_staff()) with check (public.is_staff());

-- Ledger: staff may read and append. Updates and deletes are blocked by trigger.
create policy "journal: staff read"   on public.journal_entries for select using (public.is_staff());
create policy "journal: staff insert" on public.journal_entries for insert with check (public.is_staff());
create policy "lines: staff read"     on public.journal_lines   for select using (public.is_staff());
create policy "lines: staff insert"   on public.journal_lines   for insert with check (public.is_staff());

-- Invoices: staff see everything. Customers see only their own issued invoices.
create policy "invoices: read" on public.invoices for select
  using (public.is_staff() or (customer_id = auth.uid() and status = 'issued'));
create policy "invoices: staff write" on public.invoices for all
  using (public.is_staff()) with check (public.is_staff());

create policy "invoice_items: read" on public.invoice_items for select
  using (exists (select 1 from public.invoices i where i.id = invoice_id
                  and (public.is_staff() or (i.customer_id = auth.uid() and i.status = 'issued'))));
create policy "invoice_items: staff write" on public.invoice_items for all
  using (public.is_staff()) with check (public.is_staff());

create policy "payments: read" on public.invoice_payments for select
  using (exists (select 1 from public.invoices i where i.id = invoice_id
                  and (public.is_staff() or i.customer_id = auth.uid())));
create policy "payments: staff write" on public.invoice_payments for all
  using (public.is_staff()) with check (public.is_staff());

-- Counters are reached only through the security definer function.
create policy "counters: staff read" on public.document_counters for select using (public.is_staff());

-- =====================================================================
-- Private storage for invoice PDFs.
-- NOT public: an invoice exposes pricing and tax identity. Downloads go
-- through a signed URL issued only to the owner or to staff.
-- =====================================================================
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false)
  on conflict (id) do nothing;

create policy "invoices: staff read files"  on storage.objects for select
  using (bucket_id = 'invoices' and public.is_staff());
create policy "invoices: staff write files" on storage.objects for insert
  with check (bucket_id = 'invoices' and public.is_staff());
create policy "invoices: staff update files" on storage.objects for update
  using (bucket_id = 'invoices' and public.is_staff());

-- =====================================================================
-- Seed chart of accounts for a distributor. Codes follow the common
-- 1000 asset / 2000 liability / 3000 equity / 4000 income / 5000 expense
-- convention. Replace the codes and names with your accountant's chart;
-- the posting engine keys off system_key, not code.
-- =====================================================================
insert into public.accounts (code, name, type, system_key, is_group) values
  ('1000', 'Current Assets',              'asset',     null,                  true),
  ('1010', 'Cash in Hand',                'asset',     'cash',                false),
  ('1020', 'Bank',                        'asset',     'bank',                false),
  ('1100', 'Accounts Receivable',         'asset',     'accounts_receivable', false),
  ('1200', 'Inventory',                   'asset',     'inventory',           false),
  ('1300', 'Input Sales Tax',             'asset',     'input_tax',           false),
  ('1400', 'Advances to Suppliers',       'asset',     'supplier_advances',   false),
  ('1500', 'Fixed Assets',                'asset',     null,                  true),

  ('2000', 'Current Liabilities',         'liability', null,                  true),
  ('2100', 'Accounts Payable',            'liability', 'accounts_payable',    false),
  ('2200', 'Output Sales Tax',            'liability', 'output_tax',          false),
  ('2300', 'Advances from Customers',     'liability', 'customer_advances',   false),
  ('2400', 'Withholding Tax Payable',     'liability', 'withholding_payable', false),

  ('3000', 'Equity',                      'equity',    null,                  true),
  ('3100', 'Owner Capital',               'equity',    'owner_capital',       false),
  ('3200', 'Retained Earnings',           'equity',    'retained_earnings',   false),

  ('4000', 'Income',                      'income',    null,                  true),
  ('4100', 'Sales Revenue',               'income',    'sales_revenue',       false),
  ('4200', 'Sales Returns and Discounts', 'income',    'sales_returns',       false),
  ('4900', 'Other Income',                'income',    'other_income',        false),

  ('5000', 'Expenses',                    'expense',   null,                  true),
  ('5100', 'Cost of Goods Sold',          'expense',   'cogs',                false),
  ('5200', 'Freight and Delivery',        'expense',   'freight_expense',     false),
  ('5300', 'Salaries and Wages',          'expense',   'salaries',            false),
  ('5400', 'Rent',                        'expense',   'rent',                false),
  ('5500', 'Utilities',                   'expense',   'utilities',           false),
  ('5900', 'Other Expenses',              'expense',   'other_expenses',      false)
on conflict (code) do nothing;

-- Parent the detail accounts under their groups.
update public.accounts c set parent_id = p.id from public.accounts p
 where p.is_group and p.code = (substr(c.code, 1, 1) || '000') and c.code <> p.code
   and c.parent_id is null and not c.is_group and left(c.code, 1) <> '1';
update public.accounts c set parent_id = p.id from public.accounts p
 where p.code = '1000' and left(c.code, 2) in ('10','11','12','13','14') and not c.is_group and c.parent_id is null;
update public.accounts c set parent_id = p.id from public.accounts p
 where p.code = '2000' and left(c.code, 2) in ('21','22','23','24') and not c.is_group and c.parent_id is null;
