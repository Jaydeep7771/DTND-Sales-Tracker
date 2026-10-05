-- =====================================================================
-- Invoicing: proformas, consolidated billing, and letting customers see
-- their own documents. Run after 11-pricing-cart.sql.
--
-- Four gaps:
--
--   * A customer could not see an invoice at all. The emailed PDF was
--     the only copy, so "I never got it" had no answer and a lost
--     attachment meant a reissue.
--   * Nobody could list invoices. They were reachable only by walking in
--     from the order or the customer that produced them, which is no way
--     to answer "what did we bill in September".
--   * The proforma enum value existed and nothing used it. A proforma is
--     how you ask a new account to pay before you ship, and without one
--     the only way to quote a firm number was to issue a tax invoice and
--     book revenue that had not happened.
--   * Every invoice billed exactly one order. A customer ordering twice
--     a week got eight invoices a month and eight payments to match off.
-- =====================================================================


-- =====================================================================
-- Proformas.
--
-- A proforma is not a tax invoice and the difference is not cosmetic:
-- it posts nothing to the ledger, creates no receivable, carries no
-- output tax liability and must never touch the tax invoice number
-- series, because that series has to be gapless for the tax authority.
-- It is a firm offer with an expiry date. When the customer accepts, it
-- is converted and a real tax invoice is raised from its lines.
-- =====================================================================
alter table public.invoices
  -- One pointer, not two: the tax invoice records the proforma it came
  -- from. The reverse link is a lookup, so the two can never disagree.
  add column if not exists converted_from uuid references public.invoices (id),
  -- A proforma expires. After this it should be requoted, not honoured.
  add column if not exists valid_until    date,
  -- Set on a consolidated invoice: the period it covers.
  add column if not exists period_start   date,
  add column if not exists period_end     date,
  -- When the document was last emailed, so the portal and the admin list
  -- can both answer "did this actually go out".
  add column if not exists sent_at        timestamptz,
  add column if not exists sent_to        text;

comment on column public.invoices.converted_from is
  'Tax invoice only: the proforma the customer accepted. Unique, so a quote bills once.';
comment on column public.invoices.valid_until is
  'Proforma only. Past this date the quote should be redone rather than honoured.';
comment on column public.invoices.period_start is
  'Consolidated invoice only: the first day of the period billed.';

-- A proforma converts once. Two tax invoices from one quote would bill
-- the same goods twice, and the second would look perfectly legitimate.
create unique index if not exists invoices_converted_from_once
  on public.invoices (converted_from) where converted_from is not null;

-- A consolidated invoice has no single order_id, so order_id must be
-- allowed to be null. It already is; this states the intent.
comment on column public.invoices.order_id is
  'Null on a consolidated invoice, which is linked to its orders through invoice_items.order_item_id instead.';

-- Separate, also-gapless number series for proformas, and the expiry
-- window to apply when one is raised.
alter table public.company_settings
  add column if not exists proforma_prefix     text    not null default 'PI',
  add column if not exists proforma_valid_days integer not null default 14;

-- Consolidated billing is opt-in per customer, because it changes when
-- they are expected to pay. It belongs on the account, not in settings.

alter table public.users
  add column if not exists consolidated_billing boolean not null default false;

comment on column public.users.consolidated_billing is
  'When true this account is billed once per period rather than per order.';


-- =====================================================================
-- Aging and statements must ignore proformas.
--
-- invoice_balances already excluded them. order_item_invoiced did not,
-- and neither did it cope with a consolidated invoice, whose lines point
-- at order items through invoice_items while the invoice itself belongs
-- to no single order. Rebuilt to work off the line linkage, which is the
-- only thing that is true in both cases.
-- =====================================================================
--
-- The exclusions belong in the CASE, not in the join. As join
-- predicates they only drop the invoice side of a LEFT JOIN: the
-- invoice_item row survives with a null invoice, falls through to the
-- ELSE branch and gets counted anyway. That is how a quote ended up
-- making its own goods look billed.
create or replace view public.order_item_invoiced
with (security_invoker = true) as
select oi.id                                     as order_item_id,
       oi.order_id,
       oi.quantity                               as ordered,
       coalesce(sum(billed), 0)                  as invoiced,
       oi.quantity - coalesce(sum(billed), 0)    as remaining
  from public.order_items oi
  left join lateral (
    select case
             -- A proforma is an offer. It reserves nothing and must not
             -- make the goods look billed.
             when i.id is null or i.status = 'void' or i.type = 'proforma' then 0
             when i.type = 'credit_note' then -ii.quantity
             else ii.quantity
           end as billed
      from public.invoice_items ii
      left join public.invoices i on i.id = ii.invoice_id
     where ii.order_item_id = oi.id
  ) b on true
 group by oi.id;


-- =====================================================================
-- Storage: let a customer download their own archived PDF.
--
-- The bucket stays private. Objects are filed under the customer's id,
-- so the first path segment is the authorization check.
-- =====================================================================
create policy "invoices: own read files" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
