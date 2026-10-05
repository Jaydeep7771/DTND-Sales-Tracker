"use client";

/**
 * The cart, held on the server.
 *
 * It used to live in localStorage, which meant it did not follow the
 * buyer from the phone in the warehouse to the laptop at the desk, and
 * it carried its own copy of the price — so a cart left open for a week
 * checked out at last week's number.
 *
 * Now the server owns it. Every mutation goes through a server action
 * and hands back the whole recomputed cart: prices resolved from this
 * customer's rate card, quantities capped at free stock. The client
 * applies an optimistic quantity so the UI stays quick, then takes
 * whatever the server says, including when the server says less.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { addToCart, mergeLocalCart, removeFromCart, setCartQuantity, clearCart as clearCartAction } from "@/lib/cart-actions";
import type { CartView } from "@/lib/types";

interface CartCtx {
  cart: CartView;
  lines: CartView["lines"];
  open: boolean;
  setOpen: (v: boolean) => void;
  /** Resolves with what the server actually allowed, so callers can say so. */
  add: (productId: string, qty: number, opts?: { open?: boolean }) => Promise<AddOutcome>;
  setQty: (productId: string, qty: number) => Promise<void>;
  remove: (productId: string) => Promise<void>;
  clear: () => Promise<void>;
  busy: boolean;
  error: string | null;
  subtotal: number;
  tax: number;
  total: number;
  saving: number;
}

export interface AddOutcome {
  ok: boolean;
  error?: string;
  /** Quantity actually in the cart for that product afterwards. */
  quantity?: number;
  /** The server reduced the request to free stock. */
  clamped?: boolean;
  available?: number;
}

const Ctx = createContext<CartCtx | null>(null);

/** The old localStorage key, kept only long enough to migrate it once. */
const LEGACY_KEY = "dtnd-cart";

const EMPTY: CartView = { lines: [], subtotal: 0, tax: 0, total: 0, saving: 0, blocking: [], backorders: [] };

export function CartProvider({ children, initial }: { children: ReactNode; initial: CartView }) {
  const [cart, setCart] = useState<CartView>(initial ?? EMPTY);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const merged = useRef(false);

  // The server is the source of truth: when a navigation re-renders the
  // layout with a fresher cart, take it. Adjusted during render rather
  // than in an effect, so there is no frame showing the stale cart.
  const [seen, setSeen] = useState(initial);
  if (initial && initial !== seen) {
    setSeen(initial);
    setCart(initial);
  }

  /**
   * One-time migration. A cart built before this change, or while signed
   * out, is still sitting in localStorage; fold it into the server cart
   * and then stop reading that key forever.
   */
  useEffect(() => {
    if (merged.current) return;
    merged.current = true;
    let raw: string | null = null;
    try { raw = localStorage.getItem(LEGACY_KEY); } catch { return; }
    if (!raw) return;

    let lines: { product_id: string; quantity: number }[] = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        lines = parsed
          .filter((l) => l && typeof l.product_id === "string" && Number(l.quantity) > 0)
          .map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity) }));
      }
    } catch { /* a corrupt blob is not worth rescuing */ }

    // Clear first either way, so a blob that cannot be merged does not
    // get retried on every page load.
    try { localStorage.removeItem(LEGACY_KEY); } catch {}
    if (!lines.length) return;

    void mergeLocalCart(lines).then((res) => { if (res.ok && res.data) setCart(res.data); });
  }, []);

  const add = useCallback(async (productId: string, qty: number, opts: { open?: boolean } = {}): Promise<AddOutcome> => {
    setBusy(true); setError(null);
    const res = await addToCart(productId, qty);
    setBusy(false);
    if (!res.ok) { setError(res.error); return { ok: false, error: res.error }; }
    setCart(res.data!.cart);
    if (opts.open) setOpen(true);
    return {
      ok: true,
      quantity: res.data!.cart.lines.find((l) => l.product_id === productId)?.quantity,
      clamped: res.data!.clamped,
      available: res.data!.available,
    };
  }, []);

  const setQty = useCallback(async (productId: string, qty: number) => {
    // Optimistic: move the number now, reconcile when the server answers.
    setCart((c) => ({ ...c, lines: c.lines.map((l) => (l.product_id === productId ? { ...l, quantity: Math.max(1, qty) } : l)) }));
    setBusy(true); setError(null);
    const res = await setCartQuantity(productId, qty);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setCart(res.data!.cart);
  }, []);

  const remove = useCallback(async (productId: string) => {
    setCart((c) => ({ ...c, lines: c.lines.filter((l) => l.product_id !== productId) }));
    setBusy(true); setError(null);
    const res = await removeFromCart(productId);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setCart(res.data!.cart);
  }, []);

  const clear = useCallback(async () => {
    setCart(EMPTY);
    await clearCartAction();
  }, []);

  const value = useMemo<CartCtx>(() => ({
    cart, lines: cart.lines, open, setOpen, add, setQty, remove, clear, busy, error,
    subtotal: cart.subtotal, tax: cart.tax, total: cart.total, saving: cart.saving,
  }), [cart, open, add, setQty, remove, clear, busy, error]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart(): CartCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart must be used inside <CartProvider>");
  return c;
}
