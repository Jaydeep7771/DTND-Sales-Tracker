"use client";

// Cart lives in localStorage so it survives reloads; submit sends it to the server.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CartLine } from "@/lib/types";
import { TAX_RATE } from "@/lib/types";

interface CartCtx {
  lines: CartLine[];
  open: boolean;
  setOpen: (v: boolean) => void;
  add: (line: Omit<CartLine, "quantity">, qty: number, opts?: { open?: boolean }) => void;
  setQty: (product_id: string, qty: number) => void;
  remove: (product_id: string) => void;
  clear: () => void;
  subtotal: number;
  tax: number;
  total: number;
}

const Ctx = createContext<CartCtx | null>(null);
const KEY = "dtnd-cart";

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Server renders an empty cart; the stored cart is loaded after hydration so
  // the markup matches. This is a genuine external-system sync (localStorage).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const raw = localStorage.getItem(KEY); if (raw) setLines(JSON.parse(raw)); } catch {}
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch {}
  }, [lines, hydrated]);

  const add = useCallback((line: Omit<CartLine, "quantity">, qty: number, opts: { open?: boolean } = {}) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product_id === line.product_id);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, quantity: l.quantity + qty } : l));
      return [...ls, { ...line, quantity: qty }];
    });
    if (opts.open !== false) setOpen(true);
  }, []);
  const setQty = useCallback((id: string, qty: number) => setLines((ls) => ls.map((l) => (l.product_id === id ? { ...l, quantity: Math.max(1, qty) } : l))), []);
  const remove = useCallback((id: string) => setLines((ls) => ls.filter((l) => l.product_id !== id)), []);
  const clear = useCallback(() => setLines([]), []);

  const value = useMemo(() => {
    const subtotal = lines.reduce((a, l) => a + l.unit_price * l.quantity, 0);
    const tax = Math.round(subtotal * TAX_RATE);
    return { lines, open, setOpen, add, setQty, remove, clear, subtotal, tax, total: subtotal + tax };
  }, [lines, open, add, setQty, remove, clear]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart(): CartCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart must be used inside <CartProvider>");
  return c;
}
