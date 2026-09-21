import { describe, expect, it, vi } from 'vitest';
import {
  AdapterError,
  AnalysisService,
  FORCE_INTERVAL_MS,
  MemoryKv,
  MIN_INTERVAL_MS,
  NEWS_PROMPT_VERSION,
  NewsService,
  ResilientKv,
  SupabaseKv,
  technicalInputHash,
  computeTechnicalSnapshot,
  type Candle,
  type GenerateRequest,
  type Instrument,
  type KeyValueStore,
  type LLMProvider,
  type MarketDataAdapter,
  type NewsAdapter,
  type NewsItem,
} from '../src';
import { json, mockFetch, text } from './mock-fetch';
import { readJsonFixture } from './helpers';

const ref = readJsonFixture<{ candles: Candle[] }>('thyao-1d.reference.json');
const THYAO: Instrument = { symbol: 'THYAO', market: 'BIST', name: 'Türk Hava Yolları' };
const AAPL: Instrument = { symbol: 'AAPL', market: 'US' };
const T0 = Date.UTC(2026, 8, 21, 9);

/** Fake-Markt: liefert die THYAO-Historie (für FX-Paare eine einfache Reihe). `bump` verschiebt den letzten Kurs. */
function fakeMarket() {
  const state = { bump: 0 };
  const calls: string[] = [];
  const market: MarketDataAdapter = {
    id: 'fake',
    supports: () => true,
    getQuote: async (i) => {
      calls.push(`quote:${i.symbol}`);
      return { symbol: i.symbol, market: i.market, price: 285.25, previousClose: 285.5, change: -0.25, changePercent: -0.09, dayHigh: 290.5, dayLow: 282.5, volume: 1, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, currency: 'TRY', asOf: 1, freshness: { kind: 'delayed', minutes: 15 }, source: 'fake' };
    },
    getCandles: async () => ({ candles: [], source: 'fake', interval: '1d', droppedBars: 0 }),
    getDailyHistory: async (i) => {
      calls.push(`history:${i.symbol}`);
      if (i.symbol.endsWith('TRY=X')) {
        const rate = i.symbol.startsWith('USD') ? 30 : 33;
        return { candles: ref.candles.map((c) => ({ ...c, open: rate, high: rate, low: rate, close: rate })), source: 'fake', interval: '1d', droppedBars: 0 };
      }
      const candles = ref.candles.map((c, idx, arr) => (idx === arr.length - 1 ? { ...c, close: c.close + state.bump, high: c.high + Math.max(0, state.bump) } : c));
      return { candles, source: 'fake', interval: '1d', droppedBars: 6 };
    },
  };
  return { market, state, calls };
}

const item = (id: string, kind: 'kap' | 'news' = 'news', t = T0 - 3_600_000): NewsItem => ({ id, symbol: 'THYAO', kind, title: `Meldung ${id}`, url: `https://x/${id}`, source: 'Presse', publishedAt: t, language: 'tr' });

function fakeNews(items: NewsItem[] = []) {
  const state = { items, calls: 0, fail: false };
  const adapter: NewsAdapter = {
    id: 'fake',
    supports: () => true,
    getNews: async () => {
      state.calls++;
      if (state.fail) throw new AdapterError('BLOCKED', 'kap geblockt', 'fake');
      return state.items;
    },
  };
  return { service: new NewsService([adapter]), state };
}

/** Fake-KI, die je nach Aufgabe eine gültige Antwort liefert. */
function fakeLlm(behavior: { fail?: () => Error | null } = {}) {
  const requests: GenerateRequest[] = [];
  const llm: LLMProvider = {
    id: 'fake',
    model: 'fake-1',
    generateJSON: async (req) => {
      requests.push(req);
      const err = behavior.fail?.();
      if (err) throw err;
      const data =
        req.task === 'news'
          ? {
              items: (JSON.parse(/```json\s*([\s\S]*?)\s*```/.exec(req.prompt)![1]!).items as { id: string }[]).map((n) => ({ id: n.id, sentiment: 'neutral', relevance: 2, titleLocal: 'Titel', reason: 'Grund.' })),
              overall: { summary: 'Gemischt.', argumentsFor: [], argumentsAgainst: [] },
            }
          : {
              verdict: 'neutral',
              confidence: 'mittel',
              plain: { headline: 'Der Kurs bewegt sich seitwärts.', explanation: 'Es gibt keine klare Richtung.', pros: ['Kein starker Absturz.'], cons: ['Kein klarer Aufwärtstrend.'] },
              summary: 'Seitwärts.',
              argumentsFor: ['Dafür.'],
              argumentsAgainst: ['Dagegen.'],
              risks: ['Risiko.'],
              entry: { candidateId: 'E2', comment: 'Rücksetzer.' },
              stopLoss: { candidateId: 'SL2', comment: 'Unter Unterstützung.' },
              targets: [{ candidateId: 'T2', comment: 'Ziel.' }],
              horizon: 'mittelfristig',
              horizonComment: 'Wochen.',
            };
      return { data, raw: '', provider: 'fake', model: 'fake-1', usage: { inputTokens: 100, outputTokens: 50 } };
    },
  };
  return { llm, requests };
}

function setup(opts: { news?: NewsItem[]; dailyLimit?: number; llm?: LLMProvider | null; kv?: KeyValueStore } = {}) {
  const clock = { now: T0 };
  const m = fakeMarket();
  const n = fakeNews(opts.news);
  const l = fakeLlm();
  const kv = opts.kv ?? new MemoryKv(() => clock.now);
  const service = new AnalysisService({
    llm: opts.llm === undefined ? l.llm : opts.llm,
    kv,
    market: m.market,
    news: n.service,
    now: () => clock.now,
    dailyLimit: opts.dailyLimit,
  });
  return { service, clock, market: m, news: n, llm: l, kv };
}

describe('AnalysisService: technische Auswertung', () => {
  it('ohne KI-Anbieter: klare CONFIG-Meldung', async () => {
    const { service } = setup({ llm: null });
    expect(service.configured).toBe(false);
    const err = await service.technical(THYAO).catch((e) => e);
    expect(err.code).toBe('CONFIG');
    expect(err.message).toMatch(/GEMINI_API_KEY/);
  });

  it('erstellt die Auswertung einmal und liefert sie danach ohne Datenabruf aus dem Speicher', async () => {
    const { service, clock, market, llm } = setup();
    const first = await service.technical(THYAO);
    expect(first.meta).toMatchObject({ cached: false, stale: false, provider: 'fake', model: 'fake-1', generatedAt: T0, demo: false });
    expect(first.analysis.entry.candidate?.id).toBe('E2');
    expect(llm.requests).toHaveLength(1);

    const callsBefore = market.calls.length;
    clock.now += 30 * 60_000;
    const second = await service.technical(THYAO);
    expect(second.meta.cached).toBe(true);
    expect(second.analysis).toEqual(first.analysis);
    expect(market.calls.length).toBe(callsBefore); // gar keine Datenabfrage
    expect(llm.requests).toHaveLength(1);
  });

  it('nach über einer Stunde: bei unveränderten Daten bleibt die Auswertung gültig (keine neue KI-Anfrage)', async () => {
    const { service, clock, llm } = setup();
    await service.technical(THYAO);
    clock.now += MIN_INTERVAL_MS + 1;
    const r = await service.technical(THYAO);
    expect(r.meta.cached).toBe(true);
    expect(llm.requests).toHaveLength(1);
  });

  it('nach über einer Stunde und deutlicher Kursbewegung: neue Auswertung', async () => {
    const { service, clock, market, llm } = setup();
    await service.technical(THYAO);
    clock.now += MIN_INTERVAL_MS + 1;
    market.state.bump = 12; // > halbe ATR (≈ 4,6)
    const r = await service.technical(THYAO);
    expect(r.meta).toMatchObject({ cached: false, generatedAt: clock.now });
    expect(llm.requests).toHaveLength(2);
  });

  it('kleine Kursschwankungen erzeugen keine neue Auswertung', async () => {
    const { service, clock, market, llm } = setup();
    await service.technical(THYAO);
    clock.now += MIN_INTERVAL_MS + 1;
    market.state.bump = 0.5;
    await service.technical(THYAO);
    expect(llm.requests).toHaveLength(1);
  });

  it('manuelle Aktualisierung: innerhalb von 10 Minuten abgelehnt, danach erlaubt', async () => {
    const { service, clock, llm } = setup();
    await service.technical(THYAO);
    clock.now += 5 * 60_000;
    const blocked = await service.technical(THYAO, { force: true });
    expect(blocked.meta).toMatchObject({ cached: true, refreshBlocked: true });
    expect(blocked.meta.note).toEqual({ code: 'refreshTooSoon', params: { minutes: 5 } });
    expect(llm.requests).toHaveLength(1);

    clock.now += FORCE_INTERVAL_MS;
    const forced = await service.technical(THYAO, { force: true });
    expect(forced.meta).toMatchObject({ cached: false, refreshBlocked: false });
    expect(llm.requests).toHaveLength(2);
  });

  it('liefert bei KI-Ausfall die alte Auswertung als veraltet, ohne alte Auswertung den Fehler', async () => {
    const failing = { on: false };
    const l = fakeLlm({ fail: () => (failing.on ? new AdapterError('RATE_LIMITED', 'Limit erreicht', 'gemini') : null) });
    const { service, clock, market } = setup({ llm: l.llm });
    await service.technical(THYAO);
    clock.now += MIN_INTERVAL_MS + 1;
    market.state.bump = 12;
    failing.on = true;
    const stale = await service.technical(THYAO);
    expect(stale.meta).toMatchObject({ cached: true, stale: true });
    expect(stale.meta.note).toMatchObject({ code: 'analysisFailed' });
    expect(String(stale.meta.note!.params!.detail)).toMatch(/Limit erreicht/);

    const fresh = setup({ llm: fakeLlm({ fail: () => new AdapterError('RATE_LIMITED', 'Limit', 'gemini') }).llm });
    const err = await fresh.service.technical(THYAO).catch((e) => e);
    expect(err.code).toBe('RATE_LIMITED');
  });

  it('liefert bei Datenausfall die alte Auswertung als veraltet', async () => {
    const { service, clock, market } = setup();
    await service.technical(THYAO);
    clock.now += MIN_INTERVAL_MS + 1;
    market.market.getDailyHistory = async () => {
      throw new AdapterError('BLOCKED', 'geblockt', 'yahoo');
    };
    const r = await service.technical(THYAO);
    expect(r.meta).toMatchObject({ cached: true, stale: true });
    expect(r.meta.note).toMatchObject({ code: 'dataRefreshFailed' });
    expect(String(r.meta.note!.params!.detail)).toMatch(/geblockt/);
  });

  it('Tageslimit: keine neue KI-Anfrage, alte Auswertung als veraltet bzw. Fehler', async () => {
    const { service, clock, market, llm } = setup({ dailyLimit: 1 });
    await service.technical(THYAO); // verbraucht das Budget
    expect(llm.requests).toHaveLength(1);

    clock.now += MIN_INTERVAL_MS + 1;
    market.state.bump = 12;
    const stale = await service.technical(THYAO);
    expect(stale.meta).toMatchObject({ cached: true, stale: true });
    expect(stale.meta.note).toEqual({ code: 'dailyLimit', params: { limit: 1 } });

    const err = await service.technical(AAPL).catch((e) => e);
    expect(err.code).toBe('RATE_LIMITED');
    expect(llm.requests).toHaveLength(1);

    clock.now += 24 * 3_600_000; // nächster Tag: neues Budget
    const next = await service.technical(AAPL);
    expect(next.meta.cached).toBe(false);
  });

  it('ignoriert gespeicherte Auswertungen einer anderen Prompt-Version', async () => {
    const kv = new MemoryKv(() => T0);
    await kv.set('analysis:technical:BIST:THYAO:de', { promptVersion: -1, createdAt: T0, inputHash: 'x', provider: 'alt', model: 'alt', attempts: 1, guardRemoved: 0, analysis: { veraltet: true } });
    const { service, llm } = setup({ kv });
    const r = await service.technical(THYAO);
    expect(r.meta.provider).toBe('fake');
    expect(llm.requests).toHaveLength(1);
  });

  it('BIST: holt USD- und EUR-Kurse und schickt die Währungsvergleiche an die KI, US-Aktien nicht', async () => {
    const bist = setup();
    await bist.service.technical(THYAO);
    expect(bist.market.calls).toEqual(expect.arrayContaining(['history:USDTRY=X', 'history:EURTRY=X']));
    const payload = JSON.parse(/```json\s*([\s\S]*?)\s*```/.exec(bist.llm.requests[0]!.prompt)![1]!);
    expect(payload.fxPerformance.map((p: { currency: string }) => p.currency)).toEqual(['USD', 'EUR']);
    expect(payload.dataWarnings.join(' ')).toMatch(/6 unvollständige Kerzen/);

    const us = setup();
    await us.service.technical(AAPL);
    expect(us.market.calls.some((c) => c.includes('TRY=X'))).toBe(false);
    expect(JSON.parse(/```json\s*([\s\S]*?)\s*```/.exec(us.llm.requests[0]!.prompt)![1]!)).not.toHaveProperty('fxPerformance');
  });

  it('funktioniert ohne Wechselkursdaten und ohne Kurs (mit Datenhinweis)', async () => {
    const { service, market, llm } = setup();
    const orig = market.market.getDailyHistory;
    market.market.getDailyHistory = async (i) => {
      if (i.symbol.endsWith('TRY=X')) throw new AdapterError('BLOCKED', 'x', 'yahoo');
      return orig(i);
    };
    market.market.getQuote = async () => {
      throw new AdapterError('BLOCKED', 'x', 'yahoo');
    };
    const r = await service.technical(THYAO);
    expect(r.meta.cached).toBe(false);
    const payload = JSON.parse(/```json\s*([\s\S]*?)\s*```/.exec(llm.requests[0]!.prompt)![1]!);
    expect(payload.quote).toBeNull();
    expect(payload.dataWarnings.join(' ')).toMatch(/Wechselkursdaten/);
  });
});

describe('AnalysisService: offizielle KAP-Meldungen in der technischen Auswertung', () => {
  const promptPayload = (req: GenerateRequest) => JSON.parse(/```json\s*([\s\S]*?)\s*```/.exec(req.prompt)![1]!);
  const kap = (id: string, ageMs = 3_600_000): NewsItem => ({ ...item(id, 'kap', T0 - ageMs), category: 'Özel Durum Açıklaması (Genel)', title: `Pay Dağıtım ${id}` });

  it('BIST: die KI bekommt die neuesten KAP-Meldungen, Presse-Meldungen nicht', async () => {
    const { service, llm } = setup({ news: [kap('k1'), item('p1')] });
    await service.technical(THYAO);
    const payload = promptPayload(llm.requests[0]!);
    expect(payload.kapMeldungen).toHaveLength(1);
    expect(payload.kapMeldungen[0]).toMatchObject({ titel: 'Pay Dağıtım k1', kategorie: 'Özel Durum Açıklaması (Genel)' });
  });

  it('BIST: ältere KAP-Meldungen (über 14 Tage) zählen nicht, die Liste bleibt leer statt zu fehlen', async () => {
    const { service, llm } = setup({ news: [kap('alt', 20 * 86_400_000)] });
    await service.technical(THYAO);
    expect(promptPayload(llm.requests[0]!).kapMeldungen).toEqual([]);
  });

  it('US-Aktie: keine KAP-Abfrage und kein KAP-Feld', async () => {
    const { service, llm, news } = setup({ news: [kap('k1')] });
    await service.technical(AAPL);
    expect(news.state.calls).toBe(0);
    expect(promptPayload(llm.requests[0]!)).not.toHaveProperty('kapMeldungen');
  });

  it('KAP nicht abrufbar: Auswertung läuft weiter, die KI erfährt es als Datenhinweis', async () => {
    const { service, llm, news } = setup();
    news.state.fail = true;
    const r = await service.technical(THYAO);
    expect(r.meta.cached).toBe(false);
    const payload = promptPayload(llm.requests[0]!);
    expect(payload).not.toHaveProperty('kapMeldungen');
    expect(payload.dataWarnings.join(' ')).toMatch(/KAP-Meldungen waren nicht abrufbar/);
  });

  it('eine neue KAP-Meldung löst nach dem Mindestabstand eine neue Einschätzung aus, ohne sie nicht', async () => {
    const { service, clock, llm, news } = setup({ news: [kap('k1')] });
    await service.technical(THYAO);
    clock.now += MIN_INTERVAL_MS + 1;
    await service.technical(THYAO);
    expect(llm.requests).toHaveLength(1);

    news.state.items = [kap('k2'), kap('k1')];
    clock.now += MIN_INTERVAL_MS + 1;
    await service.technical(THYAO);
    expect(llm.requests).toHaveLength(2);
  });

  it('technicalInputHash unterscheidet Meldungslisten unabhängig von der Reihenfolge', () => {
    const snap = computeTechnicalSnapshot(ref.candles);
    expect(technicalInputHash(snap, ['a', 'b'])).toBe(technicalInputHash(snap, ['b', 'a']));
    expect(technicalInputHash(snap, ['a'])).not.toBe(technicalInputHash(snap, ['a', 'b']));
    expect(technicalInputHash(snap)).toBe(technicalInputHash(snap, []));
  });
});

describe('technicalInputHash', () => {
  const snap = computeTechnicalSnapshot(ref.candles);
  it('bleibt bei kleinen Kursänderungen gleich und ändert sich bei großen', () => {
    const base = technicalInputHash(snap);
    expect(technicalInputHash({ ...snap, price: snap.price + 0.2 })).toBe(base);
    expect(technicalInputHash({ ...snap, price: snap.price + 10 })).not.toBe(base);
  });
  it('ändert sich bei neuer Tageskerze, Trend- oder Signalwechsel', () => {
    const base = technicalInputHash(snap);
    expect(technicalInputHash({ ...snap, asOf: snap.asOf + 86_400 })).not.toBe(base);
    expect(technicalInputHash({ ...snap, trend: { ...snap.trend, state: 'aufwärts' } })).not.toBe(base);
    expect(technicalInputHash({ ...snap, rsi14: { ...snap.rsi14, zone: 'überkauft' } })).not.toBe(base);
  });
});

describe('AnalysisService: News-Auswertung', () => {
  it('ohne Meldungen: keine KI-Anfrage', async () => {
    const { service, llm } = setup({ news: [] });
    const r = await service.news(THYAO);
    expect(r.analysis.overall.summary).toBe('');
    expect(r.analysis.byId).toEqual({});
    expect(r.meta.provider).toBe('none');
    expect(llm.requests).toHaveLength(0);
  });

  it('bewertet Meldungen und erneuert nur, wenn neue Meldungen dazukommen', async () => {
    const { service, clock, news, llm } = setup({ news: [item('a'), item('b')] });
    const first = await service.news(THYAO, { name: 'Türk Hava Yolları' });
    expect(Object.keys(first.analysis.byId).sort()).toEqual(['a', 'b']);
    expect(first.meta.cached).toBe(false);

    clock.now += MIN_INTERVAL_MS + 1;
    const same = await service.news(THYAO);
    expect(same.meta.cached).toBe(true);
    expect(llm.requests).toHaveLength(1);
    expect(news.state.calls).toBe(2); // Meldungen wurden neu geladen, Ergebnis blieb gültig

    news.state.items = [item('a'), item('b'), item('c')];
    clock.now += MIN_INTERVAL_MS + 1;
    const updated = await service.news(THYAO);
    expect(updated.meta.cached).toBe(false);
    expect(Object.keys(updated.analysis.byId).sort()).toEqual(['a', 'b', 'c']);
    expect(llm.requests).toHaveLength(2);
    expect(NEWS_PROMPT_VERSION).toBeGreaterThan(0);
  });

  it('innerhalb der Stunde wird nichts neu geladen', async () => {
    const { service, clock, news } = setup({ news: [item('a')] });
    await service.news(THYAO);
    clock.now += 10 * 60_000;
    await service.news(THYAO);
    expect(news.state.calls).toBe(1);
  });
});

describe('SupabaseKv', () => {
  const opts = { url: 'https://proj.supabase.co/', serviceKey: 'SERVICE', sleep: async () => {} };

  it('liest einen Eintrag über die REST-Schnittstelle mit Key im Header', async () => {
    const m = mockFetch(json([{ value: { a: 1 }, updated_at: '2026-09-21T09:00:00+00:00' }]));
    const kv = new SupabaseKv({ ...opts, fetch: m.fetch });
    const got = await kv.get<{ a: number }>('analysis:technical:BIST:THYAO');
    expect(got).toEqual({ value: { a: 1 }, updatedAt: Date.UTC(2026, 8, 21, 9) });
    const call = m.calls[0]!;
    expect(call.url).toBe('https://proj.supabase.co/rest/v1/kv_cache?key=eq.analysis%3Atechnical%3ABIST%3ATHYAO&select=value,updated_at&limit=1');
    expect(call.init!.headers).toMatchObject({ apikey: 'SERVICE', authorization: 'Bearer SERVICE' });
  });

  it('liefert null für unbekannte Schlüssel', async () => {
    expect(await new SupabaseKv({ ...opts, fetch: mockFetch(json([])).fetch }).get('x')).toBeNull();
  });

  it('schreibt per Upsert', async () => {
    const m = mockFetch(new Response(null, { status: 201 }));
    await new SupabaseKv({ ...opts, fetch: m.fetch }).set('k', { z: 2 });
    const call = m.calls[0]!;
    expect(call.url).toBe('https://proj.supabase.co/rest/v1/kv_cache?on_conflict=key');
    expect(call.init!.method).toBe('POST');
    expect((call.init!.headers as Record<string, string>).prefer).toContain('merge-duplicates');
    const body = JSON.parse(call.init!.body as string);
    expect(body).toMatchObject({ key: 'k', value: { z: 2 } });
    expect(Date.parse(body.updated_at)).not.toBeNaN();
  });

  it('meldet falschen Key, Serverfehler und ungültige Antworten', async () => {
    const get = (res: Response) => new SupabaseKv({ ...opts, fetch: mockFetch(res).fetch }).get('x').catch((e) => e);
    expect((await get(text('', 401))).code).toBe('CONFIG');
    expect((await get(text('', 500))).code).toBe('UPSTREAM');
    expect((await get(json({ nope: 1 }))).code).toBe('BAD_RESPONSE');
    const set = await new SupabaseKv({ ...opts, fetch: mockFetch(json({ message: 'relation does not exist' }, 404)).fetch }).set('k', 1).catch((e) => e);
    expect(set.code).toBe('UPSTREAM');
    expect(() => new SupabaseKv({ url: '', serviceKey: '' })).toThrow(/SUPABASE_URL/);
  });
});

describe('ResilientKv', () => {
  it('fällt bei Ausfall des Hauptspeichers auf den Arbeitsspeicher zurück', async () => {
    const broken: KeyValueStore = {
      get: async () => {
        throw new Error('down');
      },
      set: async () => {
        throw new Error('down');
      },
    };
    const errors: unknown[] = [];
    const kv = new ResilientKv(broken, new MemoryKv(), (e) => errors.push(e));
    await kv.set('a', { v: 1 });
    expect((await kv.get<{ v: number }>('a'))?.value).toEqual({ v: 1 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('bevorzugt den Hauptspeicher, wenn er läuft', async () => {
    const primary = new MemoryKv();
    await primary.set('a', 'haupt');
    const kv = new ResilientKv(primary, new MemoryKv());
    expect((await kv.get('a'))?.value).toBe('haupt');
    expect(await kv.get('zzz')).toBeNull();
  });

  it('die Auswertung läuft auch bei defektem Speicher weiter', async () => {
    const broken: KeyValueStore = {
      get: async () => {
        throw new Error('down');
      },
      set: async () => {
        throw new Error('down');
      },
    };
    const spy = vi.fn();
    const { service } = setup({ kv: new ResilientKv(broken, new MemoryKv(), spy) });
    const r = await service.technical(THYAO);
    expect(r.meta.cached).toBe(false);
    expect(spy).toHaveBeenCalled();
  });
});
