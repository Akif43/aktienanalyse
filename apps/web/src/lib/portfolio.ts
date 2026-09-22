import { MARKET_CURRENCY } from '@aktien/core';
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

export interface PortfolioTotals {
  /** Aktueller Gesamtwert in Lira. */
  valueTRY: number;
  /** Eingesetztes Kapital in Lira. */
  costTRY: number;
  gainTRY: number;
  /** Prozent bezogen auf costTRY; `null` ohne eingesetztes Kapital. */
  gainPercent: number | null;
  /** true, wenn für mindestens eine Position kein aktueller Kurs oder Wechselkurs vorlag (Summe ist dann unvollständig). */
  incomplete: boolean;
  /** Zahl der Positionen, die in der Summe fehlen. */
  missingCount: number;
}

/**
 * Summiert alle Positionen zu einem Gesamtbild in Lira. Positionen ohne aktuellen Kurs (noch nicht geladen oder
 * Datenquelle nicht erreichbar) oder ohne den nötigen Wechselkurs fließen weder in Wert noch Kapital ein, damit die
 * Prozentangabe stimmig bleibt; `incomplete` zeigt an, dass die Summe dadurch zu niedrig ausfällt.
 */
export function portfolioTotals(positions: readonly PortfolioPosition[], priceByKey: ReadonlyMap<string, number | null>, fx: FxRates): PortfolioTotals {
  let valueTRY = 0;
  let costTRY = 0;
  let missingCount = 0;
  for (const p of positions) {
    const currency = positionCurrency(p);
    const price = priceByKey.get(p.key);
    const value = price === undefined ? null : positionValue(p, price);
    const valueInTRY = value === null ? null : toTRY(value, currency, fx);
    const costInTRY = toTRY(positionCostBasis(p), currency, fx);
    if (valueInTRY === null || costInTRY === null) {
      missingCount++;
      continue;
    }
    valueTRY += valueInTRY;
    costTRY += costInTRY;
  }
  const gainTRY = valueTRY - costTRY;
  return { valueTRY, costTRY, gainTRY, gainPercent: costTRY > 0 ? (gainTRY / costTRY) * 100 : null, incomplete: missingCount > 0, missingCount };
}
