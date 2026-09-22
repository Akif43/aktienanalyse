import { describe, expect, it } from 'vitest';
import { convertCandles, type Candle, type FundPricePoint } from '@aktien/core';
import { buildFundChartData, fundCandles } from '../src/lib/fund-chart';
import { FundStore, sanitizeFunds } from '../src/lib/funds-store';
import type { StorageLike } from '../src/lib/storage';

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

describe('FundStore', () => {
  it('startet leer und speichert Einträge dauerhaft (Kürzel wird großgeschrieben)', () => {
    const storage = fakeStorage();
    const s = new FundStore(storage, () => 42);
    expect(s.getSnapshot()).toEqual([]);
    expect(s.add('aft', 'AK Portföy Yeni Teknolojiler')).toBe(true);
    expect(s.add('YAY')).toBe(true);
    expect(s.getSnapshot()).toEqual([
      { code: 'AFT', name: 'AK Portföy Yeni Teknolojiler', addedAt: 42 },
      { code: 'YAY', name: undefined, addedAt: 42 },
    ]);
    expect(new FundStore(storage).getSnapshot().map((i) => i.code)).toEqual(['AFT', 'YAY']);
  });

  it('verhindert Dubletten, aktualisiert aber den Namen, und entfernt', () => {
    const s = new FundStore(fakeStorage());
    s.add('AFT');
    s.add('aft', 'AK Portföy');
    expect(s.getSnapshot()).toHaveLength(1);
    expect(s.getSnapshot()[0]!.name).toBe('AK Portföy');
    s.remove('aft');
    expect(s.getSnapshot()).toEqual([]);
  });

  it('lehnt ungültige Kürzel ab, statt sie zu speichern', () => {
    const s = new FundStore(fakeStorage());
    expect(s.add('../evil')).toBe(false);
    expect(s.add('zu-lang-12345')).toBe(false);
    expect(s.getSnapshot()).toEqual([]);
  });

  it('benachrichtigt Abonnenten und liefert bei Änderung eine neue Referenz', () => {
    const s = new FundStore(fakeStorage());
    let calls = 0;
    const off = s.subscribe(() => calls++);
    const before = s.getSnapshot();
    s.add('AFT');
    expect(calls).toBe(1);
    expect(s.getSnapshot()).not.toBe(before);
    const same = s.getSnapshot();
    s.add('AFT'); // unverändert → keine Benachrichtigung, gleiche Referenz
    expect(calls).toBe(1);
    expect(s.getSnapshot()).toBe(same);
    off();
    s.remove('AFT');
    expect(calls).toBe(1);
  });

  it('begrenzt die Liste auf 50 Einträge', () => {
    const s = new FundStore(fakeStorage());
    for (let i = 0; i < 50; i++) expect(s.add(`F${i}`)).toBe(true);
    expect(s.add('EXTRA')).toBe(false);
    expect(s.getSnapshot()).toHaveLength(50);
  });

  it('übersteht kaputte oder manipulierte Speicherinhalte', () => {
    expect(new FundStore(fakeStorage({ 'aktien.funds.v1': '{kein json' })).getSnapshot()).toEqual([]);
    expect(new FundStore(fakeStorage({ 'aktien.funds.v1': '{"a":1}' })).getSnapshot()).toEqual([]);
    const messy = JSON.stringify([{ code: 'aft' }, { code: '../x' }, { code: 5 }, null, 'x', { code: 'AFT' }, { code: 'YAY', name: 'x'.repeat(200) }]);
    const items = new FundStore(fakeStorage({ 'aktien.funds.v1': messy })).getSnapshot();
    expect(items.map((i) => i.code)).toEqual(['AFT', 'YAY']);
    expect(items[1]!.name).toHaveLength(120);
  });

  it('funktioniert weiter, wenn der Speicher beim Schreiben scheitert', () => {
    const broken: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => {},
    };
    const s = new FundStore(broken);
    expect(() => s.add('AFT')).not.toThrow();
    expect(s.getSnapshot()).toHaveLength(1);
  });

  it('Export und Import sind verlustfrei und ersetzen die Liste', () => {
    const a = new FundStore(fakeStorage(), () => 7);
    a.add('AFT', 'AK Portföy');
    a.add('YAY', 'Yapı Kredi');
    const json = a.exportJson();
    const b = new FundStore(fakeStorage({ 'aktien.funds.v1': JSON.stringify([{ code: 'ALT' }]) }));
    expect(b.replaceAll(JSON.parse(json))).toBe(2);
    expect(b.getSnapshot().map((i) => [i.code, i.name])).toEqual([
      ['AFT', 'AK Portföy'],
      ['YAY', 'Yapı Kredi'],
    ]);
    expect(b.replaceAll('kaputt')).toBe(0);
    expect(b.getSnapshot()).toEqual([]);
  });

  it('sanitizeFunds', () => {
    expect(sanitizeFunds(undefined)).toEqual([]);
    expect(sanitizeFunds([{ code: 'aft', addedAt: '5' }])[0]).toMatchObject({ code: 'AFT', addedAt: 5 });
  });
});

describe('fundCandles', () => {
  const points: FundPricePoint[] = [
    { date: '2026-08-01', price: 1.0 },
    { date: '2026-08-02', price: 1.02 },
    { date: '2026-08-03', price: 0.98 },
  ];

  it('setzt Open/High/Low/Close auf den einen Tagespreis (Fonds haben keine Kursspanne)', () => {
    const candles = fundCandles(points);
    expect(candles).toHaveLength(3);
    for (const c of candles) {
      expect(c.open).toBe(c.close);
      expect(c.high).toBe(c.close);
      expect(c.low).toBe(c.close);
      expect(c.volume).toBe(0);
    }
    expect(candles.map((c) => c.close)).toEqual([1.0, 1.02, 0.98]);
  });

  it('legt jeden Tag auf Mittag UTC (bleibt in Istanbul am selben Kalendertag, auch über die Zeitzone gerechnet)', () => {
    const [c] = fundCandles([{ date: '2026-08-01', price: 1 }]);
    expect(new Date(c!.time * 1000).toISOString()).toBe('2026-08-01T12:00:00.000Z');
  });

  it('kommt mit leeren Daten klar', () => {
    expect(fundCandles([])).toEqual([]);
  });
});

describe('buildFundChartData', () => {
  const points: FundPricePoint[] = [
    { date: '2026-08-01', price: 1.0 },
    { date: '2026-08-02', price: 1.02 },
    { date: '2026-08-03', price: 0.98 },
  ];

  it('ordnet die Kalendertage streng aufsteigend zu (kein Sommerzeit-Versatz)', () => {
    const data = buildFundChartData(fundCandles(points));
    expect(data.candles.map((c) => c.time)).toEqual([
      { year: 2026, month: 8, day: 1 },
      { year: 2026, month: 8, day: 2 },
      { year: 2026, month: 8, day: 3 },
    ]);
  });

  it('liefert keine Indikatoren und kein Volumen (nicht sinnvoll bei nur einem Preis pro Tag)', () => {
    const data = buildFundChartData(fundCandles(points));
    expect(data.indicators).toBeNull();
    expect(data.volume.every((v) => v.value === 0)).toBe(true);
  });

  it('kommt mit leeren Daten klar', () => {
    expect(buildFundChartData([]).candles).toEqual([]);
  });

  it('lässt sich mit convertCandles in eine andere Währung umrechnen (wie beim Aktienchart)', () => {
    const fx: Candle[] = [
      { time: fundCandles([{ date: '2026-08-01', price: 0 }])[0]!.time, open: 40, high: 40, low: 40, close: 40, volume: 0 },
      { time: fundCandles([{ date: '2026-08-03', price: 0 }])[0]!.time, open: 41, high: 41, low: 41, close: 41, volume: 0 },
    ];
    const usd = convertCandles(fundCandles(points), fx, 'Europe/Istanbul');
    const data = buildFundChartData(usd);
    expect(data.candles.map((c) => c.close)).toEqual([1.0 / 40, 1.02 / 40, 0.98 / 41]);
  });
});
