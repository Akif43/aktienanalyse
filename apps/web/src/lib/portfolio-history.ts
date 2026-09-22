import { makeRateLookup, type Candle } from '@aktien/core';
import type { ChartCurrency } from './currency';
import { positionCurrency } from './portfolio';
import type { PortfolioPosition } from './portfolio-store';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Höchstens so viele Punkte im Verlaufschart, egal wie lang der Zeitraum ist (Performance, Lesbarkeit). */
const MAX_POINTS = 200;

/** Rechnet einen Betrag von einer Währung in eine andere um, mit einer Kursfunktion für einen bestimmten Tag statt eines festen Kurses. */
function convertAtDay(amount: number, from: string, to: ChartCurrency, rateFor: (currency: string) => number | null): number | null {
  if (from === to) return amount;
  const inTRY = from === 'TRY' ? amount : ((r) => (r === null ? null : amount * r))(rateFor(from));
  if (inTRY === null) return null;
  if (to === 'TRY') return inTRY;
  const rate = rateFor(to);
  return rate === null ? null : inTRY / rate;
}

/**
 * Baut den Depot-Wert über die Zeit (ohne Bargeld, dessen Kaufdatum unbekannt ist): für jeden Tag ab dem ersten
 * Kauf die zu diesem Zeitpunkt bereits gehaltene Stückzahl je Position mal historischem Kurs (vorwärts aufgefüllt
 * bei Datenlücken), umgerechnet in die Zielwährung. Fehlt für eine Position der Kursverlauf oder für eine
 * Fremdwährung der Wechselkurs an einem Tag, trägt sie an diesem Tag nichts zur Summe bei (statt eines falschen
 * Werts). Liefert leere Kerzen, wenn es noch keinen Kauf gibt.
 */
export function portfolioHistory(
  positions: readonly PortfolioPosition[],
  priceHistory: ReadonlyMap<string, readonly Candle[]>,
  fxHistory: { USD: readonly Candle[]; EUR: readonly Candle[] },
  to: ChartCurrency,
  tz: string,
): Candle[] {
  const lotDates = positions.flatMap((p) => p.lots.map((l) => l.date));
  if (lotDates.length === 0) return [];
  const startMs = Math.min(...lotDates);
  const endMs = Date.now();
  if (startMs >= endMs) return [];

  const priceLookup = new Map<string, (t: number) => number | null>();
  for (const p of positions) {
    const hist = priceHistory.get(p.key);
    priceLookup.set(p.key, hist && hist.length > 0 ? makeRateLookup(hist, tz) : () => null);
  }
  const usdLookup = makeRateLookup(fxHistory.USD, tz);
  const eurLookup = makeRateLookup(fxHistory.EUR, tz);
  const rateFor = (currency: string, t: number): number | null => (currency === 'USD' ? usdLookup(t) : currency === 'EUR' ? eurLookup(t) : null);

  const totalDays = Math.max(1, Math.round((endMs - startMs) / DAY_MS));
  const pointCount = Math.min(MAX_POINTS, totalDays) + 1;
  const grid: number[] = [];
  for (let i = 0; i < pointCount - 1; i++) grid.push(startMs + Math.round((i * (endMs - startMs)) / (pointCount - 1)));
  grid.push(endMs);

  const valueAt = (ms: number): number => {
    const t = Math.floor(ms / 1000);
    let value = 0;
    for (const p of positions) {
      const heldQty = p.lots.reduce((sum, l) => (l.date <= ms ? sum + l.quantity : sum), 0);
      if (heldQty <= 0) continue;
      const priceAt = priceLookup.get(p.key)!(t);
      if (priceAt === null) continue;
      const converted = convertAtDay(heldQty * priceAt, positionCurrency(p), to, (c) => rateFor(c, t));
      if (converted !== null) value += converted;
    }
    return value;
  };

  return grid.map((ms) => {
    const value = valueAt(ms);
    const time = Math.floor(ms / 1000);
    return { time, open: value, high: value, low: value, close: value, volume: 0 };
  });
}
