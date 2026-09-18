"use client";

// Subscribes to Supabase Realtime for INSERTs on `orders` and shows a toast.
// Only mounted when Supabase is configured (live mode).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function OrderNotifications() {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("orders-inserts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (payload) => {
        const row = payload.new as { order_number?: string };
        setToast(`New order ${row.order_number ?? ""} awaiting approval`);
        router.refresh();
        setTimeout(() => setToast(null), 6000);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [router]);

  if (!toast) return null;
  return (
    <div role="status" className="fixed bottom-5 right-5 z-[90] bg-topbar text-white rounded-lg px-4 py-3 text-[13px] shadow-[0_12px_30px_rgba(15,27,43,.35)] flex items-center gap-3">
      <span className="w-2 h-2 rounded-full bg-warning-dot" />
      {toast}
    </div>
  );
}
