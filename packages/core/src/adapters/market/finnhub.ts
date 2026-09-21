import { z } from 'zod';
import { AdapterError } from '../../errors';
import { request, type HttpOptions } from '../../http';
import type { CandleSeries, Instrument, Quote } from '../../types';
import type { MarketDataAdapter } from './types';

const ID = 'finnhub';

const quoteSchema = z.object({
  c: z.number(), // aktueller Kurs
  d: z.number().nullable(), // Änderung
  dp: z.number().nullable(), // Änderung in %
  h: z.number(), // Tageshoch
  l: z.number(), // Tagestief
  pc: z.number(), // Vortagesschluss
  t: z.number(), // Zeitstempel (Unix-Sekunden), 0 = unbekanntes Symbol
});

export interface FinnhubOptions extends HttpOptions {
  apiKey: string;
}

/**
 * Finnhub Free: echtzeitnahe US-Kurse per REST (60 Calls/Min). Der Key wird als Header gesendet,
 * nicht in der URL. Kerzen sind im Gratis-Tarif nicht enthalten, dafür dient Yahoo.
 */
export class FinnhubAdapter implements MarketDataAdapter {
  readonly id = ID;

  constructor(private readonly opts: FinnhubOptions) {
    if (!opts.apiKey) throw new AdapterError('CONFIG', 'FINNHUB_API_KEY fehlt', ID);
  }

  supports(instrument: Instrument): boolean {
    return instrument.market === 'US';
  }

  async getQuote(instrument: Instrument): Promise<Quote> {
    if (!this.supports(instrument)) throw new AdapterError('UNSUPPORTED', `${instrument.market} wird im Gratis-Tarif nicht unterstützt`, ID);
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(instrument.symbol)}`;
    const res = await request(url, { headers: { 'X-Finnhub-Token': this.opts.apiKey } }, ID, this.opts, { unauthorized: 'CONFIG' });
    if (!res.ok) throw new AdapterError('UPSTREAM', `HTTP ${res.status}`, ID);

    const parsed = quoteSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new AdapterError('BAD_RESPONSE', 'Unerwartetes Quote-Format', ID);
    const q = parsed.data;
    if (q.t === 0 && q.c === 0) throw new AdapterError('NOT_FOUND', `Symbol ${instrument.symbol} unbekannt`, ID);

    return {
      symbol: instrument.symbol,
      market: instrument.market,
      price: q.c,
      previousClose: q.pc,
      change: q.d,
      changePercent: q.dp,
      dayHigh: q.h,
      dayLow: q.l,
      volume: null,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      currency: 'USD',
      asOf: q.t,
      freshness: { kind: 'realtime' },
      source: ID,
    };
  }

  async getCandles(): Promise<CandleSeries> {
    throw new AdapterError('UNSUPPORTED', 'Kerzen sind im Finnhub-Gratis-Tarif nicht enthalten', ID);
  }

  async getDailyHistory(): Promise<CandleSeries> {
    return this.getCandles();
  }
}
