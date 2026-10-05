-- =====================================================================
-- Reporting, exports and tax-return data. Run after 12-invoicing.sql.
--
-- Most of this release is code, not schema: statements, cash flow and
-- period comparison are all derivable from the ledger that already
-- exists. Two things are not derivable, because nobody has ever been
-- asked for them, and the sales tax return cannot be filed without
-- either.
-- =====================================================================

-- =====================================================================
-- HS code.
--
-- Annex-C of the sales tax return is a line-by-line listing of supplies
-- by commodity classification. Without an HS code against the stock item
-- there is nothing to put in that column, and the portal rejects the
-- upload. It is nullable because a catalogue of several hundred lines
-- gets coded over weeks, not in one sitting, and the export reports what
-- is still missing rather than refusing to run.
-- =====================================================================
alter table public.products
  add column if not exists hs_code text;

comment on column public.products.hs_code is
  'Pakistan Customs tariff heading, for Annex-C of the sales tax return. Null until coded.';

create index if not exists products_hs_code_idx on public.products (hs_code) where hs_code is not null;


-- =====================================================================
-- Buyer identification.
--
-- The return classifies every buyer. A sales-tax registered business is
-- identified by its STRN, an income-tax registered one by its NTN, and
-- an unregistered buyer by CNIC — which is a specific 13 digit number
-- and the one piece of identification the portal validates hardest.
-- Both existing columns were already here; this adds the third so an
-- unregistered trade account can be filed correctly rather than left
-- blank.
-- =====================================================================
alter table public.users
  add column if not exists cnic text;

comment on column public.users.cnic is
  'Buyer CNIC, for Annex-C where the customer has no STRN or NTN. 13 digits.';


-- =====================================================================
-- Statement delivery.
--
-- A statement is a document we send, so when it last went out is worth
-- recording for the same reason it is on an invoice: so "I never got it"
-- has an answer.
-- =====================================================================
alter table public.users
  add column if not exists statement_sent_at timestamptz,
  add column if not exists statement_sent_to text;


-- =====================================================================
-- Further tax.
--
-- Charged on taxable supplies to a person who is not sales-tax
-- registered. Whether it applies to a given business is its tax
-- adviser's call, so this is a switch that controls whether the return
-- data reports the exposure, not something the invoice silently charges.
-- =====================================================================
alter table public.company_settings
  add column if not exists further_tax_enabled boolean not null default false,
  add column if not exists further_tax_rate    numeric(5,4) not null default 0.03,
  -- Printed on the statement and the return header.
  add column if not exists statement_note      text;

comment on column public.company_settings.further_tax_enabled is
  'Reports further-tax exposure on supplies to unregistered buyers in the return data. Does not change what invoices charge.';
