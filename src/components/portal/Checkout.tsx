"use client";

// Review order → submit to admin (status "pending").
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { useCart } from "./CartProvider";
import { submitOrder } from "@/lib/actions";
import { money, num } from "@/lib/format";

const ADDRESSES = ["Warehouse 3 — SITE Area, Karachi", "Head office — Clifton, Karachi"];

export default function Checkout() {
  const cart = useCart();
  const router = useRouter();
  const [address, setAddress] = useState(ADDRESSES[0]);
  const [requiredBy, setRequiredBy] = useState(() => new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const res = await submitOrder({ lines: cart.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })), delivery_address: address, required_by: requiredBy || null, note });
      if (!res.ok) return setError(res.error);
      cart.clear();
      router.push(`/portal/orders?submitted=${res.data!.order_number}`);
    });
  }

  return (
    <div className="grid gap-5 items-start grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 flex flex-col gap-3.5">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-.01em]">Review order</h1>
          <div className="text-[13px] text-slate mt-1">Prices lock for 48 hours once the order is submitted for approval.</div>
        </div>
        <Card className="overflow-hidden">
          {cart.lines.length === 0 && <div className="p-6 text-[13px] text-slate">Your cart is empty. <Link href="/portal">Back to the catalog</Link>.</div>}
          {cart.lines.map((l) => (
            <div key={l.product_id} className="flex items-center gap-3.5 px-4 py-3.5 border-b border-border-soft">
              <div className="hatch w-14 h-14 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold">{l.name}</div>
                <div className="font-mono text-[11px] text-slate mt-[3px]">{l.sku} · {money(l.unit_price)} / unit</div>
              </div>
              <div className="flex items-center border border-border rounded-[7px] overflow-hidden">
                <button type="button" onClick={() => cart.setQty(l.product_id, l.quantity - 1)} className="border-0 bg-surface-soft w-7 h-8 cursor-pointer">–</button>
                <input value={l.quantity} onChange={(e) => cart.setQty(l.product_id, Number(e.target.value) || 1)} className="w-[38px] border-0 text-center font-mono text-[13px] outline-none" />
                <button type="button" onClick={() => cart.setQty(l.product_id, l.quantity + 1)} className="border-0 bg-surface-soft w-7 h-8 cursor-pointer">+</button>
              </div>
              <span className="font-mono text-sm font-semibold min-w-[92px] text-right">{money(l.unit_price * l.quantity)}</span>
              <button type="button" onClick={() => cart.remove(l.product_id)} aria-label="Remove" className="text-slate border-0 bg-transparent cursor-pointer text-base hover:text-danger">×</button>
            </div>
          ))}
          <div className="px-4 py-3.5 flex justify-between items-center bg-surface-softer">
            <Link href="/portal" className="text-[13px] font-medium">← Continue shopping</Link>
            <span className="text-xs text-slate">PO reference optional at approval stage</span>
          </div>
        </Card>
        <Card className="p-4 grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <Field label="Delivery address">
            <Select value={address} onChange={(e) => setAddress(e.target.value)}>{ADDRESSES.map((a) => <option key={a}>{a}</option>)}</Select>
          </Field>
          <Field label="Required by">
            <Input type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} />
          </Field>
          <Field label="Note to admin" className="col-span-full">
            <Textarea rows={2} placeholder="Split delivery acceptable…" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </Card>
      </div>

      <Card className="p-[18px] flex flex-col gap-3 lg:sticky lg:top-[110px]">
        <div className="text-sm font-semibold">Order summary</div>
        <div className="flex flex-col gap-[9px]">
          {[
            [`Subtotal (${cart.lines.length} lines · ${num(cart.lines.reduce((a, l) => a + l.quantity, 0))} units)`, money(cart.subtotal)],
            ["Sales tax 5%", money(cart.tax)],
            ["Freight", "Quoted at approval"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between text-[13px] text-slate-strong"><span>{k}</span><span className="font-mono text-ink">{v}</span></div>
          ))}
        </div>
        <div className="h-px bg-border" />
        <div className="flex justify-between items-baseline">
          <span className="text-[13px] font-semibold">Total</span>
          <span className="font-mono text-[22px] font-semibold">{money(cart.total)}</span>
        </div>
        <div className="bg-info-bg border border-info-bd rounded-lg p-[11px] text-xs text-info">Submitted orders are reviewed by an operations admin, usually within 2 business hours.</div>
        {error && <div className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</div>}
        <Button size="lg" onClick={submit} disabled={busy || cart.lines.length === 0}>{busy ? "Submitting…" : "Submit order to admin"}</Button>
        <Button variant="secondary" disabled>Save as draft</Button>
      </Card>
    </div>
  );
}
