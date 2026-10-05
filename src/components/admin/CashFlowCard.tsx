import { Badge, Card } from "@/components/ui";
import { money, shortDate } from "@/lib/format";
import type { CashFlow } from "@/lib/cashflow";

/**
 * Cash flow, direct method.
 *
 * Profit is an opinion; cash is a fact, and the two diverge most
 * violently in exactly this business — a distributor can trade
 * profitably straight into an empty bank account by buying stock and
 * selling it on thirty days. This shows where the money actually went.
 */
export default function CashFlowCard({ cf }: { cf: CashFlow }) {
  const ok = Math.abs(cf.discrepancy) < 0.5;

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-semibold">Cash flow</div>
          <div className="text-xs text-slate mt-0.5">
            {shortDate(cf.from)} to {shortDate(cf.to)} · direct method
          </div>
        </div>
        <Badge tone={cf.netChange >= 0 ? "success" : "danger"}>
          {cf.netChange >= 0 ? "+" : "−"}{money(Math.abs(cf.netChange))}
        </Badge>
      </div>

      <table className="w-full border-collapse">
        <tbody>
          <tr className="border-b border-border">
            <td className="px-5 py-2.5 text-[13px] font-medium">Opening cash and bank</td>
            <td className="px-5 py-2.5 text-right font-mono text-[13px]">{money(cf.opening)}</td>
          </tr>

          {cf.sections.map((s) => (
            <Fragmentish key={s.section} section={s} />
          ))}

          {Math.abs(cf.unclassified) >= 0.005 && (
            <tr className="border-t border-border-soft">
              <td className="px-5 py-2 text-[13px] text-warning">Unclassified movements</td>
              <td className="px-5 py-2 text-right font-mono text-[12.5px] text-warning">{money(cf.unclassified)}</td>
            </tr>
          )}

          <tr className="border-t border-border">
            <td className="px-5 py-2.5 text-[13px] font-medium">Net movement</td>
            <td className={`px-5 py-2.5 text-right font-mono text-[13px] font-medium ${cf.netChange >= 0 ? "text-success" : "text-danger"}`}>
              {money(cf.netChange)}
            </td>
          </tr>
          <tr className="border-t border-ink">
            <td className="px-5 py-2.5 text-[13px] font-semibold">Closing cash and bank</td>
            <td className="px-5 py-2.5 text-right font-mono text-[14px] font-semibold">{money(cf.closing)}</td>
          </tr>
        </tbody>
      </table>

      <div className={`px-5 py-3 border-t text-[11.5px] leading-relaxed ${ok ? "border-border bg-surface-soft text-slate" : "border-danger-bd bg-danger-bg text-danger"}`}>
        {ok ? (
          <>
            Every line is a real movement on cash or the bank, grouped by what the other side of the
            entry was. Opening plus the movements above equals closing, so this cannot disagree with
            the balance sheet.
          </>
        ) : (
          <>
            The sections do not add back to the net movement — out by {money(Math.abs(cf.discrepancy))}.
            That means a cash entry had no identifiable counterparty. Check the day book for the period.
          </>
        )}
      </div>
    </Card>
  );
}

/** A section heading, its lines and its subtotal. */
function Fragmentish({ section: s }: { section: CashFlow["sections"][number] }) {
  if (!s.lines.length) return null;
  return (
    <>
      <tr className="bg-surface-softer border-t border-border">
        <td colSpan={2} className="px-5 py-2 label">{s.label}</td>
      </tr>
      {s.lines.map((l) => (
        <tr key={l.key} className="border-t border-border-soft">
          <td className="px-5 py-2 text-[13px]">
            <span className="font-mono text-[11.5px] text-slate mr-2">{l.key.split(" ")[0]}</span>
            {l.label}
          </td>
          <td className={`px-5 py-2 text-right font-mono text-[12.5px] ${l.amount >= 0 ? "text-success" : ""}`}>
            {money(l.amount)}
          </td>
        </tr>
      ))}
      <tr className="border-t border-border">
        <td className="px-5 py-2 text-[13px] font-medium">Net {s.label.toLowerCase()}</td>
        <td className="px-5 py-2 text-right font-mono text-[13px] font-medium">{money(s.total)}</td>
      </tr>
    </>
  );
}
