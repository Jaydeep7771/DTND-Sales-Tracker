-- =====================================================================
-- Hardening, from the Supabase security linter. Run after 09-access.sql.
--
-- The one that mattered: next_document_number was callable over the REST
-- API by any signed-in user. A customer could have called it repeatedly
-- and burnt invoice numbers, leaving gaps in a run the tax authority
-- expects to be unbroken. The whole invoicing design rests on that run
-- being gapless, so the function now refuses anyone who is not staff,
-- exactly as post_journal_entry already did.
-- =====================================================================

create or replace function public.next_document_number(p_scope text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if not public.is_staff() then
    raise exception 'Not permitted to allocate document numbers';
  end if;
  insert into public.document_counters (scope) values (p_scope) on conflict (scope) do nothing;
  update public.document_counters set last_value = last_value + 1
   where scope = p_scope returning last_value into n;
  return n;
end $$;

-- Postgres grants EXECUTE to PUBLIC on every new function, so revoking
-- from anon and authenticated alone changes nothing: the PUBLIC grant
-- still lets everybody in. Revoke that, then grant back what is needed.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.next_document_number(text) from public, anon;
revoke execute on function public.post_journal_entry(text, date, text, text, uuid, jsonb) from public, anon;
revoke execute on function public.is_staff() from public;
revoke execute on function public.is_admin() from public;

-- The app calls these two over RPC as the signed-in user, and both refuse
-- a caller who is not staff, so authenticated keeps EXECUTE.
grant execute on function public.next_document_number(text) to authenticated;
grant execute on function public.post_journal_entry(text, date, text, text, uuid, jsonb) to authenticated;

-- Row level security policies call these as the requesting role, so both
-- anon and authenticated must keep EXECUTE or every table locks up. They
-- only ever report on the caller's own row, so this discloses nothing.
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- handle_new_user is a trigger function. It runs as the table owner and
-- is never called directly, so nobody else needs EXECUTE on it.

-- =====================================================================
-- Pin search_path on the remaining functions. Without it a caller can
-- point the function at their own schema and have it resolve a different
-- table than the author meant.
-- =====================================================================
alter function public.assert_journal_balanced()      set search_path = public, pg_temp;
alter function public.assert_period_open()           set search_path = public, pg_temp;
alter function public.block_ledger_mutation()        set search_path = public, pg_temp;
alter function public.set_updated_at()               set search_path = public, pg_temp;
alter function public.lock_issued_invoice()          set search_path = public, pg_temp;
alter function public.lock_issued_invoice_items()    set search_path = public, pg_temp;
alter function public.apply_stock_movement()         set search_path = public, pg_temp;
alter function public.lock_posted_bill()             set search_path = public, pg_temp;
alter function public.handle_new_user()              set search_path = public, pg_temp;
