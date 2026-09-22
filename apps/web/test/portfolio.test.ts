import { describe, expect, it } from 'vitest';
import { positionAvgPrice, positionCostBasis, positionCurrency, positionGain, positionQuantity, positionValue, portfolioTotals, toTRY } from '../src/lib/portfolio';
import { PortfolioStore, sanitizePositions, type PortfolioPosition } from '../src/lib/portfolio-store';
import type { StorageLike } from '../src/lib/storage';

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

describe('PortfolioStore', () => {
  it('startet leer, legt beim ersten Kauf die Position an und speichert dauerhaft', () => {
    const storage = fakeStorage();
    const s = new PortfolioStore(storage, () => 'id1');
    expect(s.getSnapshot()).toEqual([]);
    s.addLot({ kind: 'stock', key: 'thyao.is', symbol: 'THYAO', market: 'BIST', name: 'Türk Hava Yolları' }, { quantity: 10, price: 250, date: 1000 });
    expect(s.getSnapshot()).toEqual([{ kind: 'stock', key: 'THYAO.IS', symbol: 'THYAO', market: 'BIST', name: 'Türk Hava Yolları', lots: [{ id: 'id1', quantity: 10, price: 250, date: 1000 }] }]);
    expect(new PortfolioStore(storage).getSnapshot()[0]!.key).toBe('THYAO.IS');
  });

  it('häuft mehrere Käufe der gleichen Position an, statt sie zu duplizieren', () => {
    let n = 0;
    const s = new PortfolioStore(fakeStorage(), () => `id${n++}`);
    s.addLot({ kind: 'fund', key: 'AFT', symbol: 'AFT', name: 'AK Portföy' }, { quantity: 100, price: 1.5, date: 1000 });
    s.addLot({ kind: 'fund', key: 'aft', symbol: 'AFT' }, { quantity: 50, price: 2.0, date: 2000 });
    const pos = s.position('AFT');
    expect(pos?.lots).toHaveLength(2);
    expect(pos?.name).toBe('AK Portföy'); // Name bleibt vom ersten Kauf, ein Kauf ohne Namen überschreibt nicht
  });

  it('lehnt ungültige Käufe ab (Stückzahl/Preis)', () => {
    const s = new PortfolioStore(fakeStorage());
    s.addLot({ kind: 'fund', key: 'AFT', symbol: 'AFT' }, { quantity: 0, price: 1, date: 1000 });
    s.addLot({ kind: 'fund', key: 'AFT', symbol: 'AFT' }, { quantity: 1, price: -1, date: 1000 });
    expect(s.getSnapshot()).toEqual([]);
  });

  it('entfernt einen einzelnen Kauf, und die Position verschwindet, wenn es der letzte war', () => {
    let n = 0;
    const s = new PortfolioStore(fakeStorage(), () => `id${n++}`);
    s.addLot({ kind: 'fund', key: 'AFT', symbol: 'AFT' }, { quantity: 10, price: 1, date: 1000 });
    s.addLot({ kind: 'fund', key: 'AFT', symbol: 'AFT' }, { quantity: 5, price: 2, date: 2000 });
    s.removeLot('AFT', 'id0');
    expect(s.position('AFT')?.lots).toHaveLength(1);
    s.removeLot('AFT', 'id1');
    expect(s.position('AFT')).toBeUndefined();
  });

  it('entfernt eine ganze Position', () => {
    const s = new PortfolioStore(fakeStorage());
    s.addLot({ kind: 'fund', key: 'AFT', symbol: 'AFT' }, { quantity: 10, price: 1, date: 1000 });
    s.removePosition('AFT');
    expect(s.getSnapshot()).toEqual([]);
  });

  it('benachrichtigt Abonnenten bei Änderung', () => {
    const s = new PortfolioStore(fakeStorage());
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.addLot({ kind: 'fund', key: 'AFT', symbol: 'AFT' }, { quantity: 10, price: 1, date: 1000 });
    expect(calls).toBe(1);
    off();
    s.addLot({ kind: 'fund', key: 'YAY', symbol: 'YAY' }, { quantity: 1, price: 1, date: 1000 });
    expect(calls).toBe(1);
  });

  it('Export und Import sind verlustfrei und ersetzen das Depot', () => {
    const a = new PortfolioStore(fakeStorage(), () => 'id1');
    a.addLot({ kind: 'stock', key: 'AAPL', symbol: 'AAPL', market: 'US' }, { quantity: 3, price: 150, date: 1000 });
    const json = a.exportJson();
    const b = new PortfolioStore(fakeStorage({ 'aktien.portfolio.v1': JSON.stringify([{ kind: 'fund', key: 'ALT', symbol: 'ALT', lots: [{ id: 'x', quantity: 1, price: 1, date: 1 }] }]) }));
    expect(b.replaceAll(JSON.parse(json))).toBe(1);
    expect(b.getSnapshot()[0]!.key).toBe('AAPL');
    expect(b.replaceAll('kaputt')).toBe(0);
    expect(b.getSnapshot()).toEqual([]);
  });
});

describe('sanitizePositions', () => {
  it('übersteht kaputte oder manipulierte Speicherinhalte', () => {
    expect(sanitizePositions('kaputt')).toEqual([]);
    expect(sanitizePositions(undefined)).toEqual([]);
    const messy = [
      { kind: 'stock', key: 'aapl', symbol: 'AAPL', market: 'US', lots: [{ quantity: 1, price: 100, date: 1000 }] },
      { kind: 'stock', key: 'x', symbol: 'X', market: 'MOND', lots: [{ quantity: 1, price: 1, date: 1 }] }, // ungültiger Markt
      { kind: 'fund', key: 'noLots', symbol: 'X', lots: [] }, // keine Käufe
      { kind: 'other', key: 'x', symbol: 'X', lots: [] }, // ungültige Art
      { kind: 'fund', key: 'AAPL', symbol: 'DUP', lots: [{ quantity: 1, price: 1, date: 1 }] }, // Dublette (Key großgeschrieben)
      null,
      'x',
    ];
    const out = sanitizePositions(messy);
    expect(out.map((p) => p.key)).toEqual(['AAPL']);
    expect(out[0]!.lots).toHaveLength(1);
  });

  it('verwirft einzelne kaputte Käufe, behält aber die gültigen', () => {
    const raw = [{ kind: 'fund', key: 'AFT', symbol: 'AFT', lots: [{ quantity: 1, price: 1, date: 1000 }, { quantity: -1, price: 1, date: 1000 }, 'kaputt', null] }];
    const out = sanitizePositions(raw);
    expect(out[0]!.lots).toHaveLength(1);
  });
});

describe('reine Berechnungen (portfolio.ts)', () => {
  const stock: PortfolioPosition = { kind: 'stock', key: 'AAPL', symbol: 'AAPL', market: 'US', lots: [{ id: '1', quantity: 2, price: 100, date: 1000 }, { id: '2', quantity: 3, price: 120, date: 2000 }] };
  const fund: PortfolioPosition = { kind: 'fund', key: 'AFT', symbol: 'AFT', lots: [{ id: '3', quantity: 100, price: 1.5, date: 1000 }] };

  it('positionCurrency: Fonds immer TRY, Aktien nach Börsenplatz', () => {
    expect(positionCurrency(stock)).toBe('USD');
    expect(positionCurrency(fund)).toBe('TRY');
    expect(positionCurrency({ kind: 'stock', market: 'XETRA' })).toBe('EUR');
  });

  it('positionQuantity/positionCostBasis/positionAvgPrice: gewichteter Durchschnitt über mehrere Käufe', () => {
    expect(positionQuantity(stock)).toBe(5);
    expect(positionCostBasis(stock)).toBe(2 * 100 + 3 * 120); // 560
    expect(positionAvgPrice(stock)).toBeCloseTo(112);
  });

  it('positionValue/positionGain: null ohne aktuellen Kurs, sonst Wert und Gewinn/Verlust', () => {
    expect(positionValue(stock, undefined)).toBeNull();
    expect(positionValue(stock, null)).toBeNull();
    expect(positionValue(stock, 130)).toBe(650);
    const gain = positionGain(stock, 130);
    expect(gain).not.toBeNull();
    expect(gain!.amount).toBeCloseTo(90); // 650 - 560
    expect(gain!.percent).toBeCloseTo((90 / 560) * 100);
    expect(positionGain(stock, undefined)).toBeNull();
  });

  it('toTRY: TRY bleibt unverändert, Fremdwährung braucht den Kurs', () => {
    expect(toTRY(100, 'TRY', { USD: null, EUR: null })).toBe(100);
    expect(toTRY(100, 'USD', { USD: 40, EUR: null })).toBe(4000);
    expect(toTRY(100, 'USD', { USD: null, EUR: null })).toBeNull();
    expect(toTRY(100, 'EUR', { USD: null, EUR: 43 })).toBe(4300);
  });

  it('portfolioTotals: rechnet alle Positionen nach Lira um und summiert', () => {
    const priceByKey = new Map<string, number | null>([['AAPL', 130], ['AFT', 2.0]]);
    const totals = portfolioTotals([stock, fund], priceByKey, { USD: 40, EUR: 43 });
    // Aktie: Wert 650 USD -> 26000 TRY, Kapital 560 USD -> 22400 TRY; Fonds: Wert 200 TRY, Kapital 150 TRY
    expect(totals.valueTRY).toBeCloseTo(26000 + 200);
    expect(totals.costTRY).toBeCloseTo(22400 + 150);
    expect(totals.incomplete).toBe(false);
    expect(totals.missingCount).toBe(0);
  });

  it('portfolioTotals: Position ohne Kurs oder fehlenden Wechselkurs macht die Summe "incomplete", statt einen falschen Wert zu zeigen', () => {
    const priceByKey = new Map<string, number | null>([['AFT', 2.0]]); // AAPL fehlt (noch nicht geladen)
    const totals = portfolioTotals([stock, fund], priceByKey, { USD: null, EUR: null });
    expect(totals.valueTRY).toBeCloseTo(200);
    expect(totals.costTRY).toBeCloseTo(150);
    expect(totals.incomplete).toBe(true);
    expect(totals.missingCount).toBe(1);
  });

  it('portfolioTotals: leeres Depot ergibt Nullen ohne Prozentangabe', () => {
    const totals = portfolioTotals([], new Map(), { USD: null, EUR: null });
    expect(totals).toEqual({ valueTRY: 0, costTRY: 0, gainTRY: 0, gainPercent: null, incomplete: false, missingCount: 0 });
  });
});
