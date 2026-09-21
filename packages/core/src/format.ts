import type { Freshness, Quote } from './types';

/** Beschriftung des Aktualitäts-Badges in der UI. */
export function freshnessLabel(freshness: Freshness): string {
  switch (freshness.kind) {
    case 'realtime':
      return 'Echtzeit';
    case 'delayed':
      return `verzögert (ca. ${freshness.minutes} Min.)`;
    case 'eod':
      return 'Tagesschlusskurs (kein Live-Kurs)';
  }
}

export type MarketState = 'open' | 'closed' | 'unknown';

/**
 * Schätzt, ob die Börse gerade handelt, aus Sitzungsfenster und Alter des letzten Kurses.
 * Das fängt auch Feiertage ab (Sitzungsfenster gilt, aber es kommen keine neuen Kurse). Kurz nach
 * Handelsbeginn steht der letzte Kurs noch vom Vortag, dafür gilt eine Karenzzeit (Verzögerung + 30 Min.).
 * Ohne Sitzungsfenster (z. B. Tagesschlusskurse) lautet die Antwort "unknown".
 */
export function marketState(
  quote: Pick<Quote, 'session' | 'asOf' | 'freshness'>,
  nowMs: number = Date.now(),
): MarketState {
  const { session } = quote;
  if (!session || quote.freshness.kind === 'eod') return 'unknown';
  const nowS = nowMs / 1000;
  if (nowS < session.start || nowS > session.end) return 'closed';
  const delayMin = quote.freshness.kind === 'delayed' ? quote.freshness.minutes : 0;
  const toleranceS = (delayMin + 30) * 60;
  return nowS - quote.asOf <= toleranceS || nowS - session.start <= toleranceS ? 'open' : 'closed';
}
