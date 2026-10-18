import { DEFAULT_GRAHAM_SETTINGS, type Fundamentals } from '@aktien/core';
import { describe, expect, it } from 'vitest';
import { mergeGrahamInput } from '../src/lib/graham-input';
import { GrahamInputsStore, GrahamSettingsStore, sanitizeGrahamInputs, sanitizeGrahamManual, sanitizeGrahamSettings } from '../src/lib/graham-store';
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

describe('GrahamSettingsStore', () => {
  it('startet mit den Standardwerten und speichert Änderungen dauerhaft', () => {
    const storage = fakeStorage();
    const s = new GrahamSettingsStore(storage);
    expect(s.getSnapshot()).toEqual(DEFAULT_GRAHAM_SETTINGS);
    s.set({ ...DEFAULT_GRAHAM_SETTINGS, riskFreeRate: 3, safetyMargin: 35 });
    expect(new GrahamSettingsStore(storage).getSnapshot()).toMatchObject({ riskFreeRate: 3, safetyMargin: 35 });
  });

  it('setzt auf die Standardwerte zurück und benachrichtigt Abonnenten', () => {
    const s = new GrahamSettingsStore(fakeStorage());
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.set({ ...DEFAULT_GRAHAM_SETTINGS, bondYield: 6 });
    s.reset();
    expect(s.getSnapshot()).toEqual(DEFAULT_GRAHAM_SETTINGS);
    expect(calls).toBe(2);
    off();
    s.set({ ...DEFAULT_GRAHAM_SETTINGS, bondYield: 7 });
    expect(calls).toBe(2);
  });

  it('ersetzt unbrauchbare Werte durch den Standard, behält aber die gültigen', () => {
    expect(sanitizeGrahamSettings('kaputt')).toEqual(DEFAULT_GRAHAM_SETTINGS);
    const messy = sanitizeGrahamSettings({ riskFreeRate: 'x', equityRiskPremium: -1, countryRiskBist: 4, bondYield: 0, safetyMargin: 95, safetyMarginHighDebt: 45 });
    expect(messy).toEqual({ ...DEFAULT_GRAHAM_SETTINGS, countryRiskBist: 4, safetyMarginHighDebt: 45 });
  });

  it('übersteht kaputten Speicher und Speicherfehler', () => {
    expect(new GrahamSettingsStore(fakeStorage({ 'aktien.graham.settings.v1': '{kein json' })).getSnapshot()).toEqual(DEFAULT_GRAHAM_SETTINGS);
    const broken: StorageLike = { getItem: () => null, setItem: () => { throw new Error('Quota'); }, removeItem: () => {} };
    const s = new GrahamSettingsStore(broken);
    expect(() => s.set({ ...DEFAULT_GRAHAM_SETTINGS, riskFreeRate: 2 })).not.toThrow();
    expect(s.getSnapshot().riskFreeRate).toBe(2);
  });
});

describe('GrahamInputsStore', () => {
  const manual = { shares: 1e9, netDebt: -5e9, years: [{ year: 2025, netIncome: 3e9, ebit: 4e9, avgFx: 40 }] };

  it('speichert Eingaben je Ticker (Großschreibung) und entfernt sie wieder', () => {
    const storage = fakeStorage();
    const s = new GrahamInputsStore(storage);
    s.set('thyao.is', manual);
    expect(s.get('THYAO.IS')).toMatchObject({ shares: 1e9 });
    expect(new GrahamInputsStore(storage).get('thyao.is')).toMatchObject({ netDebt: -5e9 });
    s.clear('THYAO.IS');
    expect(s.get('THYAO.IS')).toBeUndefined();
    expect(JSON.parse(storage.data['aktien.graham.inputs.v1']!)).toEqual({});
  });

  it('leere Eingaben löschen den Eintrag, statt einen leeren zu speichern', () => {
    const s = new GrahamInputsStore(fakeStorage());
    s.set('AAPL', manual);
    s.set('AAPL', {});
    expect(s.get('AAPL')).toBeUndefined();
  });

  it('liefert bei Änderung eine neue Referenz und benachrichtigt Abonnenten', () => {
    const s = new GrahamInputsStore(fakeStorage());
    let calls = 0;
    s.subscribe(() => calls++);
    const before = s.getSnapshot();
    s.set('AAPL', manual);
    expect(s.getSnapshot()).not.toBe(before);
    s.clear('GIBTS-NICHT');
    expect(calls).toBe(1);
  });

  it('bereinigt manipulierte Speicherinhalte', () => {
    expect(sanitizeGrahamInputs('kaputt')).toEqual({});
    expect(sanitizeGrahamInputs([1, 2])).toEqual({});
    const messy = sanitizeGrahamInputs({
      ' aapl ': {
        shares: -5, // ungültig
        netDebt: 7,
        reportingCurrency: 'EUR', // ungültig
        years: [
          { year: 2024, netIncome: 2, ebit: 'x', avgFx: -1 },
          { year: 2024, netIncome: 9 }, // doppelt
          { year: 1800, netIncome: 1 }, // unplausibel
          { year: 2023, netIncome: 1 },
          null,
        ],
        dividendYears: [{ year: 2020, amount: 1 }, { year: 2020, amount: 2 }, { year: 2021, amount: -1 }],
      },
      leer: { shares: 'x' },
    });
    expect(Object.keys(messy)).toEqual(['AAPL']);
    expect(messy.AAPL).toEqual({
      netDebt: 7,
      years: [
        { year: 2023, netIncome: 1, ebit: null, avgFx: null },
        { year: 2024, netIncome: 2, ebit: null, avgFx: null },
      ],
      dividendYears: [{ year: 2020, amount: 1 }],
    });
    expect(sanitizeGrahamManual({})).toBeNull();
  });
});

describe('mergeGrahamInput', () => {
  const auto: Fundamentals = {
    market: 'BIST',
    source: 'isyatirim',
    reportingCurrency: 'TRY',
    years: [
      { year: 2023, netIncome: 10, ebit: 12, avgFx: 24 },
      { year: 2024, netIncome: 20, ebit: 22, avgFx: 33 },
      { year: 2025, netIncome: 30, ebit: 31, avgFx: 40 },
    ],
    shares: 100,
    netDebt: 5,
    equity: 50,
    dividends: [{ year: 2025, amount: 1 }],
    dividendCoverageFromYear: 2014,
    currentFx: 45,
    avgUsdTry: { 2021: 9, 2022: 16.7, 2023: 24, 2024: 33, 2025: 40 },
    warnings: [],
  };
  const ctx = { market: 'BIST' as const, price: 100, currentYear: 2026 };

  it('ohne manuelle Eingaben gelten die automatischen Daten', () => {
    const m = mergeGrahamInput(auto, undefined, ctx);
    expect(m.missing).toEqual([]);
    expect(m.usesManual).toBe(false);
    expect(m.input).toMatchObject({ market: 'BIST', price: 100, shares: 100, netDebt: 5, reportingCurrency: 'TRY', currentFx: 45, dividendCoverageFromYear: 2014, ttmEps: null });
    expect(m.input!.years).toHaveLength(3);
  });

  it('einzelne Felder überschreiben nur den jeweiligen Wert (Berichtswährung, Aktienzahl, Nettoschuld, TTM-EPS)', () => {
    const m = mergeGrahamInput(auto, { reportingCurrency: 'USD', shares: 7, netDebt: -3, ttmEps: 2.5, currentFx: 50 }, ctx);
    expect(m.usesManual).toBe(true);
    expect(m.input).toMatchObject({ reportingCurrency: 'USD', shares: 7, netDebt: -3, ttmEps: 2.5, currentFx: 50 });
    expect(m.input!.years).toHaveLength(3); // Reihe bleibt die automatische
  });

  it('eine eigene Jahresreihe ersetzt die automatische komplett und füllt fehlende Jahresschnittskurse aus der Antwort', () => {
    const m = mergeGrahamInput(auto, { years: [{ year: 2022, netIncome: 5, ebit: null, avgFx: null }, { year: 2023, netIncome: 6, ebit: null, avgFx: 25 }] }, ctx);
    expect(m.input!.years).toEqual([
      { year: 2022, netIncome: 5, ebit: null, avgFx: 16.7 },
      { year: 2023, netIncome: 6, ebit: null, avgFx: 25 },
    ]);
  });

  it('eigene Dividendenliste gilt als vollständig (10 Jahre Abdeckung)', () => {
    const m = mergeGrahamInput(auto, { dividendYears: [{ year: 2025, amount: 3 }] }, ctx);
    expect(m.input!.dividendYears).toEqual([{ year: 2025, amount: 3 }]);
    expect(m.input!.dividendCoverageFromYear).toBe(2016);
  });

  it('fehlende Pflichtangaben → keine Eingabe, dafür die Liste der Lücken (Maske zeigt Hinweis)', () => {
    expect(mergeGrahamInput(undefined, undefined, ctx)).toEqual({ input: null, missing: ['years', 'shares', 'netDebt'], usesManual: false });
    const partial = mergeGrahamInput({ ...auto, shares: null, netDebt: null }, { shares: 10 }, ctx);
    expect(partial.missing).toEqual(['netDebt']);
    expect(partial.input).toBeNull();
    expect(partial.usesManual).toBe(true);
  });

  it('ohne Berichtswährung (alle Daten manuell) gilt TL', () => {
    const m = mergeGrahamInput(undefined, { years: [{ year: 2025, netIncome: 1, ebit: null, avgFx: 40 }], shares: 1, netDebt: 0 }, ctx);
    expect(m.input!.reportingCurrency).toBe('TRY');
  });
});
