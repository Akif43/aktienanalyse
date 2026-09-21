import type { Candle } from '../types';
import { round } from './series';

export interface VolumeTrend {
  avg20: number | null;
  avg50: number | null;
  /** avg20 / avg50: >1 = zuletzt mehr Handel als üblich. */
  ratio: number | null;
  /** Volumen an Aufwärtstagen / Volumen an Abwärtstagen der letzten 20 Kerzen. */
  upDownVolumeRatio: number | null;
  label: 'steigend' | 'fallend' | 'neutral' | 'unbekannt';
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function volumeTrend(candles: readonly Candle[]): VolumeTrend {
  const vols = candles.map((c) => c.volume);
  const avg20 = vols.length >= 20 ? mean(vols.slice(-20)) : null;
  const avg50 = vols.length >= 50 ? mean(vols.slice(-50)) : null;
  const ratio = avg20 !== null && avg50 !== null && avg50 > 0 ? avg20 / avg50 : null;

  let up = 0;
  let down = 0;
  const recent = candles.slice(-21);
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i]!.close - recent[i - 1]!.close;
    if (diff > 0) up += recent[i]!.volume;
    else if (diff < 0) down += recent[i]!.volume;
  }
  const upDownVolumeRatio = recent.length >= 21 && down > 0 ? up / down : null;

  let label: VolumeTrend['label'] = 'unbekannt';
  if (ratio !== null) label = ratio >= 1.15 ? 'steigend' : ratio <= 0.85 ? 'fallend' : 'neutral';

  return {
    avg20: round(avg20, 0),
    avg50: round(avg50, 0),
    ratio: round(ratio, 3),
    upDownVolumeRatio: round(upDownVolumeRatio, 3),
    label,
  };
}
