import { describe, expect, it } from 'vitest';
import { AdapterError, TefasAdapter } from '../src';
import { readJsonFixture } from './helpers';
import { json, mockFetch, text } from './mock-fetch';

const directory = readJsonFixture('tefas-directory.json');
const fundInfo = readJsonFixture('tefas-fund-info.json');
const benchmark = readJsonFixture('tefas-benchmark-1y.json');

describe('TefasAdapter: Fonds suchen', () => {
  it('findet per Kürzel (exakt vor Präfix) und per Namensbestandteil, unabhängig von Groß-/Kleinschreibung', async () => {
    const mock = mockFetch(json(directory));
    const adapter = new TefasAdapter({ fetch: mock.fetch, sleep: mock.sleep });

    const exact = await adapter.search('aft');
    expect(exact[0]).toEqual({ code: 'AFT', name: 'AK PORTFÖY YENİ TEKNOLOJİLER YABANCI HİSSE SENEDİ FONU' });

    const byName = await adapter.search('teknoloji');
    expect(byName.map((f) => f.code)).toEqual(expect.arrayContaining(['AFT', 'YAY']));

    const byCode = await adapter.search('YA');
    expect(byCode[0]!.code).toBe('YAY'); // Präfix-Treffer vor reinem Namenstreffer
  });

  it('lädt das Verzeichnis nur einmal für mehrere Suchen (kurzer Zwischenspeicher)', async () => {
    const mock = mockFetch(json(directory));
    const adapter = new TefasAdapter({ fetch: mock.fetch, sleep: mock.sleep });
    await adapter.search('AFT');
    await adapter.search('YAY');
    await adapter.search('teknoloji');
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]!.url).toBe('https://www.tefas.gov.tr/api/funds/fonUnvanAra');
  });

  it('lädt das Verzeichnis nach einem Fehlschlag beim nächsten Aufruf erneut', async () => {
    const mock = mockFetch(text('Server-Fehler', 500), json(directory));
    const adapter = new TefasAdapter({ fetch: mock.fetch, sleep: mock.sleep, retries: 0 });
    await expect(adapter.search('AFT')).rejects.toBeInstanceOf(AdapterError);
    expect((await adapter.search('AFT'))[0]!.code).toBe('AFT');
  });

  it('liefert bei zu kurzer oder zu langer Eingabe leer, ohne die Quelle zu fragen', async () => {
    const mock = mockFetch(json(directory));
    const adapter = new TefasAdapter({ fetch: mock.fetch, sleep: mock.sleep });
    expect(await adapter.search('')).toEqual([]);
    expect(await adapter.search('x'.repeat(61))).toEqual([]);
    expect(mock.calls).toHaveLength(0);
  });
});

describe('TefasAdapter: Fondsinfo', () => {
  it('liefert Preis, Tagesänderung, Kategorie und Kennzahlen', async () => {
    const mock = mockFetch(json(fundInfo));
    const adapter = new TefasAdapter({ fetch: mock.fetch, sleep: mock.sleep });
    const fund = await adapter.getFund('aft');
    expect(fund).toMatchObject({
      code: 'AFT',
      name: 'AK PORTFÖY YENİ TEKNOLOJİLER YABANCI HİSSE SENEDİ FONU',
      category: 'Hisse Senedi Fonu',
      price: 1.034699,
      dailyChangePercent: 2.9305,
      categoryRank: 30,
      categoryFundCount: 200,
      investorCount: 134837,
      marketSharePercent: 9.55,
    });
    expect(fund.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mock.calls[0]!.init!.body).toBe(JSON.stringify({ fonKodu: 'AFT', dil: 'TR' }));
  });

  it('unbekanntes Kürzel: NOT_FOUND', async () => {
    const mock = mockFetch(json({ errorCode: null, errorMessage: null, resultList: [] }));
    const adapter = new TefasAdapter({ fetch: mock.fetch, sleep: mock.sleep });
    const err = await adapter.getFund('ZZZZZZ').catch((e) => e);
    expect(err).toBeInstanceOf(AdapterError);
    expect(err.code).toBe('NOT_FOUND');
  });

  it('HTTP-Fehler und kaputtes Format werden erkannt', async () => {
    const badHttp = mockFetch(text('Server-Fehler', 503));
    await expect(new TefasAdapter({ fetch: badHttp.fetch, sleep: badHttp.sleep, retries: 0 }).getFund('AFT')).rejects.toMatchObject({ code: 'UPSTREAM' });
    const badShape = mockFetch(json({ resultList: [{ fonKodu: 'AFT' }] })); // sonFiyat fehlt
    await expect(new TefasAdapter({ fetch: badShape.fetch, sleep: badShape.sleep }).getFund('AFT')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });
});

describe('TefasAdapter: Kursverlauf', () => {
  it('bildet die Zeiträume auf TEFAS-Monatszahlen ab', async () => {
    const cases: [string, number][] = [
      ['month', 1],
      ['3month', 3],
      ['6month', 6],
      ['ytd', 0],
      ['year', 12],
      ['3year', 36],
      ['5year', 60],
    ];
    for (const [period, periyod] of cases) {
      const mock = mockFetch(json({ resultList: [] }));
      await new TefasAdapter({ fetch: mock.fetch, sleep: mock.sleep }).getHistory('AFT', period as never);
      expect(JSON.parse(mock.calls[0]!.init!.body as string)).toEqual({ fonKodu: 'AFT', dil: 'TR', periyod });
    }
  });

  it('sortiert Kurspunkte aufsteigend nach Datum', async () => {
    const unsorted = { resultList: [{ tarih: '2026-08-10', fiyat: 1.01 }, { tarih: '2026-08-05', fiyat: 1.0 }, { tarih: '2026-08-15', fiyat: 1.02 }] };
    const mock = mockFetch(json(unsorted));
    const points = await new TefasAdapter({ fetch: mock.fetch, sleep: mock.sleep }).getHistory('AFT', 'month');
    expect(points.map((p) => p.date)).toEqual(['2026-08-05', '2026-08-10', '2026-08-15']);
  });

  it('wirft nicht die ganze Antwort weg, wenn einzelne Tage keinen Preis haben (echt bei längeren Zeiträumen wie 3/5 Jahre)', async () => {
    const withGap = { resultList: [{ tarih: '2026-08-05', fiyat: 1.0 }, { tarih: '2026-08-10', fiyat: null }, { tarih: '2026-08-15', fiyat: 1.02 }] };
    const mock = mockFetch(json(withGap));
    const points = await new TefasAdapter({ fetch: mock.fetch, sleep: mock.sleep }).getHistory('AFT', '3year');
    expect(points.map((p) => p.date)).toEqual(['2026-08-05', '2026-08-15']);
  });

  it('"Woche" fragt einen Monat ab (TEFAS kennt keine Woche) und schneidet auf die letzten 7 Tage zu', async () => {
    const month = { resultList: Array.from({ length: 22 }, (_, i) => ({ tarih: `2026-08-${String(i + 1).padStart(2, '0')}`, fiyat: 1 + i / 100 })) };
    const mock = mockFetch(json(month));
    const points = await new TefasAdapter({ fetch: mock.fetch, sleep: mock.sleep }).getHistory('AFT', 'week');
    expect(JSON.parse(mock.calls[0]!.init!.body as string)).toMatchObject({ periyod: 1 });
    expect(points[0]!.date).toBe('2026-08-15'); // 22. minus 7 Tage
    expect(points.at(-1)!.date).toBe('2026-08-22');
    expect(points).toHaveLength(8);
  });

  it('stimmt mit echten aufgezeichneten Kursdaten überein (Preise in TRY, keine negativen oder NaN-Werte)', async () => {
    const mock = mockFetch(json(readJsonFixture('tefas-price-1m.json')));
    const points = await new TefasAdapter({ fetch: mock.fetch, sleep: mock.sleep }).getHistory('AFT', 'month');
    expect(points.length).toBeGreaterThan(15);
    for (const p of points) {
      expect(p.price).toBeGreaterThan(0);
      expect(Number.isFinite(p.price)).toBe(true);
      expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('TefasAdapter: Vergleich mit Gold, BIST, Inflation, Devisen', () => {
  it('ordnet die Werte den richtigen Arten zu, der Fonds selbst zuerst', async () => {
    const mock = mockFetch(json(benchmark));
    const points = await new TefasAdapter({ fetch: mock.fetch, sleep: mock.sleep }).getBenchmark('AFT', 'year');
    expect(points[0]).toMatchObject({ kind: 'fund', returnPercent: 35.7091 });
    const byKind = Object.fromEntries(points.map((p) => [p.kind, p]));
    expect(byKind.gold).toMatchObject({ label: 'Altın', returnPercent: 34.9237 });
    expect(byKind.bist100).toMatchObject({ returnPercent: 16.3028 });
    expect(byKind.bist30).toMatchObject({ returnPercent: 29.0263 });
    expect(byKind.cpi).toMatchObject({ label: 'TÜFE', returnPercent: 31.5019 });
    expect(byKind.usd).toMatchObject({ returnPercent: 18.137 });
    expect(byKind.eur).toMatchObject({ returnPercent: 15.3342 });
    expect(byKind.deposit).toMatchObject({ returnPercent: 40.54 });
    expect(byKind.category).toMatchObject({ label: 'Hisse Senedi Şemsiye Fonu', returnPercent: 22.93 });
  });

  it('"Woche" fragt wie beim Kursverlauf einen Monat ab', async () => {
    const mock = mockFetch(json({ resultList: [] }));
    await new TefasAdapter({ fetch: mock.fetch, sleep: mock.sleep }).getBenchmark('AFT', 'week');
    expect(JSON.parse(mock.calls[0]!.init!.body as string)).toMatchObject({ periyod: 1 });
  });

  it('stellt den Fonds selbst an den Anfang, auch wenn TEFAS ihn nicht zuerst liefert', async () => {
    const shuffled = {
      resultList: [
        { fonKodu: 'ALTIN', fonUnvan: 'ALTIN', fonTuru: 'ALTIN', fonTurGetiri: 0.1 },
        { fonKodu: 'YAY', fonUnvan: 'YAPI KREDİ PORTFÖY ...', fonTuru: 'Hisse Senedi Şemsiye Fonu', fonTurGetiri: 0.48 },
        { fonKodu: 'USD', fonUnvan: 'USD', fonTuru: 'USD', fonTurGetiri: 0.1 },
      ],
    };
    const mock = mockFetch(json(shuffled));
    const points = await new TefasAdapter({ fetch: mock.fetch, sleep: mock.sleep }).getBenchmark('yay', 'year');
    expect(points.map((p) => p.kind)).toEqual(['fund', 'gold', 'usd']);
    expect(points[0]!.returnPercent).toBeCloseTo(48);
  });

  it('lässt Vergleichswerte ohne Ergebnis über den ganzen Zeitraum weg, statt die ganze Antwort zu verwerfen', async () => {
    const withGap = {
      resultList: [
        { fonKodu: 'AFT', fonUnvan: 'AFT', fonTuru: 'Hisse Senedi Şemsiye Fonu', fonTurGetiri: 0.48 },
        { fonKodu: 'ALTIN', fonUnvan: 'ALTIN', fonTuru: 'ALTIN', fonTurGetiri: null },
        { fonKodu: 'USD', fonUnvan: 'USD', fonTuru: 'USD', fonTurGetiri: 0.1 },
      ],
    };
    const mock = mockFetch(json(withGap));
    const points = await new TefasAdapter({ fetch: mock.fetch, sleep: mock.sleep }).getBenchmark('AFT', '5year');
    expect(points.map((p) => p.kind)).toEqual(['fund', 'usd']);
  });
});
