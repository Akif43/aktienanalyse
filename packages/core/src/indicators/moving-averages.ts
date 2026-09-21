import type { Series } from './series';

/** Einfacher gleitender Durchschnitt. Erste Werte bis Index n-2 sind null. */
export function sma(values: Series, n: number): Series {
  assertPeriod(n);
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  let count = 0; // Anzahl aufeinanderfolgender gültiger Werte im Fenster
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined || !Number.isFinite(v)) {
      sum = 0;
      count = 0;
      continue;
    }
    sum += v;
    count++;
    if (count > n) sum -= values[i - n] as number;
    if (count >= n) out[i] = sum / n;
  }
  return out;
}

/**
 * Exponentieller gleitender Durchschnitt (Faktor 2/(n+1)), gestartet mit dem SMA der ersten n Werte
 * (Konvention von TradingView/StockCharts). Führende nulls (z. B. bei der MACD-Signallinie) sind erlaubt.
 */
export function ema(values: Series, n: number): Series {
  assertPeriod(n);
  const out: Series = new Array(values.length).fill(null);
  const alpha = 2 / (n + 1);
  let prev: number | null = null;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined || !Number.isFinite(v)) {
      if (prev !== null) throw new Error('ema: null nach dem Start der Reihe');
      continue;
    }
    if (prev === null) {
      seedSum += v;
      seedCount++;
      if (seedCount === n) {
        prev = seedSum / n;
        out[i] = prev;
      }
    } else {
      prev = alpha * v + (1 - alpha) * prev;
      out[i] = prev;
    }
  }
  return out;
}

export function assertPeriod(n: number): void {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Ungültige Periode: ${n}`);
}
