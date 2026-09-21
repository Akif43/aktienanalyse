import { bollinger, macd, rsi, sma, type Candle, type Series, type Timeframe } from '@aktien/core';

/** Zeitwert für Lightweight Charts: Kalendertag (Tageskerzen) oder UTC-Sekunden (Intraday, in Börsen-Ortszeit verschoben). */
export type ChartTime = number | { year: number; month: number; day: number };

export interface Point {
  time: ChartTime;
  value: number;
}
export interface HistPoint extends Point {
  up: boolean;
}
export interface CandlePoint {
  time: ChartTime;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ChartData {
  candles: CandlePoint[];
  volume: HistPoint[];
  /** Indikatoren gibt es nur bei Tageskerzen (SMA200 braucht 200 Kerzen Vorlauf). */
  indicators: null | {
    sma20: Point[];
    sma50: Point[];
    sma200: Point[];
    bbUpper: Point[];
    bbMiddle: Point[];
    bbLower: Point[];
    rsi: Point[];
    macd: Point[];
    macdSignal: Point[];
    macdHist: HistPoint[];
  };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function localParts(unixSec: number, tz: string) {
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(unixSec * 1000)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { year: p.year!, month: p.month!, day: p.day!, hour: p.hour!, minute: p.minute!, second: p.second! };
}

/**
 * Tageskerzen → Kalendertag der Börse. Intraday → "Wanduhr"-Zeit der Börse als UTC-Sekunden, damit die
 * Zeitachse die Ortszeit der Börse zeigt (Lightweight Charts kennt nur UTC).
 */
export function toChartTime(unixSec: number, tz: string, daily: boolean): ChartTime {
  const p = localParts(unixSec, tz);
  if (daily) return { year: p.year, month: p.month, day: p.day };
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000;
}

const timeKey = (t: ChartTime): number => (typeof t === 'number' ? t : t.year * 10_000 + t.month * 100 + t.day);

/** Lightweight Charts verlangt streng aufsteigende, eindeutige Zeiten (Sommerzeitwechsel oder Wochenkerzen können kollidieren). */
function strictlyAscending<T extends { time: ChartTime }>(points: T[]): T[] {
  const out: T[] = [];
  let last = -Infinity;
  for (const p of points) {
    const k = timeKey(p.time);
    if (k > last) {
      out.push(p);
      last = k;
    }
  }
  return out;
}

/** Sichtbarer Zeitraum bei Tageskerzen: Tage vor der letzten Kerze. */
export const VISIBLE_DAYS: Partial<Record<Timeframe, number>> = { '6M': 183, '1J': 366 };

export interface BuildOptions {
  tz: string;
  daily: boolean;
  /** Nur Kerzen ab diesem Zeitpunkt anzeigen (Unix-Sekunden). Indikatoren rechnen trotzdem auf allen Kerzen. */
  fromUnix?: number;
  withIndicators?: boolean;
}

export function buildChartData(candles: readonly Candle[], opts: BuildOptions): ChartData {
  const { tz, daily } = opts;
  const from = opts.fromUnix ?? -Infinity;
  const indexes: number[] = [];
  candles.forEach((c, i) => {
    if (c.time >= from) indexes.push(i);
  });

  const time = (i: number) => toChartTime(candles[i]!.time, tz, daily);
  const line = (series: Series): Point[] =>
    strictlyAscending(indexes.flatMap((i) => (series[i] === null || series[i] === undefined ? [] : [{ time: time(i), value: series[i] as number }])));

  const candlePoints = strictlyAscending(
    indexes.map((i) => ({ time: time(i), open: candles[i]!.open, high: candles[i]!.high, low: candles[i]!.low, close: candles[i]!.close })),
  );
  const volume = strictlyAscending(indexes.map((i) => ({ time: time(i), value: candles[i]!.volume, up: candles[i]!.close >= candles[i]!.open })));

  let indicators: ChartData['indicators'] = null;
  if (opts.withIndicators && daily) {
    const closes = candles.map((c) => c.close);
    const bb = bollinger(closes, 20, 2);
    const m = macd(closes);
    indicators = {
      sma20: line(sma(closes, 20)),
      sma50: line(sma(closes, 50)),
      sma200: line(sma(closes, 200)),
      bbUpper: line(bb.upper),
      bbMiddle: line(bb.middle),
      bbLower: line(bb.lower),
      rsi: line(rsi(closes, 14)),
      macd: line(m.macd),
      macdSignal: line(m.signal),
      macdHist: strictlyAscending(
        indexes.flatMap((i) => (m.histogram[i] === null || m.histogram[i] === undefined ? [] : [{ time: time(i), value: m.histogram[i] as number, up: (m.histogram[i] as number) >= 0 }])),
      ),
    };
  }
  return { candles: candlePoints, volume, indicators };
}

/** Beginn des sichtbaren Bereichs für 6M/1J, bezogen auf die letzte Kerze. */
export function visibleFrom(candles: readonly Candle[], tf: Timeframe): number | undefined {
  const days = VISIBLE_DAYS[tf];
  const last = candles.at(-1);
  return days && last ? last.time - days * 86_400 : undefined;
}
