import { exportHref } from "@/lib/export-links";

/**
 * Download links for whatever is on the screen.
 *
 * Plain anchors rather than buttons and a fetch: the browser's own
 * download handling is better than anything reimplemented here, the
 * links work with middle-click and copy-link, and there is no spinner
 * state to get wrong.
 */
export default function ExportBar({
  from, to, kinds, month, customer,
}: {
  from?: string;
  to?: string;
  month?: string;
  customer?: string;
  kinds: [string, string][];
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="label">Export</span>
      {kinds.map(([kind, label]) => (
        <a
          key={kind}
          href={exportHref(kind, { from, to, month, customer })}
          className="text-[12.5px] rounded-full px-3 py-1.5 border border-border bg-surface text-slate-dark no-underline hover:border-accent hover:text-navy-hover"
        >
          {label}
        </a>
      ))}
      <span className="text-[11.5px] text-muted">CSV · opens in Excel</span>
    </div>
  );
}
