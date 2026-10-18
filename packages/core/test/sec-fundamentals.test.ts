import { describe, expect, it } from 'vitest';
import { AdapterError, FundamentalsService, MemoryKv, pickAnnualSeries, SecFundamentals, toSecTicker, type Instrument, type SecFact } from '../src';
import { readFixture } from './helpers';
import { json, mockFetch, text } from './mock-fetch';

// Die SEC-Antworten in diesen Tests sind nachgebaut (gleiches Format wie die echte XBRL-Schnittstelle, Werte frei gewählt
// bzw. an die Größenordnung echter Abschlüsse angelehnt), damit die Tests ohne Netzwerk und ohne Kontaktadresse laufen.

const AAPL: Instrument = { symbol: 'AAPL', market: 'US' };
const SAP: Instrument = { symbol: 'SAP', market: 'XETRA' };
const KO_DE: Instrument = { symbol: 'KO', market: 'XETRA' };
const TUPRS: Instrument = { symbol: 'TUPRS', market: 'BIST' };
const CONTACT = 'test@example.com';

const fact = (start: string | undefined, end: string, val: number, form: string | undefined, filed: string): SecFact => ({ start, end, val, form, filed });
/** Ein ganzes Kalenderjahr aus einem Jahresbericht. */
const annual = (year: number, val: number, form = '10-K', filed = `${year + 1}-02-01`): SecFact => fact(`${year}-01-01`, `${year}-12-31`, val, form, filed);

describe('pickAnnualSeries', () => {
  it('nimmt nur Jahresberichte mit ca. einjährigem Zeitraum: Quartale, Halbjahre, Stichtagswerte und Fremdformulare fallen weg', () => {
    const rows = [
      annual(2023, 100),
      fact('2024-01-01', '2024-03-31', 25, '10-K', '2025-02-01'), // Quartal (steht auch in Jahresberichten)
      fact('2024-01-01', '2024-09-30', 70, '10-Q', '2024-11-01'), // 9 Monate
      fact(undefined, '2024-12-31', 999, '10-K', '2025-02-01'), // Stichtagswert ohne Beginn
      fact('2024-01-01', '2024-12-31', 888, '8-K', '2025-02-01'), // kein Jahresbericht
      fact('2022-01-01', '2023-12-31', 777, '10-K', '2024-02-01'), // zwei Jahre
      annual(2024, 120),
    ];
    expect([...pickAnnualSeries(rows)]).toEqual([
      [2023, 100],
      [2024, 120],
    ]);
  });

  it('derselbe Zeitraum aus mehreren Jahresberichten: die zuletzt eingereichte Fassung gewinnt (Korrektur)', () => {
    const rows = [annual(2022, 90, '10-K', '2023-02-01'), annual(2022, 95, '10-K', '2024-02-01'), annual(2022, 93, '10-K', '2025-02-01')];
    expect(pickAnnualSeries(rows).get(2022)).toBe(93);
    // Reihenfolge der Zeilen spielt keine Rolle
    expect(pickAnnualSeries([...rows].reverse()).get(2022)).toBe(93);
  });

  it('Jahr = Jahr des Bilanzstichtags, nicht des Geschäftsjahres-Feldes: Juni-Geschäftsjahr (MSFT-Muster) und 52/53-Wochen-Jahre', () => {
    const rows = [
      fact('2024-07-01', '2025-06-30', 101, '10-K', '2025-07-30'),
      fact('2023-07-01', '2024-06-30', 88, '10-K', '2024-07-30'),
      fact('2023-12-31', '2024-12-28', 55, '10-K', '2025-02-20'), // 364 Tage
      fact('2024-12-29', '2025-12-31', 66, '10-K', '2026-02-20'), // 368 Tage
    ];
    const s = pickAnnualSeries(rows);
    expect(s.get(2025)).toBe(66); // zwei Stichtage in 2025: der spätere gilt
    expect(s.get(2024)).toBe(55); // Juni-Jahr 2024 und Dezember-Jahr 2024: der spätere Stichtag gilt
  });

  it('akzeptiert 20-F und 40-F (SEC-Melder aus dem Ausland), lehnt 349 und 381 Tage ab', () => {
    expect(pickAnnualSeries([annual(2024, 5, '20-F')]).get(2024)).toBe(5);
    expect(pickAnnualSeries([annual(2024, 6, '40-F')]).get(2024)).toBe(6);
    expect(pickAnnualSeries([annual(2024, 7, '10-K/A')]).get(2024)).toBe(7);
    expect(pickAnnualSeries([fact('2024-01-17', '2024-12-31', 1, '10-K', 'x')]).size).toBe(0); // 349 Tage
    expect(pickAnnualSeries([fact('2023-12-15', '2024-12-31', 1, '10-K', 'x')]).size).toBe(0); // 382 Tage
  });
});

describe('toSecTicker', () => {
  it('schreibt Klassen-Aktien mit Bindestrich und groß', () => {
    expect(toSecTicker('brk.b')).toBe('BRK-B');
    expect(toSecTicker('AAPL')).toBe('AAPL');
  });
});

// --- Mock der SEC-Schnittstelle -----------------------------------------------------------------

const tickers = { '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, '1': { cik_str: 1067983, ticker: 'BRK-B', title: 'Berkshire' }, '2': { cik_str: 1000184, ticker: 'SAP', title: 'SAP SE' }, '3': { cik_str: 21344, ticker: 'KO', title: 'Coca-Cola' } };

type Concepts = Record<string, Record<string, Record<string, SecFact[]>>>; // taxonomy → concept → unit → rows
const conceptBody = (taxonomy: string, tag: string, units: Record<string, SecFact[]>) => ({ cik: 1, taxonomy, tag, units });

/** Antwortet wie data.sec.gov: companyconcept je Konzept, 404 für unbekannte Konzepte, companyfacts als Gesamtübersicht. */
function secRouter(byCik: Record<number, Concepts>, opts: { emptyConcept?: string; fail?: number } = {}) {
  return mockFetch((url) => {
    if (opts.fail) return json({}, opts.fail);
    if (url.includes('company_tickers.json')) return json(tickers);
    const concept = url.match(/companyconcept\/CIK(\d{10})\/([^/]+)\/([^/]+)\.json/);
    if (concept) {
      const [, cik, taxonomy, tag] = concept as unknown as [string, string, string, string];
      const units = byCik[Number(cik)]?.[taxonomy]?.[tag];
      if (!units) return json({}, 404);
      return json(conceptBody(taxonomy, tag, tag === opts.emptyConcept ? { USD: [] } : units));
    }
    const facts = url.match(/companyfacts\/CIK(\d{10})\.json/);
    if (facts) {
      const all = byCik[Number(facts[1])] ?? {};
      return json({ cik: Number(facts[1]), facts: Object.fromEntries(Object.entries(all).map(([tax, cs]) => [tax, Object.fromEntries(Object.entries(cs).map(([tag, units]) => [tag, { units }]))])) });
    }
    return json({}, 404);
  });
}

const years = (from: number, to: number, f: (y: number) => number): SecFact[] => Array.from({ length: to - from + 1 }, (_, i) => annual(from + i, f(from + i)));

const AAPL_CONCEPTS: Concepts = {
  'us-gaap': {
    NetIncomeLoss: { USD: [...years(2009, 2025, (y) => (y - 2000) * 1e9), fact('2025-01-01', '2025-03-31', 1, '10-Q', '2025-05-01')] },
    OperatingIncomeLoss: { USD: years(2013, 2025, (y) => (y - 2000) * 1.3e9) },
  },
};

describe('SecFundamentals', () => {
  const opts = (m: ReturnType<typeof mockFetch>) => ({ fetch: m.fetch, sleep: m.sleep, retries: 0 });

  it('ohne Kontaktadresse gar nicht erst anlegbar', () => {
    expect(() => new SecFundamentals('  ')).toThrow(AdapterError);
  });

  it('liefert höchstens 12 Jahre Gewinn und Betriebsergebnis (fehlendes EBIT → null), nutzt User-Agent mit Kontakt und gepolsterte CIK', async () => {
    const m = secRouter({ 320193: AAPL_CONCEPTS });
    const sec = new SecFundamentals(CONTACT, opts(m));
    const r = await sec.getSeries(AAPL, { minYear: 2024 });

    expect(r).toMatchObject({ cik: 320193, taxonomy: 'us-gaap', currency: 'USD' });
    expect(r.years).toHaveLength(12);
    expect(r.years[0]).toEqual({ year: 2014, netIncome: 14e9, ebit: 14 * 1.3e9 });
    expect(r.years.at(-1)).toEqual({ year: 2025, netIncome: 25e9, ebit: 25 * 1.3e9 });
    expect(m.calls.some((c) => c.url.includes('/companyconcept/CIK0000320193/us-gaap/NetIncomeLoss.json'))).toBe(true);
    for (const c of m.calls) expect((c.init?.headers as Record<string, string>)['User-Agent']).toBe(`Borsa-App ${CONTACT}`);
  });

  it('Anfragen laufen mit Pause dazwischen (SEC erlaubt höchstens 10 pro Sekunde)', async () => {
    const m = secRouter({ 320193: AAPL_CONCEPTS });
    await new SecFundamentals(CONTACT, opts(m)).getSeries(AAPL, { minYear: 2024 });
    expect(m.calls.length).toBeGreaterThanOrEqual(3);
    expect(m.sleeps.filter((ms) => ms >= 100)).toHaveLength(m.calls.length - 1);
  });

  it('bekannte CIK überspringt den Abruf des Ticker-Registers', async () => {
    const m = secRouter({ 320193: AAPL_CONCEPTS });
    await new SecFundamentals(CONTACT, opts(m)).getSeries(AAPL, { cachedCik: 320193, minYear: 2024 });
    expect(m.calls.some((c) => c.url.includes('company_tickers.json'))).toBe(false);
  });

  it('Klassen-Aktie: BRK.B wird als BRK-B gefunden; unbekannter Ticker → NOT_FOUND', async () => {
    const m = secRouter({ 1067983: { 'us-gaap': { NetIncomeLoss: { USD: years(2020, 2025, () => 1) } } } });
    const r = await new SecFundamentals(CONTACT, opts(m)).getSeries({ symbol: 'BRK.B', market: 'US' }, { minYear: 2024 });
    expect(r.cik).toBe(1067983);
    await expect(new SecFundamentals(CONTACT, opts(secRouter({}))).getSeries({ symbol: 'GIBTSNICHT', market: 'US' }, { minYear: 2024 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('leere companyconcept-Antwort (USD: {}) → Ausweichabruf über companyfacts', async () => {
    const m = secRouter({ 21344: { 'us-gaap': { NetIncomeLoss: { USD: years(2015, 2025, () => 7) } } } }, { emptyConcept: 'NetIncomeLoss' });
    const r = await new SecFundamentals(CONTACT, opts(m)).getSeries({ symbol: 'KO', market: 'US' }, { minYear: 2024 });
    expect(r.years).toHaveLength(11);
    expect(m.calls.some((c) => c.url.includes('/companyfacts/CIK0000021344.json'))).toBe(true);
  });

  it('SAP (20-F, IFRS in EUR) wird für die XETRA gefunden', async () => {
    const m = secRouter({
      1000184: {
        'ifrs-full': {
          ProfitLossAttributableToOwnersOfParent: { EUR: years(2015, 2025, (y) => (y - 2010) * 1e8) },
          ProfitLossFromOperatingActivities: { EUR: years(2015, 2025, (y) => (y - 2010) * 1.5e8) },
        },
      },
    });
    const r = await new SecFundamentals(CONTACT, opts(m)).getSeries(SAP, { minYear: 2024 });
    expect(r).toMatchObject({ taxonomy: 'ifrs-full', currency: 'EUR' });
    expect(r.years).toHaveLength(11);
    expect(r.years.at(-1)!.ebit).toBeCloseTo(15 * 1.5e8);
  });

  it('XETRA-Schutz: ein US-GAAP-Treffer unter demselben Kürzel (anderes Unternehmen, USD) wird verworfen', async () => {
    const m = secRouter({ 21344: { 'us-gaap': { NetIncomeLoss: { USD: years(2015, 2025, () => 7) } } } });
    await expect(new SecFundamentals(CONTACT, opts(m)).getSeries(KO_DE, { minYear: 2024 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(m.calls.some((c) => c.url.includes('/us-gaap/'))).toBe(false); // US-GAAP wird für die XETRA gar nicht erst abgefragt
  });

  it('US-Aktie: IFRS-Meldung in Fremdwährung wird verworfen (Reihe muss zur Kurswährung USD passen)', async () => {
    const m = secRouter({ 1000184: { 'ifrs-full': { ProfitLossAttributableToOwnersOfParent: { EUR: years(2015, 2025, () => 1) } } } });
    await expect(new SecFundamentals(CONTACT, opts(m)).getSeries({ symbol: 'SAP', market: 'US' }, { minYear: 2024 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('veraltetes Konzept (endet 2014, z. B. gewechselter Tag): das Konzept mit neueren Jahren gewinnt', async () => {
    const m = secRouter({
      320193: { 'us-gaap': { NetIncomeLoss: { USD: years(2010, 2014, () => 1) }, ProfitLoss: { USD: years(2016, 2025, () => 2) } } },
    });
    const r = await new SecFundamentals(CONTACT, opts(m)).getSeries(AAPL, { minYear: 2024 });
    expect(r.years.at(-1)!.year).toBe(2025);
    expect(r.years[0]!.netIncome).toBe(2);
  });

  it('Sperre durch die SEC (403, z. B. ungültiger User-Agent) wird als BLOCKED gemeldet', async () => {
    const m = secRouter({}, { fail: 403 });
    await expect(new SecFundamentals(CONTACT, opts(m)).getSeries(AAPL, { minYear: 2024 })).rejects.toMatchObject({ code: 'BLOCKED' });
  });
});

// --- Zusammenspiel im Dienst: EDGAR, Speicher, Ersatzquellen ------------------------------------

const ts = (date: string) => Math.floor(Date.parse(`${date}T12:00:00Z`) / 1000);
const timeseriesBody = (data: Record<string, Record<number, number>>) => ({
  timeseries: {
    result: Object.entries(data).map(([type, byYear]) => ({
      meta: { symbol: ['X'], type: [type] },
      [type]: Object.entries(byYear).map(([year, raw]) => ({ asOfDate: `${year}-12-31`, periodType: '12M', currencyCode: 'USD', reportedValue: { raw, fmt: String(raw) } })),
    })),
    error: null,
  },
});
const yahooAapl = () => json(timeseriesBody({ annualNetIncome: { 2022: 99e9, 2023: 97e9, 2024: 94e9, 2025: 112e9 }, annualTotalDebt: { 2025: 100 }, annualCashAndCashEquivalents: { 2025: 40 }, annualOrdinarySharesNumber: { 2025: 5 } }));
const dividendChart = () => json({ chart: { result: [{ timestamp: [ts('2010-01-04')], events: { dividends: { x: { amount: 1, date: ts('2025-05-01') } } } }], error: null } });
const fxChart = () => json({ chart: { result: [{ meta: { regularMarketPrice: 45 }, timestamp: [ts('2025-03-01')], indicators: { quote: [{ close: [40] }] } }], error: null } });

describe('FundamentalsService mit EDGAR und Speicher', () => {
  let nowMs = Date.parse('2026-10-18T10:00:00Z');
  const now = () => new Date(nowMs);

  /** Yahoo, İş und SEC in einem Mock; `sec` entscheidet über die SEC-Antworten. */
  function world(sec: (url: string) => Response, extra: { is?: () => Response; statements?: () => Response } = {}) {
    return mockFetch((url) => {
      if (url.includes('sec.gov')) return sec(url);
      if (url.includes('fundamentals-timeseries')) return (extra.statements ?? yahooAapl)();
      if (url.includes('MaliTablo')) return (extra.is ?? (() => json({}, 500)))();
      if (url.includes('events=div')) return dividendChart();
      if (url.includes('USDTRY')) return fxChart();
      return json({}, 500);
    });
  }
  const make = (m: ReturnType<typeof mockFetch>, extra: Record<string, unknown> = {}) => new FundamentalsService({ fetch: m.fetch, sleep: m.sleep, retries: 0, now, ...extra });
  const secCalls = (m: ReturnType<typeof mockFetch>) => m.calls.filter((c) => c.url.includes('sec.gov')).length;

  /** Synchroner Router für die SEC-Antworten innerhalb von world(). */
  function secResponder(byCik: Record<number, Concepts>, opts: { fail?: number } = {}) {
    return (url: string): Response => {
      if (opts.fail) return json({}, opts.fail);
      if (url.includes('company_tickers.json')) return json(tickers);
      const concept = url.match(/companyconcept\/CIK(\d{10})\/([^/]+)\/([^/]+)\.json/);
      if (concept) {
        const units = byCik[Number(concept[1])]?.[concept[2]!]?.[concept[3]!];
        return units ? json(conceptBody(concept[2]!, concept[3]!, units)) : json({}, 404);
      }
      return json({}, 404);
    };
  }

  it('US-Aktie mit SEC_CONTACT: Reihe von EDGAR (12 Jahre), Aktienzahl und Nettoschuld weiter von Yahoo', async () => {
    const m = world(secResponder({ 320193: AAPL_CONCEPTS }));
    const f = await make(m, { secContact: CONTACT }).get(AAPL);
    expect(f.source).toBe('edgar');
    expect(f.years).toHaveLength(12);
    expect(f.years.at(-1)).toMatchObject({ year: 2025, netIncome: 25e9, avgFx: null });
    expect(f.shares).toBe(5);
    expect(f.netDebt).toBe(60);
    expect(f.warnings).toEqual([]);
  });

  it('ohne SEC_CONTACT: nur Yahoos 4 Jahre, kein SEC-Aufruf, Hinweis secNotConfigured (nur US)', async () => {
    const m = world(secResponder({ 320193: AAPL_CONCEPTS }));
    const f = await make(m).get(AAPL);
    expect(f.source).toBe('yahoo');
    expect(f.years).toHaveLength(4);
    expect(f.warnings).toContainEqual({ code: 'secNotConfigured' });
    expect(secCalls(m)).toBe(0);
    const de = await make(world(secResponder({}), { statements: yahooAapl })).get(SAP);
    expect(de.warnings.some((w) => w.code === 'secNotConfigured')).toBe(false);
  });

  it('SEC nicht erreichbar → komplette Yahoo-Reihe mit Hinweis (nie gemischt)', async () => {
    const m = world(secResponder({}, { fail: 500 }));
    const f = await make(m, { secContact: CONTACT }).get(AAPL);
    expect(f.source).toBe('yahoo');
    expect(f.years.map((y) => y.year)).toEqual([2022, 2023, 2024, 2025]);
    expect(f.warnings.find((w) => w.code === 'edgarFallback')).toBeDefined();
  });

  it('veraltete EDGAR-Daten (neuestes Jahr 2014) gelten als unbrauchbar → Yahoo', async () => {
    const old: Concepts = { 'us-gaap': { NetIncomeLoss: { USD: years(2005, 2014, () => 1) } } };
    const m = world(secResponder({ 320193: old }));
    const f = await make(m, { secContact: CONTACT }).get(AAPL);
    expect(f.source).toBe('yahoo');
    expect(f.warnings.find((w) => w.code === 'edgarFallback')).toBeDefined();
  });

  it('XETRA-Wert ohne SEC-Eintrag: stillschweigend Yahoo, kein Hinweis', async () => {
    const m = world(secResponder({}));
    const f = await make(m, { secContact: CONTACT }).get({ symbol: 'BMW', market: 'XETRA' });
    expect(f.source).toBe('yahoo');
    expect(f.warnings.some((w) => w.code === 'edgarFallback' || w.code === 'secNotConfigured')).toBe(false);
  });

  it('Speicher: zweiter Abruf holt nichts von der SEC, nach 3 Tagen wird neu geholt, bei SEC-Ausfall hilft die gespeicherte Reihe', async () => {
    const kv = new MemoryKv();
    nowMs = Date.parse('2026-10-18T10:00:00Z');
    const m = world(secResponder({ 320193: AAPL_CONCEPTS }));
    const svc = make(m, { secContact: CONTACT, kv });

    await svc.get(AAPL);
    const first = secCalls(m);
    expect(first).toBeGreaterThan(0);
    expect((await kv.get<{ source: string; years: unknown[] }>('fundamentals:history:v1:US:AAPL'))?.value).toMatchObject({ source: 'edgar' });
    expect((await kv.get<number>('fundamentals:cik:v1:US:AAPL'))?.value).toBe(320193);

    const again = await svc.get(AAPL);
    expect(again.years).toHaveLength(12);
    expect(secCalls(m)).toBe(first); // aus dem Speicher

    nowMs += 4 * 86_400_000;
    await svc.get(AAPL);
    expect(secCalls(m)).toBeGreaterThan(first); // neu geholt (diesmal ohne Ticker-Register, die CIK ist gespeichert)
    expect(m.calls.filter((c) => c.url.includes('company_tickers.json'))).toHaveLength(1);

    nowMs += 4 * 86_400_000;
    const down = world(secResponder({}, { fail: 500 }));
    const f = await make(down, { secContact: CONTACT, kv }).get(AAPL);
    expect(f.source).toBe('edgar'); // gespeicherte Reihe statt Yahoo
    expect(f.years).toHaveLength(12);
  });

  it('ein ausgefallener Speicher verhindert die Bewertung nicht', async () => {
    const broken = { get: async () => { throw new Error('Supabase aus'); }, set: async () => { throw new Error('Supabase aus'); } };
    const m = world(secResponder({ 320193: AAPL_CONCEPTS }));
    const f = await make(m, { secContact: CONTACT, kv: broken }).get(AAPL);
    expect(f.source).toBe('edgar');
    expect(f.years).toHaveLength(12);
  });
});

describe('FundamentalsService BIST: ältere İş-Jahre aus dem Speicher', () => {
  const now = () => new Date('2026-10-18T10:00:00Z');
  const yahooLikeTl = () => json(timeseriesBody({ annualNetIncome: { 2022: 61.3e9, 2023: 77.4e9, 2024: 24.0e9 } }));
  const world = (is: () => Response) =>
    mockFetch((url) => {
      if (url.includes('MaliTablo')) return is();
      if (url.includes('fundamentals-timeseries')) return yahooLikeTl();
      if (url.includes('events=div')) return dividendChart();
      if (url.includes('USDTRY')) return fxChart();
      return json({}, 500);
    });
  const isCalls = (m: ReturnType<typeof mockFetch>) => m.calls.filter((c) => c.url.includes('MaliTablo')).length;
  const tuprs = () => text(readFixture('isyatirim-malitablo-tuprs.json'));
  const make = (m: ReturnType<typeof mockFetch>, kv?: MemoryKv) => new FundamentalsService({ fetch: m.fetch, sleep: m.sleep, retries: 0, now, kv });

  it('erster Abruf lädt 3 Blöcke (12 Jahre) und speichert sie, der zweite holt nur den jüngsten Block und behält die älteren Jahre', async () => {
    const kv = new MemoryKv();
    const m = world(tuprs);
    const svc = make(m, kv);

    const first = await svc.get(TUPRS);
    expect(isCalls(m)).toBe(3);
    expect(first.years).toHaveLength(12);
    const stored = (await kv.get<{ source: string; years: { year: number }[] }>('fundamentals:history:v1:BIST:TUPRS'))!.value;
    expect(stored.source).toBe('isyatirim');
    expect(stored.years).toHaveLength(12);

    const before = isCalls(m);
    const second = await svc.get(TUPRS);
    expect(isCalls(m) - before).toBe(1);
    expect(second.years.map((y) => y.year)).toEqual(first.years.map((y) => y.year));
    expect(second.years[0]).toMatchObject({ year: 2014 }); // ältester Wert kommt aus dem Speicher
  });

  it('frische Werte gewinnen für die neu geholten Jahre, ältere gespeicherte bleiben unverändert', async () => {
    const kv = new MemoryKv();
    const old = Array.from({ length: 12 }, (_, i) => ({ year: 2014 + i, netIncome: 1_000 + i, ebit: null }));
    await kv.set('fundamentals:history:v1:BIST:TUPRS', { source: 'isyatirim', years: old, fetchedAt: 1 });
    const m = world(tuprs);
    const f = await make(m, kv).get(TUPRS);
    expect(isCalls(m)).toBe(1);
    expect(f.years.find((y) => y.year === 2014)!.netIncome).toBe(1_000); // gespeichert
    expect(f.years.find((y) => y.year === 2025)!.netIncome).toBe(34_766_048_942); // frisch
  });

  it('Speicher von anderer Quelle oder mit zu wenig Jahren löst einen vollen Abruf aus', async () => {
    const kv = new MemoryKv();
    await kv.set('fundamentals:history:v1:BIST:TUPRS', { source: 'edgar', years: [{ year: 2020, netIncome: 1, ebit: null }], fetchedAt: 1 });
    const m = world(tuprs);
    await make(m, kv).get(TUPRS);
    expect(isCalls(m)).toBe(3);
  });

  it('Ersatzreihe aus Yahoo (İş fällt aus) wird nicht gespeichert', async () => {
    const kv = new MemoryKv();
    const m = world(() => json({}, 500));
    const f = await make(m, kv).get(TUPRS);
    expect(f.source).toBe('yahoo');
    expect(await kv.get('fundamentals:history:v1:BIST:TUPRS')).toBeNull();
  });
});
