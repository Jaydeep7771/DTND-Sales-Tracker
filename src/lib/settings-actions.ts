"use server";

/**
 * Company settings. One row, read by every screen that prints money, a
 * tax figure or an invoice.
 *
 * Validation happens here rather than only in the form, because a setting
 * reaches financial documents: a tax rate typed as 18 instead of 0.18
 * would silently overcharge every customer.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { demo } from "@/lib/demo-store";
import { isDemo, getCurrentStaff } from "@/lib/data";
import { can } from "@/lib/permissions";
import type { CompanySettings, InvoiceTemplateDb } from "@/types/database";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export type SettingsPatch = Partial<Omit<CompanySettings, "id" | "updated_at">>;

const TEMPLATES: InvoiceTemplateDb[] = ["classic", "modern", "compact"];
const LOCALES = ["en-US", "en-IN"];

function validate(p: SettingsPatch): string | null {
  if (p.legal_name !== undefined && !p.legal_name.trim()) {
    return "The legal name appears on every invoice, so it cannot be blank.";
  }
  if (p.default_tax_rate !== undefined) {
    const r = p.default_tax_rate;
    if (!Number.isFinite(r) || r < 0) return "The tax rate cannot be negative.";
    // Caught here because 18 instead of 0.18 would multiply every bill by 19.
    if (r > 1) return "Enter the tax rate as a percentage, for example 18 for 18%.";
  }
  if (p.default_terms_days !== undefined && (!Number.isInteger(p.default_terms_days) || p.default_terms_days < 0)) {
    return "Payment terms must be a whole number of days.";
  }
  if (p.fiscal_year_start_month !== undefined && (p.fiscal_year_start_month < 1 || p.fiscal_year_start_month > 12)) {
    return "Pick a month between January and December.";
  }
  if (p.decimal_places !== undefined && (p.decimal_places < 0 || p.decimal_places > 3)) {
    return "Decimal places must be between 0 and 3.";
  }
  if (p.number_locale !== undefined && !LOCALES.includes(p.number_locale)) {
    return "Unknown number format.";
  }
  if (p.invoice_template !== undefined && !TEMPLATES.includes(p.invoice_template)) {
    return "Unknown invoice template.";
  }
  if (p.accent_color !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(p.accent_color)) {
    return "The accent colour must be a six digit hex value, for example #123A5E.";
  }
  if (p.currency_code !== undefined && !/^[A-Z]{3}$/.test(p.currency_code)) {
    return "A currency code is three letters, for example PKR.";
  }
  if (p.invoice_prefix !== undefined && !p.invoice_prefix.trim()) {
    return "The invoice prefix cannot be blank.";
  }
  return null;
}

/**
 * Changing the prefix or the fiscal year start moves the numbering scope,
 * which starts a fresh run of numbers. Worth saying out loud rather than
 * letting finance discover it on the next invoice.
 */
function numberingWarning(before: CompanySettings, p: SettingsPatch): string | undefined {
  const prefixChanged = p.invoice_prefix !== undefined && p.invoice_prefix !== before.invoice_prefix;
  const fyChanged = p.fiscal_year_start_month !== undefined && p.fiscal_year_start_month !== before.fiscal_year_start_month;
  if (!prefixChanged && !fyChanged) return undefined;
  return "Invoice numbering restarts at 00001 for the new series. Issued invoices keep their numbers.";
}

export async function updateCompanySettings(patch: SettingsPatch): Promise<Result<{ warning?: string }>> {
  const staff = await getCurrentStaff();
  if (!can(staff?.role, "settings:finance")) {
    return { ok: false, error: "Your role does not permit changing company settings." };
  }

  const invalid = validate(patch);
  if (invalid) return { ok: false, error: invalid };

  const before = isDemo
    ? demo.acc.settings
    : ((await (await createClient()).from("company_settings").select("*").eq("id", true).single()).data as CompanySettings | null);
  if (!before) return { ok: false, error: "Company settings row is missing. Run supabase/02-accounting.sql." };

  const warning = numberingWarning(before, patch);

  if (isDemo) {
    Object.assign(demo.acc.settings, patch, { updated_at: new Date().toISOString() });
  } else {
    const { error } = await (await createClient())
      .from("company_settings")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", true);
    if (error) return { ok: false, error: error.message };
  }

  // The currency and tax rate reach nearly every screen, so revalidate broadly.
  revalidatePath("/", "layout");
  return { ok: true, data: { warning } };
}
