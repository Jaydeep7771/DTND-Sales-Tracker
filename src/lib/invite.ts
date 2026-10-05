/** Public URL for an invite token. Plain module so both server actions and pages can import it. */
export function inviteUrlFor(token: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/invite/${token}`;
}

/**
 * How long an invite stays usable.
 *
 * Seven days is long enough for someone to get to it after a weekend and
 * short enough that a forwarded link is not a standing key to the
 * building. Re-issuing is one click, so there is no reason to be generous.
 *
 * Lives here rather than in access-actions because a "use server" module
 * may only export async functions, and this is a constant.
 */
export const INVITE_DAYS = 7;

export function inviteExpiry(now: Date = new Date()): string {
  return new Date(now.getTime() + INVITE_DAYS * 86400e3).toISOString();
}

/**
 * An invite with no expiry recorded predates this rule. Treating those as
 * valid is deliberate: breaking links already sitting in people's inboxes
 * on the day of the upgrade would be a worse failure than a long-lived link.
 */
export function isInviteExpired(expiresAt: string | null | undefined): boolean {
  return !!expiresAt && expiresAt < new Date().toISOString();
}
