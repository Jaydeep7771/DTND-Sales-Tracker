/* Shared primitives matching the design system: buttons, badges, cards, inputs, toggle. */
import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from "react";
import type { OrderStatus } from "@/types/database";
import type { StockState } from "@/lib/format";

// ---------------------------------------------------------------- Button
type Variant = "primary" | "secondary" | "destructive" | "success" | "ghost" | "link";
const variants: Record<Variant, string> = {
  primary: "border border-navy bg-navy text-white font-semibold hover:bg-navy-hover",
  secondary: "border border-border-strong bg-surface text-slate-dark font-medium hover:border-muted",
  destructive: "border border-danger-bd bg-surface text-danger font-medium hover:bg-danger-bg",
  success: "border border-success bg-success text-white font-semibold hover:bg-[#0b6539]",
  ghost: "border border-border bg-surface text-navy-hover font-medium hover:border-accent",
  link: "border-0 bg-transparent text-navy-hover font-medium hover:text-accent p-0",
};
const sizes = { sm: "px-2.5 py-1.5 text-xs rounded-md", md: "px-3.5 py-[9px] text-[13px] rounded-lg", lg: "px-4 py-3 text-sm rounded-lg" };

export function Button({ variant = "primary", size = "md", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <button className={`inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed ${variants[variant]} ${variant === "link" ? "" : sizes[size]} ${className}`} {...rest} />;
}

// ---------------------------------------------------------------- Badge
export type BadgeTone = "success" | "warning" | "danger" | "info";
const badgeTones: Record<BadgeTone, string> = {
  success: "bg-success-bg text-success border-success-bd",
  warning: "bg-warning-bg text-warning border-warning-bd",
  danger: "bg-danger-bg text-danger border-danger-bd",
  info: "bg-info-bg text-info border-info-bd",
};
export function Badge({ tone, children, className = "" }: { tone: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={`inline-block text-[11px] font-semibold px-2.5 py-[3px] rounded-full border whitespace-nowrap ${badgeTones[tone]} ${className}`}>{children}</span>;
}

export const orderTone: Record<OrderStatus, BadgeTone> = { pending: "warning", changes_requested: "info", approved: "info", fulfilled: "success", rejected: "danger", cancelled: "danger" };
export const orderLabel: Record<OrderStatus, string> = { pending: "Pending", changes_requested: "Sent back", approved: "Approved", fulfilled: "Fulfilled", rejected: "Rejected", cancelled: "Withdrawn" };
export const stockTone: Record<StockState, BadgeTone> = { "In stock": "success", "Low stock": "warning", Backorder: "danger" };

export function OrderBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={orderTone[status]}>{orderLabel[status]}</Badge>;
}

// ---------------------------------------------------------------- Card
export function Card({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={`bg-surface border border-border rounded-[10px] ${className}`} style={style}>{children}</div>;
}
export function CardHeader({ title, sub, action }: { title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-4 py-3.5 border-b border-border flex items-center justify-between gap-3">
      <div>
        <div className="text-sm font-semibold">{title}</div>
        {sub && <div className="text-xs text-slate mt-0.5">{sub}</div>}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- Form controls
const control = "border border-border rounded-lg px-3 py-2.5 text-[13.5px] outline-none bg-surface-soft focus:border-accent focus:bg-surface w-full";
export function Input({ className = "", mono, ...rest }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return <input className={`${control} ${mono ? "font-mono" : ""} ${className}`} {...rest} />;
}
export function Select({ className = "", ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${control} ${className}`} {...rest} />;
}
export function Textarea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${control} resize-y ${className}`} {...rest} />;
}
export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------- Toggle
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`w-11 h-6 shrink-0 rounded-full p-[3px] flex cursor-pointer border-0 transition-colors ${on ? "bg-success justify-end" : "bg-border-strong justify-start"}`}
    >
      <span className="w-[18px] h-[18px] rounded-full bg-white block shadow-[0_1px_2px_rgba(15,27,43,.3)]" />
    </button>
  );
}

// ---------------------------------------------------------------- Page heading
export function PageHeading({ eyebrow, title, sub, actions }: { eyebrow?: string; title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div>
        {eyebrow && <div className="text-[11px] tracking-[.09em] uppercase text-slate font-semibold">{eyebrow}</div>}
        <h1 className={`text-2xl font-semibold tracking-[-.01em] ${eyebrow ? "mt-1" : ""}`}>{title}</h1>
        {sub && <div className="text-[13px] text-slate mt-1">{sub}</div>}
      </div>
      {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Modal shell
export function Modal({ title, sub, onClose, children, footer, wide }: { title: string; sub?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-[rgba(15,27,43,.5)] z-[80] flex items-center justify-center p-6" onClick={onClose}>
      <div className={`bg-surface rounded-xl w-full ${wide ? "max-w-3xl" : "max-w-[640px]"} max-h-[88vh] overflow-y-auto shadow-[0_24px_60px_rgba(15,27,43,.28)]`} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-[18px] border-b border-border flex items-center justify-between">
          <div>
            <div className="text-base font-semibold">{title}</div>
            {sub && <div className="text-xs text-slate mt-0.5">{sub}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="border border-border bg-surface text-slate rounded-[7px] w-[30px] h-[30px] text-[15px] cursor-pointer hover:border-muted">×</button>
        </div>
        {children}
        {footer && <div className="px-5 py-4 border-t border-border flex justify-end gap-2.5 bg-surface-softer">{footer}</div>}
      </div>
    </div>
  );
}
