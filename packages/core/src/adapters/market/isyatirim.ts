import { z } from 'zod';
import { AdapterError } from '../../errors';
import { request, type HttpOptions } from '../../http';
import type { Candle, CandleSeries, Instrument, Quote, Timeframe } from '../../types';
import type { MarketDataAdapter } from './types';

const ID = 'isyatirim';
const ENDPOINT = 'https://www.isyatirim.com.tr/_layouts/15/Isyatirim.Website/Common/Data.aspx/HisseTekil';

const rowSchema = z.object({
  HGDG_TARIH: z.string(), // "dd-MM-yyyy"
  HGDG_KAPANIS: z.number(),
  HGDG_AOF: z.number().nullable().optional(), // gewichteter Durchschnittspreis
  HGDG_MIN: z.number(),
  HGDG_MAX: z.number(),
  HGDG_HACIM: z.number().nullable().optional(), // Handelsvolumen in TRY (nicht Stückzahl)
});

const responseSchema = z.object({
  ok: z.boolean(),
  errorDescription: z.string().nullable().optional(),
  value: z.array(rowSchema).nullable(),
});

const DAY = 86_400;
const ISTANBUL_OFFSET_S = 3 * 3600;

/**
 * Tagesdaten für BIST-Aktien von İş Yatırım (öffentlicher, inoffizieller Endpoint). Nur Tagesschluss,
 * daher Fallback für Yahoo. Der Endpoint liefert keinen Eröffnungskurs: `open` ist der Vortagsschluss
 * (näherungsweise). Volumen = TRY-Umsatz / gewichteter Durchschnittspreis (≈ Stückzahl).
 * Alle Ergebnisse sind als `approximate` markiert.
 */
export class IsYatirimAdapter implements MarketDataAdapter {
  readonly id = ID;
  readonly authoritativeNotFound = true;

  constructor(private readonly opts: HttpOptions & { now?: () => Date } = {}) {}

  supports(instrument: Instrument): boolean {
    return instrument.market === 'BIST';
  }

  async getQuote(instrument: Instrument): Promise<Quote> {
    const { candles } = await this.getDailyHistory(instrument, 14);
    const last = candles.at(-1);
    if (!last) throw new AdapterError('NOT_FOUND', `Keine Daten für ${instrument.symbol}`, ID);
    const prev = candles.at(-2)?.close ?? null;
    const change = prev === null ? null : last.close - prev;
    return {
      symbol: instrument.symbol,
      market: instrument.market,
      price: last.close,
      previousClose: prev,
      change,
      changePercent: change === null || !prev ? null : (change / prev) * 100,
      dayHigh: last.high,
      dayLow: last.low,
      volume: last.volume,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      currency: 'TRY',
      asOf: last.time,
      freshness: { kind: 'eod' },
      source: ID,
    };
  }

  async getCandles(instrument: Instrument, timeframe: Timeframe): Promise<CandleSeries> {
    if (timeframe === '1T' || timeframe === '1W' || timeframe === '1M') {
      throw new AdapterError('UNSUPPORTED', 'İş Yatırım liefert nur Tagesdaten', ID);
    }
    const days = timeframe === '6M' ? 190 : timeframe === '1J' ? 370 : 1830;
    return this.getDailyHistory(instrument, days);
  }

  async getDailyHistory(instrument: Instrument, calendarDays = 740): Promise<CandleSeries> {
    if (!this.supports(instrument)) throw new AdapterError('UNSUPPORTED', 'Nur BIST-Aktien', ID);
    const end = (this.opts.now?.() ?? new Date());
    const start = new Date(end.getTime() - calendarDays * DAY * 1000);
    const url = `${ENDPOINT}?hisse=${encodeURIComponent(instrument.symbol)}&startdate=${fmt(start)}&enddate=${fmt(end)}`;

    const res = await request(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }, ID, this.opts);
    if (!res.ok) throw new AdapterError('UPSTREAM', `HTTP ${res.status}`, ID);
    const parsed = responseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success || !parsed.data.ok) {
      throw new AdapterError('BAD_RESPONSE', parsed.success ? (parsed.data.errorDescription ?? 'ok=false') : 'Unerwartetes Format', ID);
    }
    const rows = parsed.data.value ?? [];
    if (rows.length === 0) throw new AdapterError('NOT_FOUND', `Keine Daten für ${instrument.symbol}`, ID);

    const sorted = rows
      .map((r) => ({ r, time: parseDate(r.HGDG_TARIH) }))
      .filter((x): x is { r: (typeof rows)[number]; time: number } => x.time !== null)
      .sort((a, b) => a.time - b.time);

    const candles: Candle[] = sorted.map(({ r, time }, i) => {
      const avg = r.HGDG_AOF && r.HGDG_AOF > 0 ? r.HGDG_AOF : r.HGDG_KAPANIS;
      return {
        time,
        open: i > 0 ? sorted[i - 1]!.r.HGDG_KAPANIS : r.HGDG_KAPANIS,
        high: r.HGDG_MAX,
        low: r.HGDG_MIN,
        close: r.HGDG_KAPANIS,
        volume: r.HGDG_HACIM ? Math.round(r.HGDG_HACIM / avg) : 0,
      };
    });
    return { candles, source: ID, interval: '1d', droppedBars: rows.length - candles.length, approximate: true };
  }
}

function fmt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

/** "21-09-2026" → Unix-Sekunden für 00:00 Uhr Istanbuler Zeit. */
function parseDate(value: string): number | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!m) return null;
  return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) / 1000 - ISTANBUL_OFFSET_S;
}
