import { describe, expect, it } from 'vitest';
import {
  atr,
  bollinger,
  computeTechnicalSnapshot,
  detectCross,
  ema,
  findPivots,
  macd,
  macdState,
  normalizeCandles,
  range52w,
  rsi,
  sma,
  supportResistance,
  trendStructure,
  volumeTrend,
} from '../src/indicators';
import type { Candle } from '../src/types';
import { candlesFromCloses, expectClose, readJsonFixture, triangleWave } from './helpers';

interface Reference {
  candles: Candle[];
  sma20: (number | null)[];
  sma50: (number | null)[];
  sma200: (number | null)[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  ema200: (number | null)[];
  rsi14: (number | null)[];
  macd: (number | null)[];
  macdSignal: (number | null)[];
  macdHist: (number | null)[];
  bbMiddle: (number | null)[];
  bbUpper: (number | null)[];
  bbLower: (number | null)[];
  atr14: (number | null)[];
}

const ref = readJsonFixture<Reference>('thyao-1d.reference.json');
const closes = ref.candles.map((c) => c.close);
const TOL = 1e-7;

/** Vergleicht ab dem ersten Wert: gleiche Länge, gleiche Einschwingphase (null), gleiche Werte. */
function compareSeries(actual: (number | null)[], expected: (number | null)[], label: string, firstIndex: number) {
  expect(actual).toHaveLength(expected.length);
  expect(actual.findIndex((v) => v !== null), `${label}: erster Wert`).toBe(firstIndex);
  for (let i = 0; i < expected.length; i++) expectClose(actual[i], expected[i]!, TOL, `${label}[${i}]`);
}

describe('Indikatoren gegen pandas-Referenz (THYAO.IS, 2 Jahre Tagesdaten)', () => {
  it('nutzt genügend Referenzdaten', () => {
    expect(ref.candles.length).toBeGreaterThan(450);
  });

  it('SMA 20/50/200 stimmt ab dem ersten Wert überein', () => {
    compareSeries(sma(closes, 20), ref.sma20, 'sma20', 19);
    compareSeries(sma(closes, 50), ref.sma50, 'sma50', 49);
    compareSeries(sma(closes, 200), ref.sma200, 'sma200', 199);
  });

  it('EMA 20/50/200 (SMA-Seed) stimmt ab dem ersten Wert überein', () => {
    compareSeries(ema(closes, 20), ref.ema20, 'ema20', 19);
    compareSeries(ema(closes, 50), ref.ema50, 'ema50', 49);
    compareSeries(ema(closes, 200), ref.ema200, 'ema200', 199);
  });

  it('RSI(14) nach Wilder stimmt überein', () => {
    compareSeries(rsi(closes, 14), ref.rsi14, 'rsi14', 14);
  });

  it('MACD, Signal und Histogramm stimmen überein', () => {
    const m = macd(closes);
    compareSeries(m.macd, ref.macd, 'macd', 25);
    compareSeries(m.signal, ref.macdSignal, 'signal', 33);
    compareSeries(m.histogram, ref.macdHist, 'hist', 33);
  });

  it('Bollinger-Bänder (Populations-Std) stimmen ab dem ersten Wert überein', () => {
    const bb = bollinger(closes, 20, 2);
    compareSeries(bb.middle, ref.bbMiddle, 'mid', 19);
    compareSeries(bb.upper, ref.bbUpper, 'upper', 19);
    compareSeries(bb.lower, ref.bbLower, 'lower', 19);
  });

  it('ATR(14) nach Wilder stimmt überein', () => {
    compareSeries(atr(ref.candles, 14), ref.atr14, 'atr14', 13);
  });
});

describe('Von Hand nachgerechnete Fälle', () => {
  it('RSI(3): erst 80, dann 61,538', () => {
    // Änderungen +1, −0,5, +1 → avgGain 2/3, avgLoss 1/6 → RS 4 → RSI 80
    // dann −0,5: avgGain 4/9, avgLoss 5/18 → RS 1,6 → RSI 61,538…
    const out = rsi([10, 11, 10.5, 11.5, 11], 3);
    expect(out.slice(0, 3)).toEqual([null, null, null]);
    expectClose(out[3], 80, 1e-9, 'rsi[3]');
    expectClose(out[4], 100 - 100 / 2.6, 1e-9, 'rsi[4]');
  });

  it('ATR(2): Wilder-Glättung mit Gap', () => {
    const cs: Candle[] = [
      { time: 1, open: 10, high: 12, low: 10, close: 11, volume: 1 }, // TR 2
      { time: 2, open: 11, high: 13, low: 11, close: 12, volume: 1 }, // TR max(2, 2, 0) = 2 → ATR = 2
      { time: 3, open: 15, high: 16, low: 15, close: 15.5, volume: 1 }, // TR max(1, 4, 3) = 4 → (2*1+4)/2 = 3
    ];
    const out = atr(cs, 2);
    expect(out).toEqual([null, 2, 3]);
  });

  it('Bollinger: konstante Reihe hat Bandbreite 0, Reihe 1..5 hat sd √2', () => {
    const flat = bollinger([5, 5, 5, 5, 5], 5, 2);
    expect(flat.upper[4]).toBe(5);
    expect(flat.lower[4]).toBe(5);
    const bb = bollinger([1, 2, 3, 4, 5], 5, 2);
    expectClose(bb.middle[4], 3, 1e-12);
    expectClose(bb.upper[4], 3 + 2 * Math.SQRT2, 1e-12);
  });
});

describe('Grenzfälle', () => {
  it('liefert bei zu wenig Daten nur null', () => {
    expect(sma([1, 2, 3], 5).every((v) => v === null)).toBe(true);
    expect(ema([1, 2, 3], 5).every((v) => v === null)).toBe(true);
    expect(rsi([1, 2, 3], 14).every((v) => v === null)).toBe(true);
    expect(atr(candlesFromCloses([1, 2, 3]), 14).every((v) => v === null)).toBe(true);
  });

  it('SMA/EMA einfacher Fall', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    // Seed = SMA(1,2,3)=2, dann alpha=0,5: 0,5*4+0,5*2=3, 0,5*5+0,5*3=4
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('RSI: nur Gewinne = 100, konstante Reihe = 50, nur Verluste = 0', () => {
    expect(rsi(Array.from({ length: 30 }, (_, i) => 10 + i), 14).at(-1)).toBe(100);
    expect(rsi(Array.from({ length: 30 }, () => 10), 14).at(-1)).toBe(50);
    expect(rsi(Array.from({ length: 30 }, (_, i) => 100 - i), 14).at(-1)).toBe(0);
  });

  it('lehnt ungültige Perioden ab', () => {
    expect(() => sma([1, 2], 0)).toThrow();
    expect(() => rsi([1, 2], -3)).toThrow();
    expect(() => macd([1, 2, 3], 26, 12)).toThrow();
  });

  it('normalizeCandles entfernt Lücken, Duplikate und sortiert', () => {
    const out = normalizeCandles([
      { time: 3, open: 3, high: 4, low: 2, close: 3, volume: 10 },
      { time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 },
      { time: 2, open: null as unknown as number, high: 2, low: 1, close: 1.5, volume: 5 },
      { time: 1, open: 1, high: 2, low: 0.5, close: 1.6, volume: 6 },
      { time: 4, open: 1, high: 0.5, low: 2, close: 1, volume: 1 },
      { time: 5, open: 1, high: 2, low: 0.5, close: 1, volume: undefined },
    ]);
    expect(out.map((c) => c.time)).toEqual([1, 3, 5]);
    expect(out[0]!.close).toBe(1.6);
    expect(out[2]!.volume).toBe(0);
  });
});

describe('Pivots, Zonen und Trendstruktur', () => {
  // Dojis (Open = Close), damit keine gleichen Hochs an Nachbartagen entstehen
  const dojis = (closes: number[]) => candlesFromCloses(closes, 0).map((c) => ({ ...c, open: c.close, high: c.close, low: c.close }));
  const wave = triangleWave(96, 20, 100, 110);
  const candles = dojis(wave);

  it('findet Swing-Hochs und -Tiefs einer Dreieckswelle', () => {
    const pivots = findPivots(candles, 5, 5);
    expect(pivots.filter((p) => p.type === 'high').map((p) => p.index)).toEqual([10, 30, 50, 70, 90]);
    expect(pivots.filter((p) => p.type === 'low').map((p) => p.index)).toEqual([20, 40, 60, 80]);
  });

  it('bildet Unterstützung und Widerstand um den Kurs', () => {
    const pivots = findPivots(candles, 5, 5);
    const price = candles.at(-1)!.close;
    expect(price).toBe(105);
    const sr = supportResistance(pivots, candles.length - 1, price, { tolerance: 1 });
    expect(sr.supports).toHaveLength(1);
    expect(sr.resistances).toHaveLength(1);
    expect(sr.supports[0]).toMatchObject({ id: 'S1', touches: 4 });
    expect(sr.supports[0]!.high).toBeLessThan(price);
    expect(sr.resistances[0]).toMatchObject({ id: 'R1', touches: 5 });
    expect(sr.resistances[0]!.low).toBeGreaterThan(price);
    expect(sr.resistances[0]!.distancePercent).toBeGreaterThan(0);
    expect(sr.supports[0]!.distancePercent).toBeLessThan(0);
  });

  it('ordnet Zonen, in denen der Kurs liegt, separat ein', () => {
    const pivots = findPivots(candles, 5, 5);
    const sr = supportResistance(pivots, candles.length - 1, 110, { tolerance: 1 });
    expect(sr.inside).toHaveLength(1);
    expect(sr.resistances).toHaveLength(0);
  });

  it('erkennt Aufwärtstrend (HH/HL), Abwärtstrend (LH/LL) und Seitwärts', () => {
    const up = trendStructure(findPivots(dojis(triangleWave(100, 20, 100, 110, 0.5)), 5, 5));
    expect(up.state).toBe('aufwärts');
    expect(up.highs.every((h) => h === 'HH')).toBe(true);
    expect(up.lows.every((l) => l === 'HL')).toBe(true);

    const down = trendStructure(findPivots(dojis(triangleWave(100, 20, 100, 110, -0.5).map((v) => v + 100)), 5, 5));
    expect(down.state).toBe('abwärts');

    const flat = trendStructure(findPivots(candles, 5, 5));
    expect(flat.state).toBe('seitwärts');
  });

  it('meldet "unbekannt" ohne genug Swings', () => {
    expect(trendStructure([]).state).toBe('unbekannt');
  });
});

describe('Kreuze, MACD-Zustand, 52-Wochen-Bereich, Volumen', () => {
  const dummy = candlesFromCloses([1, 1, 1, 1, 1, 1]);

  it('erkennt ein Golden Cross und die Kerzen seitdem', () => {
    const info = detectCross([1, 1, 1, 3, 3, 3], [2, 2, 2, 2, 2, 2], dummy);
    expect(info.regime).toBe('golden');
    expect(info.lastCross).toMatchObject({ type: 'golden', index: 3, barsAgo: 2 });
  });

  it('erkennt ein Death Cross', () => {
    const info = detectCross([3, 3, 1, 1, 1, 1], [2, 2, 2, 2, 2, 2], dummy);
    expect(info.regime).toBe('death');
    expect(info.lastCross).toMatchObject({ type: 'death', index: 2, barsAgo: 3 });
  });

  it('meldet unbekannt, solange die langsame Reihe fehlt', () => {
    const info = detectCross([1, 2, 3], [null, null, null], candlesFromCloses([1, 2, 3]));
    expect(info).toEqual({ regime: 'unbekannt', lastCross: null });
  });

  it('macdState findet das letzte Kreuz', () => {
    const s = macdState([null, -1, -1, 1, 1], [null, 0, 0, 0, 0]);
    expect(s.position).toBe('über Signal');
    expect(s.lastCross).toEqual({ type: 'bullish', barsAgo: 1 });
  });

  it('range52w: Abstand zu Hoch und Tief, partial-Flag', () => {
    const cs = candlesFromCloses([100, 120, 80, 90], 0);
    const r = range52w(cs)!;
    expect(r).toMatchObject({ high: 120, low: 80, bars: 4, partial: true });
    expect(r.percentBelowHigh).toBe(25);
    expect(r.percentAboveLow).toBe(12.5);
    expect(range52w([])).toBeNull();
  });

  it('range52w nutzt nur die letzten 252 Kerzen', () => {
    const closes252 = Array.from({ length: 300 }, (_, i) => (i === 10 ? 500 : 100));
    const r = range52w(candlesFromCloses(closes252, 0))!;
    expect(r.high).toBe(100);
    expect(r.partial).toBe(false);
  });

  it('volumeTrend: steigendes Volumen und Auf-/Abwärts-Verhältnis', () => {
    const cs = candlesFromCloses(
      Array.from({ length: 60 }, (_, i) => 100 + (i % 2)),
      0,
    ).map((c, i) => ({ ...c, volume: i >= 40 ? 2000 : 1000 }));
    const v = volumeTrend(cs);
    expect(v.avg20).toBe(2000);
    expect(v.ratio).toBeGreaterThan(1.15);
    expect(v.label).toBe('steigend');
    expect(v.upDownVolumeRatio).not.toBeNull();
    expect(volumeTrend(cs.slice(0, 10)).label).toBe('unbekannt');
  });
});

describe('computeTechnicalSnapshot (echte THYAO-Daten)', () => {
  const snap = computeTechnicalSnapshot(ref.candles);

  it('füllt alle Kennzahlen und ist JSON-serialisierbar ohne NaN', () => {
    expect(snap.bars).toBe(ref.candles.length);
    expect(snap.sma['200'].value).not.toBeNull();
    expect(snap.rsi14.value).toBeGreaterThan(0);
    expect(snap.rsi14.value).toBeLessThan(100);
    expect(snap.range52w?.partial).toBe(false);
    // Die aufgezeichnete Yahoo-Antwort hat echte Lücken (17. und 18.09. fehlen): der Warner muss sie finden.
    expect(snap.warnings).toHaveLength(1);
    expect(snap.warnings[0]).toMatch(/^1 Lücke/);
    const json = JSON.stringify(snap);
    expect(json).not.toMatch(/NaN|Infinity/);
    expect(JSON.parse(json)).toEqual(snap);
  });

  it('ordnet Zonen konsistent zum Kurs an', () => {
    for (const z of snap.levels.supports) expect(z.high).toBeLessThan(snap.price);
    for (const z of snap.levels.resistances) expect(z.low).toBeGreaterThan(snap.price);
    // nächste Zone zuerst
    const s = snap.levels.supports.map((z) => z.mid);
    expect([...s].sort((a, b) => b - a)).toEqual(s);
    expect(snap.levels.supports.map((z) => z.id)).toEqual(snap.levels.supports.map((_, i) => `S${i + 1}`));
  });

  it('Bollinger %B und ATR-Prozent sind plausibel', () => {
    expect(snap.atr14.percentOfPrice).toBeGreaterThan(0);
    expect(snap.atr14.percentOfPrice).toBeLessThan(15);
    expect(snap.bollinger.upper!).toBeGreaterThan(snap.bollinger.lower!);
  });

  it('warnt bei Datenlücken, aber nicht bei Wochenenden und verlängerten Wochenenden', () => {
    const DAY = 86_400;
    // Kalendertage-Abstand zur jeweils vorherigen Kerze; Standard = Werktag/Wochenende (1 bzw. 3 Tage)
    const build = (gapAtEnd: number) => {
      const base = candlesFromCloses(Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 5));
      const cs = base.map((c, i) => ({ ...c, time: 1_700_000_000 + i * DAY }));
      return cs.map((c, i) => (i === cs.length - 1 ? { ...c, time: cs[i - 1]!.time + gapAtEnd * DAY } : c));
    };
    expect(computeTechnicalSnapshot(build(3)).warnings.filter((w) => /Lücke/.test(w))).toEqual([]);
    expect(computeTechnicalSnapshot(build(4)).warnings.filter((w) => /Lücke/.test(w))).toEqual([]);
    const flagged = computeTechnicalSnapshot(build(5)).warnings.filter((w) => /Lücke/.test(w));
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatch(/^1 Lücke/);
  });

  it('übernimmt Hinweise der Datenquelle in die Warnungen', () => {
    const snap = computeTechnicalSnapshot(ref.candles, { extraWarnings: ['6 Kerzen verworfen'] });
    expect(snap.warnings).toContain('6 Kerzen verworfen');
  });

  it('warnt bei kurzer Historie und lehnt zu wenig Daten ab', () => {
    const short = computeTechnicalSnapshot(ref.candles.slice(-120));
    expect(short.sma['200'].value).toBeNull();
    expect(short.crossSma50Sma200.regime).toBe('unbekannt');
    expect(short.warnings.some((w) => /200/.test(w))).toBe(true);
    expect(() => computeTechnicalSnapshot(ref.candles.slice(-10))).toThrow(/Zu wenig Daten/);
  });
});
