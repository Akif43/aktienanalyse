import { z } from 'zod';
import { AdapterError } from '../../errors';
import { request, type HttpOptions } from '../../http';
import { normalizeCandles } from '../../indicators/series';
import { toYahooSymbol } from '../../symbols';
import type { CandleSeries, Freshness, Instrument, Market, Quote, Timeframe } from '../../types';
import type { MarketDataAdapter } from './types';

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const ID = 'yahoo';

const numOrNull = z.number().nullable().optional();

const chartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({
            symbol: z.string().optional(),
            currency: z.string().optional(),
            longName: z.string().optional(),
            shortName: z.string().optional(),
            regularMarketPrice: z.number().optional(),
            regularMarketTime: z.number().optional(),
            chartPreviousClose: z.number().optional(),
            regularMarketDayHigh: numOrNull,
            regularMarketDayLow: numOrNull,
            regularMarketVolume: numOrNull,
            fiftyTwoWeekHigh: numOrNull,
            fiftyTwoWeekLow: numOrNull,
            currentTradingPeriod: z.object({ regular: z.object({ start: z.number(), end: z.number() }) }).optional(),
          }),
          timestamp: z.array(z.number()).optional(),
          indicators: z.object({
            quote: z.array(
              z.object({
                open: z.array(numOrNull),
                high: z.array(numOrNull),
                low: z.array(numOrNull),
                close: z.array(numOrNull),
                volume: z.array(numOrNull).optional(),
              }),
            ),
          }),
        }),
      )
      .nullable(),
    error: z.object({ code: z.string(), description: z.string() }).nullable(),
  }),
});

type ChartResult = NonNullable<z.infer<typeof chartSchema>['chart']['result']>[number];

/** Zeitraum und Kerzenintervall je Chart-Zeitraum. */
export const YAHOO_TIMEFRAMES: Record<Timeframe, { range: string; interval: string }> = {
  '1T': { range: '1d', interval: '5m' },
  '1W': { range: '5d', interval: '30m' },
  '1M': { range: '1mo', interval: '60m' },
  '6M': { range: '6mo', interval: '1d' },
  '1J': { range: '1y', interval: '1d' },
  '5J': { range: '5y', interval: '1wk' },
};

const DEFAULT_DELAY: Record<Market, Freshness> = {
  BIST: { kind: 'delayed', minutes: 15 },
  XETRA: { kind: 'delayed', minutes: 15 },
  // Yahoo liefert US-Kurse in der Regel ohne nennenswerte Verzögerung. Wird im scripts/smoke.ts gemessen.
  US: { kind: 'realtime' },
};

export interface YahooOptions extends HttpOptions {
  freshness?: Partial<Record<Market, Freshness>>;
}

/**
 * Yahoo Finance über den inoffiziellen `v8/chart`-Endpoint. Kein Key nötig, aber ohne Garantie:
 * Yahoo kann Rate-Limits setzen, Cloud-IPs sperren oder das Format ändern.
 */
export class YahooAdapter implements MarketDataAdapter {
  readonly id = ID;
  readonly authoritativeNotFound = true;

  constructor(private readonly opts: YahooOptions = {}) {}

  supports(): boolean {
    return true;
  }

  async getQuote(instrument: Instrument): Promise<Quote> {
    // range=1d ist wichtig: nur dann ist chartPreviousClose der Vortagsschluss.
    const result = await this.chart(instrument, '1d', '5m');
    const m = result.meta;
    if (m.regularMarketPrice === undefined || m.regularMarketTime === undefined) {
      throw new AdapterError('BAD_RESPONSE', `Kein Kurs für ${instrument.symbol} in der Antwort`, ID);
    }
    const prev = m.chartPreviousClose ?? null;
    const change = prev === null ? null : m.regularMarketPrice - prev;
    const freshness = this.opts.freshness?.[instrument.market] ?? DEFAULT_DELAY[instrument.market];
    return {
      symbol: instrument.symbol,
      market: instrument.market,
      name: m.longName ?? m.shortName,
      price: m.regularMarketPrice,
      previousClose: prev,
      change,
      changePercent: change === null || !prev ? null : (change / prev) * 100,
      dayHigh: m.regularMarketDayHigh ?? null,
      dayLow: m.regularMarketDayLow ?? null,
      volume: m.regularMarketVolume ?? null,
      fiftyTwoWeekHigh: m.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: m.fiftyTwoWeekLow ?? null,
      currency: m.currency ?? 'USD',
      asOf: m.regularMarketTime,
      freshness,
      source: ID,
      session: m.currentTradingPeriod?.regular,
    };
  }

  getCandles(instrument: Instrument, timeframe: Timeframe): Promise<CandleSeries> {
    const { range, interval } = YAHOO_TIMEFRAMES[timeframe];
    return this.candles(instrument, range, interval);
  }

  getDailyHistory(instrument: Instrument): Promise<CandleSeries> {
    return this.candles(instrument, '2y', '1d');
  }

  private async candles(instrument: Instrument, range: string, interval: string): Promise<CandleSeries> {
    const result = await this.chart(instrument, range, interval);
    const ts = result.timestamp ?? [];
    const q = result.indicators.quote[0];
    if (!q) throw new AdapterError('BAD_RESPONSE', 'Antwort ohne Kursdaten', ID);
    const raw = ts.map((time, i) => ({
      time,
      open: q.open[i] ?? undefined,
      high: q.high[i] ?? undefined,
      low: q.low[i] ?? undefined,
      close: q.close[i] ?? undefined,
      volume: q.volume?.[i] ?? 0,
    }));
    const candles = normalizeCandles(raw);
    return { candles, source: ID, interval, droppedBars: raw.length - candles.length };
  }

  private async chart(instrument: Instrument, range: string, interval: string): Promise<ChartResult> {
    const symbol = toYahooSymbol(instrument);
    let lastError: unknown;
    for (const host of HOSTS) {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
      try {
        const res = await request(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }, ID, this.opts);
        return await parseChart(res, symbol);
      } catch (err) {
        if (err instanceof AdapterError && (err.code === 'NOT_FOUND' || err.code === 'BAD_RESPONSE')) throw err;
        lastError = err; // Rate-Limit/Block/Ausfall: zweiter Host kann anders antworten
      }
    }
    throw lastError;
  }
}

async function parseChart(res: Response, symbol: string): Promise<ChartResult> {
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new AdapterError('BAD_RESPONSE', `Antwort für ${symbol} ist kein JSON (HTTP ${res.status})`, ID, err);
  }
  const parsed = chartSchema.safeParse(body);
  if (!parsed.success) {
    throw new AdapterError('BAD_RESPONSE', `Unerwartetes Format für ${symbol}: ${parsed.error.issues[0]?.message ?? 'unbekannt'}`, ID);
  }
  const { result, error } = parsed.data.chart;
  if (error) {
    const notFound = /not found|no data/i.test(`${error.code} ${error.description}`);
    throw new AdapterError(notFound ? 'NOT_FOUND' : 'UPSTREAM', `${symbol}: ${error.description}`, ID);
  }
  const first = result?.[0];
  if (!first) throw new AdapterError('NOT_FOUND', `Keine Daten für ${symbol}`, ID);
  return first;
}
