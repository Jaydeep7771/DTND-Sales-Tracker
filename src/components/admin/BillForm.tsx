"use client";

/**
 * Enter a purchase bill.
 *
 * There is no draft stage, unlike a sales invoice. A sales invoice is a
 * document this business creates and may still be deciding about; a
 * purchase bill has already arrived, and holding it unposted just means
 * the payable is missing from the books.
 */
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { postBill } from "@/lib/purchases";
import { businessDate, round2 } from "@/lib/accounting";
import { money } from "@/lib/format";
import { currencyPrefix, percent } from "@/lib/money";
import type { Product, Supplier } from "@/types/database";

interface Line { key: string; product_id: string; description: string; quantity: string; unit_cost: string }

const blank = (): Line => ({ key: crypto.randomUUID(), product_id: "", description: "", quantity: "", unit_cost: "" });

export default function BillForm({
  suppliers, products, defaultTaxRate, onClose,
}: {
  suppliers: Supplier[];
  products: Product[];
  defaultTaxRate: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [ref, setRef] = useState("");
  const [billDate, setBillDate] = useState(businessDate());
  const [terms, setTerms] = useState(String(suppliers[0]?.payment_terms_days ?? 30));
  const [taxRate, setTaxRate] = useState(String(round2(defaultTaxRate * 100)));
  const [freight, setFreight] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([blank()]);

  const totals = useMemo(() => {
    const goods = round2(lines.reduce((a, l) => a + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0));
    const f = round2(Number(freight) || 0);
    const taxable = round2(goods + f);
    const rate = (Number(taxRate) || 0) / 100;
    const tax = round2(taxable * rate);
    return { goods, freight: f, taxable, tax, total: round2(taxable + tax), rate };
  }, [lines, freight, taxRate]);

  function setLine(key: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /** Choosing a catalogue product fills the description and last cost. */
  function pickProduct(key: string, productId: string) {
    const p = products.find((x) => x.id === productId);
    setLine(key, {
      product_id: productId,
      description: p ? p.name : "",
      unit_cost: p && Number(p.cost_price) > 0 ? String(p.cost_price) : "",
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await postBill({
        supplier_id: supplierId,
        supplier_ref: ref,
        bill_date: billDate,
        terms_days: Number(terms) || 0,
        tax_rate: totals.rate,
        freight: totals.freight,
        notes,
        lines: lines
          .filter((l) => Number(l.quantity) > 0)
          .map((l) => ({
            product_id: l.product_id || null,
            description: l.description,
            quantity: Number(l.quantity),
            unit_cost: Number(l.unit_cost) || 0,
          })),
      });
      if (!res.ok) return setError(res.error);
      toast.push(`${res.data!.number} posted for ${money(res.data!.total)}`, "success");
      router.refresh();
      onClose();
    });
  }

  const stockLines = lines.filter((l) => l.product_id && Number(l.quantity) > 0).length;

  return (
    <Modal
      title="Enter a purchase bill"
      sub="Posts straight to the ledger, brings the goods into stock and updates the moving average cost."
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="bill" disabled={busy || totals.total <= 0 || !supplierId}>
            {busy ? "Posting…" : `Post bill for ${money(totals.total)}`}
          </Button>
        </>
      }
    >
      <form id="bill" onSubmit={submit} className="p-5 flex flex-col gap-4">
        {error && <p role="alert" className="rounded-lg bg-danger-bd/10 border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}

        {suppliers.length === 0 ? (
          <p className="rounded-lg bg-warning-bg border border-warning-bd px-3 py-2.5 text-[13px] text-warning">
            Add a supplier first.
          </p>
        ) : (
          <>
            <div className="grid gap-3.5 grid-cols-2 md:grid-cols-4">
              <Field label="Supplier" className="col-span-2">
                <Select
                  value={supplierId}
                  onChange={(e) => {
                    setSupplierId(e.target.value);
                    const s = suppliers.find((x) => x.id === e.target.value);
                    if (s) setTerms(String(s.payment_terms_days));
                  }}
                >
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Their invoice no.">
                <Input mono required value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. SI-99214" />
              </Field>
              <Field label="Bill date">
                <Input type="date" required max={businessDate()} value={billDate} onChange={(e) => setBillDate(e.target.value)} />
              </Field>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="label">Lines</span>
                <button
                  type="button"
                  onClick={() => setLines((ls) => [...ls, blank()])}
                  className="text-[11.5px] text-navy-hover bg-transparent border-0 cursor-pointer"
                >
                  Add line
                </button>
              </div>

              <div className="border border-border rounded-lg overflow-x-auto">
                <table className="w-full border-collapse min-w-[640px]">
                  <thead>
                    <tr className="bg-surface-soft">
                      <th className="th">Product</th>
                      <th className="th">Description</th>
                      <th className="th th-r w-[90px]">Qty</th>
                      <th className="th th-r w-[120px]">Unit cost</th>
                      <th className="th th-r w-[110px]">Total</th>
                      <th className="th w-[40px]" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.key} className="border-t border-border-soft">
                        <td className="td">
                          <Select value={l.product_id} onChange={(e) => pickProduct(l.key, e.target.value)} className="py-1.5">
                            <option value="">Not stocked</option>
                            {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                          </Select>
                        </td>
                        <td className="td">
                          <Input value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} className="py-1.5" placeholder="What was bought" />
                        </td>
                        <td className="td">
                          <Input mono type="number" min="0" step="1" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} className="py-1.5 text-right" />
                        </td>
                        <td className="td">
                          <Input mono type="number" min="0" step="0.01" value={l.unit_cost} onChange={(e) => setLine(l.key, { unit_cost: e.target.value })} className="py-1.5 text-right" />
                        </td>
                        <td className="td text-right font-mono text-[12.5px]">
                          {money(round2((Number(l.quantity) || 0) * (Number(l.unit_cost) || 0)))}
                        </td>
                        <td className="td text-center">
                          {lines.length > 1 && (
                            <button
                              type="button"
                              aria-label="Remove line"
                              onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                              className="text-slate hover:text-danger bg-transparent border-0 cursor-pointer text-[15px] leading-none"
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-3.5 grid-cols-2 md:grid-cols-4">
              <Field label={`Freight (${currencyPrefix()})`}>
                <Input mono type="number" min="0" step="0.01" value={freight} onChange={(e) => setFreight(e.target.value)} placeholder="0" />
              </Field>
              <Field label="Input tax rate (%)">
                <Input mono type="number" min="0" step="0.01" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
              </Field>
              <Field label="Terms (days)">
                <Input mono type="number" min="0" step="1" value={terms} onChange={(e) => setTerms(e.target.value)} />
              </Field>
            </div>

            <div className="rounded-lg border border-border bg-surface-soft px-3.5 py-3 flex flex-col gap-1.5">
              {[
                ["Goods", money(totals.goods)],
                ...(totals.freight > 0 ? [["Freight (capitalised into stock)", money(totals.freight)] as [string, string]] : []),
                [`Input tax ${percent(totals.rate)}`, money(totals.tax)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-[12.5px] text-slate-dark">
                  <span>{k}</span><span className="font-mono">{v}</span>
                </div>
              ))}
              <div className="flex justify-between text-[13.5px] font-semibold pt-1.5 border-t border-border">
                <span>Payable to supplier</span><span className="font-mono">{money(totals.total)}</span>
              </div>
              <div className="text-[11.5px] text-slate mt-1 leading-relaxed">
                {stockLines > 0
                  ? `${stockLines} line${stockLines === 1 ? "" : "s"} will come into stock and roll the moving average cost forward. Freight is spread across them by value, because it is part of what each unit cost to get here.`
                  : "No stocked lines, so nothing will move in the warehouse."}
                {" "}Input tax goes to its own account and reduces what you owe on the sales tax return.
              </div>
            </div>

            <Field label="Notes">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}
