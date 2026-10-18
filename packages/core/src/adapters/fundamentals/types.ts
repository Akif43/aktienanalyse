import type { Market } from '../../types';

export interface FundamentalsYear {
  year: number;
  /** Jahresüberschuss (Anteil der Muttergesellschaft) in `Fundamentals.reportingCurrency`. */
  netIncome: number;
  /** Operatives Ergebnis in derselben Währung, falls geliefert. */
  ebit: number | null;
  /** Jahresdurchschnitt Lira je USD (nur BIST). */
  avgFx: number | null;
}

export type FundamentalsWarning =
  | { code: 'usdReporter' }
  | { code: 'sourceFallback'; reason: string }
  | { code: 'noStatements' }
  | { code: 'missingFx' }
  /** US-Aktie, aber `SEC_CONTACT` fehlt: EDGAR (bis zu 12 Jahre) wird übersprungen, es bleiben Yahoos 4 Jahre. */
  | { code: 'secNotConfigured' }
  /** EDGAR war nicht erreichbar oder lieferte unbrauchbare Daten: Ersatzreihe aus Yahoo. */
  | { code: 'edgarFallback'; reason: string }
  /** Ältere Jahre (`from` bis `to`) sind aus den Jahresberichten des Unternehmens fest hinterlegt (USD-Berichter, bei denen keine Quelle mehr als 4 Jahre liefert). */
  | { code: 'referenceHistory'; from: number; to: number; source: string };

/** Bilanzdaten für die Graham-Bewertung. Eine Reihe stammt immer aus genau einer Quelle (nie gemischt). */
export interface Fundamentals {
  market: Market;
  source: 'yahoo' | 'isyatirim' | 'edgar';
  /** Währung der Werte in `years` (bei US/XETRA nur Anzeige, dort wird nicht umgerechnet). */
  reportingCurrency: 'TRY' | 'USD';
  years: FundamentalsYear[];
  /** Aktienzahl (aktuell). */
  shares: number | null;
  /** Nettoverschuldung in Kurswährung (Schulden minus liquide Mittel), negativ = Nettoguthaben. */
  netDebt: number | null;
  /** Eigenkapital (Mutter) in Kurswährung. */
  equity: number | null;
  dividends: { year: number; amount: number }[];
  /** Ab welchem Jahr die Dividendendaten vollständig vorliegen. */
  dividendCoverageFromYear: number | null;
  /** Aktueller Kurs Lira je USD (nur BIST). */
  currentFx: number | null;
  /** Jahresdurchschnitt Lira je USD für alle Jahre seit 2005 (zum Vorbefüllen eigener Jahre in der Maske). */
  avgUsdTry: Record<number, number>;
  warnings: FundamentalsWarning[];
}
