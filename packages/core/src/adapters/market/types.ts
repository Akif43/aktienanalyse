import type { CandleSeries, Instrument, Quote, Timeframe } from '../../types';

/**
 * Austauschbare Kursquelle. Eine spätere bezahlte Echtzeitquelle wird als weiterer Adapter
 * eingehängt, ohne dass sich UI oder Analyse ändern.
 */
export interface MarketDataAdapter {
  readonly id: string;
  /**
   * true, wenn "nicht gefunden" dieser Quelle verlässlich ist. Die Fallback-Kette fragt dann keine weiteren
   * Quellen mehr ab (spart langsame Umwege bei Tippfehlern). Bei false gilt es nur als "kenne ich nicht".
   */
  readonly authoritativeNotFound?: boolean;
  supports(instrument: Instrument): boolean;
  getQuote(instrument: Instrument): Promise<Quote>;
  /** Kerzen für die Chart-Anzeige im gewählten Zeitraum. */
  getCandles(instrument: Instrument, timeframe: Timeframe): Promise<CandleSeries>;
  /** Mindestens ~2 Jahre Tageskerzen für Indikatoren (SMA200, Pivots). */
  getDailyHistory(instrument: Instrument): Promise<CandleSeries>;
}
