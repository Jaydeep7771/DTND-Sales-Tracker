"use client";

/**
 * "Add product" modal (design: inventory screen).
 * Image is compressed client-side (Web Worker → WebP ≤200 KB) before upload
 * to the `product-images` bucket. In demo mode the image is previewed but not
 * uploaded, since there is no bucket to send it to.
 */
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { createProduct } from "@/lib/actions";
import { compressImage, formatBytes, IMAGE_ACCEPTED_TYPES } from "@/lib/image";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "product-images";
const UOMS = ["Each", "Box of 50", "Box of 100", "Carton", "Pallet"];

type ImageState =
  | { status: "idle" }
  | { status: "compressing"; originalSize: number }
  | { status: "ready"; file: File; previewUrl: string; originalSize: number }
  | { status: "error"; message: string };

export default function AddProductModal({ categories, demo, onClose }: { categories: string[]; demo: boolean; onClose: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<ImageState>({ status: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", category: categories[0] ?? "General", unit_of_measure: "Each", price: "", stock_quantity: "", reorder_point: "40", description: "" });

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (image.status === "ready") URL.revokeObjectURL(image.previewUrl);
    setImage({ status: "compressing", originalSize: file.size });
    try {
      const compressed = await compressImage(file);
      setImage({ status: "ready", file: compressed, previewUrl: URL.createObjectURL(compressed), originalSize: file.size });
    } catch (err) {
      setImage({ status: "error", message: err instanceof Error ? err.message : "Could not process image." });
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (image.status === "compressing") return setError("Wait for the image to finish compressing.");
    setBusy(true);
    let uploadedPath: string | null = null;
    try {
      let image_url: string | null = null;
      if (image.status === "ready" && !demo) {
        const supabase = createClient();
        const path = `${crypto.randomUUID()}.webp`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, image.file, { contentType: image.file.type, cacheControl: "31536000" });
        if (upErr) throw new Error(`Image upload failed: ${upErr.message}`);
        uploadedPath = path;
        image_url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      }
      const res = await createProduct({
        name: form.name,
        description: form.description,
        category: form.category,
        unit_of_measure: form.unit_of_measure,
        price: Number(form.price),
        stock_quantity: Number(form.stock_quantity || 0),
        reorder_point: Number(form.reorder_point || 0),
        image_url,
      });
      if (!res.ok) {
        if (uploadedPath) await createClient().storage.from(BUCKET).remove([uploadedPath]);
        throw new Error(res.error);
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add product"
      sub="SKU is generated from category and sequence."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="add-product" disabled={busy || image.status === "compressing"}>{busy ? "Saving…" : "Save product"}</Button>
        </>
      }
    >
      <form id="add-product" onSubmit={onSubmit} className="p-5 grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        {error && <p role="alert" className="col-span-full rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Field label="Product name" className="col-span-full">
          <Input required placeholder="e.g. Hex Bolt M12 Grade 8.8" value={form.name} onChange={set("name")} />
        </Field>
        <Field label="Category">
          <Select value={form.category} onChange={set("category")}>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Unit of measure">
          <Select value={form.unit_of_measure} onChange={set("unit_of_measure")}>
            {UOMS.map((u) => <option key={u}>{u}</option>)}
          </Select>
        </Field>
        <Field label="Unit price (PKR)">
          <Input mono required type="number" min="0" step="0.01" placeholder="0.00" value={form.price} onChange={set("price")} />
        </Field>
        <Field label="Opening stock">
          <Input mono type="number" min="0" step="1" placeholder="0" value={form.stock_quantity} onChange={set("stock_quantity")} />
        </Field>
        <Field label="Reorder point">
          <Input mono type="number" min="0" step="1" value={form.reorder_point} onChange={set("reorder_point")} />
        </Field>
        <Field label="Description">
          <Input placeholder="Optional" value={form.description} onChange={set("description")} />
        </Field>

        <div className="col-span-full flex flex-col gap-1.5">
          <span className="label">Product image</span>
          <label className="hatch-drop border-[1.5px] border-dashed border-[#c3d0de] rounded-[10px] p-[26px] text-center cursor-pointer hover:border-accent block">
            <input ref={fileRef} type="file" accept={IMAGE_ACCEPTED_TYPES.join(",")} onChange={onImage} className="sr-only" />
            {image.status === "ready" ? (
              <div className="flex items-center justify-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.previewUrl} alt="Preview" className="w-16 h-16 rounded-lg object-cover border border-border" />
                <div className="text-left">
                  <div className="text-[13px] font-medium">Compressed and ready</div>
                  <div className="font-mono text-[11px] text-slate mt-1">
                    {formatBytes(image.originalSize)} → {formatBytes(image.file.size)} ({Math.round((1 - image.file.size / image.originalSize) * 100)}% smaller)
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="text-[13px] font-medium">{image.status === "compressing" ? `Compressing ${formatBytes(image.originalSize)}…` : "Drop image or click to upload"}</div>
                <div className="font-mono text-[11px] text-slate mt-[5px]">product shot · 1200×1200 · JPG/PNG/WEBP ≤ 2MB · compressed to WebP before upload</div>
                {image.status === "error" && <div className="text-xs text-danger mt-2">{image.message}</div>}
              </>
            )}
          </label>
          {demo && image.status === "ready" && <div className="text-[11px] text-slate">Demo mode: image is previewed but not uploaded until Supabase is configured.</div>}
        </div>
      </form>
    </Modal>
  );
}
