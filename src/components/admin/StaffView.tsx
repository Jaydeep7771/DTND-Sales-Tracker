"use client";

/**
 * Staff management.
 *
 * The staff:invite capability has existed since the role system was
 * built and nothing used it, so a finance user could only be created by
 * editing the database. This is that screen.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import CopyLink from "./CopyLink";
import { inviteStaff, reissueInvite, setAccountActive, setStaffRole } from "@/lib/access-actions";
import { ROLE_LABEL } from "@/lib/permissions";
import { shortDateTime } from "@/lib/format";
import type { UserProfile, UserRole } from "@/types/database";

/** Mirrors inviteState in access-actions, for a row already loaded. */
function inviteStateOf(u: UserProfile): { tone: "success" | "info" | "danger" | "warning"; label: string; detail: string } {
  if (!u.is_active) return { tone: "danger", label: "Suspended", detail: u.suspend_reason ?? "" };
  if (u.activated_at) return { tone: "success", label: "Active", detail: `since ${shortDateTime(u.activated_at)}` };
  if (!u.invite_token) return { tone: "warning", label: "No invite", detail: "" };
  if (u.invite_expires_at && u.invite_expires_at < new Date().toISOString()) {
    return { tone: "danger", label: "Invite expired", detail: shortDateTime(u.invite_expires_at) };
  }
  return { tone: "info", label: "Invited", detail: u.invite_expires_at ? `valid to ${shortDateTime(u.invite_expires_at)}` : "" };
}

export default function StaffView({
  staff, meId, canManage,
}: {
  staff: UserProfile[];
  meId: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [inviting, setInviting] = useState(false);
  const [suspending, setSuspending] = useState<UserProfile | null>(null);
  const [reason, setReason] = useState("");
  const [link, setLink] = useState<{ name: string; url: string; sent: boolean } | null>(null);

  function changeRole(user: UserProfile, role: UserRole) {
    start(async () => {
      const res = await setStaffRole(user.id, role);
      if (!res.ok) return toast.push(res.error, "error");
      toast.push(`${user.company_name ?? user.email} is now ${ROLE_LABEL[role].toLowerCase()}`, "success");
      router.refresh();
    });
  }

  function toggleActive(user: UserProfile, active: boolean) {
    if (!active) { setSuspending(user); setReason(""); return; }
    start(async () => {
      const res = await setAccountActive(user.id, true, "");
      if (!res.ok) return toast.push(res.error, "error");
      toast.push(`${user.company_name ?? user.email} can sign in again`, "success");
      router.refresh();
    });
  }

  function confirmSuspend() {
    if (!suspending) return;
    start(async () => {
      const res = await setAccountActive(suspending.id, false, reason);
      if (!res.ok) return toast.push(res.error, "error");
      toast.push(`${suspending.company_name ?? suspending.email} suspended`, "info");
      setSuspending(null);
      router.refresh();
    });
  }

  function resend(user: UserProfile) {
    start(async () => {
      const res = await reissueInvite(user.id);
      if (!res.ok) return toast.push(res.error, "error");
      setLink({ name: user.company_name ?? user.email, url: res.data!.url, sent: res.data!.sent });
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[12.5px] text-slate">
          {staff.filter((s) => s.is_active).length} active · {staff.length} total
        </div>
        {canManage && <Button size="sm" onClick={() => setInviting(true)}>Invite a colleague</Button>}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[680px]">
            <thead>
              <tr className="bg-surface-soft">
                <th className="th px-5">Person</th>
                <th className="th px-3">Role</th>
                <th className="th px-3">Access</th>
                <th className="th th-r px-5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((u) => {
                const state = inviteStateOf(u);
                const isMe = u.id === meId;
                return (
                  <tr key={u.id} className={`border-t border-border-soft ${u.is_active ? "" : "opacity-60"}`}>
                    <td className="px-5 py-3">
                      <div className="text-[13.5px] font-medium">
                        {u.company_name ?? u.email}
                        {isMe && <span className="text-[11px] text-slate ml-2">you</span>}
                      </div>
                      <div className="text-[11.5px] text-slate mt-0.5">{u.email}</div>
                    </td>
                    <td className="px-3 py-3">
                      {canManage && !isMe ? (
                        <Select
                          value={u.role}
                          disabled={busy}
                          onChange={(e) => changeRole(u, e.target.value as UserRole)}
                          className="py-1.5 w-[130px]"
                        >
                          <option value="admin">Admin</option>
                          <option value="finance">Finance</option>
                        </Select>
                      ) : (
                        <span className="text-[13px]">{ROLE_LABEL[u.role]}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={state.tone}>{state.label}</Badge>
                      {state.detail && <div className="text-[11px] text-slate mt-1">{state.detail}</div>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {canManage && !isMe && (
                        <div className="flex items-center justify-end gap-2">
                          {!u.activated_at && u.is_active && (
                            <Button variant="secondary" size="sm" disabled={busy} onClick={() => resend(u)}>
                              {state.label === "Invite expired" ? "New link" : "Resend"}
                            </Button>
                          )}
                          <Button
                            variant={u.is_active ? "destructive" : "secondary"}
                            size="sm"
                            disabled={busy}
                            onClick={() => toggleActive(u, !u.is_active)}
                          >
                            {u.is_active ? "Suspend" : "Restore"}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border bg-surface-soft text-[11.5px] text-slate leading-relaxed">
          Suspending stops the sign-in and ends any open session. It is not the same as a credit hold,
          which only stops a customer ordering. The last active admin cannot be suspended or demoted,
          because somebody has to be able to let people back in.
        </div>
      </Card>

      {inviting && <InviteModal onClose={() => setInviting(false)} onInvited={setLink} />}

      {suspending && (
        <Modal
          title={`Suspend ${suspending.company_name ?? suspending.email}?`}
          sub="They are signed out immediately and cannot sign in again until restored."
          onClose={() => setSuspending(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setSuspending(null)} disabled={busy}>Cancel</Button>
              <Button variant="destructive" onClick={confirmSuspend} disabled={busy || !reason.trim()}>
                {busy ? "Suspending…" : "Suspend access"}
              </Button>
            </>
          }
        >
          <div className="p-5">
            <Field label="Reason">
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Left the company on 3 October." />
            </Field>
            <p className="text-[11.5px] text-slate mt-2.5">
              Kept on the account. It is the only record of why access was removed.
            </p>
          </div>
        </Modal>
      )}

      {link && (
        <Modal
          title={`Invite for ${link.name}`}
          sub={link.sent ? "Emailed to them. The link expires in seven days." : "Email is not configured, so send this link yourself. It expires in seven days."}
          onClose={() => setLink(null)}
          footer={<Button onClick={() => setLink(null)}>Done</Button>}
        >
          <div className="p-5"><CopyLink url={link.url} /></div>
        </Modal>
      )}
    </>
  );
}

function InviteModal({
  onClose, onInvited,
}: {
  onClose: () => void;
  onInvited: (v: { name: string; url: string; sent: boolean }) => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "finance" as UserRole });

  function save() {
    setError(null);
    start(async () => {
      const res = await inviteStaff(form);
      if (!res.ok) return setError(res.error);
      onInvited({ name: form.name, url: res.data!.url, sent: res.data!.sent });
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal
      title="Invite a colleague"
      sub="They set their own password from the link. It expires in seven days."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !form.name.trim() || !form.email.includes("@")}>
            {busy ? "Inviting…" : "Send invite"}
          </Button>
        </>
      }
    >
      <div className="p-5 grid gap-3.5 grid-cols-1 sm:grid-cols-2">
        {error && <p role="alert" className="sm:col-span-2 rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Nadia Aslam" />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </Field>
        <Field label="Role" className="sm:col-span-2">
          <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}>
            <option value="finance">Finance — invoices, payments, ledger and reports</option>
            <option value="admin">Admin — everything, including inviting staff</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
