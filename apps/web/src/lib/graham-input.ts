import type { Fundamentals, GrahamInput, Market } from '@aktien/core';
import type { GrahamManual } from './graham-store';

export type GrahamMissing = 'years' | 'shares' | 'netDebt';

export interface GrahamMerged {
  /** `null`, solange Pflichtangaben fehlen (dann zeigt die App die Eingabemaske mit Hinweis). */
  input: GrahamInput | null;
  missing: GrahamMissing[];
  /** true, wenn mindestens ein Wert von Hand überschrieben wurde. */
  usesManual: boolean;
}

/**
 * Führt automatisch geladene Bilanzdaten und eigene Eingaben zur Eingabe der Bewertung zusammen. Eine eigene
 * Jahresreihe ersetzt die automatische vollständig, damit nie Jahre verschiedener Quellen vermischt werden.
 */
export function mergeGrahamInput(auto: Fundamentals | undefined, manual: GrahamManual | undefined, ctx: { market: Market; price: number; currentYear?: number }): GrahamMerged {
  const currentYear = ctx.currentYear ?? new Date().getFullYear();
  const avgUsdTry = auto?.avgUsdTry ?? {};

  const years = manual?.years
    ? manual.years.map((y) => ({ ...y, avgFx: y.avgFx ?? avgUsdTry[y.year] ?? null }))
    : (auto?.years ?? []).map((y) => ({ year: y.year, netIncome: y.netIncome, ebit: y.ebit, avgFx: y.avgFx }));
  const shares = manual?.shares ?? auto?.shares ?? null;
  const netDebt = manual?.netDebt ?? auto?.netDebt ?? null;

  const missing: GrahamMissing[] = [];
  if (years.length === 0) missing.push('years');
  if (shares === null) missing.push('shares');
  if (netDebt === null) missing.push('netDebt');
  const usesManual = manual !== undefined && Object.keys(manual).length > 0;
  if (missing.length > 0) return { input: null, missing, usesManual };

  return {
    input: {
      market: ctx.market,
      price: ctx.price,
      shares: shares as number,
      netDebt: netDebt as number,
      reportingCurrency: manual?.reportingCurrency ?? auto?.reportingCurrency ?? 'TRY',
      years,
      currentFx: manual?.currentFx ?? auto?.currentFx ?? null,
      dividendYears: manual?.dividendYears ?? auto?.dividends ?? [],
      dividendCoverageFromYear: manual?.dividendYears ? currentYear - 10 : (auto?.dividendCoverageFromYear ?? null),
      ttmEps: manual?.ttmEps ?? null,
      currentYear,
    },
    missing,
    usesManual,
  };
}
