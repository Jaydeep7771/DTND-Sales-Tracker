-- =====================================================================
-- Receivables control: credit limits and aging. Run after 04-inventory.sql.
--
-- A distributor's working capital lives in its debtors. Until now an order
-- could be approved however much the customer already owed and however
-- long it had been outstanding, and there was no aged schedule to look at.
-- =====================================================================

alter table public.users
  -- Zero means no limit set, which is treated as unlimited rather than as
  -- a block, so adding this column cannot stop trade on day one.
  add column if not exists credit_limit numeric(14,2) not null default 0 check (credit_limit >= 0),
  -- An explicit stop, independent of the limit, for a customer in dispute
  -- or in recovery.
  add column if not exists credit_hold boolean not null default false,
  add column if not exists payment_terms_days integer check (payment_terms_days >= 0);

comment on column public.users.credit_limit is
  'Maximum outstanding exposure. 0 means no limit has been set, not a limit of zero.';
comment on column public.users.payment_terms_days is
  'Overrides the company default for this customer. Null uses the company setting.';

-- =====================================================================
-- Aged receivables. Buckets are measured from the due date, not the issue
-- date: "30 days overdue" is what collections act on, and an invoice on
-- Net 60 is not late on day 31.
-- =====================================================================
create or replace view public.receivables_aging
with (security_invoker = true) as
select
  b.customer_id,
  u.company_name,
  u.email,
  u.credit_limit,
  u.credit_hold,
  sum(b.balance)                                                              as outstanding,
  sum(case when b.due_date >= current_date                then b.balance else 0 end) as current_due,
  sum(case when current_date - b.due_date between 1  and 30 then b.balance else 0 end) as days_1_30,
  sum(case when current_date - b.due_date between 31 and 60 then b.balance else 0 end) as days_31_60,
  sum(case when current_date - b.due_date between 61 and 90 then b.balance else 0 end) as days_61_90,
  sum(case when current_date - b.due_date > 90              then b.balance else 0 end) as days_90_plus,
  max(current_date - b.due_date)                                              as worst_days,
  count(*)                                                                    as open_invoices
from public.invoice_balances b
join public.users u on u.id = b.customer_id
where b.balance > 0.005
group by b.customer_id, u.company_name, u.email, u.credit_limit, u.credit_hold;

-- Days Sales Outstanding input: issued value and collected value by month,
-- so the trend in collection speed is visible rather than anecdotal.
create or replace view public.receivables_trend
with (security_invoker = true) as
select date_trunc('month', i.issue_date)::date as month,
       sum(i.total)                            as invoiced,
       coalesce(sum(p.paid), 0)                as collected
  from public.invoices i
  left join (
    select invoice_id, sum(amount) as paid
      from public.invoice_payments where reversed_at is null group by invoice_id
  ) p on p.invoice_id = i.id
 where i.status = 'issued' and i.type <> 'proforma'
 group by 1
 order by 1 desc;
