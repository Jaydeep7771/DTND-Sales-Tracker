/**
 * Currency and number formatting, driven by company settings.
 *
 * The configuration is module level rather than a React context, which is
 * deliberate: there is exactly one company, so the currency is a process
 * wide constant rather than per request state. That keeps `money()` a
 * plain synchronous call, so the hundred or so existing call sites in
 * server and client components need no change.
 *
 * Both layouts render <FormatBootstrap> above everything else, which
 * applies the stored settings on the server and again in the browser
 * before any child renders.
 */

export interface CurrencyConfig {
  /** ISO code stored on documents, e.g. PKR. */
  code: string;
  /** What prints, e.g. "Rs" or "₨". */
  symbol: string;
  display: "code" | "symbol";
  decimals: number;
  /** en-US groups 1,234,567; en-IN groups 12,34,567 (lakh/crore). */
  locale: string;
}

export const CURRENCIES: { code: string; symbol: string; name: string }[] = [
  { code: "PKR", symbol: "Rs", name: "Pakistani rupee" },
  { code: "USD", symbol: "$", name: "US dollar" },
  { code: "AED", symbol: "د.إ", name: "UAE dirham" },
  { code: "SAR", symbol: "﷼", name: "Saudi riyal" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "Pound sterling" },
  { code: "INR", symbol: "₹", name: "Indian rupee" },
  { code: "CNY", symbol: "¥", name: "Chinese yuan" },
];

const DEFAULTS: CurrencyConfig = { code: "PKR", symbol: "Rs", display: "code", decimals: 0, locale: "en-US" };
let config: CurrencyConfig = { ...DEFAULTS };

export function configureCurrency(next: Partial<CurrencyConfig>): void {
  config = { ...config, ...next };
}

export function currencyConfig(): CurrencyConfig {
  return config;
}

/** The prefix shown before an amount. */
export function currencyPrefix(c: CurrencyConfig = config): string {
  return c.display === "symbol" ? c.symbol : c.code;
}

/** "PKR 213,816" or "Rs 2,13,816.00", depending on settings. */
export function money(n: number, overrides?: Partial<CurrencyConfig>): string {
  const c = overrides ? { ...config, ...overrides } : config;
  return `${currencyPrefix(c)} ${amount(n, c)}`;
}

/** The number alone, grouped and rounded to the configured precision. */
export function amount(n: number, c: CurrencyConfig = config): string {
  return n.toLocaleString(c.locale, {
    minimumFractionDigits: c.decimals,
    maximumFractionDigits: c.decimals,
  });
}

/** Plain integer grouping for quantities and counts. */
export function num(n: number): string {
  return n.toLocaleString(config.locale);
}

/** Maps a settings row onto the formatter's shape. */
export function currencyFromSettings(s: {
  currency_code?: string | null;
  currency_symbol?: string | null;
  currency_display?: string | null;
  decimal_places?: number | null;
  number_locale?: string | null;
}): CurrencyConfig {
  return {
    code: s.currency_code || DEFAULTS.code,
    symbol: s.currency_symbol || DEFAULTS.symbol,
    display: s.currency_display === "symbol" ? "symbol" : "code",
    decimals: s.decimal_places ?? DEFAULTS.decimals,
    locale: s.number_locale || DEFAULTS.locale,
  };
}

// ---------------------------------------------------------------- tax
/**
 * The tax rate and its wording, configured the same way and for the same
 * reason. Until now the cart multiplied by a hardcoded 5% while invoices
 * used the 18% company setting, so one order showed two different tax
 * figures depending on the screen. There is one rate, and it lives in
 * settings.
 */
export interface TaxConfig {
  /** Fraction, e.g. 0.18 for 18%. */
  rate: number;
  /** "Sales Tax", "GST", "VAT". */
  label: string;
}

let tax: TaxConfig = { rate: 0.18, label: "Sales Tax" };

export function configureTax(next: Partial<TaxConfig>): void {
  tax = { ...tax, ...next };
}

export function taxConfig(): TaxConfig {
  return tax;
}

/** "Sales Tax 18%" — the label as it should be printed next to an amount. */
export function taxLabel(c: TaxConfig = tax): string {
  return `${c.label} ${percent(c.rate)}`;
}

/** 0.18 -> "18%", 0.175 -> "17.5%" */
export function percent(rate: number): string {
  const p = rate * 100;
  return `${Number.isInteger(p) ? p : Number(p.toFixed(2))}%`;
}
