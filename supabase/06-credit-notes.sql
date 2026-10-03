-- =====================================================================
-- Credit notes. Run after 05-receivables.sql.
--
-- The invoices table already carried the credit_note type and the
-- credit_note_for link; nothing used them. A credit note is now a real
-- document with its own number series, its own ledger entry and its own
-- application against the invoice it corrects.
--
-- The only schema change needed is to the balances view: a credit note is
-- a correction, never a debt, so it must not appear as a receivable.
-- =====================================================================

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
  left join public.invoice_payments p on p.invoice_id = i.id and p.reversed_at is null
 where i.status = 'issued'
   and i.type not in ('proforma', 'credit_note')
 group by i.id;

-- Credit notes raised against each invoice, for the "already credited"
-- check that stops the same line being credited twice.
create or replace view public.invoice_credits
with (security_invoker = true) as
select n.credit_note_for          as invoice_id,
       n.id                       as credit_note_id,
       n.invoice_number           as credit_note_number,
       n.issue_date,
       n.total,
       ii.order_item_id,
       ii.sku,
       ii.quantity
  from public.invoices n
  join public.invoice_items ii on ii.invoice_id = n.id
 where n.type = 'credit_note' and n.status = 'issued';
