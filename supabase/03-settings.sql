-- =====================================================================
-- Settings: currency, number formatting, tax wording and invoice
-- presentation. Run after 02-accounting.sql.
--
-- Everything here lives on the single company_settings row. The row is
-- the single source of truth: the portal, the admin console and the PDF
-- all read it, which is what stops the same order showing two different
-- tax figures on two different screens.
--
-- Presentation settings are copied into the invoice snapshot at issue
-- time, so changing the template or the accent colour never changes the
-- look of a document a customer already received.
-- =====================================================================

alter table public.company_settings
  -- identity
  add column if not exists tagline        text not null default 'Wholesale distribution',
  add column if not exists logo_initials  text not null default 'DT',

  -- currency. code is what the ledger stores, symbol is what prints.
  add column if not exists currency_code    text not null default 'PKR',
  add column if not exists currency_symbol  text not null default 'PKR',
  add column if not exists currency_display text not null default 'code'
    check (currency_display in ('code', 'symbol')),
  add column if not exists decimal_places integer not null default 0
    check (decimal_places between 0 and 3),
  -- en-US groups as 1,234,567. en-IN groups as 12,34,567, which is how
  -- lakh and crore are read in Pakistan and India.
  add column if not exists number_locale text not null default 'en-US'
    check (number_locale in ('en-US', 'en-IN')),

  -- tax wording follows the jurisdiction: Sales Tax, GST, VAT.
  add column if not exists tax_label text not null default 'Sales Tax',

  -- invoice presentation
  add column if not exists invoice_template text not null default 'classic'
    check (invoice_template in ('classic', 'modern', 'compact')),
  add column if not exists accent_color text not null default '#123A5E'
    check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists invoice_footer_note    text,
  add column if not exists invoice_default_notes  text,
  add column if not exists invoice_show_bank      boolean not null default true,
  add column if not exists invoice_show_signature boolean not null default false,
  add column if not exists invoice_show_tax_ids   boolean not null default true;

comment on column public.company_settings.default_tax_rate is
  'The one tax rate. Orders, carts and invoices all read this; never hardcode a rate in the app.';
comment on column public.company_settings.invoice_template is
  'Copied into the invoice snapshot at issue, so changing it leaves issued documents alone.';
