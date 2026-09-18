"use client";

// Lightweight toast system: `useToast().push("Saved", "success")`.
// Bottom-right, auto-dismiss, stacked, aria-live so screen readers hear it.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type Tone = "success" | "info" | "error";
interface Toast { id: number; message: string; tone: Tone; action?: { label: string; onClick: () => void } }
interface Ctx { push: (message: string, tone?: Tone, action?: Toast["action"]) => void }

const ToastCtx = createContext<Ctx | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback<Ctx["push"]>((message, tone = "info", action) => {
    const id = ++seq;
    setToasts((t) => [...t.slice(-3), { id, message, tone, action }]);
    setTimeout(() => dismiss(id), tone === "error" ? 8000 : 4500);
  }, [dismiss]);
  const value = useMemo(() => ({ push }), [push]);

  const tones: Record<Tone, string> = {
    success: "border-l-success",
    info: "border-l-accent",
    error: "border-l-danger",
  };

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div aria-live="polite" className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 w-[min(360px,calc(100vw-32px))]">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`bg-topbar text-white rounded-lg pl-3.5 pr-2 py-2.5 text-[13px] shadow-[0_12px_30px_rgba(15,27,43,.35)] flex items-center gap-3 border-l-[3px] ${tones[t.tone]}`}>
            <span className="flex-1">{t.message}</span>
            {t.action && <button type="button" onClick={() => { t.action!.onClick(); dismiss(t.id); }} className="text-[12px] font-semibold text-[#9fc4f2] bg-transparent border-0 cursor-pointer px-1">{t.action.label}</button>}
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-[#94a7bd] bg-transparent border-0 cursor-pointer text-base leading-none px-1 hover:text-white">×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): Ctx {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("useToast must be used inside <ToastProvider>");
  return c;
}
