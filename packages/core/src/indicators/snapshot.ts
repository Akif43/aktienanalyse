import { msg, type Msg } from '../messages';
import type { Candle } from '../types';
import { ema, sma } from './moving-averages';
import { atr, bollinger, macd, rsi } from './oscillators';
import { lastValue, normalizeCandles, round } from './series';
import { detectCross, macdState, range52w, type CrossInfo, type MacdState, type Range52w } from './signals';
import { findPivots, supportResistance, trendStructure, type SupportResistance, type TrendStructure } from './structure';
import { volumeTrend, type VolumeTrend } from './volume';

export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface MovingAverageInfo {
  value: number | null;
  /** Abstand des Schlusskurses zum Durchschnitt in Prozent (positiv = Kurs darüber). */
  priceDistancePercent: number | null;
}

export interface TechnicalSnapshot {
  schemaVersion: number;
  /** Anzahl der verwendeten Tageskerzen und Zeitstempel der letzten Kerze (Unix-Sekunden). */
  bars: number;
  asOf: number;
  price: number;
  sma: { '20': MovingAverageInfo; '50': MovingAverageInfo; '200': MovingAverageInfo };
  ema: { '20': MovingAverageInfo; '50': MovingAverageInfo; '200': MovingAverageInfo };
  crossSma50Sma200: CrossInfo;
  rsi14: { value: number | null; zone: 'überkauft' | 'überverkauft' | 'neutral' | 'unbekannt' };
  macd: {
    macd: number | null;
    signal: number | null;
    histogram: number | null;
    state: MacdState;
  };
  bollinger: {
    upper: number | null;
    middle: number | null;
    lower: number | null;
    /** %B: 0 = untere Bande, 1 = obere Bande. */
    percentB: number | null;
    /** Bandbreite relativ zum Mittelband in Prozent. */
    bandwidthPercent: number | null;
  };
  atr14: { value: number | null; percentOfPrice: number | null };
  volume: VolumeTrend;
  levels: SupportResistance;
  trend: TrendStructure;
  range52w: Range52w | null;
  /** Hinweise auf fehlende Daten, damit weder Anwender noch KI Lücken übersehen. */
  warnings: Msg[];
}

export interface SnapshotOptions {
  pivotLeft?: number;
  pivotRight?: number;
  /** Hinweise der Datenquelle (z. B. verworfene Kerzen), werden in `warnings` übernommen. */
  extraWarnings?: Msg[];
}

const MIN_BARS = 30;
const DAY_S = 86_400;
/** Ein verlängertes Wochenende (Fr–Di) ergibt bis zu 4 Tage Abstand; mehr deutet auf fehlende Daten hin. */
const MAX_NORMAL_GAP_DAYS = 4;

/** Findet Lücken in den letzten `lookback` Kerzen, die länger sind als ein normales verlängertes Wochenende. */
function findGaps(candles: readonly Candle[], lookback = 120): number {
  let gaps = 0;
  for (let i = Math.max(1, candles.length - lookback); i < candles.length; i++) {
    if ((candles[i]!.time - candles[i - 1]!.time) / DAY_S > MAX_NORMAL_GAP_DAYS) gaps++;
  }
  return gaps;
}

/**
 * Berechnet alle Kennzahlen deterministisch aus Tageskerzen. Das Ergebnis ist die einzige Zahlenquelle
 * für die KI-Analyse.
 */
export function computeTechnicalSnapshot(
  input: readonly Partial<Candle>[],
  opts: SnapshotOptions = {},
): TechnicalSnapshot {
  const candles = normalizeCandles(input);
  if (candles.length < MIN_BARS) {
    throw new Error(`Zu wenig Daten für eine technische Analyse: ${candles.length} Kerzen (mind. ${MIN_BARS}).`);
  }

  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1]!;
  const warnings: Msg[] = [...(opts.extraWarnings ?? [])];
  const gaps = findGaps(candles);
  if (gaps > 0) warnings.push(msg('gaps', { count: gaps, days: MAX_NORMAL_GAP_DAYS }));
  if (candles.length < 200) warnings.push(msg('shortHistory200', { bars: candles.length }));
  else if (candles.length < 252) warnings.push(msg('short52w', { bars: candles.length }));

  const maInfo = (values: (number | null)[]): MovingAverageInfo => {
    const v = lastValue(values);
    return {
      value: round(v),
      priceDistancePercent: v === null ? null : round(((price - v) / v) * 100, 2),
    };
  };

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);

  const rsiValue = lastValue(rsi(closes, 14));
  const m = macd(closes);
  const bb = bollinger(closes, 20, 2);
  const atrValue = lastValue(atr(candles, 14));

  const bbUpper = lastValue(bb.upper);
  const bbLower = lastValue(bb.lower);
  const bbMiddle = lastValue(bb.middle);

  const pivots = findPivots(candles, opts.pivotLeft ?? 5, opts.pivotRight ?? 5);
  const tolerance = atrValue !== null ? atrValue * 0.5 : price * 0.01;

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    bars: candles.length,
    asOf: candles[candles.length - 1]!.time,
    price: round(price)!,
    sma: { '20': maInfo(sma20), '50': maInfo(sma50), '200': maInfo(sma200) },
    ema: { '20': maInfo(ema20), '50': maInfo(ema50), '200': maInfo(ema200) },
    crossSma50Sma200: detectCross(sma50, sma200, candles),
    rsi14: {
      value: round(rsiValue, 2),
      zone: rsiValue === null ? 'unbekannt' : rsiValue >= 70 ? 'überkauft' : rsiValue <= 30 ? 'überverkauft' : 'neutral',
    },
    macd: {
      macd: round(lastValue(m.macd)),
      signal: round(lastValue(m.signal)),
      histogram: round(lastValue(m.histogram)),
      state: macdState(m.macd, m.signal),
    },
    bollinger: {
      upper: round(bbUpper),
      middle: round(bbMiddle),
      lower: round(bbLower),
      percentB:
        bbUpper !== null && bbLower !== null && bbUpper !== bbLower ? round((price - bbLower) / (bbUpper - bbLower), 3) : null,
      bandwidthPercent:
        bbUpper !== null && bbLower !== null && bbMiddle ? round(((bbUpper - bbLower) / bbMiddle) * 100, 2) : null,
    },
    atr14: { value: round(atrValue), percentOfPrice: atrValue === null ? null : round((atrValue / price) * 100, 2) },
    volume: volumeTrend(candles),
    levels: supportResistance(pivots, candles.length - 1, price, { tolerance }),
    trend: trendStructure(pivots),
    range52w: range52w(candles),
    warnings,
  };
}
