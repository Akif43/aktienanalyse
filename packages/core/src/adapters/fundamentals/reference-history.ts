/**
 * Fest hinterlegte ältere Jahresgewinne für Unternehmen, bei denen keine automatische Quelle mehr als die 4 Jahre von
 * Yahoo liefert: BIST-Unternehmen, die in US-Dollar berichten (İş Yatırım liefert dort nur in Lira umgerechnete, um
 * 12 bis 31 % abweichende Zahlen). Die Werte stammen aus den offiziellen Jahresberichten der Unternehmen (IFRS, USD),
 * abgeschlossene Jahre ändern sich nicht. Neuere Jahre kommen weiter automatisch von Yahoo; ein hier hinterlegtes
 * Jahr wird nur genutzt, wenn Yahoo es nicht (mehr) liefert.
 */
export interface ReferenceYear {
  year: number;
  /** Jahresüberschuss in US-Dollar. */
  netIncome: number;
  /** Betriebsergebnis ("Operating Profit") in US-Dollar. */
  ebit: number;
}

export interface ReferenceHistory {
  source: string;
  years: ReferenceYear[];
}

const M = 1_000_000;

export const USD_REPORTER_HISTORY: Record<string, ReferenceHistory> = {
  THYAO: {
    source: 'Türk Hava Yolları, Jahresberichte 2017/2019/2021 (USD, IFRS)',
    years: [
      { year: 2016, netIncome: -77 * M, ebit: -130 * M },
      { year: 2017, netIncome: 223 * M, ebit: 1301 * M },
      { year: 2018, netIncome: 753 * M, ebit: 1413 * M },
      { year: 2019, netIncome: 788 * M, ebit: 1047 * M },
      { year: 2020, netIncome: -836 * M, ebit: -163 * M },
      { year: 2021, netIncome: 959 * M, ebit: 1689 * M },
    ],
  },
};

/** Hinterlegte Jahre, die vor `beforeYear` liegen (also nicht von der automatischen Reihe abgedeckt sind). */
export function referenceYearsBefore(symbol: string, beforeYear: number): { source: string; years: ReferenceYear[] } | null {
  const ref = USD_REPORTER_HISTORY[symbol.toUpperCase()];
  if (!ref) return null;
  const years = ref.years.filter((y) => y.year < beforeYear);
  return years.length > 0 ? { source: ref.source, years } : null;
}
