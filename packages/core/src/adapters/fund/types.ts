/**
 * Türkische Investment- und Rentenfonds (TEFAS – Türkiye Elektronik Fon Alım Satım Platformu). Fonds sind eine eigene
 * Anlageklasse, kein Aktienmarkt: ein Fonds hat nur einen Nettoinventarwert pro Tag (keine Kerzen, kein Live-Kurs,
 * keine offenen/hohen/tiefen Tageswerte), dafür eine Zusammensetzung aus mehreren Anlagen. Deshalb ein eigenes,
 * bewusst einfaches Modell statt einer Erweiterung von `Instrument`/`Quote` (keine Kerzen-Analyse, keine KI-Auswertung).
 */

/** Ein Fonds-Kürzel bei TEFAS, z. B. "AFT", "YAY". Immer in Großbuchstaben. */
export type FundCode = string;

export interface FundSearchResult {
  code: FundCode;
  name: string;
}

export interface Fund {
  code: FundCode;
  name: string;
  /** Fondskategorie laut TEFAS, z. B. "Hisse Senedi Fonu". */
  category: string | null;
  /** Aktueller Preis (Nettoinventarwert je Pay) in TRY. */
  price: number;
  /** Tagesänderung in Prozent, von TEFAS direkt geliefert. */
  dailyChangePercent: number | null;
  /** Platz in der eigenen Kategorie über das letzte Jahr, z. B. 45 von 200. */
  categoryRank: number | null;
  categoryFundCount: number | null;
  investorCount: number | null;
  /** Marktanteil unter allen TEFAS-Fonds in Prozent. */
  marketSharePercent: number | null;
  /** Tag der letzten verfügbaren Bewertung (YYYY-MM-DD, Istanbuler Datum). */
  asOf: string;
}

export interface FundPricePoint {
  /** YYYY-MM-DD (Istanbuler Datum). */
  date: string;
  price: number;
}

/** Zeitraum für Kursverlauf und Vergleich. Bildet die TEFAS-eigenen Zeiträume ab. */
export type FundPeriod = 'week' | 'month' | '3month' | '6month' | 'ytd' | 'year' | '3year' | '5year';

export interface FundBenchmarkPoint {
  /** "fund" für den Fonds selbst, sonst ein Vergleichswert (Goldpreis, BIST 100, Inflation, USD, EUR, Fondskategorie …). */
  kind: 'fund' | 'gold' | 'bist100' | 'bist30' | 'cpi' | 'usd' | 'eur' | 'deposit' | 'category';
  label: string;
  /** Wertentwicklung über den gewählten Zeitraum in Prozent. */
  returnPercent: number;
}

/** Austauschbare Fondsquelle (TEFAS). Eine bezahlte oder eine andere Plattform ließe sich als weiterer Adapter einhängen. */
export interface FundAdapter {
  readonly id: string;
  /** Sucht Fonds nach Kürzel oder Namen (Teilstring, ohne Berücksichtigung von Groß-/Kleinschreibung). */
  search(query: string): Promise<FundSearchResult[]>;
  getFund(code: FundCode): Promise<Fund>;
  getHistory(code: FundCode, period: FundPeriod): Promise<FundPricePoint[]>;
  /** Wertentwicklung des Fonds im Vergleich zu Gold, BIST 100/30, Inflation, USD, EUR und Mevduat-Zins. */
  getBenchmark(code: FundCode, period: FundPeriod): Promise<FundBenchmarkPoint[]>;
}
