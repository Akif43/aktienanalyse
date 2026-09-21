import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Candle } from '../src/types';

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

export function readFixture(name: string): string {
  return readFileSync(fixturePath(name), 'utf-8');
}

export function readJsonFixture<T = unknown>(name: string): T {
  return JSON.parse(readFixture(name)) as T;
}

/** Baut Kerzen aus Schlusskursen: Open = Vortagsschluss, High/Low = ±spread um Open/Close. */
export function candlesFromCloses(closes: number[], spread = 0.5, volume = 1000): Candle[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1]!;
    return {
      time: 1_700_000_000 + i * 86_400,
      open,
      high: Math.max(open, close) + spread,
      low: Math.min(open, close) - spread,
      close,
      volume,
    };
  });
}

/** Dreieckswelle zwischen min und max mit gegebener Periode (Hoch bei period/2, Tief bei 0 bzw. period). */
export function triangleWave(length: number, period: number, min: number, max: number, drift = 0): number[] {
  const half = period / 2;
  return Array.from({ length }, (_, i) => {
    const phase = i % period;
    const t = 1 - Math.abs(phase - half) / half; // 0 am Tief, 1 am Hoch
    return min + (max - min) * t + drift * i;
  });
}

export function expectClose(actual: number | null | undefined, expected: number | null, tol: number, label = ''): void {
  if (expected === null) {
    if (actual !== null && actual !== undefined) throw new Error(`${label}: erwartet null, erhalten ${actual}`);
    return;
  }
  if (actual === null || actual === undefined) throw new Error(`${label}: erwartet ${expected}, erhalten null`);
  if (Math.abs(actual - expected) > tol) throw new Error(`${label}: erwartet ${expected}, erhalten ${actual} (Toleranz ${tol})`);
}
