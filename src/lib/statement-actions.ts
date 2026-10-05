"use server";

/**
 * Sending statements.
 *
 * A statement is not an invoice and the rules are different. It is not a
 * legal document, nothing is numbered, and it can be sent as often as
 * you like — so there is no draft stage and no posting. The only thing
 * worth recording is that it went, and to where.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { demo } from "@/lib/demo-store";
import { isDemo, getCompanySettings, getCurrentStaff, getCustomerById, getCustomers, getStatement } from "@/lib/data";
import { can } from "@/lib/permissions";
import { sendEmail, statementEmail } from "@/lib/email";
import { amountDue } from "@/lib/statements";
import { BUCKET_ORDER } from "@/lib/receivables";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function deny(): Promise<Result | null> {
  const staff = await getCurrentStaff();
  if (can(staff?.role, "invoice:write")) return null;
  return { ok: false, error: "Your role does not permit this action." };
}

async function stampSent(customerId: string, to: string) {
  const patch = { statement_sent_at: new Date().toISOString(), statement_sent_to: to };
  if (isDemo) {
    const c = demo.customers.find((c) => c.id === customerId);
    if (c) Object.assign(c, patch);
  } else {
    await (await createClient()).from("users").update(patch).eq("id", customerId);
  }
}

export async function sendStatement(
  customerId: string, from: string, to: string,
): Promise<Result<{ sent: boolean; reason?: string; to: string }>> {
  const denied = await deny(); if (denied) return denied;

  const [customer, statement, settings, staff] = await Promise.all([
    getCustomerById(customerId),
    getStatement(customerId, from, to),
    getCompanySettings(),
    getCurrentStaff(),
  ]);
  if (!customer) return { ok: false, error: "Customer not found." };
  if (!statement) return { ok: false, error: "Could not build the statement." };

  const { renderStatementPdf } = await import("@/lib/statement-pdf");
  const pdf = await renderStatementPdf(statement, customer, settings);

  // Overdue is the sum of the buckets past their due date. Current is
  // owed but not yet late, and calling it overdue in an email is the
  // fastest way to have an argument with somebody who has paid on time.
  const overdue = BUCKET_ORDER
    .filter((b) => b !== "current")
    .reduce((a, b) => a + statement.aging[b], 0);

  const message = statementEmail({
    to: customer.email,
    company: customer.company_name ?? customer.email,
    from,
    to_date: to,
    closing: statement.closing,
    due: amountDue(statement),
    overdue,
    currency: settings.currency_code,
    senderName: staff?.company_name ?? "Accounts",
    bankDetails: settings.bank_details,
  });

  const result = await sendEmail({
    ...message,
    attachments: [{ filename: `statement-${to}.pdf`, content: pdf.toString("base64") }],
  });

  if (result.sent) await stampSent(customerId, customer.email);

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/receivables");
  return { ok: true, data: { sent: result.sent, reason: result.reason, to: customer.email } };
}

export interface StatementRunRow {
  customerId: string;
  company: string;
  sent: boolean;
  reason?: string;
  due: number;
}

/**
 * Statements to everybody with a balance.
 *
 * Accounts that are square are skipped, not because they do not deserve
 * a statement but because a run that emails thirty "you owe nothing"
 * messages teaches people to ignore the sender. Any one of them can
 * still be sent individually.
 */
export async function runStatements(from: string, to: string): Promise<Result<{ rows: StatementRunRow[] }>> {
  const denied = await deny(); if (denied) return denied;

  const customers = (await getCustomers()).filter((c) => c.is_active);
  const rows: StatementRunRow[] = [];

  for (const c of customers) {
    const statement = await getStatement(c.id, from, to);
    if (!statement) continue;
    const due = amountDue(statement);
    if (due <= 0.5) continue;

    const res = await sendStatement(c.id, from, to);
    rows.push({
      customerId: c.id,
      company: c.company_name ?? c.email,
      sent: res.ok ? !!res.data?.sent : false,
      reason: res.ok ? res.data?.reason : res.error,
      due,
    });
  }

  if (!rows.length) return { ok: false, error: "No account has an outstanding balance for that period." };
  return { ok: true, data: { rows } };
}
