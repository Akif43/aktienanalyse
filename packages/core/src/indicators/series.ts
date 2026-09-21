import type { Candle } from '../types';

/** Indikator-Zeitreihe, gleich lang wie die Eingabe. `null` = noch nicht berechenbar (Einschwingphase). */
export type Series = (number | null)[];

export function last<T>(arr: readonly T[]): T | undefined {
  return arr[arr.length - 1];
}

export function lastValue(series: Series): number | null {
  return series.length ? (series[series.length - 1] ?? null) : null;
}

export function round(value: number | null, digits = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * Bereinigt Rohkerzen: entfernt unvollständige/ungültige Werte (Yahoo liefert bei Feiertagen
 * gelegentlich null), sortiert aufsteigend und entfernt doppelte Zeitstempel (letzte gewinnt).
 */
export function normalizeCandles(input: readonly Partial<Candle>[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of input) {
    const { time, open, high, low, close } = c;
    const volume = c.volume ?? 0;
    if (
      typeof time !== 'number' ||
      ![open, high, low, close, volume].every((v) => typeof v === 'number' && Number.isFinite(v))
    ) {
      continue;
    }
    if (high! < low! || close! <= 0) continue;
    byTime.set(time, { time, open: open!, high: high!, low: low!, close: close!, volume });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
