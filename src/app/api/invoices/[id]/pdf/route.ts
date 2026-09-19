/**
 * Invoice PDF download. Authorized here rather than by an unguessable URL:
 * staff may fetch any invoice, a customer only their own issued ones.
 * The PDF is rendered from the frozen snapshot, so it is identical every time.
 */
import { NextResponse } from "next/server";
import { getCurrentStaff, getCurrentUser, getInvoice } from "@/lib/data";
import { can } from "@/lib/permissions";
import { renderInvoicePdf } from "@/lib/invoice-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) return new NextResponse("Not found", { status: 404 });

  const staff = await getCurrentStaff();
  const isStaffViewer = can(staff?.role, "invoice:read");
  if (!isStaffViewer) {
    const user = await getCurrentUser();
    const ownsIt = user?.id === invoice.customer.id && invoice.status === "issued";
    if (!ownsIt) return new NextResponse("Not found", { status: 404 });
  }

  const pdf = await renderInvoicePdf(invoice);
  const name = `${invoice.invoice_number ?? "draft-invoice"}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
