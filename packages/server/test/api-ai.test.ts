import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { AdapterError, AnalysisService, DemoProvider, MemoryKv, NewsService, type AnalysisService as AnalysisServiceType, type Candle, type MarketDataAdapter, type NewsAdapter, type NewsItem } from '@aktien/core';
import { CachingMarket, createApi, createDeps, TtlCache, type ApiDeps } from '../src';

const ref = JSON.parse(readFileSync(fileURLToPath(new URL('../../core/test/fixtures/thyao-1d.reference.json', import.meta.url)), 'utf-8')) as { candles: Candle[] };

const get = (api: (r: Request) => Promise<Response>, path: string, headers: Record<string, string> = {}) => api(new Request(`https://app.test${path}`, { headers }));

const baseDeps = (): ApiDeps => ({
  market: {} as MarketDataAdapter,
  news: {} as NewsService,
  search: async () => [],
});

const stubService = (over: Partial<Record<'technical' | 'news' | 'configured', unknown>> = {}) =>
  ({
    configured: true,
    technical: vi.fn(async () => ({ analysis: { verdict: 'neutral' }, meta: { cached: false } })),
    news: vi.fn(async () => ({ analysis: { byId: {} }, meta: { cached: false } })),
    ...over,
  }) as unknown as AnalysisServiceType & { technical: ReturnType<typeof vi.fn>; news: ReturnType<typeof vi.fn> };

describe('/api/analysis und /api/news-analysis', () => {
  it('antworten ohne KI-Anbieter mit 503 und klarer Anleitung', async () => {
    const api = createApi({}, baseDeps());
    for (const route of ['analysis', 'news-analysis']) {
      const res = await get(api, `/api/${route}?s=THYAO.IS`);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.code).toBe('AI_NOT_CONFIGURED');
      expect(body.error.message).toMatch(/GEMINI_API_KEY/);
    }
    const unconfigured = createApi({}, { ...baseDeps(), analysis: stubService({ configured: false }) });
    expect((await get(unconfigured, '/api/analysis?s=THYAO.IS')).status).toBe(503);
  });

  it('verlangen das Zugriffstoken', async () => {
    const svc = stubService();
    const api = createApi({ APP_TOKEN: 't' }, { ...baseDeps(), analysis: svc });
    expect((await get(api, '/api/analysis?s=THYAO.IS')).status).toBe(401);
    expect((await get(api, '/api/news-analysis?s=THYAO.IS')).status).toBe(401);
    expect(svc.technical).not.toHaveBeenCalled();
    expect((await get(api, '/api/analysis?s=THYAO.IS', { authorization: 'Bearer t' })).status).toBe(200);
  });

  it('reichen Instrument, Namen und refresh an den Dienst weiter', async () => {
    const svc = stubService();
    const api = createApi({}, { ...baseDeps(), analysis: svc });
    await get(api, '/api/analysis?s=thyao.is&name=T%C3%BCrk%20Hava&refresh=1');
    expect(svc.technical).toHaveBeenCalledWith({ symbol: 'THYAO', market: 'BIST', name: 'Türk Hava' }, { force: true });
    await get(api, '/api/news-analysis?s=AAPL');
    expect(svc.news).toHaveBeenCalledWith({ symbol: 'AAPL', market: 'US', name: undefined }, { force: false, name: undefined });
  });

  it('prüfen die Eingabe', async () => {
    const svc = stubService();
    const api = createApi({}, { ...baseDeps(), analysis: svc });
    expect((await get(api, '/api/analysis')).status).toBe(400);
    expect((await get(api, '/api/analysis?s=' + encodeURIComponent('../x'))).status).toBe(400);
    expect(svc.technical).not.toHaveBeenCalled();
  });

  it('bilden Fehler des Dienstes ab, ohne Details preiszugeben', async () => {
    const svc = stubService({
      technical: vi.fn(async () => {
        throw new AdapterError('RATE_LIMITED', 'Tageslimit für KI-Abfragen erreicht (300).', 'analysis');
      }),
    });
    const res = await get(createApi({}, { ...baseDeps(), analysis: svc }), '/api/analysis?s=AAPL');
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('fassen gleichzeitige gleiche Anfragen zu einer KI-Auswertung zusammen', async () => {
    const svc = stubService();
    const api = createApi({}, { ...baseDeps(), analysis: svc });
    await Promise.all([1, 2, 3].map(() => get(api, '/api/analysis?s=AAPL')));
    expect(svc.technical).toHaveBeenCalledTimes(1);
  });
});

describe('Gesamtdurchlauf mit Demo-Anbieter (HTTP → Dienst → Analyse → Speicher)', () => {
  const market: MarketDataAdapter = {
    id: 'fake',
    supports: () => true,
    getQuote: async (i) => ({ symbol: i.symbol, market: i.market, price: 285.25, previousClose: 285.5, change: -0.25, changePercent: -0.09, dayHigh: 290.5, dayLow: 282.5, volume: 1, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, currency: 'TRY', asOf: 1, freshness: { kind: 'delayed', minutes: 15 }, source: 'fake' }),
    getCandles: async () => ({ candles: [], source: 'fake', interval: '1d', droppedBars: 0 }),
    getDailyHistory: async (i) => ({
      candles: i.symbol.endsWith('TRY=X') ? ref.candles.map((c) => ({ ...c, open: 30, high: 30, low: 30, close: 30 })) : ref.candles,
      source: 'fake',
      interval: '1d',
      droppedBars: 0,
    }),
  };
  const items: NewsItem[] = [{ id: 'gn:1', symbol: 'THYAO', kind: 'news', title: 'THY yeni uçak siparişi verdi', url: 'https://x', source: 'Presse', publishedAt: Date.now() - 3_600_000, language: 'tr' }];
  const newsAdapter: NewsAdapter = { id: 'fake', supports: () => true, getNews: async () => items };

  const build = () => {
    const analysis = new AnalysisService({ llm: new DemoProvider(), kv: new MemoryKv(), market, news: new NewsService([newsAdapter]) });
    return createApi({}, { ...baseDeps(), analysis, aiInfo: { configured: true, providers: ['demo'], storage: 'memory' } });
  };

  it('liefert eine vollständige technische Auswertung und danach dieselbe aus dem Speicher', async () => {
    const api = build();
    const first = await (await get(api, '/api/analysis?s=THYAO.IS&name=THY')).json();
    expect(first.meta).toMatchObject({ provider: 'demo', demo: true, cached: false, stale: false });
    expect(first.analysis).toMatchObject({ verdict: expect.stringMatching(/bullish|neutral|bearish/), confidence: 'niedrig' });
    expect(first.analysis.argumentsFor.length).toBeGreaterThan(0);
    expect(first.analysis.argumentsAgainst.length).toBeGreaterThan(0);
    expect(first.analysis.notes).toEqual([]);

    const second = await (await get(api, '/api/analysis?s=THYAO.IS&name=THY')).json();
    expect(second.meta.cached).toBe(true);
    expect(second.meta.generatedAt).toBe(first.meta.generatedAt);
  });

  it('liefert eine Nachrichten-Einordnung je Meldung', async () => {
    const body = await (await get(build(), '/api/news-analysis?s=THYAO.IS&name=THY')).json();
    expect(body.meta.demo).toBe(true);
    expect(body.analysis.byId['gn:1']).toMatchObject({ sentiment: 'neutral', relevance: 2 });
    expect(body.analysis.overall.summary).toMatch(/Demo/);
  });

  it('zeigt den KI-Status im Health-Check (ohne Token nötig)', async () => {
    const body = await (await get(build(), '/api/health')).json();
    expect(body.ai).toEqual({ configured: true, providers: ['demo'], storage: 'memory' });
  });
});

describe('createDeps (Umgebung → Abhängigkeiten)', () => {
  it('ohne Schlüssel: KI nicht konfiguriert, Speicher im Arbeitsspeicher', () => {
    const d = createDeps({});
    expect(d.aiInfo).toEqual({ configured: false, providers: [], storage: 'memory' });
    expect(d.analysis!.configured).toBe(false);
  });

  it('mit Gemini- und Groq-Key: beide Anbieter in fester Reihenfolge', () => {
    expect(createDeps({ GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k' }).aiInfo).toMatchObject({ configured: true, providers: ['gemini', 'groq'] });
  });

  it('AI_PROVIDER=demo aktiviert den Demo-Anbieter', () => {
    expect(createDeps({ AI_PROVIDER: 'demo' }).aiInfo).toMatchObject({ configured: true, providers: ['demo'] });
  });

  it('mit Supabase-Zugang: dauerhafter Speicher', () => {
    expect(createDeps({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 's' }).aiInfo?.storage).toBe('supabase');
    expect(createDeps({ SUPABASE_URL: 'https://x.supabase.co' }).aiInfo?.storage).toBe('memory'); // Key fehlt
  });
});

describe('CachingMarket', () => {
  it('teilt Abrufe über den Cache und nutzt getrennte Schlüssel je Aktie und Zeitraum', async () => {
    let t = 0;
    const calls: string[] = [];
    const inner: MarketDataAdapter = {
      id: 'inner',
      supports: () => true,
      getQuote: async (i) => (calls.push(`q:${i.symbol}`), { symbol: i.symbol } as never),
      getCandles: async (i, tf) => (calls.push(`c:${i.symbol}:${tf}`), { candles: [], source: 'x', interval: '1d', droppedBars: 0 }),
      getDailyHistory: async (i) => (calls.push(`h:${i.symbol}`), { candles: [], source: 'x', interval: '1d', droppedBars: 0 }),
    };
    const m = new CachingMarket(inner, new TtlCache(50, () => t));
    const thy = { symbol: 'THYAO', market: 'BIST' as const };
    await m.getQuote(thy);
    await m.getQuote(thy);
    await m.getDailyHistory(thy);
    await m.getDailyHistory(thy);
    await m.getCandles(thy, '1J');
    await m.getCandles(thy, '6M');
    await m.getQuote({ symbol: 'THYAO', market: 'US' }); // gleicher Kürzel, anderer Markt
    expect(calls).toEqual(['q:THYAO', 'h:THYAO', 'c:THYAO:1J', 'c:THYAO:6M', 'q:THYAO']);
    t = 10_001; // Kurs-Cache abgelaufen, Historie noch nicht
    await m.getQuote(thy);
    await m.getDailyHistory(thy);
    expect(calls.slice(5)).toEqual(['q:THYAO']);
    expect(m.supports(thy)).toBe(true);
  });
});
