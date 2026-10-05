-- =====================================================================
-- Access control: invite expiry, account suspension, staff, and the
-- public business registration form. Run after 08-withholding-advances.sql.
--
-- Four holes and one new front door:
--
--   * Invite links never expired. invited_at was stored and never read,
--     so a link mailed a year ago still created an account today.
--   * There was no password reset. A customer who forgot theirs had no
--     way back in short of an admin re-issuing an invite.
--   * There was no way to stop a login. Credit hold blocks orders; it
--     does not stop someone browsing your wholesale prices after you have
--     parted company with them.
--   * There was no staff management at all. The staff:invite capability
--     existed and nothing used it, so a finance user could only be made
--     by hand in the database.
-- =====================================================================

alter table public.users
  -- Suspension is separate from credit hold on purpose. Hold is a
  -- commercial decision that stops orders; this stops the login.
  add column if not exists is_active boolean not null default true,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_by uuid references public.users (id),
  add column if not exists suspend_reason text,
  -- An invite that cannot go stale is a standing key to the building.
  add column if not exists invite_expires_at timestamptz,
  add column if not exists invited_by uuid references public.users (id);

comment on column public.users.is_active is
  'False blocks sign-in entirely. Distinct from credit_hold, which only blocks ordering.';
comment on column public.users.invite_expires_at is
  'Invite links stop working after this. Re-issue rather than extend.';

create index users_active_idx on public.users (role) where is_active;

-- =====================================================================
-- Business registration.
--
-- A wholesale account is not self-serve: it carries trade credit and
-- shows wholesale pricing, so an application is reviewed before it
-- becomes an account. The form collects what is needed to make that
-- decision and to invoice correctly afterwards.
-- =====================================================================
create type public.application_status as enum ('pending', 'approved', 'rejected');

create table public.customer_applications (
  id            uuid primary key default gen_random_uuid(),
  status        public.application_status not null default 'pending',

  company_name  text not null,
  contact_name  text not null,
  email         text not null,
  phone         text not null,
  address       text not null,
  city          text not null default 'Karachi',

  ntn           text,
  strn          text,
  business_type text,
  years_trading integer check (years_trading >= 0),
  note          text,

  -- Set when approved, so the application links to the account it became.
  customer_id   uuid references public.users (id) on delete set null,
  reviewed_by   uuid references public.users (id),
  reviewed_at   timestamptz,
  review_note   text,

  created_at    timestamptz not null default now()
);
create index applications_status_idx on public.customer_applications (status, created_at desc);
create unique index applications_pending_email_idx
  on public.customer_applications (lower(email)) where status = 'pending';

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.customer_applications enable row level security;

-- Anyone may apply: this is the public sign-up form. Nobody but staff may
-- read them back, because an application holds a competitor's trading
-- details and tax identity.
create policy "applications: public insert" on public.customer_applications
  for insert to anon, authenticated with check (status = 'pending');

create policy "applications: staff read" on public.customer_applications
  for select using (public.is_staff());
create policy "applications: staff write" on public.customer_applications
  for update using (public.is_staff()) with check (public.is_staff());

-- =====================================================================
-- A suspended account must not be able to read anything, so the helper
-- used by every policy checks it too.
-- =====================================================================
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users
     where id = auth.uid() and role in ('admin', 'finance') and is_active
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users
     where id = auth.uid() and role = 'admin' and is_active
  );
$$;
