"use client";

// Edit an existing product: name, price, stock, reorder point, archive.
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Modal } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { updateProduct } from "@/lib/actions";
import { setAllowBackorder as setAllowBackorder_ } from "@/lib/pricing-actions";
import type { Product } from "@/lib/types";
import { currencyPrefix } from "@/lib/money";

export default function EditProductModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    name: product.name,
    description: product.description ?? "",
    price: String(product.price),
    stock_quantity: String(product.stock_quantity),
    cost_price: String(product.cost_price ?? 0),
    reorder_point: String(product.reorder_point),
    hs_code: product.hs_code ?? "",
    is_archived: product.is_archived,
    stock_note: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const [allowBackorder, setAllowBackorder] = useState(product.allow_backorder);

  // A difference between the counted figure and the recorded one is a
  // stocktake, so the form asks why before it will post one.
  const counted = Number(form.stock_quantity);

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await updateProduct(product.id, {
        name: form.name,
        description: form.description,
        price: Number(form.price),
        cost_price: Number(form.cost_price),
        stock_quantity: Number(form.stock_quantity),
        reorder_point: Number(form.reorder_point),
        hs_code: form.hs_code,
        is_archived: form.is_archived,
        stock_note: form.stock_note,
      });
      if (!res.ok) return setError(res.error);
      if (allowBackorder !== product.allow_backorder) {
        const flag = await setAllowBackorder_(product.id, allowBackorder);
        if (!flag.ok) return setError(flag.error);
      }
      toast.push(`${form.name.trim()} updated`, "success");
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal
      title={`Edit ${product.sku}`}
      sub="Changes are visible to customers immediately. A different count posts a stock adjustment rather than overwriting the figure."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="edit-product" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
        </>
      }
    >
      <form id="edit-product" onSubmit={submit} className="p-5 grid gap-3.5 grid-cols-1 sm:grid-cols-2">
        {error && <p role="alert" className="col-span-full rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Field label="Product name" className="col-span-full"><Input required value={form.name} onChange={set("name")} /></Field>
        <Field label="Description" className="col-span-full"><Input value={form.description} onChange={set("description")} placeholder="Optional" /></Field>
        <Field label={`Unit price (${currencyPrefix()})`}><Input mono required type="number" min="0" step="0.01" value={form.price} onChange={set("price")} /></Field>
        <Field label={`Unit cost (${currencyPrefix()})`}><Input mono required type="number" min="0" step="0.01" value={form.cost_price} onChange={set("cost_price")} /></Field>
        <Field label="Counted on hand"><Input mono required type="number" min="0" step="1" value={form.stock_quantity} onChange={set("stock_quantity")} /></Field>
        <Field label="Reorder point"><Input mono type="number" min="0" step="1" value={form.reorder_point} onChange={set("reorder_point")} /></Field>
        {/* Without this the sales tax return cannot be filed: Annex-C
            lists supplies by commodity classification. */}
        <Field label="HS code"><Input mono value={form.hs_code} onChange={set("hs_code")} placeholder="7318.1500" /></Field>
        {/* Off by default. Every line that is on is a promise somebody
            in the warehouse has to keep. */}
        <label className="col-span-full flex items-start gap-2 text-[13px] text-slate-dark">
          <input type="checkbox" checked={allowBackorder} onChange={(e) => setAllowBackorder(e.target.checked)} className="accent-accent mt-[3px]" />
          <span>
            Allow backorders
            <span className="block text-[12px] text-slate">Customers may order more than is free. Leave off and the cart caps at available stock.</span>
          </span>
        </label>
        {counted !== product.stock_quantity && (
          <div className="col-span-full rounded-lg border border-warning-bd bg-warning-bg px-3 py-2.5">
            <div className="text-[12.5px] text-warning font-medium">
              {counted > product.stock_quantity
                ? `Bringing ${counted - product.stock_quantity} units in`
                : `Writing ${product.stock_quantity - counted} units off`}
              {" "}against Stock Adjustments.
            </div>
            <Input
              className="mt-2 bg-surface"
              value={form.stock_note}
              onChange={set("stock_note")}
              placeholder="Reason, e.g. stocktake 3 Oct, two cartons water damaged"
            />
          </div>
        )}
        <label className="flex items-center gap-2.5 text-[13px] text-slate-dark self-end pb-2.5">
          <input type="checkbox" checked={form.is_archived} onChange={(e) => setForm((f) => ({ ...f, is_archived: e.target.checked }))} className="accent-accent w-4 h-4" />
          Archived (hidden from catalog)
        </label>
      </form>
    </Modal>
  );
}
