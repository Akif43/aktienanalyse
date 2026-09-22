import { MARKET_CURRENCY } from '@aktien/core';
import type { CashHoldings } from './cash-store';
import type { ChartCurrency } from './currency';
import type { PortfolioPosition } from './portfolio-store';

/** Landeswährung einer Position: Fonds immer TRY, Aktien je nach Börsenplatz. */
export function positionCurrency(position: Pick<PortfolioPosition, 'kind' | 'market'>): string {
  return position.kind === 'fund' || !position.market ? 'TRY' : MARKET_CURRENCY[position.market];
}

/** Gehaltene Stückzahl (Summe aller Käufe). */
export function positionQuantity(position: PortfolioPosition): number {
  return position.lots.reduce((sum, l) => sum + l.quantity, 0);
}

/** Eingesetztes Kapital in der Landeswährung (Summe aus Stückzahl × Kaufpreis je Kauf). */
export function positionCostBasis(position: PortfolioPosition): number {
  return position.lots.reduce((sum, l) => sum + l.quantity * l.price, 0);
}

/** Durchschnittlicher Kaufpreis je Stück (gewichtet nach Stückzahl), `null` ohne Bestand. */
export function positionAvgPrice(position: PortfolioPosition): number | null {
  const qty = positionQuantity(position);
  return qty > 0 ? positionCostBasis(position) / qty : null;
}

/** Aktueller Wert der Position in der Landeswährung, `null` ohne bekannten aktuellen Kurs. */
export function positionValue(position: PortfolioPosition, currentPrice: number | null | undefined): number | null {
  return currentPrice === null || currentPrice === undefined ? null : positionQuantity(position) * currentPrice;
}

export interface Gain {
  amount: number;
  /** Prozent bezogen auf das eingesetzte Kapital; `null`, wenn kein Kapital eingesetzt wurde (Kaufpreis 0). */
  percent: number | null;
}

/** Gewinn/Verlust einer Position in der Landeswährung. */
export function positionGain(position: PortfolioPosition, currentPrice: number | null | undefined): Gain | null {
  const value = positionValue(position, currentPrice);
  if (value === null) return null;
  const cost = positionCostBasis(position);
  const amount = value - cost;
  return { amount, percent: cost > 0 ? (amount / cost) * 100 : null };
}

export interface FxRates {
  /** TRY je 1 USD bzw. 1 EUR; `null`, wenn (noch) nicht geladen. */
  USD: number | null;
  EUR: number | null;
}

/** Rechnet einen Betrag in der angegebenen Währung nach TRY um. `null`, wenn der nötige Kurs fehlt. */
export function toTRY(amount: number, currency: string, fx: FxRates): number | null {
  if (currency === 'TRY') return amount;
  const rate = currency === 'USD' ? fx.USD : currency === 'EUR' ? fx.EUR : null;
  return rate === null ? null : amount * rate;
}

/** Rechnet einen Betrag von einer Währung in eine andere um (über TRY als Zwischenschritt). `null`, wenn ein nötiger Kurs fehlt. */
export function convertAmount(amount: number, from: string, to: ChartCurrency, fx: FxRates): number | null {
  const inTRY = toTRY(amount, from, fx);
  if (inTRY === null) return null;
  if (to === 'TRY') return inTRY;
  const rate = to === 'USD' ? fx.USD : fx.EUR;
  return rate === null ? null : inTRY / rate;
}

const CASH_CURRENCIES: readonly (keyof CashHoldings)[] = ['TRY', 'USD', 'EUR'];

export interface CashTotal {
  amount: number;
  /** true, wenn für mindestens eine gehaltene Währung der Wechselkurs fehlt (Summe ist dann unvollständig). */
  incomplete: boolean;
}

/** Summiert das Bargeld über alle Währungen in die Zielwährung. */
export function cashTotal(cash: CashHoldings, to: ChartCurrency, fx: FxRates): CashTotal {
  let amount = 0;
  let incomplete = false;
  for (const c of CASH_CURRENCIES) {
    const held = cash[c];
    if (!held) continue;
    const converted = convertAmount(held, c, to, fx);
    if (converted === null) {
      incomplete = true;
      continue;
    }
    amount += converted;
  }
  return { amount, incomplete };
}

export interface PortfolioTotals {
  /** Aktueller Gesamtwert der Positionen, in der Zielwährung. */
  value: number;
  /** Eingesetztes Kapital, in der Zielwährung. */
  cost: number;
  gain: number;
  /** Prozent bezogen auf cost; `null` ohne eingesetztes Kapital. */
  gainPercent: number | null;
  /** true, wenn für mindestens eine Position kein aktueller Kurs oder Wechselkurs vorlag (Summe ist dann unvollständig). */
  incomplete: boolean;
  /** Zahl der Positionen, die in der Summe fehlen. */
  missingCount: number;
}

/**
 * Summiert alle Positionen zu einem Gesamtbild in der gewünschten Zielwährung (Standard Lira). Positionen ohne
 * aktuellen Kurs (noch nicht geladen oder Datenquelle nicht erreichbar) oder ohne den nötigen Wechselkurs fließen
 * weder in Wert noch Kapital ein, damit die Prozentangabe stimmig bleibt; `incomplete` zeigt an, dass die Summe
 * dadurch zu niedrig ausfällt.
 */
export function portfolioTotals(positions: readonly PortfolioPosition[], priceByKey: ReadonlyMap<string, number | null>, fx: FxRates, to: ChartCurrency = 'TRY'): PortfolioTotals {
  let value = 0;
  let cost = 0;
  let missingCount = 0;
  for (const p of positions) {
    const currency = positionCurrency(p);
    const price = priceByKey.get(p.key);
    const posValue = price === undefined ? null : positionValue(p, price);
    const valueIn = posValue === null ? null : convertAmount(posValue, currency, to, fx);
    const costIn = convertAmount(positionCostBasis(p), currency, to, fx);
    if (valueIn === null || costIn === null) {
      missingCount++;
      continue;
    }
    value += valueIn;
    cost += costIn;
  }
  const gain = value - cost;
  return { value, cost, gain, gainPercent: cost > 0 ? (gain / cost) * 100 : null, incomplete: missingCount > 0, missingCount };
}
