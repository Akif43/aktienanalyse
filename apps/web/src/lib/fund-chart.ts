import type { FundPricePoint } from '@aktien/core';
import { buildChartData, type ChartData } from './chart-data';

/** TEFAS-Datumsangaben sind Istanbuler Kalendertage; Mittag UTC verhindert, dass die Zeitzonen-Umrechnung den Tag verschiebt. */
const NOON_UTC_H = 12;

/**
 * Baut aus dem täglichen Nettoinventarwert eines Fonds Diagrammdaten für den einfachen Linienchart. Ein Fonds hat nur
 * einen Preis pro Tag (kein Eröffnungs-/Höchst-/Tiefstkurs, kein Volumen): Open/High/Low/Close werden alle auf diesen
 * einen Preis gesetzt, damit sich der vorhandene Chart (Linienmodus) und `periodStats` unverändert wiederverwenden lassen.
 */
export function buildFundChartData(points: readonly FundPricePoint[]): ChartData {
  const candles = points.map((p) => {
    const [y, m, d] = p.date.split('-').map(Number) as [number, number, number];
    return { time: Date.UTC(y, m - 1, d, NOON_UTC_H) / 1000, open: p.price, high: p.price, low: p.price, close: p.price, volume: 0 };
  });
  return buildChartData(candles, { tz: 'Europe/Istanbul', daily: true, withIndicators: false });
}
