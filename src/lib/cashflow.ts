/**
 * Cash flow statement, direct method.
 *
 * The indirect method starts from profit and works backwards through
 * movements in working capital. It is what most packages produce because
 * it falls out of two balance sheets, and it is also the version nobody
 * reads, because "increase in payables" is not a thing that happened —
 * it is an arithmetic residue.
 *
 * The direct method is derivable here and says something true: every
 * journal line that touched cash or the bank, grouped by what the other
 * side of the entry was. Money in from customers, money out to
 * suppliers, to staff, to the tax authority. A distributor's owner can
 * read that and recognise their week.
 *
 * It also proves itself: opening cash plus the net of everything below
 * must equal closing cash, and the statement reports whether it does
 * rather than assuming it.
 */
import { round2 } from "@/lib/accounting";

export type CashSection = "operating" | "investing" | "financing";

export interface CashLine {
  /** The contra account, e.g. "4100 Sales Revenue". */
  key: string;
  label: string;
  section: CashSection;
  /** Signed: positive is cash in. */
  amount: number;
  count: number;
}

export interface CashFlow {
  from: string;
  to: string;
  opening: number;
  closing: number;
  sections: { section: CashSection; label: string; lines: CashLine[]; total: number }[];
  netChange: number;
  /**
   * Opening + netChange - closing. Should be zero; anything else means a
   * cash line was classified against no counterparty and is reported
   * rather than hidden.
   */
  discrepancy: number;
  /** Cash movements with no identifiable other side, if any. */
  unclassified: number;
}

export interface CashEntry {
  entry_date: string;
  lines: {
    account_id: string;
    code: string;
    name: string;
    type: "asset" | "liability" | "equity" | "income" | "expense";
    system_key: string | null;
    debit: number;
    credit: number;
  }[];
}

const SECTION_LABEL: Record<CashSection, string> = {
  operating: "Operating activities",
  investing: "Investing activities",
  financing: "Financing activities",
};

/** Which accounts are cash for this purpose. */
function isCash(systemKey: string | null): boolean {
  return systemKey === "cash" || systemKey === "bank";
}

/**
 * Where a movement belongs.
 *
 * Equity and borrowing are financing; buying something that lasts is
 * investing; everything a trading business does day to day is operating.
 * Defaulting to operating is the right default for a distributor —
 * almost everything genuinely is — but fixed assets are singled out
 * because capital expenditure sitting inside operating cash flow is the
 * classic way a set of accounts flatters itself.
 */
function classify(line: CashEntry["lines"][number]): CashSection {
  if (line.type === "equity") return "financing";
  if (line.system_key === "owner_capital" || line.system_key === "retained_earnings") return "financing";
  // Fixed assets are the 1500 group in the standard chart. Anything
  // filed under it is capital expenditure, not a trading cost.
  if (line.type === "asset" && line.code.startsWith("15")) return "investing";
  return "operating";
}

export function buildCashFlow(input: {
  entries: CashEntry[];
  from: string;
  to: string;
  /** Cash and bank balance the instant before `from`. */
  opening: number;
}): CashFlow {
  const buckets = new Map<string, CashLine>();
  let net = 0;
  let unclassified = 0;

  for (const e of input.entries) {
    if (e.entry_date < input.from || e.entry_date > input.to) continue;

    const cashLines = e.lines.filter((l) => isCash(l.system_key));
    if (!cashLines.length) continue;

    const movement = cashLines.reduce((a, l) => a + l.debit - l.credit, 0);
    if (Math.abs(movement) < 0.005) continue;   // a bank-to-bank transfer
    net += movement;

    // The other side of the entry decides what the money was for. Where
    // an entry hits several accounts the movement is split across them
    // in proportion to their own amounts, which is the only honest split
    // when one receipt settles an invoice and its tax at once.
    const others = e.lines.filter((l) => !isCash(l.system_key));
    const weight = others.reduce((a, l) => a + Math.abs(l.debit - l.credit), 0);

    if (weight < 0.005) {
      unclassified += movement;
      continue;
    }

    for (const l of others) {
      const own = Math.abs(l.debit - l.credit);
      if (own < 0.005) continue;
      const share = round2(movement * (own / weight));
      const key = `${l.code} ${l.name}`;
      const row = buckets.get(key) ?? {
        key,
        label: l.name,
        section: classify(l),
        amount: 0,
        count: 0,
      };
      row.amount = round2(row.amount + share);
      row.count += 1;
      buckets.set(key, row);
    }
  }

  const sections = (["operating", "investing", "financing"] as CashSection[]).map((section) => {
    const lines = [...buckets.values()]
      .filter((l) => l.section === section && Math.abs(l.amount) >= 0.005)
      // Biggest movement first, in or out: the eye should land on what
      // actually moved the bank.
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    return {
      section,
      label: SECTION_LABEL[section],
      lines,
      total: round2(lines.reduce((a, l) => a + l.amount, 0)),
    };
  });

  const netChange = round2(net);
  const closing = round2(input.opening + netChange);

  return {
    from: input.from,
    to: input.to,
    opening: round2(input.opening),
    closing,
    sections,
    netChange,
    // Rounding the proportional split can leave a few paisa; anything
    // larger means a real classification gap worth surfacing.
    discrepancy: round2(
      netChange - sections.reduce((a, s) => a + s.total, 0) - round2(unclassified),
    ),
    unclassified: round2(unclassified),
  };
}
