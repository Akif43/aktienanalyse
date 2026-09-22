import type { Candle, FundPricePoint } from '@aktien/core';
import { buildChartData, type ChartData } from './chart-data';

/** Zeitzone, in der TEFAS-Datumsangaben (Kalendertage) ausgelegt werden. Fonds haben keine eigene Handelszeitzone. */
export const FUND_TZ = 'Europe/Istanbul';
/** Mittag UTC verhindert, dass die Zeitzonen-Umrechnung den Kalendertag verschiebt. */
const NOON_UTC_H = 12;

/**
 * Wandelt den täglichen Nettoinventarwert eines Fonds in Kerzen um. Ein Fonds hat nur einen Preis pro Tag (kein
 * Eröffnungs-/Höchst-/Tiefstkurs, kein Volumen): Open/High/Low/Close werden alle auf diesen einen Preis gesetzt, damit
 * sich vorhandene Werkzeuge (Linienchart, `periodStats`, `convertCandles` für die Währungsumrechnung) unverändert
 * wiederverwenden lassen.
 */
export function fundCandles(points: readonly FundPricePoint[]): Candle[] {
  return points.map((p) => {
    const [y, m, d] = p.date.split('-').map(Number) as [number, number, number];
    return { time: Date.UTC(y, m - 1, d, NOON_UTC_H) / 1000, open: p.price, high: p.price, low: p.price, close: p.price, volume: 0 };
  });
}

/** Baut aus Fonds-Kerzen (siehe `fundCandles`) Diagrammdaten für den einfachen Linienchart. */
export function buildFundChartData(candles: readonly Candle[]): ChartData {
  return buildChartData(candles, { tz: FUND_TZ, daily: true, withIndicators: false });
}
