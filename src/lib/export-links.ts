/**
 * Builds a link to the export route.
 *
 * A plain module, not a server action, so both server and client
 * components can build the same URL and there is one place that knows
 * the parameter names.
 */
export function exportHref(
  kind: string,
  q: { from?: string; to?: string; month?: string; customer?: string } = {},
): string {
  const p = new URLSearchParams();
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  if (q.month) p.set("month", q.month);
  if (q.customer) p.set("customer", q.customer);
  const qs = p.toString();
  return `/api/export/${kind}${qs ? `?${qs}` : ""}`;
}
