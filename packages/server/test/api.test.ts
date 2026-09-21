import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdapterError, type MarketDataAdapter, type NewsService, type Quote } from '@aktien/core';
import { createApi, safeEqual, toNodeHandler, TtlCache, type ApiDeps } from '../src';

const quote = (symbol: string, price = 100): Quote => ({
  symbol,
  market: 'BIST',
  price,
  previousClose: 99,
  change: 1,
  changePercent: 1.01,
  dayHigh: 101,
  dayLow: 98,
  volume: 10,
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  currency: 'TRY',
  asOf: 1_700_000_000,
  freshness: { kind: 'delayed', minutes: 15 },
  source: 'fake',
});

function fakeDeps(overrides: Partial<{ market: Partial<MarketDataAdapter>; news: Partial<NewsService>; search: ApiDeps['search'] }> = {}) {
  const market = {
    id: 'fake',
    supports: () => true,
    getQuote: vi.fn(async (i) => quote(i.symbol)),
    getCandles: vi.fn(async () => ({ candles: [], source: 'fake', interval: '1d', droppedBars: 0 })),
    getDailyHistory: vi.fn(async () => ({ candles: [], source: 'fake', interval: '1d', droppedBars: 0 })),
    ...overrides.market,
  } as unknown as MarketDataAdapter & { getQuote: ReturnType<typeof vi.fn> };
  const news = {
    getNews: vi.fn(async () => ({ items: [], errors: [new AdapterError('BLOCKED', 'geblockt', 'kap')] })),
    ...overrides.news,
  } as unknown as NewsService & { getNews: ReturnType<typeof vi.fn> };
  const search = overrides.search ?? vi.fn(async () => []);
  return { deps: { market, news, search } as ApiDeps, market, news, search: search as ReturnType<typeof vi.fn> };
}

const get = (api: (r: Request) => Promise<Response>, path: string, headers: Record<string, string> = {}) =>
  api(new Request(`https://app.test${path}`, { headers }));

describe('Zugriffsschutz', () => {
  it('health ist offen und verrät nur, ob ein Token nötig ist', async () => {
    const { deps } = fakeDeps();
    const res = await get(createApi({ APP_TOKEN: 'geheim' }, deps), '/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, authRequired: true });
    expect(await (await get(createApi({}, deps), '/api/health')).json()).toMatchObject({ authRequired: false });
  });

  it('verweigert Datenabfragen ohne oder mit falschem Token', async () => {
    const { deps, market } = fakeDeps();
    const api = createApi({ APP_TOKEN: 'geheim' }, deps);
    for (const headers of [{}, { authorization: 'Bearer falsch' }, { authorization: 'geheim' }, { authorization: 'Bearer ' }] as Record<string, string>[]) {
      const res = await get(api, '/api/quote?s=THYAO.IS', headers);
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('UNAUTHORIZED');
    }
    expect(market.getQuote).not.toHaveBeenCalled();
    expect((await get(api, '/api/quote?s=THYAO.IS', { authorization: 'Bearer geheim' })).status).toBe(200);
  });

  it('ohne konfiguriertes Token (lokale Entwicklung) ist alles offen', async () => {
    const { deps } = fakeDeps();
    expect((await get(createApi({}, deps), '/api/quote?s=THYAO.IS')).status).toBe(200);
  });

  it('safeEqual', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', 'a')).toBe(false);
  });
});

describe('Routing und Validierung', () => {
  const api = () => createApi({}, fakeDeps().deps);

  it('kennt nur GET und bekannte Routen', async () => {
    expect((await api()(new Request('https://x/api/quote?s=A', { method: 'POST' }))).status).toBe(405);
    expect((await get(api(), '/api/gibtsnicht')).status).toBe(404);
    expect((await get(api(), '/api/')).status).toBe(404);
  });

  it('prüft Parameter', async () => {
    const a = api();
    expect((await get(a, '/api/quote')).status).toBe(400);
    expect((await get(a, '/api/quote?s=' + Array.from({ length: 21 }, (_, i) => `A${i}`).join(','))).status).toBe(400);
    expect((await get(a, '/api/candles?s=AAPL')).status).toBe(400);
    expect((await get(a, '/api/candles?s=AAPL&tf=10J')).status).toBe(400);
    expect((await get(a, '/api/history')).status).toBe(400);
    expect((await get(a, '/api/search?q=')).status).toBe(400);
    expect((await get(a, '/api/search?q=' + 'x'.repeat(41))).status).toBe(400);
    const bad = await get(a, '/api/history?s=' + encodeURIComponent('../../etc'));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toMatch(/Ungültiges Kürzel/);
  });

  it('setzt cache-control: no-store und JSON-Content-Type', async () => {
    const res = await get(api(), '/api/quote?s=THYAO.IS');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

describe('Kurse', () => {
  it('liefert mehrere Ticker und übersetzt Märkte über das Suffix', async () => {
    const { deps, market } = fakeDeps();
    const body = await (await get(createApi({}, deps), '/api/quote?s=THYAO.IS,AAPL,SAP.DE')).json();
    expect(body.results.map((r: any) => r.ticker)).toEqual(['THYAO.IS', 'AAPL', 'SAP.DE']);
    expect(market.getQuote.mock.calls.map(([i]) => `${i.market}:${i.symbol}`)).toEqual(['BIST:THYAO', 'US:AAPL', 'XETRA:SAP']);
  });

  it('ein fehlgeschlagener Ticker verhindert die anderen nicht', async () => {
    const { deps } = fakeDeps({
      market: {
        getQuote: async (i) => {
          if (i.symbol === 'KAPUTT') throw new AdapterError('NOT_FOUND', 'unbekannt', 'yahoo');
          return quote(i.symbol);
        },
      },
    });
    const res = await get(createApi({}, deps), '/api/quote?s=THYAO.IS,KAPUTT.IS,../x');
    expect(res.status).toBe(200);
    const [ok, notFound, invalid] = (await res.json()).results;
    expect(ok.quote.symbol).toBe('THYAO');
    expect(notFound.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(invalid.error.message).toMatch(/Ungültiges Kürzel/);
  });

  it('cacht Kurse kurz und lädt danach neu', async () => {
    let t = 0;
    const { deps, market } = fakeDeps();
    const api = createApi({}, { ...deps, cache: new TtlCache(50, () => t) });
    await get(api, '/api/quote?s=THYAO.IS');
    await get(api, '/api/quote?s=THYAO.IS');
    expect(market.getQuote).toHaveBeenCalledTimes(1);
    t = 10_001;
    await get(api, '/api/quote?s=THYAO.IS');
    expect(market.getQuote).toHaveBeenCalledTimes(2);
  });

  it('gleichzeitige identische Anfragen teilen sich einen Abruf', async () => {
    const { deps, market } = fakeDeps();
    const api = createApi({}, deps);
    await Promise.all([get(api, '/api/quote?s=AAPL'), get(api, '/api/quote?s=AAPL'), get(api, '/api/quote?s=AAPL')]);
    expect(market.getQuote).toHaveBeenCalledTimes(1);
  });
});

describe('Fehlerabbildung', () => {
  it.each([
    ['NOT_FOUND', 404],
    ['RATE_LIMITED', 429],
    ['BLOCKED', 502],
    ['UPSTREAM', 502],
    ['BAD_RESPONSE', 502],
    ['UNSUPPORTED', 422],
    ['CONFIG', 500],
  ] as const)('%s → HTTP %i', async (code, status) => {
    const { deps } = fakeDeps({
      market: {
        getCandles: async () => {
          throw new AdapterError(code, 'x', 'yahoo');
        },
      },
    });
    const res = await get(createApi({}, deps), '/api/candles?s=AAPL&tf=1J');
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
  });

  it('gibt bei unerwarteten Fehlern keine Details preis', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps } = fakeDeps({
      market: {
        getDailyHistory: async () => {
          throw new Error('Datenbankpasswort=hunter2');
        },
      },
    });
    const res = await get(createApi({}, deps), '/api/history?s=AAPL');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('hunter2');
    spy.mockRestore();
  });

  it('cacht keine Fehler', async () => {
    let calls = 0;
    const { deps } = fakeDeps({
      market: {
        getDailyHistory: async () => {
          if (++calls === 1) throw new AdapterError('RATE_LIMITED', 'zu viele', 'yahoo');
          return { candles: [], source: 'fake', interval: '1d', droppedBars: 0 };
        },
      },
    });
    const api = createApi({}, deps);
    expect((await get(api, '/api/history?s=AAPL')).status).toBe(429);
    expect((await get(api, '/api/history?s=AAPL')).status).toBe(200);
  });
});

describe('News und Suche', () => {
  it('gibt News samt Quellenfehlern zurück und reicht den Firmennamen weiter', async () => {
    const item = { id: '1', symbol: 'THYAO', kind: 'news', title: 'T', url: 'https://x', source: 's', publishedAt: 1, language: 'tr' };
    const { deps, news } = fakeDeps({
      news: { getNews: vi.fn(async () => ({ items: [item, { ...item, id: '2' }, { ...item, id: '3' }], errors: [new AdapterError('BLOCKED', 'geblockt', 'kap')] })) as any },
    });
    const body = await (await get(createApi({}, deps), '/api/news?s=THYAO.IS&name=T%C3%BCrk%20Hava&limit=2')).json();
    expect(body.items).toHaveLength(2);
    expect(body.errors).toEqual([{ adapter: 'kap', code: 'BLOCKED', message: '[kap] geblockt' }]);
    expect(news.getNews.mock.calls[0]![0]).toMatchObject({ symbol: 'THYAO', market: 'BIST', name: 'Türk Hava' });
  });

  it('kürzt so, dass offizielle KAP-Meldungen nicht hinter neueren Pressemeldungen herausfallen', async () => {
    const mk = (id: string, kind: string, publishedAt: number) => ({ id, symbol: 'THYAO', kind, title: id, url: 'https://x', source: 's', publishedAt, language: 'tr' });
    const items = [...Array.from({ length: 6 }, (_, i) => mk(`p${i}`, 'news', 100 - i)), mk('kap1', 'kap', 1)];
    const { deps } = fakeDeps({ news: { getNews: vi.fn(async () => ({ items, errors: [] })) as any } });
    const body = await (await get(createApi({}, deps), '/api/news?s=THYAO.IS&limit=3')).json();
    expect(body.items).toHaveLength(3);
    expect(body.items.map((i: { id: string }) => i.id)).toContain('kap1');
  });

  it('nutzt ohne limit den Standardwert (40) und begrenzt auf 1..100', async () => {
    const item = (n: number) => ({ id: String(n), symbol: 'AAPL', kind: 'news', title: `T${n}`, url: 'https://x', source: 's', publishedAt: n, language: 'en' });
    const many = Array.from({ length: 150 }, (_, i) => item(i));
    const { deps } = fakeDeps({ news: { getNews: vi.fn(async () => ({ items: many, errors: [] })) as any } });
    const api = createApi({}, deps);
    const count = async (q: string) => (await (await get(api, `/api/news?s=AAPL${q}`)).json()).items.length;
    expect(await count('')).toBe(40);
    expect(await count('&limit=')).toBe(40);
    expect(await count('&limit=abc')).toBe(40);
    expect(await count('&limit=0')).toBe(1);
    expect(await count('&limit=500')).toBe(100);
    expect(await count('&limit=7')).toBe(7);
  });

  it('sucht und cacht die Suche', async () => {
    const { deps, search } = fakeDeps({ search: vi.fn(async () => [{ symbol: 'SAP', market: 'XETRA', name: 'SAP SE', ticker: 'SAP.DE', marketLabel: 'XETRA' }]) as any });
    const api = createApi({}, deps);
    const a = await (await get(api, '/api/search?q=SAP')).json();
    await get(api, '/api/search?q=sap');
    expect(a.results[0].ticker).toBe('SAP.DE');
    expect(search).toHaveBeenCalledTimes(1); // Groß-/Kleinschreibung egal
  });
});

describe('TtlCache', () => {
  it('verdrängt bei Überlauf abgelaufene und dann die ältesten Einträge', async () => {
    let t = 0;
    const c = new TtlCache(2, () => t);
    await c.get('a', 100, async () => 1);
    await c.get('b', 100, async () => 2);
    await c.get('c', 100, async () => 3);
    expect(c.size).toBe(2);
    t = 200;
    await c.get('d', 100, async () => 4);
    expect(c.size).toBe(1); // a/b/c abgelaufen bzw. verdrängt
  });
});

describe('toNodeHandler (echter HTTP-Server)', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  it('reicht Pfad, Query und Header durch und schreibt Status und Body zurück', async () => {
    const { deps } = fakeDeps();
    server = createServer(toNodeHandler(createApi({ APP_TOKEN: 't' }, deps)));
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const denied = await fetch(`${base}/api/quote?s=THYAO.IS`);
    expect(denied.status).toBe(401);

    const ok = await fetch(`${base}/api/quote?s=THYAO.IS,AAPL`, { headers: { authorization: 'Bearer t' } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).results).toHaveLength(2);
    expect(ok.headers.get('cache-control')).toBe('no-store');
  });

  it('fängt Fehler im Handler ab', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    server = createServer(
      toNodeHandler(async () => {
        throw new Error('boom');
      }),
    );
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/x`);
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('INTERNAL');
    spy.mockRestore();
  });
});
