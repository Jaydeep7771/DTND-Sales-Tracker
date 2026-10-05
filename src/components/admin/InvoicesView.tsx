"use client";

/**
 * The invoice register.
 *
 * Until now an invoice could only be reached by walking in from the
 * order or the customer that produced it, which answers "what did we
 * bill this customer" and nothing else. This answers the questions a
 * finance person actually asks: what went out this month, what is still
 * owed, what is sitting in draft, which quotes are still open.
 *
 * The totals row is deliberately computed from the filtered set, not the
 * whole book, so narrowing to September gives September's numbers.
 */
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { money, num, shortDate } from "@/lib/format";
import { SETTLEMENT_LABEL, type Settlement } from "@/lib/accounting";
import { runConsolidatedBilling, type BillingRunRow } from "@/lib/invoice-actions";
import type { BadgeTone } from "@/components/ui";
import type { InvoiceView } from "@/lib/types";

const TONE: Record<Settlement, BadgeTone> = {
  draft: "warning", open: "info", part_paid: "info", paid: "success", overdue: "danger", void: "danger",
};

type Kind = "all" | "tax_invoice" | "credit_note" | "proforma";
type State = "all" | "draft" | "issued" | "void" | "outstanding" | "overdue";

interface CustomerLite { id: string; name: string; consolidated: boolean }

export default function InvoicesView({
  invoices, customers, canInvoice,
}: {
  invoices: InvoiceView[];
  customers: CustomerLite[];
  canInvoice: boolean;
}) {
  const [kind, setKind] = useState<Kind>("all");
  const [state, setState] = useState<State>("all");
  const [customerId, setCustomerId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [running, setRunning] = useState(false);

  const rows = useMemo(() => invoices.filter((i) => {
    if (kind !== "all" && i.type !== kind) return false;
    if (customerId && i.customer.id !== customerId) return false;

    if (state === "draft" && i.status !== "draft") return false;
    if (state === "issued" && i.status !== "issued") return false;
    if (state === "void" && i.status !== "void") return false;
    // "Outstanding" means money we are still waiting for, which only a
    // tax invoice can be.
    if (state === "outstanding" && !(i.status === "issued" && i.type === "tax_invoice" && i.balance > 0.005)) return false;
    if (state === "overdue" && i.settlement !== "overdue") return false;

    // A draft has no issue date; filter it on when it was raised so a
    // date range does not silently hide work in progress.
    const on = i.issue_date ?? i.created_at.slice(0, 10);
    if (from && on < from) return false;
    if (to && on > to) return false;

    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      const hay = [i.invoice_number, i.customer.company_name, ...i.order_numbers].join(" ").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  }), [invoices, kind, state, customerId, from, to, q]);

  // Signed: a credit note reduces what was billed, so adding it in
  // unsigned would overstate the month.
  const totals = useMemo(() => {
    let billed = 0, outstanding = 0, quoted = 0;
    for (const i of rows) {
      if (i.status !== "issued") continue;
      if (i.type === "proforma") { quoted += i.total; continue; }
      billed += i.type === "credit_note" ? -i.total : i.total;
      if (i.type === "tax_invoice") outstanding += i.balance;
    }
    return { billed, outstanding, quoted };
  }, [rows]);

  const anyConsolidated = customers.some((c) => c.consolidated);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title={`${num(rows.length)} document${rows.length === 1 ? "" : "s"}`}
          sub="Filters apply to the totals below as well, so narrowing to a month gives that month's figures."
          action={canInvoice ? <Button variant="secondary" onClick={() => setRunning(true)}>Monthly billing run</Button> : undefined}
        />

        <div className="px-4 pb-3 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
          <Field label="Search">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, customer, order" />
          </Field>
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="all">All types</option>
              <option value="tax_invoice">Tax invoices</option>
              <option value="credit_note">Credit notes</option>
              <option value="proforma">Proformas</option>
            </Select>
          </Field>
          <Field label="State">
            <Select value={state} onChange={(e) => setState(e.target.value as State)}>
              <option value="all">Any state</option>
              <option value="draft">Draft</option>
              <option value="issued">Issued</option>
              <option value="outstanding">Outstanding</option>
              <option value="overdue">Overdue</option>
              <option value="void">Void</option>
            </Select>
          </Field>
          <Field label="Customer">
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Every customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>

        <div className="px-4 pb-4 flex gap-5 flex-wrap text-[13px]">
          <Figure label="Net billed" value={money(totals.billed)} />
          <Figure label="Still outstanding" value={money(totals.outstanding)} tone={totals.outstanding > 0 ? "danger" : undefined} />
          {totals.quoted > 0 && <Figure label="Quoted (not billed)" value={money(totals.quoted)} tone="muted" />}
        </div>

        <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-[13px] border-collapse min-w-[760px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate border-b border-border">
                <th className="px-4 py-2 font-semibold">Document</th>
                <th className="px-4 py-2 font-semibold">Customer</th>
                <th className="px-4 py-2 font-semibold">Covers</th>
                <th className="px-4 py-2 font-semibold">Dated</th>
                <th className="px-4 py-2 font-semibold text-right">Total</th>
                <th className="px-4 py-2 font-semibold text-right">Balance</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => <Row key={i.id} invoice={i} />)}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate">Nothing matches those filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {running && (
        <BillingRunModal
          anyConsolidated={anyConsolidated}
          onClose={() => setRunning(false)}
        />
      )}
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "danger" | "muted" }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={`font-mono text-[18px] font-semibold ${tone === "danger" ? "text-danger" : tone === "muted" ? "text-slate" : ""}`}>{value}</div>
    </div>
  );
}

function Row({ invoice: i }: { invoice: InvoiceView }) {
  const isCredit = i.type === "credit_note";
  const isProforma = i.type === "proforma";
  const consolidated = !!i.period_start;
  const expired = isProforma && !!i.valid_until && !i.converted_to && i.valid_until < new Date().toISOString().slice(0, 10);

  return (
    <tr className={`border-b border-border-soft ${i.status === "void" ? "opacity-55" : ""}`}>
      <td className="px-4 py-2.5 whitespace-nowrap">
        <div className="font-mono font-semibold">{i.invoice_number ?? "— draft —"}</div>
        <div className="mt-1 flex gap-1 flex-wrap">
          {isCredit && <Badge tone="info" className="text-[10px]">Credit note</Badge>}
          {isProforma && <Badge tone="info" className="text-[10px]">Proforma</Badge>}
          {isProforma && i.converted_to && <Badge tone="success" className="text-[10px]">Converted</Badge>}
          {expired && <Badge tone="danger" className="text-[10px]">Expired</Badge>}
          {consolidated && <Badge tone="info" className="text-[10px]">Consolidated</Badge>}
          {!isCredit && !isProforma && <Badge tone={TONE[i.settlement]} className="text-[10px]">{SETTLEMENT_LABEL[i.settlement]}</Badge>}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <Link href={`/admin/customers/${i.customer.id}`} className="font-medium">{i.customer.company_name}</Link>
      </td>
      <td className="px-4 py-2.5 text-[12px] text-slate">
        {consolidated
          ? <>{shortDate(i.period_start!)} – {shortDate(i.period_end!)} · {num(i.order_numbers.length)} orders</>
          : i.order_numbers.length
            ? i.order_numbers.join(", ")
            : "—"}
      </td>
      <td className="px-4 py-2.5 text-[12px] text-slate whitespace-nowrap">
        {i.issue_date ? shortDate(i.issue_date) : "not issued"}
        {isProforma && i.valid_until && <div className="text-[11px] text-muted">valid to {shortDate(i.valid_until)}</div>}
        {!isProforma && !isCredit && i.due_date && <div className="text-[11px] text-muted">due {shortDate(i.due_date)}</div>}
      </td>
      <td className={`px-4 py-2.5 text-right font-mono font-semibold whitespace-nowrap ${isCredit ? "text-success" : ""}`}>
        {isCredit ? "−" : ""}{money(i.total)}
      </td>
      <td className="px-4 py-2.5 text-right font-mono whitespace-nowrap">
        {i.type === "tax_invoice" && i.status === "issued"
          ? <span className={i.balance > 0.005 ? "" : "text-slate"}>{money(i.balance)}</span>
          : <span className="text-muted">—</span>}
      </td>
      <td className="px-4 py-2.5 text-right whitespace-nowrap">
        {i.order_id && <Link href={`/admin/orders?open=${i.order_id}`} className="text-[12px] mr-3">Order</Link>}
        <a href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer" className="text-[12px]">PDF</a>
      </td>
    </tr>
  );
}

/**
 * The monthly run.
 *
 * One consolidated draft per account that is set to be billed that way.
 * Drafts, not issued invoices — a month's billing is exactly the kind of
 * document somebody should read before it posts to the ledger.
 */
function BillingRunModal({ anyConsolidated, onClose }: { anyConsolidated: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [result, setResult] = useState<BillingRunRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Defaults to last month, which is when you actually run it.
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [from, setFrom] = useState(iso(first));
  const [to, setTo] = useState(iso(last));

  return (
    <Modal
      title="Monthly billing run"
      sub="Raises one consolidated draft per account set to consolidated billing, covering every order in the period that is not already invoiced."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Close</Button>
          <Button
            disabled={busy || !anyConsolidated}
            onClick={() => start(async () => {
              setError(null);
              const res = await runConsolidatedBilling(from, to);
              if (!res.ok) return setError(res.error);
              setResult(res.data!.rows);
              const made = res.data!.rows.filter((r) => r.ok).length;
              toast.push(made ? `${made} consolidated draft${made === 1 ? "" : "s"} raised.` : "Nothing to bill in that period.", made ? "success" : "info");
              router.refresh();
            })}
          >
            {busy ? "Running…" : "Run"}
          </Button>
        </>
      }
    >
      <div className="p-5 flex flex-col gap-3.5">
        {!anyConsolidated && (
          <div className="rounded-lg bg-info-bg border border-info-bd px-3 py-2 text-[12.5px] text-info">
            No account is set to consolidated billing yet. Turn it on from a customer&apos;s page first.
          </div>
        )}
        <div className="grid gap-3 grid-cols-2">
          <Field label="Period from"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Period to"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>

        {error && <div className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</div>}

        {result && (
          <div className="border border-border rounded-lg overflow-hidden">
            {result.map((r) => (
              <div key={r.customerId} className="px-3 py-2 border-b border-border-soft last:border-0 flex items-center justify-between gap-3">
                <span className="text-[13px] font-medium">{r.company}</span>
                <span className={`text-[12px] text-right ${r.ok ? "text-success" : "text-slate"}`}>
                  {r.ok ? `${num(r.orders ?? 0)} orders billed` : r.reason}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="text-[12px] text-slate">
          Each run takes only what is still uninvoiced, so running it twice, or running it after
          somebody billed one order by hand, cannot bill the same goods again.
        </div>
      </div>
    </Modal>
  );
}
