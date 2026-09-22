/**
 * Anzeigewährung für Charts und Depot. Eigene, abhängigkeitsfreie Datei (keine Imports), damit sie sowohl von
 * `chart-model.ts` als auch von `hooks.ts` genutzt werden kann, ohne dass sich die beiden gegenseitig importieren.
 */
export type ChartCurrency = 'TRY' | 'USD' | 'EUR';
/** Yahoo-Ticker der Wechselkurse (TRY je 1 Einheit Fremdwährung). */
export const FX_SYMBOL = { USD: 'USDTRY=X', EUR: 'EURTRY=X' } as const;
