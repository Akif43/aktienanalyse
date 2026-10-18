import { describe, expect, it } from 'vitest';
import { AdapterError, FundamentalsService, IsYatirimFundamentals, YahooFundamentals, type Instrument } from '../src';
import { readFixture } from './helpers';
import { json, mockFetch, text } from './mock-fetch';

const THYAO: Instrument = { symbol: 'THYAO', market: 'BIST' };
const TUPRS: Instrument = { symbol: 'TUPRS', market: 'BIST' };
const AAPL: Instrument = { symbol: 'AAPL', market: 'US' };

const ts = (date: string) => Math.floor(Date.parse(`${date}T12:00:00Z`) / 1000);

/** Yahoo-Timeseries-Antwort aus {Typ: {Jahr: Wert}} (gleiches Format wie die echte Antwort). */
function timeseriesBody(data: Record<string, Record<number, number>>) {
  return {
    timeseries: {
      result: Object.entries(data).map(([type, byYear]) => ({
        meta: { symbol: ['X'], type: [type] },
        [type]: Object.entries(byYear).map(([year, raw]) => ({ asOfDate: `${year}-12-31`, periodType: '12M', currencyCode: 'USD', reportedValue: { raw, fmt: String(raw) } })),
      })),
      error: null,
    },
  };
}

const dividendChart = (events: Record<string, { amount: number; date: number }>, firstBar: number) => ({ chart: { result: [{ timestamp: [firstBar, firstBar + 86_400 * 31], events: { dividends: events } }], error: null } });

/** Zwei Jahre Tageskurse: 2024 immer 30, 2025 immer 40, aktueller Kurs 45. */
const fxChart = {
  chart: {
    result: [
      {
        meta: { regularMarketPrice: 45 },
        timestamp: [ts('2024-03-01'), ts('2024-06-01'), ts('2025-03-01'), ts('2025-06-01'), ts('2025-09-01')],
        indicators: { quote: [{ close: [28, 32, 38, null, 42] }] },
      },
    ],
    error: null,
  },
};

describe('YahooFundamentals', () => {
  it('liest die Jahresabschlüsse (echte AAPL-Antwort): 4 Jahre, alle Kennzahlen zusammengeführt', async () => {
    const m = mockFetch(text(readFixture('yahoo-fundamentals-aapl.json')));
    const rows = await new YahooFundamentals({ fetch: m.fetch, sleep: m.sleep }).getStatements(AAPL);

    expect(m.calls[0]!.url).toContain('/ws/fundamentals-timeseries/v1/finance/timeseries/AAPL?type=annualNetIncome,annualOperatingIncome,annualTotalDebt');
    expect(rows.map((r) => r.year)).toEqual([2022, 2023, 2024, 2025]);
    const last = rows[3]!;
    expect(last.netIncome).toBeCloseTo(112.01e9, -7);
    expect(last.operatingIncome).toBeGreaterThan(100e9);
    expect(last.totalDebt).toBeCloseTo(98.657e9, -7);
    expect(last.shares).toBeCloseTo(14.77326e9, -6);
    expect(last.equity).not.toBeNull();
  });

  it('fällt auf den zweiten Host zurück, wenn der erste ausfällt', async () => {
    const m = mockFetch(json({}, 500), text(readFixture('yahoo-fundamentals-aapl.json')));
    const rows = await new YahooFundamentals({ fetch: m.fetch, sleep: m.sleep, retries: 0 }).getStatements(AAPL);
    expect(rows).toHaveLength(4);
    expect(m.calls[0]!.url).toContain('query1.');
    expect(m.calls[1]!.url).toContain('query2.');
  });

  it('übersetzt 404 in NOT_FOUND und unbrauchbare Antworten in BAD_RESPONSE', async () => {
    const notFound = mockFetch(json({}, 404));
    await expect(new YahooFundamentals({ fetch: notFound.fetch, sleep: notFound.sleep, retries: 0 }).getStatements(AAPL)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const bad = mockFetch(json({ foo: 1 }));
    await expect(new YahooFundamentals({ fetch: bad.fetch, sleep: bad.sleep }).getStatements(AAPL)).rejects.toBeInstanceOf(AdapterError);
  });

  it('summiert Dividenden je Kalenderjahr, verwirft Jahre vor dem 12-Jahres-Fenster und meldet den Beginn der vollständigen Daten', async () => {
    const events = {
      a: { amount: 0.5, date: ts('2003-05-01') }, // zu alt (z. B. vor der TL-Umstellung)
      b: { amount: 0.2, date: ts('2024-02-10') },
      c: { amount: 0.3, date: ts('2024-08-10') },
      d: { amount: 1.0, date: ts('2025-05-10') },
    };
    const m = mockFetch(json(dividendChart(events, ts('2001-03-15'))));
    const d = await new YahooFundamentals({ fetch: m.fetch, sleep: m.sleep }).getDividends(AAPL, 2026);
    expect(m.calls[0]!.url).toContain('range=max&interval=1mo&events=div');
    expect(d.dividends).toEqual([
      { year: 2024, amount: 0.5 },
      { year: 2025, amount: 1 },
    ]);
    expect(d.coverageFromYear).toBe(2014); // Historie reicht weiter zurück: das 12-Jahres-Fenster begrenzt
  });

  it('bei einer Aktie mit kurzer Historie beginnt die vollständige Abdeckung im Jahr nach dem ersten Datenpunkt', async () => {
    const m = mockFetch(json(dividendChart({}, ts('2020-06-15'))));
    const d = await new YahooFundamentals({ fetch: m.fetch, sleep: m.sleep }).getDividends(AAPL, 2026);
    expect(d.dividends).toEqual([]);
    expect(d.coverageFromYear).toBe(2021);
  });

  it('mittelt USD/TRY je Kalenderjahr (ohne fehlende Kurse) und liefert den aktuellen Kurs', async () => {
    const m = mockFetch(json(fxChart));
    const fx = await new YahooFundamentals({ fetch: m.fetch, sleep: m.sleep }).getUsdTry();
    expect(m.calls[0]!.url).toContain('USDTRY%3DX?range=10y&interval=1d');
    expect(fx.avgByYear[2024]).toBeCloseTo(30);
    expect(fx.avgByYear[2025]).toBeCloseTo(40);
    expect(fx.current).toBe(45);
  });
});

describe('IsYatirimFundamentals', () => {
  const tuprs = () => text(readFixture('isyatirim-malitablo-tuprs.json'));

  it('liest TL-Abschlüsse (Beträge als Zeichenketten) und rechnet die Nettoverschuldung aus Krediten minus liquiden Mitteln', async () => {
    const m = mockFetch(tuprs());
    const s = await new IsYatirimFundamentals({ fetch: m.fetch, sleep: m.sleep }).getStatements('TUPRS', 2025);

    expect(m.calls).toHaveLength(2); // zwei Blöcke à 4 Jahre
    expect(m.calls[0]!.url).toContain('companyCode=TUPRS');
    expect(m.calls[0]!.url).toContain('year1=2025&period1=12&year2=2024');
    expect(m.calls[1]!.url).toContain('year1=2021&period1=12');
    expect(s.years.map((y) => y.year)).toEqual([2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
    expect(s.years[7]).toEqual({ year: 2025, netIncome: 34_766_048_942, operatingProfit: 49_042_749_197 });
    expect(s.shares).toBe(1_926_796_000);
    expect(s.netDebt).toBe(25_695_734_494 + 33_477_290_812 - 126_280_900_199 - 41_215);
    expect(s.equity).toBe(428_757_719_763);
  });

  it('scheitert der ältere Block, bleiben die 4 jüngeren Jahre', async () => {
    const m = mockFetch(tuprs(), json({}, 500));
    const s = await new IsYatirimFundamentals({ fetch: m.fetch, sleep: m.sleep, retries: 0 }).getStatements('TUPRS', 2025);
    expect(s.years.map((y) => y.year)).toEqual([2022, 2023, 2024, 2025]);
  });

  it('Jahre ohne veröffentlichten Abschluss (null/0) werden ausgelassen', async () => {
    const body = {
      ok: true,
      value: [
        { itemCode: '3Z', value1: '100', value2: '90', value3: '0', value4: null },
        { itemCode: '2OA', value1: '10', value2: '10', value3: '0', value4: null },
      ],
    };
    const m = mockFetch(json(body), json({ ok: true, value: [] }));
    const s = await new IsYatirimFundamentals({ fetch: m.fetch, sleep: m.sleep }).getStatements('X', 2025);
    expect(s.years.map((y) => y.year)).toEqual([2024, 2025]);
  });

  it('Unternehmen ohne Daten (z. B. Banken in dieser Tabellengruppe) → NOT_FOUND', async () => {
    const m = mockFetch(json({ ok: true, value: [] }));
    await expect(new IsYatirimFundamentals({ fetch: m.fetch, sleep: m.sleep }).getStatements('AKBNK', 2025)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('FundamentalsService', () => {
  const now = () => new Date('2026-10-18T10:00:00Z');

  /** Verteilt die Anfragen nach URL auf passende Antworten. */
  function router(routes: { statements?: () => Response; is?: () => Response; div?: () => Response; fx?: () => Response }) {
    const fallback = () => json({}, 500);
    return mockFetch((url) => {
      if (url.includes('fundamentals-timeseries')) return (routes.statements ?? fallback)();
      if (url.includes('MaliTablo')) return (routes.is ?? fallback)();
      if (url.includes('events=div')) return (routes.div ?? fallback)();
      if (url.includes('USDTRY')) return (routes.fx ?? fallback)();
      return fallback();
    });
  }
  const opts = (m: ReturnType<typeof mockFetch>) => ({ fetch: m.fetch, sleep: m.sleep, retries: 0, now });
  const divs = () => json(dividendChart({ x: { amount: 2, date: ts('2025-05-01') } }, ts('2010-01-04')));
  const fx = () => json(fxChart);

  it('BIST, TL-Berichter (Tüpraş): Reihe komplett aus İş Yatırım, mit Jahresschnittskursen', async () => {
    const yahooLikeTl = () => json(timeseriesBody({ annualNetIncome: { 2022: 61.3e9, 2023: 77.4e9, 2024: 24.0e9 } })); // Verhältnis ≈ 1 → TL-Berichter
    const m = router({ is: () => text(readFixture('isyatirim-malitablo-tuprs.json')), statements: yahooLikeTl, div: divs, fx });
    const f = await new FundamentalsService(opts(m)).get(TUPRS);

    expect(f.source).toBe('isyatirim');
    expect(f.reportingCurrency).toBe('TRY');
    expect(f.years).toHaveLength(8);
    expect(f.years.at(-1)).toMatchObject({ year: 2025, netIncome: 34_766_048_942, ebit: 49_042_749_197, avgFx: 40 });
    expect(f.years.find((y) => y.year === 2024)!.avgFx).toBeCloseTo(30);
    expect(f.shares).toBe(1_926_796_000);
    expect(f.netDebt).toBeLessThan(0); // Nettoguthaben
    expect(f.currentFx).toBe(45);
    expect(f.dividends).toEqual([{ year: 2025, amount: 2 }]);
    expect(f.warnings).toEqual([]);
  });

  it('BIST, USD-Berichter (THY): erkennt am Verhältnis İş-TL zu Yahoo-USD, nimmt die USD-Reihe, behält die TL-Nettoschuld', async () => {
    const m = router({ is: () => text(readFixture('isyatirim-malitablo-thyao.json')), statements: () => text(readFixture('yahoo-fundamentals-thyao.json')), div: divs, fx });
    const f = await new FundamentalsService(opts(m)).get(THYAO);

    expect(f.warnings).toContainEqual({ code: 'usdReporter' });
    expect(f.reportingCurrency).toBe('USD');
    expect(f.source).toBe('yahoo');
    expect(f.years.map((y) => y.year)).toEqual([2022, 2023, 2024, 2025]);
    expect(f.years[1]!.netIncome).toBeCloseTo(6.02e9, -7); // echter USD-Wert 2023, nicht der in TL umgerechnete
    expect(f.years[1]!.ebit).toBeCloseTo(2.94e9, -7);
    expect(f.shares).toBe(1_380_000_000);
    expect(f.netDebt).toBeGreaterThan(500e9); // TL, passt zum TL-Börsenwert
  });

  it('BIST, İş Yatırım fällt aus: Ersatzreihe komplett aus Yahoo mit Warnhinweis (nie gemischt)', async () => {
    const m = router({
      statements: () => json(timeseriesBody({ annualNetIncome: { 2023: 10, 2024: 20, 2025: 30 }, annualTotalDebt: { 2025: 100 }, annualCashAndCashEquivalents: { 2025: 40 }, annualOrdinarySharesNumber: { 2025: 5 } })),
      div: divs,
      fx,
    });
    const f = await new FundamentalsService(opts(m)).get(TUPRS);
    expect(f.source).toBe('yahoo');
    expect(f.reportingCurrency).toBe('TRY');
    expect(f.years.map((y) => y.netIncome)).toEqual([10, 20, 30]);
    expect(f.netDebt).toBe(60);
    expect(f.shares).toBe(5);
    expect(f.warnings.find((w) => w.code === 'sourceFallback')).toBeDefined();
  });

  it('fehlt der Wechselkurs, kommt die Reihe trotzdem, mit Hinweis und ohne Jahresschnittskurse', async () => {
    const m = router({ is: () => text(readFixture('isyatirim-malitablo-tuprs.json')), statements: () => json(timeseriesBody({ annualNetIncome: { 2024: 24e9 } })), div: divs });
    const f = await new FundamentalsService(opts(m)).get(TUPRS);
    expect(f.warnings).toContainEqual({ code: 'missingFx' });
    expect(f.currentFx).toBeNull();
    expect(f.years.every((y) => y.avgFx === null)).toBe(true);
  });

  it('beide BIST-Quellen fallen aus → Fehler statt leerer Daten', async () => {
    const m = router({ div: divs, fx });
    await expect(new FundamentalsService(opts(m)).get(TUPRS)).rejects.toBeInstanceOf(AdapterError);
  });

  it('US-Aktie (AAPL): Yahoo-Reihe, Nettoverschuldung = Schulden − liquide Mittel, kein Wechselkurs', async () => {
    const m = router({ statements: () => text(readFixture('yahoo-fundamentals-aapl.json')), div: divs });
    const f = await new FundamentalsService(opts(m)).get(AAPL);
    expect(f.source).toBe('yahoo');
    expect(f.years).toHaveLength(4);
    expect(f.years.every((y) => y.avgFx === null)).toBe(true);
    expect(f.currentFx).toBeNull();
    expect(f.shares).toBeCloseTo(14.77326e9, -6);
    expect(f.netDebt).toBeGreaterThan(0);
    expect(m.calls.some((c) => c.url.includes('MaliTablo') || c.url.includes('USDTRY'))).toBe(false); // keine BIST-Abrufe
  });

  it('US-Aktie ohne Abschlussdaten: leere Reihe mit Hinweis statt Fehler (Maske bleibt nutzbar)', async () => {
    const m = router({ statements: () => json({ timeseries: { result: [], error: null } }), div: divs });
    const f = await new FundamentalsService(opts(m)).get(AAPL);
    expect(f.years).toEqual([]);
    expect(f.warnings).toContainEqual({ code: 'noStatements' });
  });
});
