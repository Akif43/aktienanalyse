import type { Instrument, NewsItem, NewsKind } from '../../types';

export interface NewsQuery {
  /** Nur Meldungen ab diesem Zeitpunkt (Unix-Millisekunden). */
  since?: number;
  /** Maximale Anzahl Meldungen je Instrument (neueste zuerst). */
  limit?: number;
  /** Nur Quellen und Meldungen dieser Art (z. B. nur offizielle KAP-Meldungen). */
  kind?: NewsKind;
}

/** Austauschbare Nachrichtenquelle (KAP, Google News RSS, Finnhub …). */
export interface NewsAdapter {
  readonly id: string;
  /** Art der gelieferten Meldungen. Ohne Angabe wird die Quelle bei jeder Abfrage befragt. */
  readonly kind?: NewsKind;
  supports(instrument: Instrument): boolean;
  getNews(instrument: Instrument, query?: NewsQuery): Promise<NewsItem[]>;
}
