/** Public URL for an invite token. Plain module so both server actions and pages can import it. */
export function inviteUrlFor(token: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/invite/${token}`;
}
