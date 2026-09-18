// Transactional email. Sends through Resend when RESEND_API_KEY is set
// (works in demo mode too); otherwise returns the rendered message so the
// admin can still see and copy what the customer would have received.
import "server-only";

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  sent: boolean;
  reason?: string; // why it was not sent
}

const BRAND = "Dynamic Traders & Distributors";

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Invite email sent when an admin onboards a customer. */
export function inviteEmail(input: { to: string; company: string; inviteUrl: string; adminName: string }): Email {
  const company = escape(input.company);
  const subject = `${input.company}, your ${BRAND} wholesale account is ready`;

  const text = `Hello ${input.company},

Welcome to the ${BRAND} wholesale portal. I've set up an account for your business so you can order directly from our live catalog, track every order from approval to delivery, and message us on any order if something needs adjusting.

Activate your account and choose a password here (the link is single-use):
${input.inviteUrl}

Once you're in you can:
  - Browse the full catalog with live stock and your wholesale prices
  - Add items to your cart and submit an order for approval
  - Follow each order's status and reply to us directly on the order
  - See your complete order history

Orders are usually reviewed within 2 business hours (09:00 to 18:00). If anything in an order can't be fulfilled as requested, we'll send it back to you with a note and a proposed change rather than rejecting it outright, so you always stay in control.

If you have any trouble with the link, just reply to this email and I'll sort it out.

Kind regards,
${input.adminName}
Operations, ${BRAND}

This invitation was sent to ${input.to}. If you weren't expecting it, you can ignore this email.`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f6f9;font-family:'IBM Plex Sans',Helvetica,Arial,sans-serif;color:#0f1b2b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
        <tr><td style="background:#12263c;padding:20px 28px">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:34px;height:34px;background:#2f7dd1;border-radius:8px;color:#fff;font-family:'IBM Plex Mono',Menlo,monospace;font-weight:600;font-size:14px;text-align:center;vertical-align:middle">DT</td>
            <td style="padding-left:12px;color:#ffffff;font-size:15px;font-weight:600;line-height:1.2">${BRAND}<br><span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#7e9ab8;font-weight:600">Wholesale portal</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:28px 28px 8px">
          <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;letter-spacing:-.01em">Welcome, ${company}</h1>
          <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#334155">I've set up a wholesale account for your business. From the portal you can order straight from our live catalog, track every order from approval to delivery, and message us on any order if something needs adjusting.</p>
          <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#334155">Activate your account and choose a password using the button below. The link is single-use.</p>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#123a5e;border-radius:8px">
            <a href="${input.inviteUrl}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none">Activate your account</a>
          </td></tr></table>
          <p style="margin:14px 0 0;font-size:12px;color:#64748b;line-height:1.5">Or paste this link into your browser:<br><a href="${input.inviteUrl}" style="color:#1c5488;font-family:'IBM Plex Mono',Menlo,monospace;font-size:11.5px;word-break:break-all">${input.inviteUrl}</a></p>
        </td></tr>
        <tr><td style="padding:20px 28px 8px">
          <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;font-weight:600;margin-bottom:10px">Once you're in</div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:13.5px;line-height:1.55;color:#334155">
            <tr><td style="padding:3px 10px 3px 0;color:#2f7dd1">&#9679;</td><td>Browse the full catalog with live stock and your wholesale prices</td></tr>
            <tr><td style="padding:3px 10px 3px 0;color:#2f7dd1">&#9679;</td><td>Add items to your cart and submit an order for approval</td></tr>
            <tr><td style="padding:3px 10px 3px 0;color:#2f7dd1">&#9679;</td><td>Follow each order's status and reply to us directly on the order</td></tr>
            <tr><td style="padding:3px 10px 3px 0;color:#2f7dd1">&#9679;</td><td>See your complete order history</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:16px 28px 26px">
          <div style="background:#f1f6fc;border:1px solid #d7e5f5;border-radius:8px;padding:12px 14px;font-size:12.5px;line-height:1.55;color:#1c5488">Orders are usually reviewed within 2 business hours (09:00 to 18:00). If part of an order can't be fulfilled as requested, we'll send it back with a note and a proposed change rather than rejecting it, so you always stay in control.</div>
          <p style="margin:18px 0 0;font-size:13.5px;line-height:1.6;color:#334155">If you have any trouble with the link, just reply to this email and I'll sort it out.</p>
          <p style="margin:14px 0 0;font-size:13.5px;line-height:1.5;color:#0f1b2b">Kind regards,<br><strong>${escape(input.adminName)}</strong><br><span style="color:#64748b">Operations, ${BRAND}</span></p>
        </td></tr>
        <tr><td style="background:#fcfdfe;border-top:1px solid #e2e8f0;padding:14px 28px;font-size:11px;color:#94a3b8;line-height:1.5">This invitation was sent to ${escape(input.to)}. If you weren't expecting it, you can ignore this email.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { to: input.to, subject, html, text };
}

export async function sendEmail(email: Email): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "RESEND_API_KEY is not set, so no email was sent. Share the link manually." };
  try {
    const { Resend } = await import("resend");
    const { error } = await new Resend(key).emails.send({
      from: process.env.EMAIL_FROM ?? "Dynamic Traders <onboarding@resend.dev>",
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    if (error) return { sent: false, reason: error.message };
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : "Email provider error." };
  }
}
