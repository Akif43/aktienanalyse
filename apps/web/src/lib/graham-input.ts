import type { Fundamentals, GrahamInput, Market } from '@aktien/core';
import type { GrahamManual } from './graham-store';

export type GrahamMissing = 'years' | 'shares' | 'netDebt';

export interface GrahamMerged {
  /** `null`, solange Pflichtangaben fehlen (dann zeigt die App die Eingabemaske mit Hinweis). */
  input: GrahamInput | null;
  missing: GrahamMissing[];
  /** true, wenn mindestens ein Wert von Hand überschrieben wurde. */
  usesManual: boolean;
  /** true, wenn eigene Jahre mit automatischen Jahren einer Quelle gemischt werden (mögliche Unterschiede der Rechnungsbasis). */
  mixedSeries: boolean;
}

/** Die gültige Jahresreihe: eigene Jahre überlagern die automatischen, fehlende Jahresschnittskurse kommen aus der Quelle. */
export function overlayYears(auto: Fundamentals | undefined, manual: GrahamManual | undefined): GrahamInput['years'][number][] {
  const avgUsdTry = auto?.avgUsdTry ?? {};
  const byYear = new Map<number, GrahamInput['years'][number]>();
  for (const y of auto?.years ?? []) byYear.set(y.year, { year: y.year, netIncome: y.netIncome, ebit: y.ebit, avgFx: y.avgFx });
  for (const y of manual?.years ?? []) byYear.set(y.year, { ...y, avgFx: y.avgFx ?? avgUsdTry[y.year] ?? null });
  return [...byYear.values()].sort((x, y) => x.year - y.year);
}

/**
 * Führt automatisch geladene Bilanzdaten und eigene Eingaben zur Eingabe der Bewertung zusammen. Eigene Jahre
 * überlagern die automatische Reihe jahresweise: für ein Jahr gewinnt der eigene Wert, die übrigen bleiben automatisch.
 * Die automatischen Jahre selbst stammen weiterhin immer aus genau einer Quelle.
 */
export function mergeGrahamInput(auto: Fundamentals | undefined, manual: GrahamManual | undefined, ctx: { market: Market; price: number; currentYear?: number }): GrahamMerged {
  const currentYear = ctx.currentYear ?? new Date().getFullYear();

  const years = overlayYears(auto, manual);
  const manualYears = new Set((manual?.years ?? []).map((y) => y.year));
  const mixedSeries = manualYears.size > 0 && (auto?.years ?? []).some((y) => !manualYears.has(y.year));
  const shares = manual?.shares ?? auto?.shares ?? null;
  const netDebt = manual?.netDebt ?? auto?.netDebt ?? null;

  const missing: GrahamMissing[] = [];
  if (years.length === 0) missing.push('years');
  if (shares === null) missing.push('shares');
  if (netDebt === null) missing.push('netDebt');
  const usesManual = manual !== undefined && Object.keys(manual).length > 0;
  if (missing.length > 0) return { input: null, missing, usesManual, mixedSeries };

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
    mixedSeries,
  };
}
