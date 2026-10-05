/**
 * Statement PDF.
 *
 * Authorized here, not by an unguessable URL: staff may fetch any
 * account's statement, a customer only their own. A guessed id returns
 * 404 rather than 403, so the route does not confirm which customer ids
 * exist.
 */
import { NextResponse } from "next/server";
import { getCompanySettings, getCurrentStaff, getCurrentUser, getCustomerById, getStatement } from "@/lib/data";
import { can } from "@/lib/permissions";
import { businessDate } from "@/lib/accounting";
import { renderStatementPdf } from "@/lib/statement-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;
  const url = new URL(req.url);
  const to = url.searchParams.get("to") || businessDate();
  // Three months is the window a buyer can actually reconcile in one
  // sitting; anything longer is a ledger, not a statement.
  const from = url.searchParams.get("from") || backThreeMonths(to);

  const staff = await getCurrentStaff();
  if (!can(staff?.role, "invoice:read")) {
    const user = await getCurrentUser();
    if (!user || user.id !== customerId) return new NextResponse("Not found", { status: 404 });
  }

  const [customer, statement, settings] = await Promise.all([
    getCustomerById(customerId),
    getStatement(customerId, from, to),
    getCompanySettings(),
  ]);
  if (!customer || !statement) return new NextResponse("Not found", { status: 404 });

  const pdf = await renderStatementPdf(statement, customer, settings);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="statement-${to}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function backThreeMonths(to: string): string {
  const d = new Date(`${to}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 3, 1)).toISOString().slice(0, 10);
}
