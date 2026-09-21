import { describe, expect, it } from 'vitest';
import {
  AdapterError,
  createMarketData,
  FallbackMarketData,
  FinnhubAdapter,
  freshnessLabel,
  IsYatirimAdapter,
  YahooAdapter,
  type Candle,
  type Instrument,
  type MarketDataAdapter,
} from '../src';
import { readFixture, readJsonFixture } from './helpers';
import { json, mockFetch, text } from './mock-fetch';

const THYAO: Instrument = { symbol: 'THYAO', market: 'BIST', name: 'Türk Hava Yolları' };
const AAPL: Instrument = { symbol: 'AAPL', market: 'US' };

const yahooDaily = () => text(readFixture('yahoo-thyao-1d-2y.json'));
const yahooIntraday = () => text(readFixture('yahoo-thyao-5m-1d.json'));

async function catchError(p: Promise<unknown>): Promise<AdapterError> {
  try {
    await p;
  } catch (e) {
    return e as AdapterError;
  }
  throw new Error('Erwartete einen Fehler, es kam keiner');
}

describe('YahooAdapter', () => {
  it('liefert Tageskerzen, die exakt der pandas-Bereinigung entsprechen', async () => {
    const m = mockFetch(yahooDaily());
    const series = await new YahooAdapter({ fetch: m.fetch }).getDailyHistory(THYAO);
    const ref = readJsonFixture<{ candles: Candle[] }>('thyao-1d.reference.json').candles;

    expect(series.source).toBe('yahoo');
    expect(series.interval).toBe('1d');
    expect(series.candles).toHaveLength(ref.length);
    expect(series.droppedBars).toBe(6);
    series.candles.forEach((c, i) => expect(c).toEqual(ref[i]));
    expect(m.calls[0]!.url).toContain('/THYAO.IS?range=2y&interval=1d');
  });

  it('bildet den Kurs aus range=1d ab (Vortagsschluss, Tageshoch/-tief, verzögert)', async () => {
    const m = mockFetch(yahooIntraday());
    const q = await new YahooAdapter({ fetch: m.fetch }).getQuote(THYAO);

    expect(m.calls[0]!.url).toContain('range=1d');
    expect(q).toMatchObject({
      symbol: 'THYAO',
      market: 'BIST',
      price: 285.25,
      previousClose: 285.5,
      dayHigh: 287.75,
      dayLow: 282.5,
      currency: 'TRY',
      source: 'yahoo',
      freshness: { kind: 'delayed', minutes: 15 },
    });
    expect(q.name).toMatch(/Hava Yollari/i);
    expect(q.change).toBeCloseTo(-0.25, 10);
    expect(q.changePercent).toBeCloseTo(-0.0876, 3);
    expect(q.asOf).toBe(1789976196);
    expect(q.session!.end).toBeGreaterThan(q.session!.start);
    expect(freshnessLabel(q.freshness)).toBe('verzögert (ca. 15 Min.)');
  });

  it('kennzeichnet US-Kurse standardmäßig als Echtzeit und erlaubt Überschreiben', async () => {
    const m = mockFetch(yahooIntraday());
    const a = await new YahooAdapter({ fetch: m.fetch }).getQuote(AAPL);
    expect(a.freshness).toEqual({ kind: 'realtime' });
    expect(freshnessLabel(a.freshness)).toBe('Echtzeit');

    const b = await new YahooAdapter({ fetch: m.fetch, freshness: { US: { kind: 'delayed', minutes: 15 } } }).getQuote(AAPL);
    expect(b.freshness).toEqual({ kind: 'delayed', minutes: 15 });
  });

  it('mappt jeden Chart-Zeitraum auf Range und Intervall', async () => {
    const m = mockFetch(yahooDaily());
    const y = new YahooAdapter({ fetch: m.fetch });
    for (const tf of ['1T', '1W', '1M', '6M', '1J', '5J'] as const) await y.getCandles(AAPL, tf);
    expect(m.calls.map((c) => c.url.split('?')[1])).toEqual([
      'range=1d&interval=5m',
      'range=5d&interval=30m',
      'range=1mo&interval=60m',
      'range=6mo&interval=1d',
      'range=1y&interval=1d',
      'range=5y&interval=1wk',
    ]);
  });

  it('meldet unbekannte Symbole als NOT_FOUND, ohne den zweiten Host zu fragen', async () => {
    const m = mockFetch(text(readFixture('yahoo-notfound.json'), 404));
    const err = await catchError(new YahooAdapter({ fetch: m.fetch }).getQuote({ symbol: 'NOSUCHTICKERXYZ', market: 'BIST' }));
    expect(err.code).toBe('NOT_FOUND');
    expect(m.calls).toHaveLength(1);
  });

  it('wiederholt bei 429 mit Backoff (500 ms, 1 s) und liefert dann', async () => {
    const m = mockFetch(text('', 429), text('', 429), yahooIntraday());
    const q = await new YahooAdapter({ fetch: m.fetch, sleep: m.sleep }).getQuote(THYAO);
    expect(q.price).toBe(285.25);
    expect(m.sleeps).toEqual([500, 1000]);
    expect(m.calls).toHaveLength(3);
    expect(m.calls.every((c) => c.url.includes('query1.'))).toBe(true);
  });

  it('respektiert Retry-After bei 429', async () => {
    const limited = new Response('', { status: 429, headers: { 'retry-after': '3' } });
    const m = mockFetch(limited, yahooIntraday());
    await new YahooAdapter({ fetch: m.fetch, sleep: m.sleep }).getQuote(THYAO);
    expect(m.sleeps).toEqual([3000]);
  });

  it('weicht bei anhaltendem Rate-Limit auf den zweiten Host aus', async () => {
    const m = mockFetch(text('', 429), yahooIntraday());
    const q = await new YahooAdapter({ fetch: m.fetch, sleep: m.sleep, retries: 0 }).getQuote(THYAO);
    expect(q.price).toBe(285.25);
    expect(m.calls[0]!.url).toContain('query1.');
    expect(m.calls[1]!.url).toContain('query2.');
  });

  it('gibt bei 403 BLOCKED zurück (kein Retry auf demselben Host)', async () => {
    const m = mockFetch(text('', 403));
    const err = await catchError(new YahooAdapter({ fetch: m.fetch, sleep: m.sleep }).getQuote(THYAO));
    expect(err.code).toBe('BLOCKED');
    expect(m.calls).toHaveLength(2); // je ein Versuch pro Host
    expect(m.sleeps).toEqual([]);
  });

  it('gibt bei Serverfehlern nach allen Versuchen UPSTREAM zurück', async () => {
    const m = mockFetch(text('', 503));
    const err = await catchError(new YahooAdapter({ fetch: m.fetch, sleep: m.sleep, retries: 1 }).getQuote(THYAO));
    expect(err.code).toBe('UPSTREAM');
    expect(err.retryable).toBe(true);
  });

  it('meldet Netzwerkfehler als UPSTREAM', async () => {
    const err = await catchError(
      new YahooAdapter({
        fetch: async () => {
          throw new TypeError('fetch failed');
        },
        sleep: async () => {},
        retries: 0,
      }).getQuote(THYAO),
    );
    expect(err.code).toBe('UPSTREAM');
    expect(err.message).toContain('fetch failed');
  });

  it('erkennt ungültige Antworten (kein JSON, falsches Format)', async () => {
    const e1 = await catchError(new YahooAdapter({ fetch: mockFetch(text('<html>')).fetch }).getQuote(THYAO));
    expect(e1.code).toBe('BAD_RESPONSE');
    const e2 = await catchError(new YahooAdapter({ fetch: mockFetch(json({ foo: 1 })).fetch }).getQuote(THYAO));
    expect(e2.code).toBe('BAD_RESPONSE');
  });
});

describe('FinnhubAdapter', () => {
  const quote = { c: 336.13, d: 1.5, dp: 0.45, h: 337, l: 333, o: 334, pc: 334.63, t: 1789975000 };

  it('mappt den Quote und sendet den Key als Header, nicht in der URL', async () => {
    const m = mockFetch(json(quote));
    const q = await new FinnhubAdapter({ apiKey: 'SECRET', fetch: m.fetch }).getQuote(AAPL);
    expect(q).toMatchObject({ price: 336.13, previousClose: 334.63, dayHigh: 337, dayLow: 333, currency: 'USD', source: 'finnhub' });
    expect(q.freshness).toEqual({ kind: 'realtime' });
    expect(m.calls[0]!.url).not.toContain('SECRET');
    expect((m.calls[0]!.init!.headers as Record<string, string>)['X-Finnhub-Token']).toBe('SECRET');
  });

  it('erkennt unbekannte Symbole (alles 0), ungültige Keys und Nicht-US-Märkte', async () => {
    const zero = { c: 0, d: null, dp: null, h: 0, l: 0, pc: 0, t: 0 };
    const a = new FinnhubAdapter({ apiKey: 'k', fetch: mockFetch(json(zero)).fetch });
    expect((await catchError(a.getQuote(AAPL))).code).toBe('NOT_FOUND');
    const b = new FinnhubAdapter({ apiKey: 'k', fetch: mockFetch(text('', 401)).fetch, sleep: async () => {} });
    expect((await catchError(b.getQuote(AAPL))).code).toBe('CONFIG');
    expect((await catchError(a.getQuote(THYAO))).code).toBe('UNSUPPORTED');
    expect(a.supports(THYAO)).toBe(false);
  });

  it('verlangt einen Key und unterstützt keine Kerzen', async () => {
    expect(() => new FinnhubAdapter({ apiKey: '' })).toThrow(/FINNHUB_API_KEY/);
    const a = new FinnhubAdapter({ apiKey: 'k' });
    expect((await catchError(a.getCandles())).code).toBe('UNSUPPORTED');
    expect((await catchError(a.getDailyHistory())).code).toBe('UNSUPPORTED');
  });
});

describe('IsYatirimAdapter', () => {
  const now = () => new Date(Date.UTC(2026, 8, 21, 9, 0, 0));
  const fx = () => text(readFixture('isyatirim-thyao.json'));

  it('bildet Tagesdaten ab (Open = Vortagsschluss, Volumen = Umsatz / Durchschnittspreis)', async () => {
    const m = mockFetch(fx());
    const s = await new IsYatirimAdapter({ fetch: m.fetch, now }).getDailyHistory(THYAO);
    const rows = readJsonFixture<{ value: Record<string, number | string>[] }>('isyatirim-thyao.json').value;

    expect(s.approximate).toBe(true);
    expect(s.source).toBe('isyatirim');
    expect(s.candles).toHaveLength(rows.length);
    expect(s.candles.map((c) => c.time)).toEqual([...s.candles.map((c) => c.time)].sort((a, b) => a - b));

    const first = s.candles[0]!;
    expect(first.close).toBe(rows[0]!.HGDG_KAPANIS);
    expect(first.open).toBe(first.close); // erste Kerze: kein Vortag bekannt
    expect(s.candles[1]!.open).toBe(s.candles[0]!.close);
    expect(first.volume).toBe(Math.round((rows[0]!.HGDG_HACIM as number) / (rows[0]!.HGDG_AOF as number)));
    // Datum der Fixture ("10-09-2026") um 00:00 Istanbuler Zeit = Vortag 21:00 UTC
    const [dd, mm, yyyy] = (rows[0]!.HGDG_TARIH as string).split('-').map(Number);
    expect(first.time).toBe(Date.UTC(yyyy!, mm! - 1, dd!) / 1000 - 3 * 3600);
    expect(m.calls[0]!.url).toContain('hisse=THYAO');
    expect(m.calls[0]!.url).toContain('enddate=21-09-2026');
  });

  it('liefert einen Tagesschluss-Kurs (eod) aus den letzten beiden Kerzen', async () => {
    const q = await new IsYatirimAdapter({ fetch: mockFetch(fx()).fetch, now }).getQuote(THYAO);
    expect(q.freshness).toEqual({ kind: 'eod' });
    expect(q.currency).toBe('TRY');
    expect(q.previousClose).not.toBeNull();
    expect(q.change).toBeCloseTo(q.price - q.previousClose!, 10);
    expect(freshnessLabel(q.freshness)).toMatch(/Tagesschluss/);
  });

  it('unterstützt nur BIST und keine Intraday-Zeiträume; leere Antworten sind NOT_FOUND', async () => {
    const a = new IsYatirimAdapter({ fetch: mockFetch(fx()).fetch, now });
    expect(a.supports(AAPL)).toBe(false);
    expect((await catchError(a.getCandles(THYAO, '1T'))).code).toBe('UNSUPPORTED');
    expect((await catchError(a.getDailyHistory(AAPL))).code).toBe('UNSUPPORTED');
    const empty = new IsYatirimAdapter({ fetch: mockFetch(json({ ok: true, value: [] })).fetch, now });
    expect((await catchError(empty.getDailyHistory(THYAO))).code).toBe('NOT_FOUND');
    const bad = new IsYatirimAdapter({ fetch: mockFetch(json({ ok: false, errorDescription: 'kaputt', value: null })).fetch, now });
    expect((await catchError(bad.getDailyHistory(THYAO))).message).toContain('kaputt');
  });
});

describe('FallbackMarketData', () => {
  const stub = (id: string, behavior: 'ok' | AdapterError, markets: Instrument['market'][] = ['BIST', 'US', 'XETRA']): MarketDataAdapter => {
    const run = async () => {
      if (behavior !== 'ok') throw behavior;
      return { candles: [], source: id, interval: '1d', droppedBars: 0 };
    };
    return {
      id,
      supports: (i) => markets.includes(i.market),
      getQuote: async () => {
        if (behavior !== 'ok') throw behavior;
        return { source: id } as never;
      },
      getCandles: run,
      getDailyHistory: run,
    };
  };

  it('nimmt den ersten funktionierenden Adapter und meldet Ausfälle', async () => {
    const events: string[] = [];
    const chain = new FallbackMarketData(
      [stub('a', new AdapterError('RATE_LIMITED', 'zu viele', 'a')), stub('b', 'ok')],
      (e) => events.push(`${e.adapter}:${e.error.code}`),
    );
    expect((await chain.getQuote(THYAO)).source).toBe('b');
    expect(events).toEqual(['a:RATE_LIMITED']);
  });

  it('überspringt nicht unterstützte Märkte und meldet UNSUPPORTED nicht als Ausfall', async () => {
    const events: string[] = [];
    const chain = new FallbackMarketData(
      [stub('us-only', 'ok', ['US']), stub('unsup', new AdapterError('UNSUPPORTED', 'nein', 'unsup')), stub('any', 'ok')],
      (e) => events.push(e.adapter),
    );
    expect((await chain.getDailyHistory(THYAO)).source).toBe('any');
    expect(events).toEqual([]);
  });

  it('beendet die Kette bei verlässlichem NOT_FOUND, fragt bei unverlässlichem weiter', async () => {
    const calls: string[] = [];
    const make = (id: string, authoritative: boolean, behavior: 'notfound' | 'ok'): MarketDataAdapter => ({
      id,
      authoritativeNotFound: authoritative,
      supports: () => true,
      getQuote: async () => {
        calls.push(id);
        if (behavior === 'notfound') throw new AdapterError('NOT_FOUND', 'unbekannt', id);
        return { source: id } as never;
      },
      getCandles: async () => ({ candles: [], source: id, interval: '1d', droppedBars: 0 }),
      getDailyHistory: async () => ({ candles: [], source: id, interval: '1d', droppedBars: 0 }),
    });

    // Yahoo-Typ: "nicht gefunden" ist endgültig, der langsame Fallback wird nicht mehr befragt
    const strict = new FallbackMarketData([make('yahoo', true, 'notfound'), make('slow', true, 'ok')]);
    expect((await catchError(strict.getQuote(THYAO))).code).toBe('NOT_FOUND');
    expect(calls).toEqual(['yahoo']);

    // Finnhub-Typ: "kenne ich nicht", die nächste Quelle darf es noch versuchen
    calls.length = 0;
    const lenient = new FallbackMarketData([make('finnhub', false, 'notfound'), make('yahoo', true, 'ok')]);
    expect((await lenient.getQuote(AAPL)).source).toBe('yahoo');
    expect(calls).toEqual(['finnhub', 'yahoo']);
  });

  it('fasst Fehler zusammen, wenn alle scheitern (NOT_FOUND nur, wenn alle NOT_FOUND melden)', async () => {
    const nf = (id: string) => stub(id, new AdapterError('NOT_FOUND', 'unbekannt', id));
    expect((await catchError(new FallbackMarketData([nf('a'), nf('b')]).getQuote(THYAO))).code).toBe('NOT_FOUND');

    const mixed = new FallbackMarketData([nf('a'), stub('b', new AdapterError('RATE_LIMITED', 'limit', 'b'))]);
    const err = await catchError(mixed.getQuote(THYAO));
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.message).toContain('[a]');
    expect(err.message).toContain('[b]');

    expect((await catchError(new FallbackMarketData([stub('us', 'ok', ['US'])]).getQuote(THYAO))).code).toBe('UNSUPPORTED');
  });

  it('createMarketData baut Finnhub nur mit Key ein und fällt bei Kerzen auf Yahoo zurück', async () => {
    const m = mockFetch(yahooDaily());
    const withKey = createMarketData({ finnhubApiKey: 'k', fetch: m.fetch, sleep: m.sleep });
    const s = await withKey.getDailyHistory(AAPL);
    expect(s.source).toBe('yahoo');
    expect(m.calls.every((c) => c.url.includes('yahoo'))).toBe(true);

    const m2 = mockFetch(json({ c: 1, d: 0, dp: 0, h: 1, l: 1, pc: 1, t: 1789975000 }));
    expect((await createMarketData({ finnhubApiKey: 'k', fetch: m2.fetch }).getQuote(AAPL)).source).toBe('finnhub');
    const m3 = mockFetch(yahooIntraday());
    expect((await createMarketData({ fetch: m3.fetch }).getQuote(AAPL)).source).toBe('yahoo');
  });
});
