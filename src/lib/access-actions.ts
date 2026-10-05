"use server";

/**
 * Who can get in, and for how long.
 *
 * Four things were missing and are handled here: invite links that expire,
 * a password reset that does not need an admin, suspension that actually
 * stops a login, and staff management so a finance user can be made
 * without opening the database.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { demo, newId } from "@/lib/demo-store";
import { isDemo, getCurrentStaff, getStaff } from "@/lib/data";
import { can, isStaff } from "@/lib/permissions";
import { inviteExpiry, inviteUrlFor } from "@/lib/invite";
import { inviteEmail, sendEmail } from "@/lib/email";
import type { UserRole } from "@/types/database";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

// ---------------------------------------------------------------- suspension
/**
 * Blocks or restores sign-in.
 *
 * Deliberately separate from credit hold. Hold is commercial: the
 * customer stays in the portal, sees their history, and cannot order.
 * Suspension is the door: they cannot get in at all. Confusing the two
 * means either letting a former customer browse your wholesale prices, or
 * locking out a good customer over a late payment.
 */
export async function setAccountActive(userId: string, active: boolean, reason: string): Promise<Result> {
  const staff = await getCurrentStaff();
  if (!can(staff?.role, "customer:write")) return { ok: false, error: "Your role does not permit this." };
  if (!active && !reason.trim()) return { ok: false, error: "Give a reason. It is the only record of why access was removed." };
  if (userId === staff?.id) return { ok: false, error: "You cannot suspend your own account." };

  const target = await findUser(userId);
  if (!target) return { ok: false, error: "Account not found." };

  // The last active admin must stay, or nobody can let anyone back in.
  // In practice the self-check above catches this first, since only an
  // admin can reach here; it is kept for the day another role is given
  // customer:write.
  if (!active && target.role === "admin") {
    const admins = (await getStaff()).filter((u) => u.role === "admin" && u.is_active);
    if (admins.length <= 1) {
      return { ok: false, error: "This is the only active admin. Promote someone else before suspending this account." };
    }
  }

  const patch = active
    ? { is_active: true, suspended_at: null, suspended_by: null, suspend_reason: null }
    : { is_active: false, suspended_at: new Date().toISOString(), suspended_by: staff?.id ?? null, suspend_reason: reason.trim() };

  if (isDemo) {
    const row = [...demo.customers, ...demo.staff].find((u) => u.id === userId);
    if (!row) return { ok: false, error: "Account not found." };
    Object.assign(row, patch);
  } else {
    const admin = createAdminClient();
    const { error } = await admin.from("users").update(patch).eq("id", userId);
    if (error) return { ok: false, error: error.message };

    // Supabase keeps its own session store, so revoking the row is not
    // enough: an open tab would keep working until its token expired.
    if (!active) await admin.auth.admin.signOut(userId, "global").catch(() => undefined);
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------- password
/**
 * Sends a reset link. Always reports success, even for an address that is
 * not registered, because telling a stranger which emails have accounts
 * is a free list of your customers.
 */
export async function requestPasswordReset(email: string): Promise<Result<{ sent: boolean }>> {
  const address = email.trim().toLowerCase();
  if (!address.includes("@")) return { ok: false, error: "Enter a valid email address." };

  if (isDemo) {
    return { ok: true, data: { sent: false } };
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const supabase = await createClient();

  // A suspended account gets nothing: a reset would hand back a login
  // that was deliberately taken away.
  const { data: profile } = await createAdminClient()
    .from("users").select("is_active").eq("email", address).maybeSingle();
  if (profile && !profile.is_active) return { ok: true, data: { sent: false } };

  await supabase.auth.resetPasswordForEmail(address, { redirectTo: `${base}/reset-password` });
  return { ok: true, data: { sent: true } };
}

/** Completes the reset, against the recovery session Supabase has opened. */
export async function completePasswordReset(password: string): Promise<Result> {
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  if (isDemo) return { ok: true };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "This reset link has expired. Ask for a new one." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------------------------------------------------------------- staff
export interface StaffInviteInput { email: string; name: string; role: UserRole }

/**
 * Invites an admin or finance user.
 *
 * Reuses the customer invite mechanism rather than inventing a second
 * one: same token, same expiry, same acceptance page. A staff invite that
 * behaved differently would be a second thing to keep secure.
 */
export async function inviteStaff(input: StaffInviteInput): Promise<Result<{ url: string; sent: boolean }>> {
  const by = await getCurrentStaff();
  if (!can(by?.role, "staff:invite")) return { ok: false, error: "Only an admin can invite staff." };

  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!email.includes("@")) return { ok: false, error: "Enter a valid email." };
  if (!name) return { ok: false, error: "Give them a name so colleagues know who this is." };
  if (input.role === "customer") return { ok: false, error: "Use the customer onboarding flow for customers." };

  const token = crypto.randomUUID().replace(/-/g, "");
  const now = new Date().toISOString();
  const expires = inviteExpiry();

  if (isDemo) {
    if ([...demo.staff, ...demo.customers].some((u) => u.email === email)) {
      return { ok: false, error: "Somebody with that email already has an account." };
    }
    demo.staff.push({
      id: newId(), email, role: input.role, company_name: name,
      billing_address: null, ntn: null, strn: null,
      is_active: true, suspended_at: null, suspended_by: null, suspend_reason: null,
      invite_expires_at: expires, invited_by: by?.id ?? null, price_list_id: null, consolidated_billing: false, cnic: null, statement_sent_at: null, statement_sent_to: null,
      credit_limit: 0, credit_hold: false, payment_terms_days: null,
      invite_token: token, invited_at: now, activated_at: null, created_at: now,
    });
  } else {
    const admin = createAdminClient();
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { role: input.role, company_name: name },
    });
    if (error || !created.user) return { ok: false, error: error?.message ?? "Could not create the account." };
    const { error: patchError } = await admin.from("users").update({
      role: input.role, company_name: name,
      invite_token: token, invited_at: now, invite_expires_at: expires, invited_by: by?.id ?? null,
    }).eq("id", created.user.id);
    if (patchError) return { ok: false, error: patchError.message };
  }

  const url = inviteUrlFor(token);
  const sent = await sendEmail(
    inviteEmail({ to: email, company: name, inviteUrl: url, adminName: by?.company_name ?? "Dynamic Traders" }),
  );

  revalidatePath("/admin/staff");
  return { ok: true, data: { url, sent: sent.sent } };
}

/** Changes a colleague's role. */
export async function setStaffRole(userId: string, role: UserRole): Promise<Result> {
  const by = await getCurrentStaff();
  if (!can(by?.role, "staff:invite")) return { ok: false, error: "Only an admin can change roles." };
  if (!isStaff(role)) return { ok: false, error: "Staff can only be admin or finance." };
  if (userId === by?.id) return { ok: false, error: "You cannot change your own role. Ask another admin." };

  const target = await findUser(userId);
  if (!target) return { ok: false, error: "Account not found." };

  // Counts every admin, not only active ones. Demoting an already
  // suspended admin cannot lock anyone out, and filtering on active would
  // have blocked it for no reason.
  if (target.role === "admin" && role !== "admin") {
    const admins = (await getStaff()).filter((u) => u.role === "admin");
    if (admins.length <= 1) {
      return { ok: false, error: "This is the only admin. Promote somebody else first." };
    }
  }

  if (isDemo) {
    const row = demo.staff.find((u) => u.id === userId);
    if (!row) return { ok: false, error: "Account not found." };
    row.role = role;
  } else {
    const { error } = await createAdminClient().from("users").update({ role }).eq("id", userId);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/** Issues a fresh invite link for anyone who has not accepted, or whose link went stale. */
export async function reissueInvite(userId: string): Promise<Result<{ url: string; sent: boolean }>> {
  const by = await getCurrentStaff();
  if (!can(by?.role, "customer:write")) return { ok: false, error: "Your role does not permit this." };

  const target = await findUser(userId);
  if (!target) return { ok: false, error: "Account not found." };
  if (target.activated_at) return { ok: false, error: "This account is already active. Send a password reset instead." };

  const token = crypto.randomUUID().replace(/-/g, "");
  const now = new Date().toISOString();
  const expires = inviteExpiry();
  const patch = { invite_token: token, invited_at: now, invite_expires_at: expires, invited_by: by?.id ?? null };

  if (isDemo) {
    const row = [...demo.customers, ...demo.staff].find((u) => u.id === userId);
    if (!row) return { ok: false, error: "Account not found." };
    Object.assign(row, patch);
  } else {
    const { error } = await createAdminClient().from("users").update(patch).eq("id", userId);
    if (error) return { ok: false, error: error.message };
  }

  const url = inviteUrlFor(token);
  const sent = await sendEmail(
    inviteEmail({
      to: target.email,
      company: target.company_name ?? target.email,
      inviteUrl: url,
      adminName: by?.company_name ?? "Dynamic Traders",
    }),
  );

  revalidatePath("/", "layout");
  return { ok: true, data: { url, sent: sent.sent } };
}

async function findUser(id: string) {
  if (isDemo) return [...demo.customers, ...demo.staff].find((u) => u.id === id) ?? null;
  const { data } = await createAdminClient().from("users").select("*").eq("id", id).maybeSingle();
  return data;
}
