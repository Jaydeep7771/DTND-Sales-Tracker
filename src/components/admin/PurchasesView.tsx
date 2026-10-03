"use client";

/**
 * Purchases: the bill list, the supplier list and the sales tax working.
 *
 * Kept on one screen with tabs because they are read together: "what did
 * we buy, who do we owe, what do we owe FBR" is one question in practice.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input, Modal, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import BillForm from "./BillForm";
import { paySupplier, saveSupplier } from "@/lib/purchases";
import { businessDate } from "@/lib/accounting";
import { money, shortDate } from "@/lib/format";
import type { BillView, TaxMonth } from "@/lib/data";
import type { BadgeTone } from "@/components/ui";
import type { Product, Supplier } from "@/types/database";

const TONE: Record<string, BadgeTone> = {
  open: "info", part_paid: "info", paid: "success", overdue: "danger", void: "danger",
};
const LABEL: Record<string, string> = {
  open: "Awaiting payment", part_paid: "Part paid", paid: "Paid", overdue: "Overdue", void: "Void",
};

type Tab = "bills" | "suppliers" | "tax";

export default function PurchasesView({
  bills, suppliers, products, taxMonths, defaultTaxRate, canEdit,
}: {
  bills: BillView[];
  suppliers: Supplier[];
  products: Product[];
  taxMonths: TaxMonth[];
  defaultTaxRate: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("bills");
  const [entering, setEntering] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null | "new">(null);
  const [paying, setPaying] = useState<BillView | null>(null);

  const owed = bills.filter((b) => b.status === "posted").reduce((a, b) => a + b.balance, 0);
  const overdue = bills.filter((b) => b.settlement === "overdue").reduce((a, b) => a + b.balance, 0);

  const TABS: { key: Tab; label: string }[] = [
    { key: "bills", label: `Bills (${bills.length})` },
    { key: "suppliers", label: `Suppliers (${suppliers.length})` },
    { key: "tax", label: "Sales tax" },
  ];

  return (
    <>
      <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <Card className="px-4 py-3.5">
          <div className="label">Owed to suppliers</div>
          <div className="text-[22px] font-semibold font-mono mt-1">{money(owed)}</div>
        </Card>
        <Card className="px-4 py-3.5">
          <div className="label">Overdue</div>
          <div className={`text-[22px] font-semibold font-mono mt-1 ${overdue > 0 ? "text-danger" : ""}`}>{money(overdue)}</div>
        </Card>
        <Card className="px-4 py-3.5">
          <div className="label">Input tax this month</div>
          <div className="text-[22px] font-semibold font-mono mt-1">{money(taxMonths[0]?.input ?? 0)}</div>
          <div className="text-[11.5px] text-slate mt-0.5">reduces what you owe</div>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`text-[12.5px] rounded-full px-3 py-1.5 border cursor-pointer ${
                tab === t.key ? "bg-navy text-white border-navy" : "bg-surface text-slate-dark border-border hover:border-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditingSupplier("new")}>Add supplier</Button>
            <Button size="sm" onClick={() => setEntering(true)} disabled={suppliers.length === 0}>Enter bill</Button>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------- bills */}
      {tab === "bills" && (
        <Card className="overflow-hidden">
          {bills.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <div className="text-[13px] text-slate">No bills entered.</div>
              <div className="text-[12px] text-muted mt-1.5 max-w-[440px] mx-auto">
                Until purchases are entered, the ledger records output tax with no input tax against it,
                which overstates what you owe on the return.
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[760px]">
                <thead>
                  <tr className="bg-surface-soft">
                    <th className="th px-5">Bill</th>
                    <th className="th px-3">Supplier</th>
                    <th className="th px-3">Date</th>
                    <th className="th px-3">Due</th>
                    <th className="th th-r px-3">Total</th>
                    <th className="th th-r px-3">Balance</th>
                    <th className="th th-r px-5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((b) => (
                    <tr key={b.id} className="border-t border-border-soft hover:bg-surface-soft">
                      <td className="px-5 py-3">
                        <div className="font-mono text-[12.5px] font-medium">{b.bill_number}</div>
                        <div className="text-[11px] text-slate mt-0.5">their ref {b.supplier_ref}</div>
                      </td>
                      <td className="px-3 py-3 text-[13px]">{b.supplier_name}</td>
                      <td className="px-3 py-3 text-[12.5px] text-slate-strong whitespace-nowrap">{shortDate(b.bill_date)}</td>
                      <td className={`px-3 py-3 text-[12.5px] whitespace-nowrap ${b.settlement === "overdue" ? "text-danger font-semibold" : "text-slate-strong"}`}>
                        {b.due_date ? shortDate(b.due_date) : "—"}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-[12.5px]">{money(b.total)}</td>
                      <td className="px-3 py-3 text-right font-mono text-[12.5px] font-semibold">
                        {b.status === "void" ? "—" : money(b.balance)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Badge tone={TONE[b.settlement]}>{LABEL[b.settlement]}</Badge>
                          {canEdit && b.status === "posted" && b.balance > 0.005 && (
                            <Button size="sm" variant="secondary" onClick={() => setPaying(b)}>Pay</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ------------------------------------------------------ suppliers */}
      {tab === "suppliers" && (
        <Card className="overflow-hidden">
          {suppliers.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate">No suppliers yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[620px]">
                <thead>
                  <tr className="bg-surface-soft">
                    <th className="th px-5">Supplier</th>
                    <th className="th px-3">Contact</th>
                    <th className="th px-3">NTN</th>
                    <th className="th px-3">Terms</th>
                    <th className="th th-r px-5">Owed</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => {
                    const owedTo = bills
                      .filter((b) => b.supplier_id === s.id && b.status === "posted")
                      .reduce((a, b) => a + b.balance, 0);
                    return (
                      <tr key={s.id} className="border-t border-border-soft hover:bg-surface-soft">
                        <td className="px-5 py-3">
                          <button
                            type="button"
                            onClick={() => canEdit && setEditingSupplier(s)}
                            className="text-[13.5px] font-medium bg-transparent border-0 p-0 cursor-pointer text-ink hover:text-navy-hover text-left"
                          >
                            {s.name}
                          </button>
                          {s.email && <div className="text-[11.5px] text-slate mt-0.5">{s.email}</div>}
                        </td>
                        <td className="px-3 py-3 text-[12.5px] text-slate-strong">{s.contact_name ?? "—"}</td>
                        <td className="px-3 py-3 font-mono text-[12px] text-slate-strong">{s.ntn ?? "—"}</td>
                        <td className="px-3 py-3 text-[12.5px]">Net {s.payment_terms_days}</td>
                        <td className="px-5 py-3 text-right font-mono text-[12.5px] font-semibold">{money(owedTo)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ------------------------------------------------------------ tax */}
      {tab === "tax" && (
        <Card className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border">
            <div className="text-sm font-semibold">Sales tax working</div>
            <div className="text-xs text-slate mt-0.5">
              Output tax charged to customers, less input tax paid to suppliers. The difference is what you file.
            </div>
          </div>
          {taxMonths.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate">Nothing to report yet.</div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-surface-soft">
                  <th className="th px-5">Month</th>
                  <th className="th th-r px-3">Output tax</th>
                  <th className="th th-r px-3">Input tax</th>
                  <th className="th th-r px-5">Net payable</th>
                </tr>
              </thead>
              <tbody>
                {taxMonths.map((m) => (
                  <tr key={m.month} className="border-t border-border-soft">
                    <td className="px-5 py-3 text-[13px]">{shortDate(`${m.month}-01`).slice(3)}</td>
                    <td className="px-3 py-3 text-right font-mono text-[12.5px]">{money(m.output)}</td>
                    <td className="px-3 py-3 text-right font-mono text-[12.5px]">{money(m.input)}</td>
                    <td className={`px-5 py-3 text-right font-mono text-[13px] font-semibold ${m.net < 0 ? "text-success" : ""}`}>
                      {money(m.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="px-5 py-3 border-t border-border bg-surface-soft text-[11.5px] text-slate leading-relaxed">
            A negative net figure is a refund position, not a payment. Credit notes reduce output tax in the
            month the note was raised, which is the normal treatment but means a month can move after it looked settled.
          </div>
        </Card>
      )}

      {entering && (
        <BillForm suppliers={suppliers} products={products} defaultTaxRate={defaultTaxRate} onClose={() => setEntering(false)} />
      )}

      {editingSupplier && (
        <SupplierModal
          supplier={editingSupplier === "new" ? null : editingSupplier}
          onClose={() => setEditingSupplier(null)}
        />
      )}

      {paying && (
        <PayBillModal
          bill={paying}
          onClose={() => setPaying(null)}
          onDone={() => { setPaying(null); router.refresh(); }}
          toast={toast}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- supplier
function SupplierModal({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: supplier?.name ?? "",
    contact_name: supplier?.contact_name ?? "",
    email: supplier?.email ?? "",
    phone: supplier?.phone ?? "",
    address: supplier?.address ?? "",
    ntn: supplier?.ntn ?? "",
    strn: supplier?.strn ?? "",
    payment_terms_days: String(supplier?.payment_terms_days ?? 30),
    notes: supplier?.notes ?? "",
  });

  function save() {
    setError(null);
    start(async () => {
      const res = await saveSupplier(supplier?.id ?? null, {
        ...form, payment_terms_days: Number(form.payment_terms_days) || 0,
      });
      if (!res.ok) return setError(res.error);
      toast.push(supplier ? "Supplier updated" : `${form.name} added`, "success");
      router.refresh();
      onClose();
    });
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Modal
      title={supplier ? `Edit ${supplier.name}` : "Add a supplier"}
      sub="Their NTN matters: a purchase without one may not support an input tax claim."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !form.name.trim()}>{busy ? "Saving…" : "Save supplier"}</Button>
        </>
      }
    >
      <div className="p-5 grid gap-3.5 grid-cols-1 sm:grid-cols-2">
        {error && <p role="alert" className="sm:col-span-2 rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Field label="Name" className="sm:col-span-2"><Input value={form.name} onChange={set("name")} /></Field>
        <Field label="Contact"><Input value={form.contact_name} onChange={set("contact_name")} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={set("phone")} /></Field>
        <Field label="Email" className="sm:col-span-2"><Input type="email" value={form.email} onChange={set("email")} /></Field>
        <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={form.address} onChange={set("address")} /></Field>
        <Field label="NTN"><Input mono value={form.ntn} onChange={set("ntn")} /></Field>
        <Field label="STRN"><Input mono value={form.strn} onChange={set("strn")} /></Field>
        <Field label="Payment terms (days)"><Input mono type="number" min="0" value={form.payment_terms_days} onChange={set("payment_terms_days")} /></Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- payment
function PayBillModal({
  bill, onClose, onDone, toast,
}: {
  bill: BillView;
  onClose: () => void;
  onDone: () => void;
  toast: { push: (m: string, t?: "success" | "error" | "info") => void };
}) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(bill.balance));
  const [paidOn, setPaidOn] = useState(businessDate());
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");

  function pay() {
    setError(null);
    start(async () => {
      const res = await paySupplier({
        billId: bill.id,
        amount: Number(amount) || 0,
        paid_on: paidOn,
        method: method as "bank_transfer",
        reference,
        note: "",
      });
      if (!res.ok) return setError(res.error);
      toast.push(`Paid ${money(Number(amount))} to ${bill.supplier_name}`, "success");
      onDone();
    });
  }

  return (
    <Modal
      title={`Pay ${bill.bill_number}`}
      sub={`${bill.supplier_name} · ${money(bill.balance)} outstanding`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={pay} disabled={busy || !(Number(amount) > 0)}>{busy ? "Paying…" : "Record payment"}</Button>
        </>
      }
    >
      <div className="p-5 grid gap-3.5 grid-cols-2">
        {error && <p role="alert" className="col-span-2 rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Field label="Amount"><Input mono type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Paid on"><Input type="date" max={businessDate()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
        <Field label="Method">
          <select
            className="border border-border rounded-lg px-3 py-2.5 text-[13.5px] outline-none bg-surface-soft focus:border-accent focus:bg-surface w-full"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {[["bank_transfer", "Bank transfer"], ["cheque", "Cheque"], ["cash", "Cash"], ["online", "Online"]].map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque or transfer no." /></Field>
      </div>
    </Modal>
  );
}
