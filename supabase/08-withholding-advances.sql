-- =====================================================================
-- Withholding tax and customer advances. Run after 07-purchases.sql.
--
-- Two things that break on a real payment:
--
-- 1. A large customer deducts income tax at source and pays less than the
--    invoice. Without somewhere to put the deduction the receipt is short
--    and cannot be allocated, so the invoice never clears.
--
-- 2. A customer pays more than is due, or pays on account before an
--    invoice exists. Previously this was refused outright.
--
-- Neither needs a new table. Both are ledger positions per customer,
-- derived from journal lines carrying that customer as the party, which
-- means they cannot drift away from the accounts.
-- =====================================================================

-- Tax deducted by a customer is money the business has already paid to
-- the government: an asset, recoverable against its own tax liability.
-- The existing withholding_payable account is the opposite case, where
-- this business withholds from a supplier.
insert into public.accounts (code, name, type, system_key, is_group) values
  ('1350', 'Withholding Tax Receivable', 'asset', 'withholding_receivable', false)
on conflict (code) do nothing;

update public.accounts c set parent_id = p.id from public.accounts p
 where p.code = '1000' and c.code = '1350' and c.parent_id is null;

comment on column public.accounts.system_key is
  'Stable key the posting engine resolves against, so the chart can be renumbered freely.';

-- =====================================================================
-- Per-customer positions, straight from the ledger.
-- =====================================================================

-- Money held on account for a customer. Credit balance = we owe them
-- goods or a refund.
create or replace view public.customer_advances
with (security_invoker = true) as
select jl.party_id as customer_id,
       u.company_name,
       sum(jl.credit) - sum(jl.debit) as balance
  from public.journal_lines jl
  join public.accounts a on a.id = jl.account_id and a.system_key = 'customer_advances'
  join public.users u on u.id = jl.party_id
 where jl.party_id is not null
 group by jl.party_id, u.company_name
having sum(jl.credit) - sum(jl.debit) <> 0;

-- Tax withheld by customers, by customer, for reclaiming at year end.
create or replace view public.withholding_by_customer
with (security_invoker = true) as
select jl.party_id as customer_id,
       u.company_name,
       sum(jl.debit) - sum(jl.credit) as withheld
  from public.journal_lines jl
  join public.accounts a on a.id = jl.account_id and a.system_key = 'withholding_receivable'
  join public.users u on u.id = jl.party_id
 where jl.party_id is not null
 group by jl.party_id, u.company_name
having sum(jl.debit) - sum(jl.credit) <> 0;
