"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import EditProductModal from "./EditProductModal";
import type { Product } from "@/lib/types";

export default function EditProductButton({ product }: { product: Product }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Edit ${product.name}`}>Edit</Button>
      {open && <EditProductModal product={product} onClose={() => setOpen(false)} />}
    </>
  );
}
