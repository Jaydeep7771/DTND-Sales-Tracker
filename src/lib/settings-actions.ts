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
import { isDemo, getCurrentStaff, getPeriods } from "@/lib/data";
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

// ---------------------------------------------------------------- periods
/**
 * Accounting periods.
 *
 * Closing a period is the control that stops a figure already reported to
 * the tax authority being changed afterwards. The table and the blocking
 * trigger existed from the start; this is the screen that uses them.
 */
export interface PeriodInput { name: string; starts_on: string; ends_on: string }

export async function createPeriod(input: PeriodInput): Promise<Result> {
  const staff = await getCurrentStaff();
  if (!can(staff?.role, "settings:finance")) return { ok: false, error: "Your role does not permit this." };
  if (!input.name.trim()) return { ok: false, error: "Give the period a name, for example 'September 2026'." };
  if (input.ends_on < input.starts_on) return { ok: false, error: "The end date is before the start date." };

  const periods = await getPeriods();
  // Overlapping periods would make "is this date closed?" ambiguous.
  const clash = periods.find((p) => input.starts_on <= p.ends_on && input.ends_on >= p.starts_on);
  if (clash) return { ok: false, error: `This overlaps ${clash.name} (${clash.starts_on} to ${clash.ends_on}).` };

  const row = { name: input.name.trim(), starts_on: input.starts_on, ends_on: input.ends_on };
  if (isDemo) {
    demo.acc.periods.push({ ...row, id: crypto.randomUUID(), closed_at: null, closed_by: null, created_at: new Date().toISOString() });
  } else {
    const { error } = await (await createClient()).from("accounting_periods").insert(row);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/admin/periods");
  return { ok: true };
}

export async function setPeriodClosed(periodId: string, closed: boolean): Promise<Result> {
  const staff = await getCurrentStaff();
  if (!can(staff?.role, "settings:finance")) return { ok: false, error: "Your role does not permit this." };

  const patch = closed
    ? { closed_at: new Date().toISOString(), closed_by: staff?.id ?? null }
    : { closed_at: null, closed_by: null };

  if (isDemo) {
    const p = demo.acc.periods.find((p) => p.id === periodId);
    if (!p) return { ok: false, error: "Period not found." };
    Object.assign(p, patch);
  } else {
    const { error } = await (await createClient()).from("accounting_periods").update(patch).eq("id", periodId);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
