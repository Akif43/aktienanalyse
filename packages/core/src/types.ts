/** Unterstützte Handelsplätze. Steuert Yahoo-Suffix, Währung und Zeitzone. */
export type Market = 'BIST' | 'US' | 'XETRA';

export interface Instrument {
  /** Kürzel ohne Suffix, z. B. THYAO, AAPL, SAP. */
  symbol: string;
  market: Market;
  /** Firmenname, wird für die News-Suche genutzt. */
  name?: string;
}

/** OHLCV-Kerze. `time` ist der Kerzenbeginn in Unix-Sekunden (UTC). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = '1T' | '1W' | '1M' | '6M' | '1J' | '5J';

/** Kerzenreihe samt Herkunft und Datenqualität. */
export interface CandleSeries {
  candles: Candle[];
  /** Adapter, der die Daten geliefert hat (z. B. "yahoo"). */
  source: string;
  /** Kerzenintervall der Quelle (z. B. "1d", "5m"). */
  interval: string;
  /** Anzahl unvollständiger Kerzen, die die Quelle geliefert hat und die verworfen wurden. */
  droppedBars: number;
  /** true, wenn Open/Volumen nur angenähert sind (z. B. Tagesdaten von İş Yatırım). */
  approximate?: boolean;
}

/** Wie aktuell ein Kurs ist. Wird direkt in der UI als Badge angezeigt. */
export type Freshness =
  | { kind: 'realtime' }
  | { kind: 'delayed'; minutes: number }
  | { kind: 'eod' };

export interface Quote {
  symbol: string;
  market: Market;
  /** Firmenname laut Quelle, falls geliefert. */
  name?: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  currency: string;
  /** Zeitpunkt des letzten Kurses in Unix-Sekunden. */
  asOf: number;
  freshness: Freshness;
  /** Adapter, der den Kurs geliefert hat (z. B. "yahoo"). */
  source: string;
  /** Börsenzeit-Fenster der aktuellen Sitzung (Unix-Sekunden), falls bekannt. */
  session?: { start: number; end: number };
}

export type NewsKind = 'kap' | 'news';

export interface NewsItem {
  /** Stabile ID zur Deduplizierung (Hash aus Quelle und URL bzw. Meldungsnummer). */
  id: string;
  symbol: string;
  kind: NewsKind;
  title: string;
  /** Kurztext, bei KAP die Zusammenfassung der Meldung. */
  summary?: string;
  url: string;
  source: string;
  /** Veröffentlichung in Unix-Millisekunden (UTC). */
  publishedAt: number;
  language: 'tr' | 'de' | 'en';
  /** Meldungsart bei KAP (z. B. "Özel Durum Açıklaması (Genel)"). */
  category?: string;
  /** Wer die KAP-Meldung veröffentlicht hat (Firmenname). Weicht er vom Firmennamen der Aktie ab, ist es meist eine Meldung von Börse oder Takasbank. */
  issuer?: string;
  /** Bei Presse: Zahl weiterer Berichte zur selben Geschichte, die zu dieser Meldung zusammengefasst wurden. */
  alsoReported?: number;
}
