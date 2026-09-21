import { AdapterError } from '../../errors';
import type { HttpOptions } from '../../http';
import type { CandleSeries, Instrument, Quote, Timeframe } from '../../types';
import { FinnhubAdapter } from './finnhub';
import { IsYatirimAdapter } from './isyatirim';
import type { MarketDataAdapter } from './types';
import { YahooAdapter } from './yahoo';

export type FallbackListener = (event: { adapter: string; operation: string; error: AdapterError }) => void;

/**
 * Fragt mehrere Adapter der Reihe nach ab. Adapter, die das Instrument nicht unterstützen, werden
 * übersprungen, bei Fehlern springt die Kette zum nächsten. Erst wenn alle scheitern, wirft sie.
 */
export class FallbackMarketData implements MarketDataAdapter {
  readonly id = 'fallback';

  constructor(
    private readonly adapters: readonly MarketDataAdapter[],
    private readonly onFallback?: FallbackListener,
  ) {}

  supports(instrument: Instrument): boolean {
    return this.adapters.some((a) => a.supports(instrument));
  }

  getQuote(instrument: Instrument): Promise<Quote> {
    return this.run(instrument, 'getQuote', (a) => a.getQuote(instrument));
  }

  getCandles(instrument: Instrument, timeframe: Timeframe): Promise<CandleSeries> {
    return this.run(instrument, 'getCandles', (a) => a.getCandles(instrument, timeframe));
  }

  getDailyHistory(instrument: Instrument): Promise<CandleSeries> {
    return this.run(instrument, 'getDailyHistory', (a) => a.getDailyHistory(instrument));
  }

  private async run<T>(instrument: Instrument, operation: string, call: (a: MarketDataAdapter) => Promise<T>): Promise<T> {
    const errors: AdapterError[] = [];
    for (const adapter of this.adapters) {
      if (!adapter.supports(instrument)) continue;
      try {
        return await call(adapter);
      } catch (err) {
        const e = err instanceof AdapterError ? err : new AdapterError('UPSTREAM', (err as Error).message, adapter.id, err);
        errors.push(e);
        if (e.code === 'NOT_FOUND' && adapter.authoritativeNotFound) break;
        if (e.code !== 'UNSUPPORTED') this.onFallback?.({ adapter: adapter.id, operation, error: e });
      }
    }
    const real = errors.filter((e) => e.code !== 'UNSUPPORTED');
    if (real.length === 0) {
      throw new AdapterError('UNSUPPORTED', `${operation} wird für ${instrument.symbol} von keiner Quelle unterstützt`, this.id);
    }
    const allNotFound = real.every((e) => e.code === 'NOT_FOUND');
    throw new AdapterError(
      allNotFound ? 'NOT_FOUND' : (real.find((e) => e.code === 'RATE_LIMITED')?.code ?? 'UPSTREAM'),
      `${operation} für ${instrument.symbol} fehlgeschlagen: ${real.map((e) => e.message).join(' | ')}`,
      this.id,
    );
  }
}

export interface MarketDataConfig extends HttpOptions {
  finnhubApiKey?: string;
  onFallback?: FallbackListener;
}

/**
 * Standard-Kette: Finnhub (nur US-Kurse, falls Key gesetzt) → Yahoo (alles) → İş Yatırım (BIST, Tagesschluss).
 * Finnhub liefert keine Kerzen und wirft dafür UNSUPPORTED, sodass Yahoo übernimmt.
 */
export function createMarketData(config: MarketDataConfig = {}): FallbackMarketData {
  const { finnhubApiKey, onFallback, ...http } = config;
  const adapters: MarketDataAdapter[] = [];
  if (finnhubApiKey) adapters.push(new FinnhubAdapter({ apiKey: finnhubApiKey, ...http }));
  adapters.push(new YahooAdapter(http), new IsYatirimAdapter(http));
  return new FallbackMarketData(adapters, onFallback);
}
