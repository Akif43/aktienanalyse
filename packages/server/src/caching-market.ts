import { toYahooSymbol, type CandleSeries, type Instrument, type MarketDataAdapter, type Quote, type Timeframe } from '@aktien/core';
import type { TtlCache } from './cache';

export const MARKET_TTL = {
  quote: 10_000,
  candlesIntraday: 30_000,
  candles: 5 * 60_000,
  history: 15 * 60_000,
};

/**
 * Setzt einen Kurzzeit-Cache vor einen Kursadapter. Die Routen /api/quote und /api/history und die KI-Auswertung
 * teilen sich damit dieselben Abrufe und belasten die Datenquelle (Yahoo) nicht doppelt.
 */
export class CachingMarket implements MarketDataAdapter {
  readonly id: string;
  readonly authoritativeNotFound: boolean | undefined;

  constructor(
    private readonly inner: MarketDataAdapter,
    private readonly cache: TtlCache,
  ) {
    this.id = `cached-${inner.id}`;
    this.authoritativeNotFound = inner.authoritativeNotFound;
  }

  supports(instrument: Instrument): boolean {
    return this.inner.supports(instrument);
  }

  getQuote(instrument: Instrument): Promise<Quote> {
    return this.cache.get(`q:${toYahooSymbol(instrument)}`, MARKET_TTL.quote, () => this.inner.getQuote(instrument));
  }

  getCandles(instrument: Instrument, timeframe: Timeframe): Promise<CandleSeries> {
    const ttl = timeframe === '1T' || timeframe === '1W' ? MARKET_TTL.candlesIntraday : MARKET_TTL.candles;
    return this.cache.get(`c:${toYahooSymbol(instrument)}:${timeframe}`, ttl, () => this.inner.getCandles(instrument, timeframe));
  }

  getDailyHistory(instrument: Instrument): Promise<CandleSeries> {
    return this.cache.get(`h:${toYahooSymbol(instrument)}`, MARKET_TTL.history, () => this.inner.getDailyHistory(instrument));
  }
}
