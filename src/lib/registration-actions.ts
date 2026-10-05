"use server";

/**
 * Business registration.
 *
 * A wholesale account is not self-serve. It carries trade credit and
 * shows wholesale pricing, so an application is reviewed before it
 * becomes an account rather than after. The form collects what is needed
 * to make that decision — who they are, where they trade from, their tax
 * identity — and nothing else, because every extra field loses applicants.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { demo, newId } from "@/lib/demo-store";
import { isDemo, getCurrentStaff } from "@/lib/data";
import { can } from "@/lib/permissions";
import { onboardCustomer, type InviteResult } from "@/lib/actions";
import { sendEmail } from "@/lib/email";
import type { CustomerApplication } from "@/types/database";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export interface RegistrationInput {
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  ntn: string;
  strn: string;
  business_type: string;
  years_trading: string;
  note: string;
}

/**
 * Submitted by the public, so it validates hard and trusts nothing.
 *
 * It reports the same success whether or not the email already has an
 * account or a pending application. Saying "you already applied" tells a
 * stranger who your customers are, and an applicant who double-submits
 * gets a sensible outcome either way.
 */
export async function submitRegistration(input: RegistrationInput): Promise<Result<{ reference: string }>> {
  const company = input.company_name.trim();
  const contact = input.contact_name.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();
  const address = input.address.trim();

  if (!company) return { ok: false, error: "Enter your registered business name." };
  if (!contact) return { ok: false, error: "Enter the name of the person we should deal with." };
  if (!email.includes("@") || email.length < 5) return { ok: false, error: "Enter a valid email address." };
  if (phone.replace(/\D/g, "").length < 7) return { ok: false, error: "Enter a phone number we can reach you on." };
  if (!address) return { ok: false, error: "Enter the address we would deliver to." };

  const years = input.years_trading.trim() === "" ? null : Number(input.years_trading);
  if (years !== null && (!Number.isFinite(years) || years < 0 || years > 200)) {
    return { ok: false, error: "Years trading does not look right." };
  }

  const row = {
    company_name: company,
    contact_name: contact,
    email,
    phone,
    address,
    city: input.city.trim() || "Karachi",
    ntn: input.ntn.trim() || null,
    strn: input.strn.trim() || null,
    business_type: input.business_type.trim() || null,
    years_trading: years,
    note: input.note.trim() || null,
  };

  const reference = `APP-${Date.now().toString(36).toUpperCase().slice(-6)}`;

  if (isDemo) {
    const duplicate = demo.applications.some((a) => a.email === email && a.status === "pending");
    if (!duplicate) {
      demo.applications.unshift({
        ...row, id: newId(), status: "pending",
        customer_id: null, reviewed_by: null, reviewed_at: null, review_note: null,
        created_at: new Date().toISOString(),
      });
    }
  } else {
    // A unique index on pending emails does the deduplicating; a clash is
    // swallowed so the applicant still gets a clean confirmation.
    const { error } = await (await createClient()).from("customer_applications").insert(row);
    if (error && !error.message.toLowerCase().includes("duplicate")) {
      return { ok: false, error: "Something went wrong submitting the form. Please try again or call us." };
    }
  }

  revalidatePath("/admin/applications");
  return { ok: true, data: { reference } };
}

// ---------------------------------------------------------------- review
export async function getApplications(): Promise<CustomerApplication[]> {
  const staff = await getCurrentStaff();
  if (!can(staff?.role, "customer:read")) return [];

  if (isDemo) return demo.applications;
  const { data } = await (await createClient())
    .from("customer_applications").select("*").order("created_at", { ascending: false });
  return data ?? [];
}

/**
 * Approving creates the account and sends the invite in one step, because
 * an approved application that still needs a second manual onboarding is
 * a queue of half-finished work waiting to be forgotten.
 */
export async function approveApplication(id: string, note: string): Promise<Result<InviteResult>> {
  const staff = await getCurrentStaff();
  if (!can(staff?.role, "customer:write")) return { ok: false, error: "Your role does not permit this." };

  const application = await findApplication(id);
  if (!application) return { ok: false, error: "Application not found." };
  if (application.status !== "pending") return { ok: false, error: "This application has already been reviewed." };

  const onboarded = await onboardCustomer({
    company_name: application.company_name,
    email: application.email,
  });
  if (!onboarded.ok) return onboarded;

  // Carry over what they already told us, so nobody retypes it.
  const customerId = await customerIdFor(application.email);
  if (customerId) {
    const billing = [application.address, application.city].filter(Boolean).join(", ");
    const patch = { billing_address: billing, ntn: application.ntn, strn: application.strn };
    if (isDemo) {
      const row = demo.customers.find((c) => c.id === customerId);
      if (row) Object.assign(row, patch);
    } else {
      await createAdminClient().from("users").update(patch).eq("id", customerId);
    }
  }

  await markReviewed(id, "approved", note, customerId);
  revalidatePath("/admin/applications");
  revalidatePath("/admin/customers");
  return { ok: true, data: onboarded.data! };
}

export async function rejectApplication(id: string, reason: string): Promise<Result> {
  const staff = await getCurrentStaff();
  if (!can(staff?.role, "customer:write")) return { ok: false, error: "Your role does not permit this." };
  if (!reason.trim()) return { ok: false, error: "Give a reason. It is sent to the applicant and kept on file." };

  const application = await findApplication(id);
  if (!application) return { ok: false, error: "Application not found." };
  if (application.status !== "pending") return { ok: false, error: "This application has already been reviewed." };

  await markReviewed(id, "rejected", reason.trim(), null);

  // Told plainly rather than left wondering. A rejected applicant who
  // hears nothing calls the office, which costs more than the email.
  await sendEmail({
    to: application.email,
    subject: "About your Dynamic Traders account application",
    html: `<p>Dear ${escapeHtml(application.contact_name)},</p>
<p>Thank you for applying for a trade account with Dynamic Traders &amp; Distributors.
We are not able to open an account for ${escapeHtml(application.company_name)} at this time.</p>
<p>${escapeHtml(reason.trim())}</p>
<p>If you believe this is a mistake, or your circumstances change, please get in touch.</p>`,
    text: `Dear ${application.contact_name},\n\nThank you for applying for a trade account with Dynamic Traders & Distributors. We are not able to open an account for ${application.company_name} at this time.\n\n${reason.trim()}\n\nIf you believe this is a mistake, or your circumstances change, please get in touch.`,
  });

  revalidatePath("/admin/applications");
  return { ok: true };
}

async function markReviewed(
  id: string, status: "approved" | "rejected", note: string, customerId: string | null,
) {
  const staff = await getCurrentStaff();
  const patch = {
    status,
    review_note: note.trim() || null,
    reviewed_by: staff?.id ?? null,
    reviewed_at: new Date().toISOString(),
    customer_id: customerId,
  };
  if (isDemo) {
    const row = demo.applications.find((a) => a.id === id);
    if (row) Object.assign(row, patch);
  } else {
    await (await createClient()).from("customer_applications").update(patch).eq("id", id);
  }
}

async function findApplication(id: string): Promise<CustomerApplication | null> {
  if (isDemo) return demo.applications.find((a) => a.id === id) ?? null;
  const { data } = await (await createClient()).from("customer_applications").select("*").eq("id", id).maybeSingle();
  return data;
}

async function customerIdFor(email: string): Promise<string | null> {
  if (isDemo) return demo.customers.find((c) => c.email === email)?.id ?? null;
  const { data } = await createAdminClient().from("users").select("id").eq("email", email).maybeSingle();
  return data?.id ?? null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
