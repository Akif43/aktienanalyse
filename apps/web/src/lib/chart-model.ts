import { convertCandles, type Market, type Timeframe } from '@aktien/core';
import { useMemo } from 'react';
import { buildChartData, visibleFrom } from './chart-data';
import { useChartSeries, useHistory, usesDailyHistory } from './hooks';
import { marketTimezone } from './format';

export type ChartCurrency = 'TRY' | 'USD' | 'EUR';
export const FX_SYMBOL = { USD: 'USDTRY=X', EUR: 'EURTRY=X' } as const;
export const TIMEFRAMES: readonly Timeframe[] = ['1T', '1W', '1M', '6M', '1J', '5J'];

/**
 * Kursdaten für ein Diagramm: Zeitraum laden, bei Bedarf in USD/EUR umrechnen (nur BIST) und für die Anzeige aufbereiten.
 * Die einfache Ansicht und der Kerzenchart nutzen dasselbe Modell, die Abfragen teilen sich den Zwischenspeicher.
 */
export function useChartModel(ticker: string, market: Market, tf: Timeframe, currency: ChartCurrency) {
  const series = useChartSeries(ticker, tf);
  const fxSymbol = currency === 'USD' ? FX_SYMBOL.USD : currency === 'EUR' ? FX_SYMBOL.EUR : FX_SYMBOL.USD;
  const needsFx = market === 'BIST' && currency !== 'TRY';
  const fx = useHistory(fxSymbol, needsFx);
  const daily = usesDailyHistory(tf);
  const intraday = tf === '1T' || tf === '1W' || tf === '1M';
  const tz = marketTimezone(market);

  const data = useMemo(() => {
    if (!series.data) return undefined;
    if (needsFx && !fx.data) return undefined;
    // Umrechnung mit dem Tageskurs des jeweiligen Tages; bei Intraday-Kerzen ist das eine Näherung
    const candles = needsFx && fx.data ? convertCandles(series.data.candles, fx.data.candles, tz) : series.data.candles;
    return buildChartData(candles, { tz, daily: !intraday, withIndicators: daily, fromUnix: daily ? visibleFrom(candles, tf) : undefined });
  }, [series.data, fx.data, needsFx, tz, intraday, daily, tf]);

  return { series, fx: needsFx ? fx : undefined, data, daily, intraday };
}

/** Veränderung, Höchst- und Tiefststand über die sichtbaren Kerzen. */
export function periodStats(candles: { open: number; high: number; low: number; close: number }[]) {
  if (candles.length === 0) return null;
  const first = candles[0]!;
  const last = candles.at(-1)!;
  let high = -Infinity;
  let low = Infinity;
  for (const c of candles) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }
  // Startpunkt ist der Schlusskurs der ersten sichtbaren Kerze (dieselbe Basis wie die Farbe der Kurslinie)
  const base = first.close;
  return { changePercent: base ? ((last.close - base) / base) * 100 : null, high, low };
}
