import { describe, expect, it } from 'vitest';
import {
  AdapterError,
  dedupe,
  FinnhubNewsAdapter,
  GoogleNewsRssAdapter,
  KapAdapter,
  NewsService,
  parseKapDate,
  parseRss,
  windows,
  type Instrument,
  type NewsAdapter,
  type NewsItem,
} from '../src';
import { readFixture, readJsonFixture } from './helpers';
import { json, mockFetch, text } from './mock-fetch';

const THYAO: Instrument = { symbol: 'THYAO', market: 'BIST', name: 'Türk Hava Yolları' };
const BIMAS: Instrument = { symbol: 'BIMAS', market: 'BIST' };
const AAPL: Instrument = { symbol: 'AAPL', market: 'US' };
const SAP: Instrument = { symbol: 'SAP', market: 'XETRA', name: 'SAP SE' };

describe('Google News RSS', () => {
  const xml = readFixture('google-news-thyao.xml');

  it('zerlegt den Feed: Titel ohne Quellen-Suffix, neueste zuerst, eindeutige IDs', () => {
    const items = parseRss(xml, 'THYAO', 'tr');
    expect(items).toHaveLength(5);
    expect(new Set(items.map((i) => i.id)).size).toBe(5);
    expect(items.map((i) => i.publishedAt)).toEqual([...items.map((i) => i.publishedAt)].sort((a, b) => b - a));
    for (const i of items) {
      expect(i).toMatchObject({ symbol: 'THYAO', kind: 'news', language: 'tr' });
      expect(i.url).toMatch(/^https:\/\/news\.google\.com\//);
      expect(i.source.length).toBeGreaterThan(0);
      expect(i.title.endsWith(` - ${i.source}`)).toBe(false);
      expect(Number.isFinite(i.publishedAt)).toBe(true);
    }
  });

  it('behandelt leere Feeds und ungültiges XML', () => {
    expect(parseRss('<rss><channel><title>x</title></channel></rss>', 'X', 'de')).toEqual([]);
    expect(() => parseRss('<html></html>', 'X', 'de')).toThrow(/channel/);
  });

  it('baut die Anfrage je Markt (Sprache, Region, Zeitfenster, Firmenname)', async () => {
    const m = mockFetch(text(xml));
    const a = new GoogleNewsRssAdapter({ fetch: m.fetch, lookbackDays: 3 });
    await a.getNews(THYAO);
    await a.getNews(SAP);
    await a.getNews(AAPL);

    const [tr, de, en] = m.calls.map((c) => new URL(c.url));
    // BIST: nur der Firmenname in Anführungszeichen (das Kürzel zieht Ranglisten-Rauschen an)
    expect(tr!.searchParams.get('q')).toBe('"Türk Hava Yolları" when:3d');
    expect([tr!.searchParams.get('hl'), tr!.searchParams.get('gl'), tr!.searchParams.get('ceid')]).toEqual(['tr', 'TR', 'TR:tr']);
    expect(de!.searchParams.get('q')).toBe('SAP SE SAP when:3d');
    expect(de!.searchParams.get('hl')).toBe('de');
    expect(en!.searchParams.get('q')).toBe('AAPL when:3d');
    expect(en!.searchParams.get('ceid')).toBe('US:en');
  });

  it('BIST ohne Namen sucht mit dem Kürzel, Anführungszeichen im Namen werden entfernt', async () => {
    const m = mockFetch(text(xml));
    const a = new GoogleNewsRssAdapter({ fetch: m.fetch });
    await a.getNews({ symbol: 'ASELS', market: 'BIST' });
    await a.getNews({ symbol: 'ASELS', market: 'BIST', name: 'Asel"san' });
    expect(new URL(m.calls[0]!.url).searchParams.get('q')).toBe('ASELS when:7d');
    expect(new URL(m.calls[1]!.url).searchParams.get('q')).toBe('"Aselsan" when:7d');
  });

  it('unterstützt eine eigene Suchanfrage, since und limit', async () => {
    const m = mockFetch(text(xml));
    const items = await new GoogleNewsRssAdapter({ fetch: m.fetch, queryOverride: () => '"THY" hisse' }).getNews(THYAO, { limit: 2 });
    expect(new URL(m.calls[0]!.url).searchParams.get('q')).toBe('"THY" hisse when:7d');
    expect(items).toHaveLength(2);

    const all = parseRss(xml, 'THYAO', 'tr');
    const since = all[1]!.publishedAt;
    const recent = await new GoogleNewsRssAdapter({ fetch: mockFetch(text(xml)).fetch }).getNews(THYAO, { since });
    expect(recent.every((i) => i.publishedAt >= since)).toBe(true);
  });

  it('meldet HTTP-Fehler', async () => {
    const err = await new GoogleNewsRssAdapter({ fetch: mockFetch(text('nope', 404)).fetch }).getNews(THYAO).catch((e) => e);
    expect(err).toBeInstanceOf(AdapterError);
    expect(err.code).toBe('UPSTREAM');
  });
});

describe('KAP', () => {
  const now = Date.UTC(2026, 8, 21, 8, 0, 0);
  const fixture = () => text(readFixture('kap-sample.json'));

  it('parst das Datum als Istanbuler Zeit', () => {
    expect(parseKapDate('21.09.2026 10:47:09')).toBe(Date.UTC(2026, 8, 21, 7, 47, 9));
    expect(parseKapDate('21.09.2026')).toBe(Date.UTC(2026, 8, 20, 21, 0, 0));
    expect(parseKapDate('kaputt')).toBeNull();
  });

  it('zerlegt Zeiträume in 3-Tage-Fenster (Istanbuler Datum)', () => {
    expect(windows(Date.UTC(2026, 8, 18, 8), Date.UTC(2026, 8, 21, 8))).toEqual([
      ['2026-09-18', '2026-09-20'],
      ['2026-09-21', '2026-09-21'],
    ]);
    expect(windows(Date.UTC(2026, 8, 21, 6), Date.UTC(2026, 8, 21, 8))).toEqual([['2026-09-21', '2026-09-21']]);
  });

  it('filtert nach Kürzel, auch bei Sammelmeldungen mit vielen Kürzeln, und baut Links', async () => {
    const m = mockFetch(fixture());
    const kap = new KapAdapter({ fetch: m.fetch, now: () => now });
    const batch = await kap.getNewsBatch([THYAO, BIMAS, AAPL]);

    expect([...batch.keys()].sort()).toEqual(['BIMAS', 'THYAO']); // US-Aktie wird ignoriert
    const raw = readJsonFixture<{ disclosureIndex: number; relatedStocks: string | null; summary: string | null; subject: string | null }[]>('kap-sample.json');

    const bimas = batch.get('BIMAS')!;
    expect(bimas).toHaveLength(1);
    expect(bimas[0]).toMatchObject({ kind: 'kap', source: 'KAP', language: 'tr', symbol: 'BIMAS' });
    expect(bimas[0]!.url).toBe(`https://www.kap.org.tr/tr/Bildirim/${raw[0]!.disclosureIndex}`);
    expect(bimas[0]!.category).toBe(raw[0]!.subject);
    expect(bimas[0]!.publishedAt).toBeGreaterThan(Date.UTC(2026, 8, 1));

    const thyao = batch.get('THYAO')!;
    expect(thyao).toHaveLength(1); // THYAO steht in der Sammelmeldung
    expect(thyao[0]!.id).toMatch(/^kap:\d+:THYAO$/);
  });

  it('sendet POST mit Referer und Datumsfenstern und dedupliziert über Fenster hinweg', async () => {
    const m = mockFetch(fixture());
    const kap = new KapAdapter({ fetch: m.fetch, now: () => now });
    const items = await kap.getNews(BIMAS);

    expect(m.calls).toHaveLength(2); // 3 Tage Rückblick = 2 Fenster
    const bodies = m.calls.map((c) => JSON.parse(c.init!.body as string));
    expect(bodies[0]).toMatchObject({ fromDate: '2026-09-18', toDate: '2026-09-20', mkkMemberOidList: [], subjectList: [] });
    expect(bodies[1]).toMatchObject({ fromDate: '2026-09-21', toDate: '2026-09-21' });
    expect(m.calls[0]!.init!.method).toBe('POST');
    expect((m.calls[0]!.init!.headers as Record<string, string>).Referer).toContain('kap.org.tr');
    expect(items).toHaveLength(1); // gleiche Meldung in beiden Fenstern nur einmal
  });

  it('liefert für Aktien ohne Meldungen eine leere Liste und ignoriert Nicht-BIST', async () => {
    const m = mockFetch(fixture());
    const kap = new KapAdapter({ fetch: m.fetch, now: () => now });
    expect(await kap.getNews({ symbol: 'ASELS', market: 'BIST' })).toEqual([]);
    expect(await kap.getNews(AAPL)).toEqual([]);
    expect(kap.supports(AAPL)).toBe(false);
  });

  it('schlägt bei 2000 Einträgen laut fehl statt Meldungen still zu verlieren', async () => {
    const many = Array.from({ length: 2000 }, (_, i) => ({ publishDate: '21.09.2026 10:00:00', disclosureIndex: i, relatedStocks: 'X', summary: 's' }));
    const kap = new KapAdapter({ fetch: mockFetch(json(many)).fetch, now: () => now });
    const err = await kap.getNews(THYAO).catch((e) => e);
    expect(err.code).toBe('BAD_RESPONSE');
    expect(err.message).toMatch(/2000/);
  });

  it('meldet geblockte Zugriffe und kaputte Antworten', async () => {
    const blocked = new KapAdapter({ fetch: mockFetch(text('', 403)).fetch, now: () => now });
    expect((await blocked.getNews(THYAO).catch((e) => e)).code).toBe('BLOCKED');
    const bad = new KapAdapter({ fetch: mockFetch(json({ nope: true })).fetch, now: () => now });
    expect((await bad.getNews(THYAO).catch((e) => e)).code).toBe('BAD_RESPONSE');
  });

  it('respektiert since und limit', async () => {
    const kap = new KapAdapter({ fetch: mockFetch(fixture()).fetch, now: () => now });
    expect(await kap.getNews(BIMAS, { since: now + 1 })).toEqual([]); // nach "jetzt" gibt es nichts
    expect(await kap.getNews(BIMAS, { limit: 0 })).toEqual([]);
  });
});

describe('Finnhub News', () => {
  const now = Date.UTC(2026, 8, 21);
  const payload = [
    { id: 1, datetime: 1789900000, headline: ' Older ', summary: 'S', source: 'Reuters', url: 'https://x/1' },
    { id: 2, datetime: 1789990000, headline: 'Newer', source: 'CNBC', url: 'https://x/2' },
  ];

  it('mappt Meldungen (neueste zuerst) und sendet den Key im Header', async () => {
    const m = mockFetch(json(payload));
    const items = await new FinnhubNewsAdapter({ apiKey: 'SECRET', fetch: m.fetch, now: () => now, lookbackDays: 7 }).getNews(AAPL);
    expect(items.map((i) => i.title)).toEqual(['Newer', 'Older']);
    expect(items[1]).toMatchObject({ id: 'fh:1', source: 'Reuters', language: 'en', publishedAt: 1789900000 * 1000 });
    expect(m.calls[0]!.url).toContain('from=2026-09-14&to=2026-09-21');
    expect(m.calls[0]!.url).not.toContain('SECRET');
  });

  it('unterstützt nur US und erkennt ungültige Keys', async () => {
    const a = new FinnhubNewsAdapter({ apiKey: 'k', fetch: mockFetch(text('', 401)).fetch });
    expect(a.supports(THYAO)).toBe(false);
    expect((await a.getNews(AAPL).catch((e) => e)).code).toBe('CONFIG');
    expect(() => new FinnhubNewsAdapter({ apiKey: '' })).toThrow(/FINNHUB_API_KEY/);
  });
});

describe('NewsService', () => {
  const item = (id: string, title: string, publishedAt: number): NewsItem => ({
    id,
    symbol: 'THYAO',
    kind: 'news',
    title,
    url: `https://x/${id}`,
    source: 's',
    publishedAt,
    language: 'tr',
  });
  const stub = (id: string, result: NewsItem[] | AdapterError, supports = true): NewsAdapter => ({
    id,
    supports: () => supports,
    getNews: async () => {
      if (result instanceof AdapterError) throw result;
      return result;
    },
  });

  it('führt Quellen zusammen, entfernt Dubletten (ID oder Titel) und sortiert neueste zuerst', async () => {
    const svc = new NewsService([
      stub('a', [item('1', 'THY Rekor kırdı!', 100), item('2', 'Zweite', 300)]),
      stub('b', [item('3', 'thy rekor kırdı', 200), item('1', 'egal', 50), item('4', 'Vierte', 250)]),
    ]);
    const { items, errors } = await svc.getNews(THYAO);
    expect(errors).toEqual([]);
    expect(items.map((i) => i.id)).toEqual(['2', '4', '1']);
  });

  it('liefert Ergebnisse der intakten Quellen, auch wenn eine ausfällt', async () => {
    const svc = new NewsService([
      stub('kap', new AdapterError('BLOCKED', 'geblockt', 'kap')),
      stub('gn', [item('9', 'Meldung', 10)]),
      stub('skip', [item('8', 'Nicht gefragt', 20)], false),
    ]);
    const { items, errors } = await svc.getNews(THYAO);
    expect(items.map((i) => i.id)).toEqual(['9']);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('BLOCKED');
  });

  it('kind: fragt nur Quellen dieser Art und liefert nur Meldungen dieser Art', async () => {
    const kapItem = { ...item('k1', 'Kâr payı açıklaması', 500), kind: 'kap' as const };
    let pressAsked = false;
    const press: NewsAdapter = { ...stub('gn', [item('9', 'Basın haberi', 400)]), kind: 'news', getNews: async () => ((pressAsked = true), [item('9', 'Basın haberi', 400)]) };
    const kap: NewsAdapter = { ...stub('kap', [kapItem, item('8', 'Karışık', 100)]), kind: 'kap' };
    const svc = new NewsService([kap, press]);
    const only = await svc.getNews(THYAO, { kind: 'kap' });
    expect(only.items.map((i) => i.id)).toEqual(['k1']);
    expect(pressAsked).toBe(false);
    expect((await svc.getNews(THYAO)).items.map((i) => i.id)).toEqual(['k1', '9', '8']);
  });

  it('wendet limit nach dem Zusammenführen an', async () => {
    const svc = new NewsService([stub('a', [item('1', 'a', 1), item('2', 'b', 2), item('3', 'c', 3)])]);
    expect((await svc.getNews(THYAO, { limit: 2 })).items.map((i) => i.id)).toEqual(['3', '2']);
  });

  it('limit: eine ältere KAP-Meldung wird nicht von neueren Pressemeldungen verdrängt', async () => {
    const kapItem = { ...item('k1', 'Kâr payı açıklaması', 1), kind: 'kap' as const };
    const press = Array.from({ length: 10 }, (_, i) => item(`p${i}`, `Haber ${i}`, 100 + i));
    const svc = new NewsService([stub('a', [kapItem, ...press])]);
    const { items } = await svc.getNews(THYAO, { limit: 4 });
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.id)).toContain('k1');
    // Reihenfolge bleibt: neueste zuerst
    expect(items.map((i) => i.publishedAt)).toEqual([...items.map((i) => i.publishedAt)].sort((a, b) => b - a));
  });

  it('dedupe ist unabhängig von Groß-/Kleinschreibung und Satzzeichen (türkisches İ/ı)', () => {
    const out = dedupe([item('1', 'İş Bankası: Kâr arttı!', 2), item('2', 'iş bankası kâr arttı', 1)]);
    expect(out).toHaveLength(1);
  });
});
