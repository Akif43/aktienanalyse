import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Candle } from '@aktien/core';
import { buildChartData, localParts, toChartTime, visibleFrom } from '../src/lib/chart-data';
import { formatAsOf, formatCount, formatNumber, formatPercent, formatPrice, formatRelative, formatSigned, formatVolume, direction, newsSearchName, safeHref } from '../src/lib/format';
import type { StorageLike } from '../src/lib/storage';
import { sanitize, WatchlistStore } from '../src/lib/watchlist';

const ref = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/core/test/fixtures/thyao-1d.reference.json', import.meta.url)), 'utf-8'),
) as { candles: Candle[]; sma20: (number | null)[]; rsi14: (number | null)[]; macdHist: (number | null)[] };

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

describe('Zeitumrechnung', () => {
  it('liefert Ortszeit der Börse (Istanbul UTC+3, kein Sommerzeit)', () => {
    // 2026-09-21 07:00:00 UTC = 10:00 in Istanbul
    const t = Date.UTC(2026, 8, 21, 7) / 1000;
    expect(localParts(t, 'Europe/Istanbul')).toMatchObject({ day: 21, hour: 10, minute: 0 });
    expect(toChartTime(t, 'Europe/Istanbul', false)).toBe(Date.UTC(2026, 8, 21, 10) / 1000);
    expect(toChartTime(t, 'Europe/Istanbul', true)).toEqual({ year: 2026, month: 9, day: 21 });
  });

  it('berücksichtigt Sommerzeit (Berlin: UTC+2 im Sommer, UTC+1 im Winter; New York: UTC−4 / −5)', () => {
    const sec = (...a: Parameters<typeof Date.UTC>) => Date.UTC(...a) / 1000;
    expect(localParts(sec(2026, 6, 1, 7), 'Europe/Berlin').hour).toBe(9);
    expect(localParts(sec(2026, 0, 15, 8), 'Europe/Berlin').hour).toBe(9);
    expect(localParts(sec(2026, 6, 1, 13, 30), 'America/New_York')).toMatchObject({ hour: 9, minute: 30 });
    expect(localParts(sec(2026, 0, 15, 14, 30), 'America/New_York')).toMatchObject({ hour: 9, minute: 30 });
  });

  it('ordnet Tageskerzen dem Börsentag zu, auch wenn UTC schon der Vortag/Folgetag wäre', () => {
    // 22:30 UTC am 20.09. = 01:30 am 21.09. in Istanbul
    expect(toChartTime(Date.UTC(2026, 8, 20, 22, 30) / 1000, 'Europe/Istanbul', true)).toEqual({ year: 2026, month: 9, day: 21 });
    // 01:00 UTC am 21.09. = 21:00 am 20.09. in New York
    expect(toChartTime(Date.UTC(2026, 8, 21, 1) / 1000, 'America/New_York', true)).toEqual({ year: 2026, month: 9, day: 20 });
  });
});

describe('buildChartData (echte THYAO-Tagesdaten)', () => {
  const tz = 'Europe/Istanbul';
  const data = buildChartData(ref.candles, { tz, daily: true, withIndicators: true });
  const ind = data.indicators!;

  it('erzeugt gleich viele Kerzen- und Volumenpunkte, streng aufsteigend', () => {
    expect(data.candles).toHaveLength(ref.candles.length);
    expect(data.volume).toHaveLength(ref.candles.length);
    const keys = data.candles.map((c) => (c.time as any).year * 10000 + (c.time as any).month * 100 + (c.time as any).day);
    expect(keys.every((k, i) => i === 0 || k > keys[i - 1]!)).toBe(true);
  });

  it('Indikatorreihen beginnen erst nach der Einschwingphase und stimmen mit der Referenz überein', () => {
    expect(ind.sma20).toHaveLength(ref.candles.length - 19);
    expect(ind.sma200).toHaveLength(ref.candles.length - 199);
    expect(ind.rsi).toHaveLength(ref.candles.length - 14);
    expect(ind.sma20.at(-1)!.value).toBeCloseTo(ref.sma20.at(-1)!, 8);
    expect(ind.rsi.at(-1)!.value).toBeCloseTo(ref.rsi14.at(-1)!, 5);
    expect(ind.macdHist.at(-1)!.value).toBeCloseTo(ref.macdHist.at(-1)!, 6);
    expect(ind.macdHist.at(-1)!.up).toBe(ref.macdHist.at(-1)! >= 0);
  });

  it('Bollinger-Bänder liegen um das Mittelband', () => {
    const i = ind.bbMiddle.length - 1;
    expect(ind.bbUpper[i]!.value).toBeGreaterThan(ind.bbMiddle[i]!.value);
    expect(ind.bbLower[i]!.value).toBeLessThan(ind.bbMiddle[i]!.value);
  });

  it('kürzt auf den sichtbaren Zeitraum, rechnet aber mit voller Historie (SMA200 bleibt gefüllt)', () => {
    const from = visibleFrom(ref.candles, '6M')!;
    const six = buildChartData(ref.candles, { tz, daily: true, withIndicators: true, fromUnix: from });
    expect(six.candles.length).toBeGreaterThan(100);
    expect(six.candles.length).toBeLessThan(140);
    expect(six.indicators!.sma200).toHaveLength(six.candles.length); // 6 Monate Anzeige, aber SMA200 überall vorhanden
    expect(six.indicators!.sma200[0]!.value).toBeCloseTo(sma200At(ref.candles, ref.candles.length - six.candles.length), 8);
  });

  it('Intraday: keine Indikatoren, Zeitachse in Ortszeit', () => {
    const intraday = ref.candles.slice(-5).map((c, i) => ({ ...c, time: Date.UTC(2026, 8, 21, 7, i * 5) / 1000 }));
    const d = buildChartData(intraday, { tz, daily: false, withIndicators: true });
    expect(d.indicators).toBeNull();
    expect(d.candles[0]!.time).toBe(Date.UTC(2026, 8, 21, 10) / 1000);
  });

  it('verwirft doppelte Zeiten, z. B. beim Sommerzeitwechsel', () => {
    const base = Date.UTC(2026, 9, 25, 0, 30) / 1000; // Berlin: Umstellung auf Winterzeit am 25.10.
    const cs: Candle[] = Array.from({ length: 6 }, (_, i) => ({ time: base + i * 1800, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }));
    const d = buildChartData(cs, { tz: 'Europe/Berlin', daily: false });
    const times = d.candles.map((c) => c.time as number);
    expect(times.every((t, i) => i === 0 || t > times[i - 1]!)).toBe(true);
  });

  it('visibleFrom kennt nur 6M und 1J', () => {
    expect(visibleFrom(ref.candles, '1T')).toBeUndefined();
    expect(visibleFrom([], '6M')).toBeUndefined();
    const last = ref.candles.at(-1)!.time;
    expect(visibleFrom(ref.candles, '1J')).toBe(last - 366 * 86_400);
  });
});

function sma200At(candles: Candle[], index: number): number {
  return candles.slice(index - 199, index + 1).reduce((s, c) => s + c.close, 0) / 200;
}

describe('Formatierung (de-DE)', () => {
  it('Zahlen und Preise', () => {
    expect(formatNumber(285.25)).toBe('285,25');
    expect(formatNumber(1234567.891)).toBe('1.234.567,89');
    expect(formatNumber(4.1234)).toBe('4,1234'); // kleine Kurse mit mehr Stellen
    expect(formatNumber(null)).toBe('–');
    expect(formatNumber(NaN)).toBe('–');
    expect(formatPrice(285.25, 'TRY')).toBe('285,25 ₺');
    expect(formatPrice(336.13, 'USD')).toBe('336,13 $');
    expect(formatPrice(1, 'CHF')).toBe('1,00 CHF');
  });

  it('Prozent und Vorzeichen (echtes Minuszeichen)', () => {
    expect(formatPercent(1.234)).toBe('+1,23 %');
    expect(formatPercent(-0.5)).toBe('−0,50 %');
    expect(formatPercent(0)).toBe('0,00 %');
    expect(formatPercent(-3, false)).toBe('−3,00 %');
    expect(formatPercent(undefined)).toBe('–');
    expect(formatSigned(-2.5)).toBe('−2,50');
    expect(formatSigned(2.5)).toBe('+2,50');
  });

  it('Volumen kompakt', () => {
    expect(formatVolume(9_282_188)).toMatch(/9,3\s?Mio/);
    expect(formatVolume(null)).toBe('–');
  });

  it('Ganzzahl ohne Nachkommastellen (z. B. Anlegerzahl), anders als formatNumber', () => {
    expect(formatCount(42_599)).toBe('42.599');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(null)).toBe('–');
    expect(formatCount(NaN)).toBe('–');
  });

  it('Kurszeit in Börsenzeit: heute nur Uhrzeit, sonst Datum', () => {
    const now = Date.UTC(2026, 8, 21, 8, 0);
    expect(formatAsOf(Date.UTC(2026, 8, 21, 7, 36) / 1000, 'BIST', now)).toBe('10:36');
    expect(formatAsOf(Date.UTC(2026, 8, 18, 20, 0) / 1000, 'US', now)).toMatch(/^18\.09\..*16:00$/);
  });

  it('relative Zeit', () => {
    const now = 1_000_000_000_000;
    expect(formatRelative(now - 10_000, now)).toBe('gerade eben');
    expect(formatRelative(now - 5 * 60_000, now)).toBe('vor 5 Min.');
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe('vor 3 Std.');
    expect(formatRelative(now - 86_400_000, now)).toBe('vor 1 Tag');
    expect(formatRelative(now - 3 * 86_400_000, now)).toBe('vor 3 Tagen');
    expect(formatRelative(now - 30 * 86_400_000, now)).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
    expect(formatRelative(now + 60_000, now)).toBe('gerade eben'); // Uhrenabweichung
  });

  it('newsSearchName entfernt Rechtsformen', () => {
    expect(newsSearchName('Türk Hava Yollari Anonim Ortakligi')).toBe('Türk Hava Yollari');
    expect(newsSearchName('SAP SE')).toBe('SAP');
    expect(newsSearchName('Apple Inc.')).toBe('Apple');
    expect(newsSearchName('BİM Birleşik Mağazalar A.Ş.')).toBe('BİM Birleşik Mağazalar');
    expect(newsSearchName('Aselsan')).toBe('Aselsan');
    expect(newsSearchName('SE')).toBe('SE'); // nie leer
  });

  it('direction', () => {
    expect([direction(1), direction(-1), direction(0), direction(null)]).toEqual(['up', 'down', 'flat', 'flat']);
  });
});

describe('WatchlistStore', () => {
  it('startet leer und speichert Einträge dauerhaft', () => {
    const storage = fakeStorage();
    const s = new WatchlistStore(storage, () => 42);
    expect(s.getSnapshot()).toEqual([]);
    expect(s.add('thyao.is', 'Türk Hava Yolları')).toBe(true);
    expect(s.add('AAPL')).toBe(true);
    expect(s.getSnapshot()).toEqual([
      { ticker: 'THYAO.IS', symbol: 'THYAO', market: 'BIST', name: 'Türk Hava Yolları', addedAt: 42 },
      { ticker: 'AAPL', symbol: 'AAPL', market: 'US', name: undefined, addedAt: 42 },
    ]);
    expect(new WatchlistStore(storage).getSnapshot().map((i) => i.ticker)).toEqual(['THYAO.IS', 'AAPL']);
  });

  it('verhindert Dubletten, aktualisiert aber den Namen, und entfernt', () => {
    const s = new WatchlistStore(fakeStorage());
    s.add('SAP.DE');
    s.add('sap.de', 'SAP SE');
    expect(s.getSnapshot()).toHaveLength(1);
    expect(s.getSnapshot()[0]!.name).toBe('SAP SE');
    s.remove('sap.de');
    expect(s.getSnapshot()).toEqual([]);
    expect(() => s.add('../evil')).toThrow(/Ungültiges Kürzel/);
  });

  it('benachrichtigt Abonnenten und liefert bei Änderung eine neue Referenz', () => {
    const s = new WatchlistStore(fakeStorage());
    let calls = 0;
    const off = s.subscribe(() => calls++);
    const before = s.getSnapshot();
    s.add('AAPL');
    expect(calls).toBe(1);
    expect(s.getSnapshot()).not.toBe(before);
    const same = s.getSnapshot();
    s.add('AAPL'); // unverändert → keine Benachrichtigung, gleiche Referenz
    expect(calls).toBe(1);
    expect(s.getSnapshot()).toBe(same);
    off();
    s.remove('AAPL');
    expect(calls).toBe(1);
  });

  it('begrenzt die Liste auf 50 Einträge', () => {
    const s = new WatchlistStore(fakeStorage());
    for (let i = 0; i < 50; i++) expect(s.add(`T${i}`)).toBe(true);
    expect(s.add('EXTRA')).toBe(false);
    expect(s.getSnapshot()).toHaveLength(50);
  });

  it('übersteht kaputte oder manipulierte Speicherinhalte', () => {
    expect(new WatchlistStore(fakeStorage({ 'aktien.watchlist.v1': '{kein json' })).getSnapshot()).toEqual([]);
    expect(new WatchlistStore(fakeStorage({ 'aktien.watchlist.v1': '{"a":1}' })).getSnapshot()).toEqual([]);
    const messy = JSON.stringify([{ ticker: 'thyao.is' }, { ticker: '../x' }, { ticker: 5 }, null, 'x', { ticker: 'THYAO.IS' }, { ticker: 'AAPL', name: 'x'.repeat(200) }]);
    const items = new WatchlistStore(fakeStorage({ 'aktien.watchlist.v1': messy })).getSnapshot();
    expect(items.map((i) => i.ticker)).toEqual(['THYAO.IS', 'AAPL']);
    expect(items[1]!.name).toHaveLength(80);
  });

  it('funktioniert weiter, wenn der Speicher beim Schreiben scheitert', () => {
    const broken: StorageLike = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); }, removeItem: () => {} };
    const s = new WatchlistStore(broken);
    expect(() => s.add('AAPL')).not.toThrow();
    expect(s.getSnapshot()).toHaveLength(1);
  });

  it('Export und Import sind verlustfrei und ersetzen die Liste', () => {
    const a = new WatchlistStore(fakeStorage(), () => 7);
    a.add('THYAO.IS', 'Türk Hava Yolları');
    a.add('AAPL', 'Apple Inc.');
    const json = a.exportJson();
    const b = new WatchlistStore(fakeStorage({ 'aktien.watchlist.v1': JSON.stringify([{ ticker: 'SAP.DE' }]) }));
    expect(b.replaceAll(JSON.parse(json))).toBe(2);
    expect(b.getSnapshot().map((i) => [i.ticker, i.name])).toEqual([['THYAO.IS', 'Türk Hava Yolları'], ['AAPL', 'Apple Inc.']]);
    expect(b.replaceAll('kaputt')).toBe(0);
    expect(b.getSnapshot()).toEqual([]);
  });

  it('sanitize', () => {
    expect(sanitize(undefined)).toEqual([]);
    expect(sanitize([{ ticker: 'sap.de', addedAt: '5' }])[0]).toMatchObject({ ticker: 'SAP.DE', market: 'XETRA', addedAt: 5 });
  });
});

describe('safeHref', () => {
  it('lässt nur http(s) zu', () => {
    expect(safeHref('https://news.google.com/rss/articles/abc')).toBe('https://news.google.com/rss/articles/abc');
    expect(safeHref('http://example.com/a?b=1')).toBe('http://example.com/a?b=1');
    expect(safeHref('javascript:alert(1)')).toBe('#');
    expect(safeHref('JaVaScRiPt:alert(1)')).toBe('#');
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBe('#');
    expect(safeHref('//evil.com')).toBe('#');
    expect(safeHref('')).toBe('#');
    expect(safeHref('kein url')).toBe('#');
  });
});
