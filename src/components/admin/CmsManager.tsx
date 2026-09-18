"use client";

// Announcements + FAQ lists with publish toggles and a "New" modal.
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, Textarea, Toggle } from "@/components/ui";
import { createAnnouncement, toggleAnnouncement } from "@/lib/actions";
import { shortDate } from "@/lib/format";
import type { Announcement } from "@/lib/types";

export default function CmsManager({ announcements, faqs }: { announcements: Announcement[]; faqs: Announcement[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [modal, setModal] = useState<"announcement" | "faq" | null>(null);

  function toggle(a: Announcement, on: boolean) {
    start(async () => {
      await toggleAnnouncement(a.id, on);
      router.refresh();
    });
  }

  const meta = (a: Announcement) =>
    a.is_active
      ? `Banner · priority ${a.priority} · ${a.expires_at ? "expires " + shortDate(a.expires_at) : "no expiry"}`
      : "Draft · not published";

  return (
    <div className="flex flex-col gap-4 max-w-[880px]">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-.01em]">CMS manager</h1>
        <div className="text-[13px] text-slate mt-1">Content published here appears instantly in the customer portal.</div>
      </div>

      <Card>
        <CardHeader title="Announcements" sub="Shown as the portal banner, highest priority first." action={<Button size="sm" onClick={() => setModal("announcement")}>+ New</Button>} />
        {announcements.map((a) => (
          <div key={a.id} className="px-4 py-[13px] border-b border-border-soft flex items-center gap-3.5">
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium">{a.title}</div>
              <div className="text-[11.5px] text-slate mt-0.5">{meta(a)}</div>
            </div>
            <Badge tone={a.is_active ? "success" : "danger"}>{a.is_active ? "Live" : "Off"}</Badge>
            <Toggle on={a.is_active} onChange={(v) => toggle(a, v)} label={`Publish ${a.title}`} />
          </div>
        ))}
      </Card>

      <Card>
        <CardHeader title="FAQ entries" sub="Toggle visibility on the portal help drawer." action={<Button variant="secondary" size="sm" onClick={() => setModal("faq")}>+ New FAQ</Button>} />
        {faqs.map((f, i) => (
          <div key={f.id} className="px-4 py-[13px] border-b border-border-soft flex items-center gap-3.5">
            <span className="font-mono text-[11px] text-muted shrink-0">{String(i + 1).padStart(2, "0")}</span>
            <div className="min-w-0 flex-1 text-[13.5px] font-medium">{f.title}</div>
            <Toggle on={f.is_active} onChange={(v) => toggle(f, v)} label={`Show ${f.title}`} />
          </div>
        ))}
      </Card>

      {modal && <NewEntryModal type={modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function NewEntryModal({ type, onClose }: { type: "announcement" | "faq"; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await createAnnouncement({ title, content, type });
      if (!res.ok) return setError(res.error);
      router.refresh();
      onClose();
    });
  }

  const isFaq = type === "faq";
  return (
    <Modal
      title={isFaq ? "New FAQ entry" : "New announcement"}
      sub={isFaq ? "Question and answer shown in the portal help drawer." : "Published immediately as the portal banner."}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="new-entry" disabled={busy}>{busy ? "Publishing…" : "Publish"}</Button>
        </>
      }
    >
      <form id="new-entry" onSubmit={submit} className="p-5 flex flex-col gap-3.5">
        {error && <p className="rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Field label={isFaq ? "Question" : "Title"}><Input required value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label={isFaq ? "Answer" : "Message"}><Textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
