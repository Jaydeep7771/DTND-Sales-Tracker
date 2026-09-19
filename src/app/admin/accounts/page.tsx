import { Badge, Card, PageHeading } from "@/components/ui";
import { getCompanySettings, getTrialBalance } from "@/lib/data";
import { requirePage } from "@/lib/guard";
import { ACCOUNT_TYPE_LABEL, POSTING_RULES, isDebitNormal, type AccountType } from "@/lib/accounting";
import { money } from "@/lib/format";

const ORDER: AccountType[] = ["asset", "liability", "equity", "income", "expense"];

export default async function AccountsPage() {
  await requirePage("ledger:read");
  const [accounts, settings] = await Promise.all([getTrialBalance(), getCompanySettings()]);

  const totalDebit = accounts.reduce((a, x) => a + x.total_debit, 0);
  const totalCredit = accounts.reduce((a, x) => a + x.total_credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005;

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        title="Chart of accounts"
        sub={`${accounts.filter((a) => !a.is_group).length} postable accounts · fiscal year starts in month ${settings.fiscal_year_start_month}`}
        actions={
          <Badge tone={balanced ? "success" : "danger"}>
            {balanced ? "Ledger in balance" : "Out of balance"}
          </Badge>
        }
      />

      <div className="grid gap-5 items-start grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[620px]">
              <thead>
                <tr className="bg-surface-soft">
                  <th className="th px-5">Code</th>
                  <th className="th px-5">Account</th>
                  <th className="th th-r px-5">Debit</th>
                  <th className="th th-r px-5">Credit</th>
                  <th className="th th-r px-5">Balance</th>
                </tr>
              </thead>
              <tbody>
                {ORDER.map((type) => {
                  const rows = accounts.filter((a) => a.type === type);
                  if (rows.length === 0) return null;
                  const subtotal = rows.reduce((a, x) => a + x.balance, 0);
                  return (
                    <tr key={type} className="align-top">
                      <td colSpan={5} className="p-0">
                        <table className="w-full border-collapse">
                          <tbody>
                            <tr className="border-t border-border bg-surface-softer">
                              <td colSpan={4} className="px-5 py-2 label">{ACCOUNT_TYPE_LABEL[type]}</td>
                              <td className="px-5 py-2 text-right font-mono text-[12px] text-slate">{money(subtotal)}</td>
                            </tr>
                            {rows.map((a) => (
                              <tr key={a.id} className={`border-t border-border-soft ${a.is_group ? "bg-surface-soft" : ""}`}>
                                <td className="px-5 py-2 font-mono text-[12px] text-slate whitespace-nowrap">{a.code}</td>
                                <td className={`px-5 py-2 text-[13px] ${a.is_group ? "font-semibold" : "pl-9"}`}>
                                  {a.name}
                                  {a.system_key && <span className="ml-2 font-mono text-[10px] text-muted">{a.system_key}</span>}
                                </td>
                                <td className="px-5 py-2 text-right font-mono text-[12.5px] text-slate-strong whitespace-nowrap">{a.total_debit ? money(a.total_debit) : ""}</td>
                                <td className="px-5 py-2 text-right font-mono text-[12.5px] text-slate-strong whitespace-nowrap">{a.total_credit ? money(a.total_credit) : ""}</td>
                                <td className="px-5 py-2 text-right font-mono text-[12.5px] font-medium whitespace-nowrap">{a.balance ? money(a.balance) : ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-border bg-surface-soft flex justify-end gap-8 text-[13px]">
            <span className="text-slate">Total debits <span className="font-mono text-ink ml-2">{money(totalDebit)}</span></span>
            <span className="text-slate">Total credits <span className="font-mono text-ink ml-2">{money(totalCredit)}</span></span>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-[18px]">
            <div className="label mb-2.5">Posting rules</div>
            <div className="text-[12.5px] text-slate mb-3 leading-[1.5]">
              Every document posts one balanced entry using these rules. Ask your accountant to confirm them before we build on top.
            </div>
            <div className="flex flex-col gap-2.5">
              {POSTING_RULES.map((r) => (
                <div key={r.event} className="border border-border-soft rounded-lg p-2.5 bg-surface-softer">
                  <div className="text-[12.5px] font-semibold">{r.event}</div>
                  <div className="text-[11.5px] text-slate mt-1">
                    <span className="text-success font-medium">Dr</span> {r.debit.join(", ")}
                  </div>
                  <div className="text-[11.5px] text-slate">
                    <span className="text-info font-medium">Cr</span> {r.credit.join(", ")}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-[18px]">
            <div className="label mb-2">Ledger rules</div>
            <ul className="text-[12.5px] text-slate-strong leading-[1.6] flex flex-col gap-1.5 list-disc pl-4">
              <li>Entries are append-only. Corrections post a reversing entry.</li>
              <li>Debits must equal credits, enforced by the database.</li>
              <li>Closing a period blocks any further posting into it.</li>
              <li>Accounts marked {ORDER.filter(isDebitNormal).map((t) => ACCOUNT_TYPE_LABEL[t]).join(" and ").toLowerCase()} are debit-normal.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
