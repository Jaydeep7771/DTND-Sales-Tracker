"use client";

// Announcement banner, dismissible per announcement (remembered in this browser).
import { useEffect, useState } from "react";
import type { Announcement } from "@/lib/types";

export default function Banner({ announcement }: { announcement: Announcement }) {
  const key = `dtnd-banner-${announcement.id}`;
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading dismissal from localStorage after hydration
    try { if (localStorage.getItem(key) === "1") setHidden(true); } catch {}
  }, [key]);
  if (hidden) return null;

  return (
    <div className="bg-warning-bg border-b border-warning-bd" role="region" aria-label="Announcement">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-5 py-[11px] flex items-center gap-3 flex-wrap">
        <span className="font-mono text-[10px] tracking-[.1em] uppercase font-semibold text-warning bg-[#f7e4be] rounded px-[7px] py-[3px]">Notice</span>
        <span className="text-[13px] text-[#6b4708] flex-1 min-w-[200px]"><strong className="font-semibold">{announcement.title}.</strong> {announcement.content}</span>
        <button type="button" onClick={() => { setHidden(true); try { localStorage.setItem(key, "1"); } catch {} }} aria-label="Dismiss announcement" className="text-[#8a5a0b] bg-transparent border-0 cursor-pointer text-base leading-none px-1 hover:text-ink">×</button>
      </div>
    </div>
  );
}
