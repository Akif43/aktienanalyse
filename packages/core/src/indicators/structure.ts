import type { Candle } from '../types';
import { round } from './series';

export interface Pivot {
  index: number;
  time: number;
  price: number;
  type: 'high' | 'low';
}

/**
 * Swing-Punkte (Fractals): Ein Hoch ist Pivot, wenn es mindestens so hoch ist wie die `left` Kerzen davor
 * und höher als die `right` Kerzen danach. Analog für Tiefs. Pivots stehen erst nach `right` Kerzen fest,
 * die jüngsten Kerzen liefern daher keine Pivots.
 */
export function findPivots(candles: readonly Candle[], left = 5, right = 5): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = left; i < candles.length - right; i++) {
    const c = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j < i; j++) {
      if (candles[j]!.high > c.high) isHigh = false;
      if (candles[j]!.low < c.low) isLow = false;
    }
    for (let j = i + 1; j <= i + right; j++) {
      if (candles[j]!.high >= c.high) isHigh = false;
      if (candles[j]!.low <= c.low) isLow = false;
    }
    if (isHigh) pivots.push({ index: i, time: c.time, price: c.high, type: 'high' });
    if (isLow) pivots.push({ index: i, time: c.time, price: c.low, type: 'low' });
  }
  return pivots;
}

export interface Zone {
  /** Stabile Kennung je Auswertung, z. B. "S1" (nächste Unterstützung) oder "R2". */
  id: string;
  low: number;
  high: number;
  mid: number;
  /** Anzahl der Pivots in der Zone. */
  touches: number;
  /** Gewichtete Stärke: neuere Pivots zählen mehr (Halbwertszeit `halfLifeBars`). */
  strength: number;
  /** Abstand der Zonenmitte zum aktuellen Kurs in Prozent (positiv = über dem Kurs). */
  distancePercent: number;
}

export interface SupportResistance {
  supports: Zone[];
  resistances: Zone[];
  /** Zonen, in denen der aktuelle Kurs gerade liegt. */
  inside: Zone[];
}

export interface SrOptions {
  /** Cluster-Toleranz in Preiseinheiten (Standard: 0,5 × ATR). */
  tolerance: number;
  minTouches?: number;
  halfLifeBars?: number;
  maxPerSide?: number;
}

/** Fasst Pivot-Preise zu Zonen zusammen und ordnet sie relativ zum aktuellen Kurs. */
export function supportResistance(
  pivots: readonly Pivot[],
  lastIndex: number,
  price: number,
  opts: SrOptions,
): SupportResistance {
  const { tolerance, minTouches = 2, halfLifeBars = 120, maxPerSide = 3 } = opts;
  const sorted = [...pivots].sort((a, b) => a.price - b.price);

  const clusters: Pivot[][] = [];
  let anchor: number | null = null;
  for (const p of sorted) {
    if (anchor !== null && p.price <= anchor + tolerance) {
      clusters[clusters.length - 1]!.push(p);
    } else {
      clusters.push([p]);
      anchor = p.price;
    }
  }

  const minWidth = tolerance * 0.5;
  const zones = clusters
    .filter((c) => c.length >= minTouches)
    .map((c) => {
      const prices = c.map((p) => p.price);
      let low = Math.min(...prices);
      let high = Math.max(...prices);
      if (high - low < minWidth) {
        const mid = (low + high) / 2;
        low = mid - minWidth / 2;
        high = mid + minWidth / 2;
      }
      const mid = (low + high) / 2;
      const strength = c.reduce((s, p) => s + 0.5 ** ((lastIndex - p.index) / halfLifeBars), 0);
      return {
        low,
        high,
        mid,
        touches: c.length,
        strength,
        distancePercent: ((mid - price) / price) * 100,
      };
    });

  const inside = zones.filter((z) => z.low <= price && z.high >= price);
  const below = zones.filter((z) => z.high < price).sort((a, b) => b.mid - a.mid);
  const above = zones.filter((z) => z.low > price).sort((a, b) => a.mid - b.mid);

  const finish = (z: (typeof zones)[number], id: string): Zone => ({
    id,
    low: round(z.low)!,
    high: round(z.high)!,
    mid: round(z.mid)!,
    touches: z.touches,
    strength: round(z.strength, 2)!,
    distancePercent: round(z.distancePercent, 2)!,
  });

  return {
    supports: below.slice(0, maxPerSide).map((z, i) => finish(z, `S${i + 1}`)),
    resistances: above.slice(0, maxPerSide).map((z, i) => finish(z, `R${i + 1}`)),
    inside: inside.map((z, i) => finish(z, `I${i + 1}`)),
  };
}

export type TrendState = 'aufwärts' | 'abwärts' | 'seitwärts' | 'unbekannt';

export interface TrendStructure {
  state: TrendState;
  /** Vergleich der letzten Swing-Hochs: HH = höheres Hoch, LH = tieferes Hoch. */
  highs: ('HH' | 'LH' | 'EH')[];
  /** Vergleich der letzten Swing-Tiefs: HL = höheres Tief, LL = tieferes Tief. */
  lows: ('HL' | 'LL' | 'EL')[];
  lastSwingHigh: number | null;
  lastSwingLow: number | null;
}

/**
 * Trendstruktur nach Dow: Aufwärts = höhere Hochs UND höhere Tiefs (jeweils aus den letzten drei Swings),
 * abwärts = tiefere Hochs UND tiefere Tiefs, sonst seitwärts.
 */
export function trendStructure(pivots: readonly Pivot[]): TrendStructure {
  const highs = pivots.filter((p) => p.type === 'high').slice(-3);
  const lows = pivots.filter((p) => p.type === 'low').slice(-3);

  const cmpHighs = highs.slice(1).map((p, i) => (p.price > highs[i]!.price ? 'HH' : p.price < highs[i]!.price ? 'LH' : 'EH') as 'HH' | 'LH' | 'EH');
  const cmpLows = lows.slice(1).map((p, i) => (p.price > lows[i]!.price ? 'HL' : p.price < lows[i]!.price ? 'LL' : 'EL') as 'HL' | 'LL' | 'EL');

  let state: TrendState = 'unbekannt';
  if (cmpHighs.length >= 1 && cmpLows.length >= 1) {
    const up = cmpHighs.every((c) => c === 'HH') && cmpLows.every((c) => c === 'HL');
    const down = cmpHighs.every((c) => c === 'LH') && cmpLows.every((c) => c === 'LL');
    state = up ? 'aufwärts' : down ? 'abwärts' : 'seitwärts';
  }

  return {
    state,
    highs: cmpHighs,
    lows: cmpLows,
    lastSwingHigh: highs.length ? round(highs[highs.length - 1]!.price) : null,
    lastSwingLow: lows.length ? round(lows[lows.length - 1]!.price) : null,
  };
}
