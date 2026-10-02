"use client";

/**
 * Applies the company's currency settings to the formatter.
 *
 * Rendered as the first child of each layout. React renders a parent
 * before its children, so by the time any screen calls `money()` the
 * configuration is already in place — on the server during the initial
 * render and again in the browser after hydration. No effect is involved,
 * so there is no flash of the wrong currency.
 */
import { configureCurrency, configureTax, type CurrencyConfig, type TaxConfig } from "@/lib/money";

export default function FormatBootstrap({ currency, tax }: { currency: CurrencyConfig; tax: TaxConfig }) {
  configureCurrency(currency);
  configureTax(tax);
  return null;
}
