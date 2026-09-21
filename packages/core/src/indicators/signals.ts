import type { Candle } from '../types';
import { round, type Series } from './series';

export interface CrossEvent {
  type: 'golden' | 'death';
  index: number;
  time: number;
  /** Kerzen seit dem Kreuz (0 = aktuelle Kerze). */
  barsAgo: number;
}

export interface CrossInfo {
  /** Golden-Cross-Regime: SMA50 über SMA200. */
  regime: 'golden' | 'death' | 'unbekannt';
  lastCross: CrossEvent | null;
}

/** Sucht das letzte Kreuz zweier Reihen (schnell kreuzt langsam von unten = golden, von oben = death). */
export function detectCross(fast: Series, slow: Series, candles: readonly Candle[]): CrossInfo {
  let regime: CrossInfo['regime'] = 'unbekannt';
  let lastCross: CrossEvent | null = null;
  let prevSign = 0;
  for (let i = 0; i < candles.length; i++) {
    const f = fast[i];
    const s = slow[i];
    if (f === null || f === undefined || s === null || s === undefined) continue;
    const sign = f > s ? 1 : f < s ? -1 : 0;
    if (sign !== 0) {
      if (prevSign !== 0 && sign !== prevSign) {
        lastCross = {
          type: sign > 0 ? 'golden' : 'death',
          index: i,
          time: candles[i]!.time,
          barsAgo: candles.length - 1 - i,
        };
      }
      prevSign = sign;
      regime = sign > 0 ? 'golden' : 'death';
    }
  }
  return { regime, lastCross };
}

export interface Range52w {
  high: number;
  low: number;
  /** Prozent, um die der Kurs unter dem 52W-Hoch liegt (0 = am Hoch). */
  percentBelowHigh: number;
  /** Prozent, um die der Kurs über dem 52W-Tief liegt (0 = am Tief). */
  percentAboveLow: number;
  /** Anzahl Kerzen, auf denen die Berechnung beruht. */
  bars: number;
  /** true, wenn weniger als ein Jahr (252 Handelstage) verfügbar war. */
  partial: boolean;
}

export function range52w(candles: readonly Candle[], tradingDays = 252): Range52w | null {
  if (candles.length === 0) return null;
  const window = candles.slice(-tradingDays);
  let high = -Infinity;
  let low = Infinity;
  for (const c of window) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }
  const close = candles[candles.length - 1]!.close;
  return {
    high: round(high)!,
    low: round(low)!,
    percentBelowHigh: round(((high - close) / high) * 100, 2)!,
    percentAboveLow: round(((close - low) / low) * 100, 2)!,
    bars: window.length,
    partial: window.length < tradingDays,
  };
}

export interface MacdState {
  /** Lage der MACD-Linie zur Signallinie. */
  position: 'über Signal' | 'unter Signal' | 'unbekannt';
  /** Letztes Kreuz von MACD- und Signallinie. */
  lastCross: { type: 'bullish' | 'bearish'; barsAgo: number } | null;
}

export function macdState(macdLine: Series, signal: Series): MacdState {
  let prevSign = 0;
  let position: MacdState['position'] = 'unbekannt';
  let lastCross: MacdState['lastCross'] = null;
  for (let i = 0; i < macdLine.length; i++) {
    const m = macdLine[i];
    const s = signal[i];
    if (m === null || m === undefined || s === null || s === undefined) continue;
    const sign = m > s ? 1 : m < s ? -1 : 0;
    if (sign === 0) continue;
    if (prevSign !== 0 && sign !== prevSign) {
      lastCross = { type: sign > 0 ? 'bullish' : 'bearish', barsAgo: macdLine.length - 1 - i };
    }
    prevSign = sign;
    position = sign > 0 ? 'über Signal' : 'unter Signal';
  }
  return { position, lastCross };
}
