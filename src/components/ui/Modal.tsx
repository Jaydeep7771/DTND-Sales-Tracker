"use client";

// Accessible modal: Escape closes, backdrop click closes, body scroll locked,
// focus moves to the first field on open and returns to the opener on close.
import { useEffect, useRef, type ReactNode } from "react";

export function Modal({ title, sub, onClose, children, footer, wide }: { title: string; sub?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select, button:not([aria-label=Close])");
    first?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panel.current) {
        // Simple focus trap.
        const els = [...panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])")];
        if (!els.length) return;
        const firstEl = els[0], lastEl = els[els.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-[rgba(15,27,43,.5)] z-[80] flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`whitespace-normal text-left font-normal text-ink bg-surface rounded-t-xl sm:rounded-xl w-full ${wide ? "sm:max-w-3xl" : "sm:max-w-[640px]"} max-h-[92vh] sm:max-h-[88vh] overflow-y-auto shadow-[0_24px_60px_rgba(15,27,43,.28)]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-[18px] border-b border-border flex items-start justify-between gap-3 sticky top-0 bg-surface z-10">
          <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <div className="text-base font-semibold">{title}</div>
            {sub && <div className="text-xs text-slate mt-0.5">{sub}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 border border-border bg-surface text-slate rounded-[7px] w-[30px] h-[30px] text-[15px] cursor-pointer hover:border-muted">×</button>
        </div>
        {children}
        {footer && <div className="px-5 py-4 border-t border-border flex justify-end gap-2.5 bg-surface-softer sticky bottom-0">{footer}</div>}
      </div>
    </div>
  );
}
