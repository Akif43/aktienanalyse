import type { Candle } from '@aktien/core';
import { describe, expect, it } from 'vitest';
import { portfolioHistory } from '../src/lib/portfolio-history';
import type { PortfolioPosition } from '../src/lib/portfolio-store';

const TZ = 'Europe/Istanbul';
const DAY = 24 * 60 * 60;
const NOON = (daysAgo: number) => Math.floor(Date.now() / 1000) - daysAgo * DAY;

/** Eine tägliche Kerzenreihe mit konstantem Preis über den angegebenen Zeitraum (nur `close` wird von der Kurssuche genutzt). */
function flatHistory(days: number, price: number): Candle[] {
  const out: Candle[] = [];
  for (let d = days; d >= 0; d--) out.push({ time: NOON(d), open: price, high: price, low: price, close: price, volume: 0 });
  return out;
}

describe('portfolioHistory', () => {
  it('liefert eine leere Reihe, wenn es noch keinen Kauf gibt', () => {
    expect(portfolioHistory([], new Map(), { USD: [], EUR: [] }, 'TRY', TZ)).toEqual([]);
  });

  it('vor dem Kaufdatum trägt eine Position nichts zum Wert bei, danach schon', () => {
    const stock: PortfolioPosition = {
      kind: 'stock',
      key: 'AAPL',
      symbol: 'AAPL',
      market: 'US',
      lots: [{ id: '1', quantity: 10, price: 100, date: NOON(5) * 1000 }],
    };
    const priceHistory = new Map([['AAPL', flatHistory(10, 100)]]);
    const points = portfolioHistory([stock], priceHistory, { USD: [], EUR: [] }, 'USD', TZ);
    expect(points.length).toBeGreaterThan(1);
    // Erster Punkt liegt vor dem Kauf? Nein: Start ist genau das erste Kaufdatum, also schon 10*100=1000
    expect(points[0]!.close).toBeCloseTo(1000);
    expect(points.at(-1)!.close).toBeCloseTo(1000); // Preis konstant, Bestand unverändert seit Kauf
  });

  it('berücksichtigt mehrere Käufe zu unterschiedlichen Zeitpunkten (Stückzahl wächst im Verlauf)', () => {
    const stock: PortfolioPosition = {
      kind: 'stock',
      key: 'AAPL',
      symbol: 'AAPL',
      market: 'US',
      lots: [
        { id: '1', quantity: 10, price: 100, date: NOON(20) * 1000 },
        { id: '2', quantity: 5, price: 100, date: NOON(5) * 1000 },
      ],
    };
    const priceHistory = new Map([['AAPL', flatHistory(25, 100)]]);
    const points = portfolioHistory([stock], priceHistory, { USD: [], EUR: [] }, 'USD', TZ);
    // Am Anfang (Tag des ersten Kaufs) hält man nur 10 Stück, am Ende 15
    expect(points[0]!.close).toBeCloseTo(1000);
    expect(points.at(-1)!.close).toBeCloseTo(1500);
  });

  it('rechnet Fremdwährungspositionen mit dem historischen Wechselkurs in die Zielwährung um', () => {
    const stock: PortfolioPosition = {
      kind: 'stock',
      key: 'AAPL',
      symbol: 'AAPL',
      market: 'US',
      lots: [{ id: '1', quantity: 10, price: 100, date: NOON(5) * 1000 }],
    };
    const priceHistory = new Map([['AAPL', flatHistory(10, 100)]]);
    const usdHistory = flatHistory(10, 40); // 40 TRY je 1 USD, konstant
    const points = portfolioHistory([stock], priceHistory, { USD: usdHistory, EUR: [] }, 'TRY', TZ);
    // 10 Stück * 100 USD * 40 TRY/USD = 40000 TRY
    expect(points.at(-1)!.close).toBeCloseTo(40000);
  });

  it('lässt einen Tag ohne bekannten Wechselkurs mit Wert 0 statt eines falschen Betrags', () => {
    const stock: PortfolioPosition = {
      kind: 'stock',
      key: 'AAPL',
      symbol: 'AAPL',
      market: 'US',
      lots: [{ id: '1', quantity: 10, price: 100, date: NOON(5) * 1000 }],
    };
    const priceHistory = new Map([['AAPL', flatHistory(10, 100)]]);
    const points = portfolioHistory([stock], priceHistory, { USD: [], EUR: [] }, 'TRY', TZ); // kein USD-Verlauf
    expect(points.every((p) => p.close === 0)).toBe(true);
  });

  it('fehlt der Kursverlauf einer Position ganz, trägt sie nichts bei, andere Positionen zählen trotzdem', () => {
    const withHistory: PortfolioPosition = { kind: 'fund', key: 'AFT', symbol: 'AFT', lots: [{ id: '1', quantity: 100, price: 1, date: NOON(5) * 1000 }] };
    const withoutHistory: PortfolioPosition = { kind: 'fund', key: 'YAY', symbol: 'YAY', lots: [{ id: '2', quantity: 50, price: 1, date: NOON(5) * 1000 }] };
    const priceHistory = new Map([['AFT', flatHistory(10, 2)]]); // YAY fehlt bewusst
    const points = portfolioHistory([withHistory, withoutHistory], priceHistory, { USD: [], EUR: [] }, 'TRY', TZ);
    expect(points.at(-1)!.close).toBeCloseTo(200); // nur AFT: 100 * 2
  });

  it('begrenzt die Anzahl der Punkte bei langen Zeiträumen', () => {
    const stock: PortfolioPosition = {
      kind: 'stock',
      key: 'AAPL',
      symbol: 'AAPL',
      market: 'US',
      lots: [{ id: '1', quantity: 1, price: 100, date: NOON(2000) * 1000 }], // gut 5 Jahre zurück
    };
    const priceHistory = new Map([['AAPL', flatHistory(2000, 100)]]);
    const points = portfolioHistory([stock], priceHistory, { USD: [], EUR: [] }, 'USD', TZ);
    expect(points.length).toBeLessThanOrEqual(201);
  });
});
