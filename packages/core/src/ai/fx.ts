import type { Candle } from '../types';
import { round } from '../indicators/series';

/**
 * Währungsumrechnung für BIST-Aktien. Wechselkursreihe = Tageskerzen eines Paares wie USDTRY=X
 * (TRY je 1 USD bzw. EUR). Schlusskurs der Aktie in USD = TRY-Kurs / Kurs USDTRY am selben Tag.
 */

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
function dayKey(unixSec: number, tz: string): string {
  let f = dayFormatters.get(tz);
  if (!f) dayFormatters.set(tz, (f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })));
  return f.format(unixSec * 1000); // YYYY-MM-DD
}

/** Tageskurse als sortierte Liste (Datum → Schlusskurs) mit Vorwärtsauffüllung für fehlende Tage. */
export function makeRateLookup(fx: readonly Candle[], tz: string): (unixSec: number) => number | null {
  const days = fx.map((c) => ({ day: dayKey(c.time, tz), rate: c.close })).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return (unixSec) => {
    if (days.length === 0) return null;
    const key = dayKey(unixSec, tz);
    let lo = 0;
    let hi = days.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (days[mid]!.day <= key) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    // Vor dem ersten bekannten Kurs: ersten Kurs verwenden statt die Kerze zu verlieren
    return days[best >= 0 ? best : 0]!.rate;
  };
}

/** Rechnet Kerzen in eine andere Währung um (Open/High/Low/Close je durch den Tageskurs). Volumen bleibt. */
export function convertCandles(candles: readonly Candle[], fx: readonly Candle[], tz: string): Candle[] {
  const rateAt = makeRateLookup(fx, tz);
  const out: Candle[] = [];
  for (const c of candles) {
    const rate = rateAt(c.time);
    if (!rate || rate <= 0) continue;
    out.push({ ...c, open: c.open / rate, high: c.high / rate, low: c.low / rate, close: c.close / rate });
  }
  return out;
}

export interface FxPeriod {
  label: string;
  /** Kerzen im Zeitraum (Näherung für Handelstage). */
  bars: number;
  /** Kursänderung in TRY (Prozent). */
  localPercent: number;
  /** Kursänderung in der Fremdwährung (Prozent). */
  foreignPercent: number;
  /** Änderung des Wechselkurses (Prozent, positiv = Lira schwächer). */
  fxPercent: number;
}

export interface FxPerformance {
  currency: string;
  periods: FxPeriod[];
}

const PERIODS: { label: string; bars: number }[] = [
  { label: '3 Monate', bars: 63 },
  { label: '6 Monate', bars: 126 },
  { label: '1 Jahr', bars: 252 },
];

/**
 * Vergleicht die Kursentwicklung in TRY mit der in USD/EUR. Zeigt, wie stark nominale Lira-Gewinne durch die
 * Abwertung schrumpfen. Zeiträume, für die zu wenig Daten vorliegen, entfallen.
 */
export function computeFxPerformance(stock: readonly Candle[], fx: readonly Candle[], currency: string, tz: string): FxPerformance {
  const rateAt = makeRateLookup(fx, tz);
  const periods: FxPeriod[] = [];
  const last = stock.at(-1);
  if (!last) return { currency, periods };
  const endRate = rateAt(last.time);
  if (!endRate) return { currency, periods };

  for (const p of PERIODS) {
    const startIdx = stock.length - 1 - p.bars;
    if (startIdx < 0) continue;
    const start = stock[startIdx]!;
    const startRate = rateAt(start.time);
    if (!startRate) continue;
    const local = last.close / start.close - 1;
    const foreign = last.close / endRate / (start.close / startRate) - 1;
    periods.push({
      label: p.label,
      bars: p.bars,
      localPercent: round(local * 100, 1)!,
      foreignPercent: round(foreign * 100, 1)!,
      fxPercent: round((endRate / startRate - 1) * 100, 1)!,
    });
  }
  return { currency, periods };
}
