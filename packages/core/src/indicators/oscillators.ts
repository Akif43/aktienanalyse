import type { Candle } from '../types';
import { assertPeriod, ema, sma } from './moving-averages';
import type { Series } from './series';

/**
 * RSI nach Wilder. Der erste Wert steht bei Index n (n Kursänderungen nötig).
 * Sonderfälle: keine Verluste → 100, weder Gewinne noch Verluste → 50.
 */
export function rsi(closes: readonly number[], n = 14): Series {
  assertPeriod(n);
  const out: Series = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d > 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= n;
  avgLoss /= n;
  out[n] = rsiValue(avgGain, avgLoss);

  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    avgGain = (avgGain * (n - 1) + Math.max(d, 0)) / n;
    avgLoss = (avgLoss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = rsiValue(avgGain, avgLoss);
  }
  return out;
}

function rsiValue(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

/** MACD (Standard 12/26/9): Linie = EMA12 − EMA26, Signal = EMA9 der Linie. */
export function macd(closes: readonly number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  if (fast >= slow) throw new Error('macd: fast muss kleiner als slow sein');
  const values: Series = [...closes];
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const line: Series = values.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f !== null && f !== undefined && s !== null && s !== undefined ? f - s : null;
  });
  const signal = ema(line, signalPeriod);
  const histogram: Series = line.map((m, i) => {
    const s = signal[i];
    return m !== null && s !== null && s !== undefined ? m - s : null;
  });
  return { macd: line, signal, histogram };
}

export interface BollingerResult {
  middle: Series;
  upper: Series;
  lower: Series;
}

/** Bollinger-Bänder mit SMA und Populations-Standardabweichung (wie TradingView). */
export function bollinger(closes: readonly number[], n = 20, k = 2): BollingerResult {
  assertPeriod(n);
  const middle = sma([...closes], n);
  const upper: Series = new Array(closes.length).fill(null);
  const lower: Series = new Array(closes.length).fill(null);
  for (let i = n - 1; i < closes.length; i++) {
    const mean = middle[i];
    if (mean === null || mean === undefined) continue;
    let sq = 0;
    for (let j = i - n + 1; j <= i; j++) sq += (closes[j]! - mean) ** 2;
    const sd = Math.sqrt(sq / n);
    upper[i] = mean + k * sd;
    lower[i] = mean - k * sd;
  }
  return { middle, upper, lower };
}

/** True Range je Kerze; die erste Kerze hat nur die Spanne High−Low. */
export function trueRange(candles: readonly Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1]!.close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
}

/** Average True Range nach Wilder (RMA, gestartet mit dem Mittel der ersten n True Ranges). */
export function atr(candles: readonly Candle[], n = 14): Series {
  assertPeriod(n);
  const out: Series = new Array(candles.length).fill(null);
  if (candles.length < n) return out;
  const tr = trueRange(candles);
  let prev = 0;
  for (let i = 0; i < n; i++) prev += tr[i]!;
  prev /= n;
  out[n - 1] = prev;
  for (let i = n; i < candles.length; i++) {
    prev = (prev * (n - 1) + tr[i]!) / n;
    out[i] = prev;
  }
  return out;
}
