"use client";

// Clickable table row. The company name stays a real link so keyboard and
// middle-click behave normally; the row click is a convenience on top.
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export default function CustomerRow({ id, name, children }: { id: string; name: string; children: ReactNode }) {
  const router = useRouter();
  const href = `/admin/customers/${id}`;
  return (
    <tr
      onClick={() => router.push(href)}
      className="border-t border-border-soft hover:bg-surface-soft cursor-pointer"
    >
      <td className="px-4 py-3 font-medium text-[13.5px]">
        <Link href={href} onClick={(e) => e.stopPropagation()} className="text-ink hover:text-navy-hover">
          {name}
        </Link>
      </td>
      {children}
    </tr>
  );
}
