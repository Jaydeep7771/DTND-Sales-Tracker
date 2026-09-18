"use client";

/**
 * Admin → Add Product form.
 *
 * Flow:
 *  1. Admin picks an image → compressed client-side (browser-image-compression,
 *     Web Worker) and previewed with the before/after size.
 *  2. On submit: upload compressed image to the `product-images` bucket,
 *     then insert the product row with the resulting public URL.
 *  3. If the row insert fails, the uploaded object is removed so the bucket
 *     doesn't accumulate orphans.
 *
 * RLS: both the storage insert and the products insert require public.is_admin().
 */

import { useRef, useState, type FormEvent, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { compressImage, formatBytes, IMAGE_ACCEPTED_TYPES } from "@/lib/image";

const BUCKET = "product-images";

type ImageState =
  | { status: "idle" }
  | { status: "compressing"; originalSize: number }
  | { status: "ready"; file: File; previewUrl: string; originalSize: number }
  | { status: "error"; message: string };

interface FormValues {
  name: string;
  description: string;
  price: string;
  stock_quantity: string;
}

const EMPTY_FORM: FormValues = { name: "", description: "", price: "", stock_quantity: "0" };

export default function AddProductForm() {
  const router = useRouter();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [image, setImage] = useState<ImageState>({ status: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ---- Field handlers ------------------------------------------------
  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setValues((v) => ({ ...v, [name]: value }));
  }

  async function handleImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Release any previous preview object URL to avoid leaking memory.
    if (image.status === "ready") URL.revokeObjectURL(image.previewUrl);

    setImage({ status: "compressing", originalSize: file.size });
    try {
      const compressed = await compressImage(file);
      setImage({
        status: "ready",
        file: compressed,
        previewUrl: URL.createObjectURL(compressed),
        originalSize: file.size,
      });
    } catch (err) {
      setImage({ status: "error", message: err instanceof Error ? err.message : "Could not process image." });
    }
  }

  function resetForm() {
    if (image.status === "ready") URL.revokeObjectURL(image.previewUrl);
    setValues(EMPTY_FORM);
    setImage({ status: "idle" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ---- Submit --------------------------------------------------------
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Basic validation (the DB CHECK constraints are the source of truth).
    const price = Number(values.price);
    const stock = Number(values.stock_quantity);
    if (!values.name.trim()) return setError("Product name is required.");
    if (!Number.isFinite(price) || price < 0) return setError("Price must be a non-negative number.");
    if (!Number.isInteger(stock) || stock < 0) return setError("Stock must be a non-negative whole number.");
    if (image.status === "compressing") return setError("Please wait for the image to finish compressing.");

    setSubmitting(true);
    let uploadedPath: string | null = null;

    try {
      // 1. Upload the compressed image (if any).
      let imageUrl: string | null = null;
      if (image.status === "ready") {
        // Unique, URL-safe object key. Keeping files under a per-product-ish prefix
        // makes it easy to clean up later.
        const path = `${crypto.randomUUID()}.webp`;
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, image.file, { contentType: image.file.type, cacheControl: "31536000", upsert: false });
        if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);

        uploadedPath = path;
        imageUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      }

      // 2. Insert the product row.
      const { error: insertError } = await supabase.from("products").insert({
        name: values.name.trim(),
        description: values.description.trim() || null,
        price,
        stock_quantity: stock,
        image_url: imageUrl,
      });

      if (insertError) {
        // 3. Roll back the orphaned upload so the bucket stays clean.
        if (uploadedPath) await supabase.storage.from(BUCKET).remove([uploadedPath]);
        throw new Error(`Could not save product: ${insertError.message}`);
      }

      setSuccess(`"${values.name.trim()}" added.`);
      resetForm();
      router.refresh(); // Re-render the server-side product list if this form sits on it.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Render --------------------------------------------------------
  const inputCls =
    "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100";

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-5 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Add product</h2>

      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {success && <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700">Name</label>
        <input id="name" name="name" required value={values.name} onChange={handleChange} disabled={submitting} className={inputCls} />
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description</label>
        <textarea id="description" name="description" rows={3} value={values.description} onChange={handleChange} disabled={submitting} className={inputCls} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="price" className="block text-sm font-medium text-gray-700">Price</label>
          <input id="price" name="price" type="number" min="0" step="0.01" required value={values.price} onChange={handleChange} disabled={submitting} className={inputCls} />
        </div>
        <div>
          <label htmlFor="stock_quantity" className="block text-sm font-medium text-gray-700">Stock</label>
          <input id="stock_quantity" name="stock_quantity" type="number" min="0" step="1" required value={values.stock_quantity} onChange={handleChange} disabled={submitting} className={inputCls} />
        </div>
      </div>

      <div>
        <label htmlFor="image" className="block text-sm font-medium text-gray-700">Image</label>
        <input
          id="image"
          ref={fileInputRef}
          type="file"
          accept={IMAGE_ACCEPTED_TYPES.join(",")}
          onChange={handleImageChange}
          disabled={submitting}
          className="mt-1 block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
        />

        {image.status === "compressing" && (
          <p className="mt-2 text-xs text-gray-500">Compressing {formatBytes(image.originalSize)}…</p>
        )}
        {image.status === "error" && <p className="mt-2 text-xs text-red-600">{image.message}</p>}
        {image.status === "ready" && (
          <div className="mt-3 flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
            <img src={image.previewUrl} alt="Preview" className="h-20 w-20 rounded-md border object-cover" />
            <p className="text-xs text-gray-600">
              {formatBytes(image.originalSize)} → <span className="font-medium">{formatBytes(image.file.size)}</span>
              {" "}({Math.round((1 - image.file.size / image.originalSize) * 100)}% smaller)
            </p>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={resetForm} disabled={submitting} className="rounded-md px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
          Clear
        </button>
        <button
          type="submit"
          disabled={submitting || image.status === "compressing"}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Saving…" : "Add product"}
        </button>
      </div>
    </form>
  );
}
