import type { Instrument, NewsItem } from '../../types';

export interface NewsQuery {
  /** Nur Meldungen ab diesem Zeitpunkt (Unix-Millisekunden). */
  since?: number;
  /** Maximale Anzahl Meldungen je Instrument (neueste zuerst). */
  limit?: number;
}

/** Austauschbare Nachrichtenquelle (KAP, Google News RSS, Finnhub …). */
export interface NewsAdapter {
  readonly id: string;
  supports(instrument: Instrument): boolean;
  getNews(instrument: Instrument, query?: NewsQuery): Promise<NewsItem[]>;
}
