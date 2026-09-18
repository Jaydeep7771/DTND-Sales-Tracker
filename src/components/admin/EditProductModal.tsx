"use client";

// Edit an existing product: name, price, stock, reorder point, archive.
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Modal } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { updateProduct } from "@/lib/actions";
import type { Product } from "@/lib/types";

export default function EditProductModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    name: product.name,
    description: product.description ?? "",
    price: String(product.price),
    stock_quantity: String(product.stock_quantity),
    reorder_point: String(product.reorder_point),
    is_archived: product.is_archived,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await updateProduct(product.id, {
        name: form.name,
        description: form.description,
        price: Number(form.price),
        stock_quantity: Number(form.stock_quantity),
        reorder_point: Number(form.reorder_point),
        is_archived: form.is_archived,
      });
      if (!res.ok) return setError(res.error);
      toast.push(`${form.name.trim()} updated`, "success");
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal
      title={`Edit ${product.sku}`}
      sub="Changes are visible to customers immediately. Archiving hides the product from the catalog without deleting order history."
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
        <Field label="Unit price (PKR)"><Input mono required type="number" min="0" step="0.01" value={form.price} onChange={set("price")} /></Field>
        <Field label="On hand"><Input mono required type="number" min="0" step="1" value={form.stock_quantity} onChange={set("stock_quantity")} /></Field>
        <Field label="Reorder point"><Input mono type="number" min="0" step="1" value={form.reorder_point} onChange={set("reorder_point")} /></Field>
        <label className="flex items-center gap-2.5 text-[13px] text-slate-dark self-end pb-2.5">
          <input type="checkbox" checked={form.is_archived} onChange={(e) => setForm((f) => ({ ...f, is_archived: e.target.checked }))} className="accent-accent w-4 h-4" />
          Archived (hidden from catalog)
        </label>
      </form>
    </Modal>
  );
}
